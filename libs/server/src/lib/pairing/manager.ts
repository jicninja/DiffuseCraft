/**
 * `PairingManager` (B.1–B.7, design.md §4.1).
 *
 * Owns every server-side pairing operation:
 *   - Open + close pairing windows (any | mdns | qr | code | manual modes).
 *   - Pre-issue tokens for QR / code / manual modes (pending status).
 *   - Generate collision-free 6-digit numeric codes.
 *   - Build the QR payload + manual URL line.
 *   - Handle anonymous /pair requests: validate window, dispatch hook,
 *     issue or claim a token, persist audit + pairing_request rows, and
 *     produce the response object the HTTP transport returns to the
 *     candidate.
 *   - Bootstrap admin token: issue a 24h-TTL active token on first run with
 *     the cleartext returned to the caller exactly once (CLAUDE.md).
 *
 * The manager is dependency-injected with the SQLite handle, EventBus,
 * HookRegistry, MdnsAdvertiser, AuditLog and Logger; nothing else is
 * stateful inside it (pending timers track open windows so they can be
 * expired). This keeps the manager testable from a tsx runner against
 * `:memory:` SQLite without touching transports.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { EventBus } from '../events/bus.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { AuditLog } from '../audit/log.js';
import type { MdnsAdvertiser } from './mdns.js';
import { newId } from '../id.js';
import { PairingError } from './errors.js';
import { isLanIp } from './lan-ip.js';
import {
  buildManualUrl,
  buildQrPayload,
  formatNumericCode,
  normalizeNumericCode,
} from './payloads.js';
import {
  insertToken,
  markTokenRevoked,
  renameToken,
  type TokenRow,
} from './tokens.js';

export type PairingMode = 'any' | 'mdns' | 'qr' | 'code' | 'manual';
export type PairingMethod = 'mdns' | 'qr' | 'code' | 'manual';
export type WindowCloseReason = 'expired' | 'claimed' | 'stopped';

export interface OpenWindowOptions {
  duration_seconds?: number;
  mode?: PairingMode;
}

export interface OpenWindowResult {
  window_id: string;
  expires_at: string;
  mode: PairingMode;
  numeric_code?: string;
  numeric_code_display?: string;
  qr_payload?: string;
  manual_url?: string;
}

export interface PairRequest {
  v?: number;
  method: PairingMethod;
  candidate_name: string;
  code?: string;
}

export interface PairResponse {
  token: string;
  token_id: string;
  token_name: string;
  server_name: string;
  catalog_version: string;
}

export interface PairingManagerDeps {
  db: DB;
  bus: EventBus;
  hooks: HookRegistry;
  mdns?: MdnsAdvertiser;
  audit: AuditLog;
  logger: Logger;
  /** Catalog version surfaced in the pair response. */
  catalog_version: string;
  /** Server name shown to discovering clients (FR-12). */
  server_name: string;
  /** Default window duration. Falls back to 120s if undefined. */
  default_window_seconds?: number;
  /** Bound HTTP transport address used in QR / manual payloads. */
  http_address?: { ip: string; port: number };
}

interface WindowRow {
  id: string;
  opened_at: string;
  expires_at: string;
  closed_at: string | null;
  close_reason: string | null;
  mode: PairingMode;
  numeric_code: string | null;
  pre_issued_token_id: string | null;
}

/** Maximum number of attempts to roll a unique numeric code per window. */
const NUMERIC_CODE_MAX_ATTEMPTS = 64;

/** TTL (ms) of the bootstrap admin token: 24h per CLAUDE.md. */
const BOOTSTRAP_ADMIN_TTL_MS = 24 * 60 * 60 * 1000;

export class PairingManager {
  private readonly db: DB;
  private readonly bus: EventBus;
  private readonly hooks: HookRegistry;
  private readonly mdns?: MdnsAdvertiser;
  private readonly audit: AuditLog;
  private readonly logger: Logger;
  private readonly catalogVersion: string;
  private readonly serverName: string;
  private readonly defaultWindowSeconds: number;
  private httpAddress?: { ip: string; port: number };
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /**
   * In-memory cleartext for tokens pre-issued to QR / code / manual windows.
   * The cleartext is shown ONCE at openWindow time AND surfaced again at
   * `/pair` claim time so every mode returns a usable token to the client
   * (FR-18 — only the server-side memory holds it; the DB never sees the
   * cleartext). Removed when the window closes.
   */
  private readonly pendingClearText = new Map<string, string>();

  constructor(deps: PairingManagerDeps) {
    this.db = deps.db;
    this.bus = deps.bus;
    this.hooks = deps.hooks;
    if (deps.mdns) this.mdns = deps.mdns;
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.catalogVersion = deps.catalog_version;
    this.serverName = deps.server_name;
    this.defaultWindowSeconds = deps.default_window_seconds ?? 120;
    if (deps.http_address) this.httpAddress = deps.http_address;
  }

  /** Late binding for the HTTP host/port (mounted after manager construction). */
  setHttpAddress(addr: { ip: string; port: number }): void {
    this.httpAddress = addr;
  }

  /**
   * Open a pairing window (FR-4, FR-6). Pre-issues a pending token for QR /
   * code / manual modes; for `mdns` and `any` modes the token is minted on
   * claim.
   */
  openWindow(opts: OpenWindowOptions = {}): OpenWindowResult {
    const mode: PairingMode = opts.mode ?? 'any';
    const durationSeconds = opts.duration_seconds ?? this.defaultWindowSeconds;
    const id = newId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);

    let numericCode: string | undefined;
    let preIssuedTokenId: string | null = null;
    let qrPayload: string | undefined;
    let manualUrl: string | undefined;

    if (mode === 'code') {
      numericCode = this.generateUniqueCode();
    }

    if (mode === 'qr' || mode === 'code' || mode === 'manual') {
      const issued = insertToken(this.db, {
        name: '<pending>',
        status: 'pending',
        pairing_method: mode,
        pairing_window_id: id,
        expires_at: expiresAt.toISOString(),
      });
      preIssuedTokenId = issued.token_id;
      this.pendingClearText.set(id, issued.cleartext);
      if (mode === 'qr') {
        qrPayload = buildQrPayload({
          v: 1,
          url: this.httpUrl(),
          ip: this.httpAddress?.ip ?? '127.0.0.1',
          port: this.httpAddress?.port ?? 7860,
          token: issued.cleartext,
          token_id: issued.token_id,
          server_name: this.serverName,
          issued_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        });
      } else if (mode === 'manual') {
        manualUrl = buildManualUrl({
          ip: this.httpAddress?.ip ?? '127.0.0.1',
          port: this.httpAddress?.port ?? 7860,
          token: issued.cleartext,
        });
      }
    }

    this.db
      .prepare<[string, string, string, string, string | null, string | null]>(
        `INSERT INTO pairing_windows
          (id, opened_at, expires_at, mode, numeric_code, pre_issued_token_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        now.toISOString(),
        expiresAt.toISOString(),
        mode,
        numericCode ?? null,
        preIssuedTokenId,
      );

    // Audit + bus + mDNS update.
    this.audit.append({
      token_id: null,
      token_name: '<pairing-protocol>',
      operation: 'pairing.window-open',
      args_summary: JSON.stringify({ window_id: id, mode, duration_seconds: durationSeconds }),
      outcome: 'ok',
      latency_ms: 0,
    });
    this.bus.publish({
      name: 'lifecycle.pairing-window-open',
      payload: { window_id: id, mode, expires_at: expiresAt.toISOString() },
    });
    this.mdns?.updateTxt({ pairing_open: 'true' });

    // Schedule expiry. `unref()` so the timer never blocks process exit.
    const ms = expiresAt.getTime() - now.getTime();
    const timer = setTimeout(() => this.expireWindow(id), Math.max(0, ms));
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(id, timer);

    return {
      window_id: id,
      expires_at: expiresAt.toISOString(),
      mode,
      ...(numericCode ? { numeric_code: numericCode, numeric_code_display: formatNumericCode(numericCode) } : {}),
      ...(qrPayload ? { qr_payload: qrPayload } : {}),
      ...(manualUrl ? { manual_url: manualUrl } : {}),
    };
  }

  /**
   * Close a window with the given reason. Idempotent: a window already
   * closed is left alone. Always re-evaluates the global pairing_open
   * mDNS flag.
   */
  closeWindow(window_id: string, reason: WindowCloseReason): void {
    const now = new Date().toISOString();
    const res = this.db
      .prepare<[string, string, string]>(
        'UPDATE pairing_windows SET closed_at = ?, close_reason = ? WHERE id = ? AND closed_at IS NULL',
      )
      .run(now, reason, window_id);
    const t = this.timers.get(window_id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(window_id);
    }
    this.pendingClearText.delete(window_id);
    if (res.changes === 0) return;

    // If the window had a still-pending pre-issued token, revoke it so the
    // QR / manual URL becomes invalid the moment the window closes.
    const row = this.db
      .prepare<string, { pre_issued_token_id: string | null }>(
        'SELECT pre_issued_token_id FROM pairing_windows WHERE id = ?',
      )
      .get(window_id);
    if (row?.pre_issued_token_id) {
      this.db
        .prepare<string>(
          "UPDATE tokens SET status='revoked', revoked_at=datetime('now') " +
            "WHERE id = ? AND status='pending'",
        )
        .run(row.pre_issued_token_id);
    }

    this.audit.append({
      token_id: null,
      token_name: '<pairing-protocol>',
      operation: 'pairing.window-close',
      args_summary: JSON.stringify({ window_id, reason }),
      outcome: 'ok',
      latency_ms: 0,
    });
    this.bus.publish({
      name: 'lifecycle.pairing-window-closed',
      payload: { window_id, reason },
    });
    if (!this.hasOpenWindow()) this.mdns?.updateTxt({ pairing_open: 'false' });
  }

  /** Stop every open window (used on `server.stop()`). */
  closeAllWindows(reason: WindowCloseReason = 'stopped'): void {
    const rows = this.db
      .prepare<[], { id: string }>(
        'SELECT id FROM pairing_windows WHERE closed_at IS NULL',
      )
      .all();
    for (const r of rows) this.closeWindow(r.id, reason);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Returns true when any window is currently open + non-expired. */
  hasOpenWindow(): boolean {
    const row = this.db
      .prepare<[string], { c: number }>(
        'SELECT COUNT(*) AS c FROM pairing_windows WHERE closed_at IS NULL AND expires_at > ?',
      )
      .get(new Date().toISOString());
    return !!row && row.c > 0;
  }

  /** Open a window only if no tokens exist yet. Returns the window or null. */
  openOnFirstRun(opts: OpenWindowOptions = {}): OpenWindowResult | null {
    const row = this.db
      .prepare<[], { c: number }>(
        "SELECT COUNT(*) AS c FROM tokens WHERE status='active' AND revoked_at IS NULL",
      )
      .get();
    if (row && row.c > 0) return null;
    return this.openWindow({ mode: 'any', ...opts });
  }

  /**
   * Issue a 24h bootstrap admin token (CLAUDE.md). The cleartext is returned
   * exactly once so the caller (`server.ts`) can print it on stdout. The
   * stored hash is identical in structure to a normal pairing token.
   */
  issueBootstrapAdminToken(): { token: string; token_id: string; expires_at: string } {
    const expiresAt = new Date(Date.now() + BOOTSTRAP_ADMIN_TTL_MS).toISOString();
    const issued = insertToken(this.db, {
      name: 'bootstrap-admin',
      status: 'active',
      pairing_method: 'bootstrap',
      pairing_window_id: null,
      expires_at: expiresAt,
    });
    this.audit.append({
      token_id: issued.token_id,
      token_name: 'bootstrap-admin',
      operation: 'pairing.bootstrap-admin-issued',
      args_summary: JSON.stringify({ expires_at: expiresAt }),
      outcome: 'ok',
      latency_ms: 0,
    });
    return { token: issued.cleartext, token_id: issued.token_id, expires_at: expiresAt };
  }

  /**
   * Handle an anonymous POST /pair request. Throws `PairingError` on every
   * documented failure (mapped to HTTP status by the route).
   */
  async handlePairRequest(req: PairRequest, sourceIp: string): Promise<PairResponse> {
    if (!isLanIp(sourceIp)) {
      throw new PairingError({
        status: 403,
        code: 'INTERNET_PAIRING_NOT_SUPPORTED',
        message: 'pairing requests are only accepted from LAN addresses',
        hint: 'Use a tunnel (post-v1) for Internet pairing.',
      });
    }
    if (!req || typeof req !== 'object') {
      throw new PairingError({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'request body must be an object',
      });
    }
    if (typeof req.candidate_name !== 'string' || req.candidate_name.length === 0) {
      throw new PairingError({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'candidate_name is required',
        hint: 'Provide a human-readable device name (e.g., "iPad de Igna").',
      });
    }
    if (!isPairingMethod(req.method)) {
      throw new PairingError({
        status: 400,
        code: 'INVALID_INPUT',
        message: `method must be one of mdns | qr | code | manual; got ${String(req.method)}`,
      });
    }

    const window = this.findOpenWindowForRequest(req);
    if (!window) {
      throw new PairingError({
        status: 403,
        code: 'PAIRING_WINDOW_CLOSED',
        message: 'no pairing window matches this request',
        hint: 'Ask the host to open a pairing window.',
      });
    }

    // Hook approval (FR-20, K.1). HookRegistry already enforces a 60s timeout
    // per handler and default-approves when no handler is registered.
    const decision = await this.hooks.dispatchPairingRequest({
      candidate_name: req.candidate_name,
      request_id: newId(),
    });
    if (!decision.approved) {
      this.recordPairingRequest({
        candidate_name: req.candidate_name,
        approved: false,
        rejected_reason: decision.reason ?? 'rejected',
      });
      throw new PairingError({
        status: 403,
        code: 'PAIRING_REJECTED',
        message: decision.reason ?? 'host rejected the pair request',
      });
    }

    let cleartext: string;
    let token_id: string;

    if (window.pre_issued_token_id) {
      // QR / code / manual: claim the pending token atomically. The
      // cleartext was minted at openWindow() and held in-memory keyed by
      // window_id; we surface it here so the candidate receives the same
      // token regardless of how it arrived (server-issued via QR/manual or
      // claimed-by-code).
      const claimed = this.claimPreIssuedToken(window.id, window.pre_issued_token_id, req.candidate_name);
      if (!claimed) {
        throw new PairingError({
          status: 403,
          code: 'PAIRING_TOKEN_ALREADY_CLAIMED',
          message: 'this pairing token has already been claimed',
        });
      }
      cleartext = claimed.cleartext;
      token_id = window.pre_issued_token_id;
    } else {
      // mdns / any: mint a fresh active token bound to the window.
      const issued = insertToken(this.db, {
        name: req.candidate_name,
        status: 'active',
        pairing_method: req.method,
        pairing_window_id: window.id,
      });
      cleartext = issued.cleartext;
      token_id = issued.token_id;
    }

    this.recordPairingRequest({
      candidate_name: req.candidate_name,
      approved: true,
      issued_token_id: token_id,
    });
    this.audit.append({
      token_id,
      token_name: req.candidate_name,
      operation: 'pairing.token-issued',
      args_summary: JSON.stringify({
        window_id: window.id,
        method: req.method,
      }),
      outcome: 'ok',
      latency_ms: 0,
    });

    // FR-19: one-shot — the window closes once a token is claimed.
    this.closeWindow(window.id, 'claimed');

    return {
      token: cleartext,
      token_id,
      token_name: req.candidate_name,
      server_name: this.serverName,
      catalog_version: this.catalogVersion,
    };
  }

  /** Revoke a token by id (FR-26). Returns true if revoked, false if a no-op. */
  revokeToken(token_id: string, by_token_id: string | null = null): boolean {
    const ok = markTokenRevoked(this.db, token_id);
    if (ok) {
      this.audit.append({
        token_id: by_token_id,
        token_name: '<revocation>',
        operation: 'pairing.token-revoked',
        args_summary: JSON.stringify({ revoked_token_id: token_id }),
        outcome: 'ok',
        latency_ms: 0,
      });
      this.bus.publish({
        name: 'auth.token-revoked',
        payload: { token_id },
      });
    }
    return ok;
  }

  /**
   * Rotate a token (FR-24). Atomically issues a new active token under the
   * same name and revokes the old one. Returns the cleartext (FR-18).
   */
  rotateToken(args: {
    current_token_id: string;
    name: string;
  }): { token: string; token_id: string } | null {
    const existing = this.db
      .prepare<[string], TokenRow>(
        'SELECT id, name, hash, status, pairing_method, pairing_window_id, expires_at, revoked_at, created_at, last_used_at FROM tokens WHERE id = ?',
      )
      .get(args.current_token_id);
    if (!existing || existing.status !== 'active' || existing.revoked_at) return null;

    const txn = this.db.transaction(() => {
      const issued = insertToken(this.db, {
        name: args.name,
        status: 'active',
        pairing_method: existing.pairing_method,
        pairing_window_id: existing.pairing_window_id,
      });
      markTokenRevoked(this.db, args.current_token_id);
      return issued;
    });
    const issued = txn();
    this.audit.append({
      token_id: issued.token_id,
      token_name: args.name,
      operation: 'pairing.token-rotated',
      args_summary: JSON.stringify({ old_token_id: args.current_token_id }),
      outcome: 'ok',
      latency_ms: 0,
    });
    this.bus.publish({
      name: 'auth.token-rotated',
      payload: { old_token_id: args.current_token_id, new_token_id: issued.token_id },
    });
    return { token: issued.cleartext, token_id: issued.token_id };
  }

  /** List paired non-revoked devices (FR-30). */
  listPairedDevices(): Array<{
    id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    pairing_method: string | null;
  }> {
    return this.db
      .prepare<
        [],
        {
          id: string;
          name: string;
          created_at: string;
          last_used_at: string | null;
          pairing_method: string | null;
        }
      >(
        "SELECT id, name, created_at, last_used_at, pairing_method " +
          "FROM tokens WHERE status='active' AND revoked_at IS NULL " +
          'ORDER BY created_at DESC',
      )
      .all();
  }

  // ---- Internals ---------------------------------------------------------

  private expireWindow(window_id: string): void {
    this.timers.delete(window_id);
    const row = this.db
      .prepare<string, { closed_at: string | null }>(
        'SELECT closed_at FROM pairing_windows WHERE id = ?',
      )
      .get(window_id);
    if (!row || row.closed_at) return;
    this.closeWindow(window_id, 'expired');
  }

  /**
   * Generate a 6-digit numeric code that is unique among currently-open
   * windows (Q6, B.4). Falls back to throwing if too many collisions occur.
   */
  private generateUniqueCode(): string {
    const stmt = this.db.prepare<[string, string], { id: string }>(
      'SELECT id FROM pairing_windows WHERE numeric_code = ? AND closed_at IS NULL AND expires_at > ?',
    );
    for (let attempt = 0; attempt < NUMERIC_CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      const conflict = stmt.get(code, new Date().toISOString());
      if (!conflict) return code;
    }
    throw new Error('failed to generate a unique 6-digit pairing code');
  }

  private findOpenWindowForRequest(req: PairRequest): WindowRow | null {
    const now = new Date().toISOString();
    if (req.method === 'code') {
      const code = normalizeNumericCode(req.code ?? '');
      if (code.length !== 6) {
        throw new PairingError({
          status: 400,
          code: 'INVALID_INPUT',
          message: 'code must be 6 digits',
        });
      }
      const row = this.db
        .prepare<[string, string], WindowRow>(
          'SELECT * FROM pairing_windows WHERE numeric_code = ? AND closed_at IS NULL AND expires_at > ? LIMIT 1',
        )
        .get(code, now);
      if (!row) {
        // Distinguish wrong-code from window-closed for the candidate.
        const anyOpen = this.db
          .prepare<[string], { c: number }>(
            "SELECT COUNT(*) AS c FROM pairing_windows WHERE mode='code' AND closed_at IS NULL AND expires_at > ?",
          )
          .get(now);
        if (anyOpen && anyOpen.c > 0) {
          throw new PairingError({
            status: 403,
            code: 'PAIRING_CODE_MISMATCH',
            message: 'the supplied numeric code does not match any open window',
          });
        }
        return null;
      }
      return row;
    }

    // For mdns / qr / manual / any: find the most recently-opened window
    // whose mode allows this request method.
    const rows = this.db
      .prepare<string, WindowRow>(
        'SELECT * FROM pairing_windows WHERE closed_at IS NULL AND expires_at > ? ORDER BY opened_at DESC',
      )
      .all(now);
    for (const r of rows) {
      if (r.mode === 'any') return r;
      if (r.mode === req.method) return r;
    }
    return null;
  }

  private claimPreIssuedToken(
    window_id: string,
    token_id: string,
    candidate_name: string,
  ): { cleartext: string } | null {
    const cleartext = this.pendingClearText.get(window_id);
    if (!cleartext) return null;
    const txn = this.db.transaction(() => {
      const res = this.db
        .prepare<[string, string]>(
          "UPDATE tokens SET status='active', name = ?, expires_at = NULL WHERE id = ? AND status='pending'",
        )
        .run(candidate_name, token_id);
      return res.changes > 0;
    });
    const ok = txn();
    if (!ok) return null;
    // Atomic claim succeeded — drop the in-memory cleartext to enforce
    // the one-shot semantics in FR-19 (any future claim attempt fails).
    this.pendingClearText.delete(window_id);
    renameToken(this.db, token_id, candidate_name);
    return { cleartext };
  }

  private recordPairingRequest(args: {
    candidate_name: string;
    approved: boolean;
    issued_token_id?: string;
    rejected_reason?: string;
  }): void {
    const id = newId();
    const now = new Date().toISOString();
    this.db
      .prepare<[string, string, string, string | null, string | null, string | null]>(
        `INSERT INTO pairing_requests
          (id, candidate_name, requested_at, approved_at, rejected_at, issued_token_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        args.candidate_name,
        now,
        args.approved ? now : null,
        args.approved ? null : now,
        args.approved ? args.issued_token_id ?? null : null,
      );
    if (!args.approved && args.rejected_reason) {
      this.logger.info(
        { candidate: args.candidate_name, reason: args.rejected_reason },
        'pair request rejected',
      );
    }
  }

  private httpUrl(): string {
    if (!this.httpAddress) return 'http://127.0.0.1:7860';
    return `http://${this.httpAddress.ip}:${this.httpAddress.port}`;
  }
}

function isPairingMethod(value: unknown): value is PairingMethod {
  return value === 'mdns' || value === 'qr' || value === 'code' || value === 'manual';
}
