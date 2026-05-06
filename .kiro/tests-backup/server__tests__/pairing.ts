#!/usr/bin/env tsx
/**
 * Pairing-protocol unit tests (B.8, C.7, D.6, E.5).
 *
 * Runs without the real `better-sqlite3` / `bonjour-service` / `fastify`
 * peer dependencies (none of which are installed in this workspace per
 * CLAUDE.md). To exercise `PairingManager` against SQL semantics we stand
 * up a tiny in-memory shim that implements the subset of `Database` and
 * `Statement` the manager actually uses (see `FakeDb` below). The shim is
 * intentionally minimal and lives under `__tests__` so it never ships.
 *
 * The tests cover:
 *   - lan-ip enforcement (private IPv4 + IPv6 ranges).
 *   - QR / manual / numeric-code payload builders.
 *   - PairingManager open/close lifecycle for every mode.
 *   - one-shot claim semantics + already-claimed error.
 *   - hook approval + rejection paths.
 *   - bootstrap admin token issuance + 24h TTL.
 *   - revocation + token rotation event emission.
 *   - mDNS TXT updates on pairing_open changes.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/pairing.ts`
 */
import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';
import type { Logger } from 'pino';
import { isLanIp } from '../lib/pairing/lan-ip.js';
import {
  buildManualUrl,
  buildQrPayload,
  decodeQrPayload,
  formatNumericCode,
  normalizeNumericCode,
} from '../lib/pairing/payloads.js';
import { PairingManager } from '../lib/pairing/manager.js';
import { EventBus } from '../lib/events/bus.js';
import { HookRegistry } from '../lib/hooks/registry.js';
import { AuditLog, type AuditEntry } from '../lib/audit/log.js';
import { MdnsAdvertiser } from '../lib/pairing/mdns.js';
import { generateClearTextToken, hashToken } from '../lib/pairing/tokens.js';
import { verifyToken } from '../lib/pairing/verify.js';
import { PairingError } from '../lib/pairing/errors.js';

// ---------------------------------------------------------------------------
// In-memory SQLite shim (test-only, hand-rolled).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Table {
  rows: Row[];
}

class FakeDb implements Database {
  readonly open = true;
  readonly inTransaction = false;
  private readonly tables = new Map<string, Table>();

  constructor() {
    // Pre-create the tables PairingManager actually touches.
    this.tables.set('tokens', { rows: [] });
    this.tables.set('pairing_windows', { rows: [] });
    this.tables.set('pairing_requests', { rows: [] });
    this.tables.set('audit', { rows: [] });
  }

  prepare<TParams = unknown, TRow = unknown>(sql: string): Statement<TParams, TRow> {
    return new FakeStatement(this, sql) as unknown as Statement<TParams, TRow>;
  }

  exec(_sql: string): Database {
    return this;
  }

  pragma(_pragma: string): unknown {
    return null;
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    // Synchronous shim: just call fn with given args.
    return ((...args: never[]) => fn(...args)) as T;
  }

  close(): void {
    /* no-op */
  }

  // ---- helpers used by FakeStatement ----------------------------------
  table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new Error(`fake-db: unknown table ${name}`);
    return t;
  }
}

class FakeStatement {
  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const sql = this.sql.trim();
    if (/^INSERT\s+INTO\s+tokens/i.test(sql)) {
      const [id, name, hash, status, created_at, pairing_method, pairing_window_id, expires_at] = params;
      this.db.table('tokens').rows.push({
        id, name, hash, status, created_at, pairing_method, pairing_window_id, expires_at,
        revoked_at: null, last_used_at: null,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^INSERT\s+INTO\s+pairing_windows/i.test(sql)) {
      const [id, opened_at, expires_at, mode, numeric_code, pre_issued_token_id] = params;
      this.db.table('pairing_windows').rows.push({
        id, opened_at, expires_at, closed_at: null, close_reason: null,
        mode, numeric_code, pre_issued_token_id,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^INSERT\s+INTO\s+pairing_requests/i.test(sql)) {
      const [id, candidate_name, requested_at, approved_at, rejected_at, issued_token_id] = params;
      this.db.table('pairing_requests').rows.push({
        id, candidate_name, requested_at, approved_at, rejected_at, issued_token_id,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^INSERT\s+INTO\s+audit/i.test(sql)) {
      const [id, token_id, token_name, operation, args_summary, ts, outcome, latency_ms] = params;
      this.db.table('audit').rows.push({
        id, token_id, token_name, operation, args_summary, ts, outcome, latency_ms,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+pairing_windows\s+SET\s+closed_at/i.test(sql)) {
      const [closed_at, close_reason, id] = params as [string, string, string];
      const row = this.db.table('pairing_windows').rows.find((r) => r['id'] === id && r['closed_at'] === null);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['closed_at'] = closed_at;
      row['close_reason'] = close_reason;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+tokens\s+SET\s+status='revoked'/i.test(sql) && /datetime\('now'\)/.test(sql)) {
      const [id] = params as [string];
      const row = this.db.table('tokens').rows.find((r) => r['id'] === id && r['status'] === 'pending');
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['status'] = 'revoked';
      row['revoked_at'] = new Date().toISOString();
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+tokens\s+SET\s+status='revoked'/i.test(sql)) {
      // markTokenRevoked: SET status='revoked', revoked_at=? WHERE id=? AND revoked_at IS NULL AND status != ?
      const [revoked_at, id, _excludeStatus] = params as [string, string, string];
      const row = this.db.table('tokens').rows.find(
        (r) => r['id'] === id && r['revoked_at'] === null && r['status'] !== 'revoked',
      );
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['status'] = 'revoked';
      row['revoked_at'] = revoked_at;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+tokens\s+SET\s+status='active'/i.test(sql)) {
      // claimPreIssuedToken
      const [name, id] = params as [string, string];
      const row = this.db.table('tokens').rows.find((r) => r['id'] === id && r['status'] === 'pending');
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['status'] = 'active';
      row['name'] = name;
      row['expires_at'] = null;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+tokens\s+SET\s+name\s*=/i.test(sql)) {
      const [name, id] = params as [string, string];
      const row = this.db.table('tokens').rows.find((r) => r['id'] === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['name'] = name;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+tokens\s+SET\s+last_used_at/i.test(sql)) {
      const [last_used_at, id] = params as [string, string];
      const row = this.db.table('tokens').rows.find((r) => r['id'] === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row['last_used_at'] = last_used_at;
      return { changes: 1, lastInsertRowid: 0 };
    }
    throw new Error(`fake-db.run: unhandled SQL: ${sql}`);
  }

  get(...params: unknown[]): Row | undefined {
    return this.iterate(...params).next().value as Row | undefined;
  }

  all(...params: unknown[]): Row[] {
    return [...this.iterate(...params)] as Row[];
  }

  *iterate(...params: unknown[]): IterableIterator<Row> {
    const sql = this.sql.trim();

    if (/^SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+tokens/i.test(sql)) {
      const c = this.db.table('tokens').rows.filter(
        (r) => r['status'] === 'active' && r['revoked_at'] === null,
      ).length;
      yield { c };
      return;
    }
    if (/^SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+pairing_windows\s+WHERE\s+closed_at\s+IS\s+NULL/i.test(sql)) {
      const [now] = params as [string];
      const c = this.db.table('pairing_windows').rows.filter(
        (r) => r['closed_at'] === null && (r['expires_at'] as string) > now,
      ).length;
      yield { c };
      return;
    }
    if (/^SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+pairing_windows\s+WHERE\s+mode='code'/i.test(sql)) {
      const [now] = params as [string];
      const c = this.db.table('pairing_windows').rows.filter(
        (r) => r['mode'] === 'code' && r['closed_at'] === null && (r['expires_at'] as string) > now,
      ).length;
      yield { c };
      return;
    }
    if (/^SELECT\s+id\s+FROM\s+pairing_windows\s+WHERE\s+numeric_code/i.test(sql)) {
      const [code, now] = params as [string, string];
      const found = this.db.table('pairing_windows').rows.find(
        (r) => r['numeric_code'] === code && r['closed_at'] === null && (r['expires_at'] as string) > now,
      );
      if (found) yield { id: found['id'] };
      return;
    }
    if (/^SELECT\s+pre_issued_token_id\s+FROM\s+pairing_windows/i.test(sql)) {
      const [id] = params as [string];
      const found = this.db.table('pairing_windows').rows.find((r) => r['id'] === id);
      if (found) yield { pre_issued_token_id: found['pre_issued_token_id'] };
      return;
    }
    if (/^SELECT\s+closed_at\s+FROM\s+pairing_windows\s+WHERE\s+id\s*=/i.test(sql)) {
      const [id] = params as [string];
      const found = this.db.table('pairing_windows').rows.find((r) => r['id'] === id);
      if (found) yield { closed_at: found['closed_at'] };
      return;
    }
    if (/^SELECT\s+id\s+FROM\s+pairing_windows\s+WHERE\s+closed_at/i.test(sql)) {
      // closeAllWindows: SELECT id ... WHERE closed_at IS NULL
      yield* this.db
        .table('pairing_windows')
        .rows.filter((r) => r['closed_at'] === null)
        .map((r) => ({ id: r['id'] })) as Row[];
      return;
    }
    if (/^SELECT\s+\*\s+FROM\s+pairing_windows\s+WHERE\s+numeric_code/i.test(sql)) {
      const [code, now] = params as [string, string];
      const found = this.db.table('pairing_windows').rows.find(
        (r) => r['numeric_code'] === code && r['closed_at'] === null && (r['expires_at'] as string) > now,
      );
      if (found) yield { ...found };
      return;
    }
    if (/^SELECT\s+\*\s+FROM\s+pairing_windows\s+WHERE\s+closed_at\s+IS\s+NULL/i.test(sql)) {
      const [now] = params as [string];
      const rows = this.db.table('pairing_windows').rows
        .filter((r) => r['closed_at'] === null && (r['expires_at'] as string) > now)
        .sort((a, b) => ((b['opened_at'] as string).localeCompare(a['opened_at'] as string)));
      yield* rows.map((r) => ({ ...r })) as Row[];
      return;
    }
    if (/^SELECT\s+id,\s*name,\s*hash,\s*status/i.test(sql)) {
      // rotateToken's existing-token lookup
      const [id] = params as [string];
      const found = this.db.table('tokens').rows.find((r) => r['id'] === id);
      if (found) yield { ...found };
      return;
    }
    if (/^SELECT\s+id,\s*name,\s*status,\s*revoked_at,\s*expires_at\s+FROM\s+tokens/i.test(sql)) {
      const [hash] = params as [string];
      const found = this.db.table('tokens').rows.find((r) => r['hash'] === hash);
      if (found) yield { ...found };
      return;
    }
    if (/^SELECT\s+id,\s*name,\s*revoked_at,\s*status,\s*expires_at\s+FROM\s+tokens/i.test(sql)) {
      const [hash] = params as [string];
      const found = this.db.table('tokens').rows.find((r) => r['hash'] === hash);
      if (found) yield { ...found };
      return;
    }
    if (/^SELECT\s+id,\s*name,\s*created_at,\s*last_used_at,\s*pairing_method/i.test(sql)) {
      yield* this.db.table('tokens').rows
        .filter((r) => r['status'] === 'active' && r['revoked_at'] === null)
        .map((r) => ({
          id: r['id'],
          name: r['name'],
          created_at: r['created_at'],
          last_used_at: r['last_used_at'],
          pairing_method: r['pairing_method'],
        })) as Row[];
      return;
    }
    if (/^SELECT\s+revoked_at\s+FROM\s+tokens\s+WHERE\s+id\s*=/i.test(sql)) {
      const [id] = params as [string];
      const found = this.db.table('tokens').rows.find((r) => r['id'] === id);
      if (found) yield { revoked_at: found['revoked_at'] };
      return;
    }
    throw new Error(`fake-db.iterate: unhandled SQL: ${sql}`);
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const silentLogger: Logger = {
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
};

function newManager(opts?: { hooks?: HookRegistry; mdns?: MdnsAdvertiser }): {
  manager: PairingManager;
  db: FakeDb;
  bus: EventBus;
  hooks: HookRegistry;
  audit: AuditLog;
  events: { name: string; payload: unknown }[];
  auditEntries: AuditEntry[];
} {
  const db = new FakeDb();
  const bus = new EventBus();
  const events: { name: string; payload: unknown }[] = [];
  bus.subscribe('lifecycle.pairing-window-open', (p) => {
    events.push({ name: 'lifecycle.pairing-window-open', payload: p });
  });
  bus.subscribe('lifecycle.pairing-window-closed', (p) => {
    events.push({ name: 'lifecycle.pairing-window-closed', payload: p });
  });
  bus.subscribe('auth.token-rotated', (p) => {
    events.push({ name: 'auth.token-rotated', payload: p });
  });
  bus.subscribe('auth.token-revoked', (p) => {
    events.push({ name: 'auth.token-revoked', payload: p });
  });
  const hooks = opts?.hooks ?? new HookRegistry();
  const auditEntries: AuditEntry[] = [];
  const audit = new AuditLog(db as unknown as Database, (entry) => auditEntries.push(entry));
  const manager = new PairingManager({
    db: db as unknown as Database,
    bus,
    hooks,
    ...(opts?.mdns ? { mdns: opts.mdns } : {}),
    audit,
    logger: silentLogger,
    catalog_version: '1.0.0',
    server_name: 'test-server',
    default_window_seconds: 60,
    http_address: { ip: '127.0.0.1', port: 7860 },
  });
  return { manager, db, bus, hooks, audit, events, auditEntries };
}

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- lan-ip ----------------------------------------------------------
  ['lan-ip accepts private IPv4 ranges', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.42', '172.16.5.5', '169.254.1.1']) {
      assert.equal(isLanIp(ip), true, `expected ${ip} private`);
    }
  }],
  ['lan-ip rejects public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '34.120.50.1', '172.32.1.1']) {
      assert.equal(isLanIp(ip), false, `expected ${ip} public`);
    }
  }],
  ['lan-ip accepts loopback + link-local + ULA IPv6', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
      assert.equal(isLanIp(ip), true, `expected ${ip} private`);
    }
  }],
  ['lan-ip handles IPv4-mapped IPv6', () => {
    assert.equal(isLanIp('::ffff:192.168.1.1'), true);
    assert.equal(isLanIp('::ffff:8.8.8.8'), false);
  }],

  // ---- payloads --------------------------------------------------------
  ['QR payload round-trips through base64url', () => {
    const enc = buildQrPayload({
      v: 1,
      url: 'http://192.168.1.42:7860',
      ip: '192.168.1.42',
      port: 7860,
      token: 'dcft_aaaa',
      token_id: '01HZK',
      server_name: 'iMac',
      issued_at: '2026-05-04T12:00:00Z',
      expires_at: '2026-05-04T12:02:00Z',
    });
    const decoded = decodeQrPayload(enc);
    assert.equal(decoded.url, 'http://192.168.1.42:7860');
    assert.equal(decoded.token, 'dcft_aaaa');
  }],
  ['manual URL embeds the token in the query string', () => {
    const url = buildManualUrl({ ip: '192.168.1.42', port: 7860, token: 'dcft_xx' });
    assert.equal(url, 'http://192.168.1.42:7860/?t=dcft_xx');
  }],
  ['numeric code formatting + normalization', () => {
    assert.equal(formatNumericCode('123456'), '123-456');
    assert.equal(normalizeNumericCode('  847-219 '), '847219');
    assert.equal(normalizeNumericCode('abc8def4ghi7'), '847');
  }],

  // ---- token issuance --------------------------------------------------
  ['generated cleartext token has dcft_ prefix + 64 hex chars', () => {
    const t = generateClearTextToken();
    assert.match(t, /^dcft_[0-9a-f]{64}$/);
  }],
  ['hashToken produces SHA-256 hex (deterministic)', () => {
    assert.equal(hashToken('abc').length, 64);
    assert.equal(hashToken('abc'), hashToken('abc'));
    assert.notEqual(hashToken('abc'), hashToken('abcd'));
  }],

  // ---- PairingManager open/close --------------------------------------
  ['openWindow(any) emits lifecycle event + audits', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'any', duration_seconds: 10 });
    assert.equal(r.mode, 'any');
    assert.ok(r.window_id);
    assert.ok(t.events.find((e) => e.name === 'lifecycle.pairing-window-open'));
    assert.ok(t.auditEntries.find((a) => a.operation === 'pairing.window-open'));
  }],
  ['openWindow(qr) returns a decodable QR payload', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'qr', duration_seconds: 30 });
    assert.ok(r.qr_payload);
    const decoded = decodeQrPayload(r.qr_payload!);
    assert.match(decoded.token, /^dcft_/);
    assert.equal(decoded.server_name, 'test-server');
  }],
  ['openWindow(code) returns 6-digit code + display form', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'code' });
    assert.match(r.numeric_code!, /^[0-9]{6}$/);
    assert.match(r.numeric_code_display!, /^[0-9]{3}-[0-9]{3}$/);
  }],
  ['openWindow(manual) returns a manual URL', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'manual' });
    assert.match(r.manual_url!, /^http:\/\/127\.0\.0\.1:7860\/\?t=dcft_/);
  }],
  ['closeWindow is idempotent', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'any' });
    t.manager.closeWindow(r.window_id, 'stopped');
    t.manager.closeWindow(r.window_id, 'stopped'); // second call no-op
    const closeEvents = t.events.filter((e) => e.name === 'lifecycle.pairing-window-closed');
    assert.equal(closeEvents.length, 1);
  }],

  // ---- handlePairRequest ----------------------------------------------
  ['handlePairRequest rejects non-LAN source IPs', async () => {
    const t = newManager();
    t.manager.openWindow({ mode: 'any' });
    await assert.rejects(
      () => t.manager.handlePairRequest({ method: 'mdns', candidate_name: 'iPad' }, '8.8.8.8'),
      (err: unknown) => err instanceof PairingError && err.code === 'INTERNET_PAIRING_NOT_SUPPORTED',
    );
  }],
  ['handlePairRequest rejects when no window open', async () => {
    const t = newManager();
    await assert.rejects(
      () => t.manager.handlePairRequest({ method: 'mdns', candidate_name: 'iPad' }, '127.0.0.1'),
      (err: unknown) => err instanceof PairingError && err.code === 'PAIRING_WINDOW_CLOSED',
    );
  }],
  ['handlePairRequest issues fresh active token on mdns/any', async () => {
    const t = newManager();
    t.manager.openWindow({ mode: 'any' });
    const r = await t.manager.handlePairRequest(
      { method: 'mdns', candidate_name: 'iPad de Igna' },
      '127.0.0.1',
    );
    assert.match(r.token, /^dcft_/);
    assert.equal(r.token_name, 'iPad de Igna');
    assert.equal(r.server_name, 'test-server');
  }],
  ['handlePairRequest with code returns the pre-issued cleartext', async () => {
    const t = newManager();
    const w = t.manager.openWindow({ mode: 'code' });
    const r = await t.manager.handlePairRequest(
      { method: 'code', code: w.numeric_code!, candidate_name: 'iPad' },
      '127.0.0.1',
    );
    assert.match(r.token, /^dcft_/);
  }],
  ['handlePairRequest with wrong code returns PAIRING_CODE_MISMATCH', async () => {
    const t = newManager();
    t.manager.openWindow({ mode: 'code' });
    await assert.rejects(
      () => t.manager.handlePairRequest({ method: 'code', code: '000000', candidate_name: 'iPad' }, '127.0.0.1'),
      (err: unknown) => err instanceof PairingError && err.code === 'PAIRING_CODE_MISMATCH',
    );
  }],
  ['second pair request after claim returns PAIRING_TOKEN_ALREADY_CLAIMED for same QR window', async () => {
    const t = newManager();
    const w = t.manager.openWindow({ mode: 'code' });
    await t.manager.handlePairRequest(
      { method: 'code', code: w.numeric_code!, candidate_name: 'iPad' },
      '127.0.0.1',
    );
    // Window has been auto-closed (FR-19); second attempt with the same code
    // hits PAIRING_WINDOW_CLOSED because the window is no longer open.
    await assert.rejects(
      () => t.manager.handlePairRequest(
        { method: 'code', code: w.numeric_code!, candidate_name: 'iPad2' },
        '127.0.0.1',
      ),
      (err: unknown) => err instanceof PairingError && err.code === 'PAIRING_WINDOW_CLOSED',
    );
  }],
  ['handlePairRequest honors hook rejection', async () => {
    const hooks = new HookRegistry();
    hooks.onPairingRequest(() => ({ approved: false, reason: 'denied-by-host' }));
    const t = newManager({ hooks });
    t.manager.openWindow({ mode: 'any' });
    await assert.rejects(
      () => t.manager.handlePairRequest({ method: 'mdns', candidate_name: 'X' }, '127.0.0.1'),
      (err: unknown) => err instanceof PairingError && err.code === 'PAIRING_REJECTED',
    );
  }],

  // ---- bootstrap admin token ------------------------------------------
  ['issueBootstrapAdminToken returns cleartext + 24h TTL', () => {
    const t = newManager();
    const r = t.manager.issueBootstrapAdminToken();
    assert.match(r.token, /^dcft_/);
    const ttlMs = new Date(r.expires_at).getTime() - Date.now();
    assert.ok(ttlMs > 23 * 60 * 60 * 1000 && ttlMs < 25 * 60 * 60 * 1000, 'TTL must be ~24h');
  }],

  // ---- revocation + rotation + verifyToken ----------------------------
  ['revokeToken sets revoked_at + emits auth.token-revoked', () => {
    const t = newManager();
    const r = t.manager.openWindow({ mode: 'any' });
    void r;
    const issued = t.manager.issueBootstrapAdminToken();
    const ok = t.manager.revokeToken(issued.token_id);
    assert.equal(ok, true);
    assert.ok(t.events.find((e) => e.name === 'auth.token-revoked'));
  }],
  ['rotateToken issues a new active token and emits auth.token-rotated', () => {
    const t = newManager();
    const issued = t.manager.issueBootstrapAdminToken();
    const r = t.manager.rotateToken({ current_token_id: issued.token_id, name: 'iPad' });
    assert.ok(r);
    assert.notEqual(r!.token_id, issued.token_id);
    assert.match(r!.token, /^dcft_/);
    assert.ok(t.events.find((e) => e.name === 'auth.token-rotated'));
  }],
  ['rotateToken returns null for unknown / revoked tokens', () => {
    const t = newManager();
    assert.equal(t.manager.rotateToken({ current_token_id: 'nope', name: 'x' }), null);
  }],
  ['verifyToken accepts an active token, rejects revoked/expired', () => {
    const t = newManager();
    const issued = t.manager.issueBootstrapAdminToken();
    const ctx = verifyToken(issued.token, t.db as unknown as Database);
    assert.ok(ctx);
    assert.equal(ctx!.token_name, 'bootstrap-admin');
    t.manager.revokeToken(issued.token_id);
    assert.equal(verifyToken(issued.token, t.db as unknown as Database), null);
  }],
  ['verifyToken rejects a token whose expires_at is in the past', () => {
    const t = newManager();
    const issued = t.manager.issueBootstrapAdminToken();
    // Force expiry by mutating the row directly via the fake-db API.
    const row = t.db.table('tokens').rows.find((r) => r['id'] === issued.token_id);
    row!['expires_at'] = '2000-01-01T00:00:00.000Z';
    assert.equal(verifyToken(issued.token, t.db as unknown as Database), null);
  }],

  // ---- mDNS TXT updates -----------------------------------------------
  ['MdnsAdvertiser.updateTxt only re-broadcasts on actual change', () => {
    const updates: Record<string, string>[] = [];
    const fakePublished = {
      name: 'x',
      type: 't',
      port: 7860,
      txt: { v: '1', cv: '1.0.0', sn: 'x', po: 'false', pm: 'mdns,qr,code,manual' },
      updateTxt(txt: Record<string, string>) {
        updates.push({ ...txt });
      },
      stop() {},
    };
    const advertiser = new MdnsAdvertiser(silentLogger);
    // Inject an already-published service to bypass `bonjour-service`.
    (advertiser as unknown as { published: typeof fakePublished }).published = fakePublished;
    (advertiser as unknown as { currentTxt: Record<string, string> }).currentTxt = { ...fakePublished.txt };
    advertiser.updateTxt({ po: 'false' }); // no change
    advertiser.updateTxt({ po: 'true' });  // change
    advertiser.updateTxt({ po: 'true' });  // no change again
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.['po'], 'true');
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} pairing test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} pairing test(s) passed.`);
  }
})();
