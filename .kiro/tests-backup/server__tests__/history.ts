#!/usr/bin/env tsx
/**
 * Generation-history unit tests.
 *
 * Covers the pieces that don't require a real ComfyUI / Fastify / DB
 * runtime:
 *
 *   - Migration 003 lists in MIGRATIONS in order.
 *   - HistoryStore CRUD + filtering against an in-memory fake DB.
 *   - Projection helpers (`projectHistoryItemSummary` / Full /
 *     `batchSummary`) round-trip a row.
 *   - `apply_history_item` handler:
 *       * positional insertion per resolved verb (FR-7);
 *       * source-layer-missing fallback (FR-8);
 *       * reversible `Command` (P27 / B.5).
 *   - `discard_history_item` idempotency (B.3).
 *   - `get_history_item` returns full projection.
 *   - `HistoryGc` honours each retention rule + emits the bus event.
 *   - History list resource pagination + filters.
 *   - In-memory transport's URI matcher accepts our two patterns.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/history.ts`.
 */
import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';
import { MIGRATIONS } from '../lib/db/migrations/index.js';
import { HistoryStore, type HistoryItemRow } from '../lib/history/store.js';
import {
  batchSummary,
  parseStoredParameters,
  projectHistoryItemFull,
  projectHistoryItemSummary,
} from '../lib/history/projection.js';
import { HistoryGc } from '../lib/history/gc.js';
import { EventBus } from '../lib/events/bus.js';
import { createGetHistoryItemHandler } from '../lib/handlers/get-history-item.js';
import { createApplyHistoryItemHandler } from '../lib/handlers/apply-history-item.js';
import { createDiscardHistoryItemHandler } from '../lib/handlers/discard-history-item.js';
import {
  readHistoryList,
  readHistoryItem,
} from '../lib/resources/history-list.js';
import { InMemoryTransport, type ResourceResolver } from '../lib/transports/in-memory.js';

// ---------------------------------------------------------------------------
// Tiny in-memory SQLite shim. Models the surface the history modules touch:
//   - `history_items` rows (full schema after migration 003);
//   - `layers` rows (id, document_id, kind, position, content_blob_id);
//   - `blobs` rows (id, bytes, mime, rel_path, created_at).
// ---------------------------------------------------------------------------

interface HistoryRowMutable extends HistoryItemRow {
  [k: string]: unknown;
}

interface LayerRowMutable {
  id: string;
  document_id: string;
  kind: string;
  name: string;
  position: number;
  opacity: number;
  blend: string;
  visible: number;
  content_blob_id: string | null;
}

interface BlobRowMutable {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  rel_path: string;
  created_at: string;
  expires_at: string | null;
}

class FakeDb implements Database {
  readonly open = true;
  readonly inTransaction = false;
  history_items: HistoryRowMutable[] = [];
  layers: LayerRowMutable[] = [];
  blobs: BlobRowMutable[] = [];

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
    return ((...args: never[]) => fn(...args)) as T;
  }

  close(): void {}
}

class FakeStatement {
  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const sql = this.sql.trim();

    if (/^INSERT\s+INTO\s+history_items/i.test(sql)) {
      const [
        id, document_id, job_id, prompt, parameters_json,
        image_blob_id, thumbnail_blob_id, created_at,
        batch_size, batch_position,
      ] = params as [
        string, string, string | null, string, string,
        string | null, string | null, string,
        number, number,
      ];
      this.db.history_items.push({
        id, document_id, job_id, prompt, parameters_json,
        image_blob_id, thumbnail_blob_id,
        applied_to_layer_id: null, applied_at: null, discarded_at: null,
        created_at,
        batch_size, batch_position,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^UPDATE\s+history_items\s+SET\s+applied_to_layer_id = \?, applied_at = \?/i.test(sql)) {
      const [layer_id, applied_at, id] = params as [string, string, string];
      const row = this.db.history_items.find((r) => r.id === id && r.discarded_at === null);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.applied_to_layer_id = layer_id;
      row.applied_at = applied_at;
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^UPDATE\s+history_items\s+SET\s+applied_to_layer_id = NULL/i.test(sql)) {
      const [id, layer_id] = params as [string, string];
      const row = this.db.history_items.find((r) => r.id === id && r.applied_to_layer_id === layer_id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.applied_to_layer_id = null;
      row.applied_at = null;
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^UPDATE\s+history_items\s+SET\s+discarded_at = \?/i.test(sql)) {
      const [discarded_at, id] = params as [string, string];
      const row = this.db.history_items.find((r) => r.id === id && r.discarded_at === null);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.discarded_at = discarded_at;
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^DELETE\s+FROM\s+history_items/i.test(sql)) {
      const [id] = params as [string];
      const before = this.db.history_items.length;
      this.db.history_items = this.db.history_items.filter((r) => r.id !== id);
      return { changes: before - this.db.history_items.length, lastInsertRowid: 0 };
    }

    if (/^INSERT\s+INTO\s+layers/i.test(sql)) {
      const [
        id, document_id, name, position, _opacity, _blendOrSomething, content_blob_id,
      ] = params as [string, string, string, number, number, number | string, string];
      // The actual SQL is: INSERT INTO layers (id, document_id, kind, name, position, opacity, blend, visible, content_blob_id) VALUES (?, ?, 'paint', ?, ?, 1.0, ?, 1, ?)
      // parameter order: id, document_id, name, position, opacity, blend, content_blob_id
      const layer: LayerRowMutable = {
        id,
        document_id,
        kind: 'paint',
        name,
        position,
        opacity: 1.0,
        blend: typeof _blendOrSomething === 'string' ? _blendOrSomething : 'normal',
        visible: 1,
        content_blob_id,
      };
      this.db.layers.push(layer);
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^DELETE\s+FROM\s+layers/i.test(sql)) {
      const [id] = params as [string];
      const before = this.db.layers.length;
      this.db.layers = this.db.layers.filter((r) => r.id !== id);
      return { changes: before - this.db.layers.length, lastInsertRowid: 0 };
    }

    if (/^UPDATE\s+layers\s+SET\s+position = position \+ 1/i.test(sql)) {
      const [doc, pos] = params as [string, number];
      let n = 0;
      for (const l of this.db.layers) {
        if (l.document_id === doc && l.position >= pos) {
          l.position += 1;
          n += 1;
        }
      }
      return { changes: n, lastInsertRowid: 0 };
    }

    if (/^UPDATE\s+layers\s+SET\s+position = position - 1/i.test(sql)) {
      const [doc, pos] = params as [string, number];
      let n = 0;
      for (const l of this.db.layers) {
        if (l.document_id === doc && l.position > pos) {
          l.position -= 1;
          n += 1;
        }
      }
      return { changes: n, lastInsertRowid: 0 };
    }

    if (/^INSERT\s+INTO\s+blobs/i.test(sql)) {
      const [id, sha256, bytes, mime, rel_path, created_at, expires_at] = params as [
        string, string, number, string, string, string, string | null,
      ];
      this.db.blobs.push({ id, sha256, bytes, mime, rel_path, created_at, expires_at });
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (/^DELETE\s+FROM\s+blobs/i.test(sql)) {
      const [id] = params as [string];
      const before = this.db.blobs.length;
      this.db.blobs = this.db.blobs.filter((b) => b.id !== id);
      return { changes: before - this.db.blobs.length, lastInsertRowid: 0 };
    }

    throw new Error(`fake-db.run: unhandled SQL: ${sql}`);
  }

  get(...params: unknown[]): unknown {
    return this.iterate(...params).next().value;
  }

  all(...params: unknown[]): unknown[] {
    return [...this.iterate(...params)];
  }

  *iterate(...params: unknown[]): IterableIterator<unknown> {
    const sql = this.sql.trim();

    if (/^SELECT\s+\*\s+FROM\s+history_items\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.history_items.find((r) => r.id === id);
      if (row) yield { ...row };
      return;
    }

    if (/^SELECT\s+created_at,\s*id\s+FROM\s+history_items/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.history_items.find((r) => r.id === id);
      if (row) yield { created_at: row.created_at, id: row.id };
      return;
    }

    if (/^SELECT\s+\*\s+FROM\s+history_items/i.test(sql)) {
      // The store builds LIMIT N + ORDER BY created_at DESC, id DESC.
      // We approximate by sorting the entire array and applying the
      // filter conditions we recognise via the SQL fragment.
      let rows = [...this.db.history_items];
      // Filters
      const lower = sql.toLowerCase();
      // Document_id filter
      if (lower.includes('document_id = ?')) {
        const v = params.shift() as string;
        rows = rows.filter((r) => r.document_id === v);
      }
      if (lower.includes('applied_to_layer_id is not null')) {
        if (lower.includes('applied_to_layer_id is not null and created_at')) {
          // unreferenced clause uses NULL not NOT NULL
        } else {
          rows = rows.filter((r) => r.applied_to_layer_id !== null);
        }
      }
      if (
        lower.includes('applied_to_layer_id is null') &&
        !lower.includes('applied_to_layer_id is null and created_at')
      ) {
        rows = rows.filter((r) => r.applied_to_layer_id === null);
      }
      if (lower.includes('discarded_at is null') && !lower.includes('discarded_at is not null')) {
        rows = rows.filter((r) => r.discarded_at === null);
      }
      if (lower.includes('discarded_at is not null and discarded_at < ?')) {
        const cutoff = params.shift() as string;
        rows = rows.filter((r) => r.discarded_at !== null && r.discarded_at < cutoff);
      }
      if (lower.includes('applied_to_layer_id is null and created_at < ?')) {
        const cutoff = params.shift() as string;
        rows = rows.filter((r) => r.applied_to_layer_id === null && r.created_at < cutoff);
      }
      if (lower.includes('created_at > ?')) {
        const v = params.shift() as string;
        rows = rows.filter((r) => r.created_at > v);
      }
      if (lower.includes('(created_at < ? or')) {
        const c = params.shift() as string;
        const c2 = params.shift() as string;
        const idCmp = params.shift() as string;
        void c2;
        rows = rows.filter((r) => r.created_at < c || (r.created_at === c && r.id < idCmp));
      }
      // Sort
      if (lower.includes('order by created_at desc')) {
        rows.sort((a, b) =>
          a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1,
        );
      } else if (lower.includes('order by created_at asc')) {
        rows.sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
        );
      }
      const limit = params.shift();
      const limited = typeof limit === 'number' ? rows.slice(0, limit) : rows;
      for (const r of limited) yield { ...r };
      return;
    }

    if (/^SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+history_items/i.test(sql)) {
      const [job_id] = params as [string];
      const c = this.db.history_items.filter((r) => r.job_id === job_id).length;
      yield { c };
      return;
    }

    if (/^SELECT\s+id,\s*position\s+FROM\s+layers/i.test(sql)) {
      const [doc] = params as [string];
      const rows = this.db.layers
        .filter((l) => l.document_id === doc)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ id: l.id, position: l.position }));
      for (const r of rows) yield r;
      return;
    }

    if (/^SELECT\s+bytes,\s*mime\s+FROM\s+blobs/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.blobs.find((b) => b.id === id);
      if (row) yield { bytes: row.bytes, mime: row.mime };
      return;
    }

    if (/^SELECT\s+COALESCE\(SUM\(b\.bytes\)/i.test(sql)) {
      let total = 0;
      const seen = new Set<string>();
      for (const h of this.db.history_items) {
        for (const id of [h.image_blob_id, h.thumbnail_blob_id]) {
          if (!id) continue;
          const blob = this.db.blobs.find((b) => b.id === id);
          if (blob) total += blob.bytes;
        }
        seen.add(h.id);
      }
      yield { total_bytes: total, item_count: seen.size };
      return;
    }

    if (/^SELECT\s+h\.\*\s+FROM\s+history_items\s+h/i.test(sql)) {
      // selectItemsWithMissingBlobs
      for (const h of this.db.history_items) {
        if (h.discarded_at !== null) continue;
        const imageMissing =
          h.image_blob_id !== null && !this.db.blobs.some((b) => b.id === h.image_blob_id);
        const thumbMissing =
          h.thumbnail_blob_id !== null && !this.db.blobs.some((b) => b.id === h.thumbnail_blob_id);
        if (imageMissing || thumbMissing) yield { ...h };
      }
      return;
    }

    throw new Error(`fake-db.iterate: unhandled SQL: ${sql}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory AssetStore stub — captures writes/deletes for GC assertions.
// ---------------------------------------------------------------------------

class FakeAssetStore {
  written = new Map<string, { bytes: number; mime: string }>();
  deleted: string[] = [];
  async write({ bytes, mime }: { bytes: Buffer; mime: string }): Promise<{ id: string; bytes: number; mime: string; sha256: string; rel_path: string; created_at: string; expires_at: string | null }> {
    const id = `blob_${this.written.size}`;
    this.written.set(id, { bytes: bytes.byteLength, mime });
    return { id, bytes: bytes.byteLength, mime, sha256: 'x', rel_path: id, created_at: '', expires_at: null };
  }
  async read(id: string): Promise<{ meta: { id: string; bytes: number; mime: string; sha256: string; rel_path: string; created_at: string; expires_at: string | null }; bytes: Buffer } | null> {
    const w = this.written.get(id);
    if (!w) return null;
    return {
      meta: { id, bytes: w.bytes, mime: w.mime, sha256: 'x', rel_path: id, created_at: '', expires_at: null },
      bytes: Buffer.alloc(w.bytes),
    };
  }
  async delete(id: string): Promise<void> {
    this.deleted.push(id);
    this.written.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Test helper: minimal HandlerContext
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<{ document_id: string; token_name: string }>): {
  ctx: import('../types/handler-context.js').HandlerContext & { scratch: Record<string, unknown> };
  events: { name: string; payload: unknown }[];
} {
  const events: { name: string; payload: unknown }[] = [];
  const ctx = {
    request_id: 'req_test',
    transport: 'in-memory' as const,
    token_id: null,
    token_name: overrides?.token_name ?? 'test-token',
    received_at: Date.now(),
    document_id: overrides?.document_id,
    publish: (event: { name: string; payload: unknown }) => events.push(event),
    audit: () => {},
    logger: { info: () => {}, error: () => {} },
    scratch: {} as Record<string, unknown>,
  };
  return { ctx, events };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- Migration --------------------------------------------------------
  ['MIGRATIONS includes 003-history-extensions in order', () => {
    const names = MIGRATIONS.map((m) => m.name);
    // Other waves may append further migrations; assert prefix only.
    assert.equal(names[0], '001-initial-schema');
    assert.equal(names[1], '002-pairing-protocol');
    assert.equal(names[2], '003-history-extensions');
    assert.ok(names.includes('004-transform-tools'), 'expected migration 004-transform-tools to be registered');
  }],

  // ---- Store ------------------------------------------------------------
  ['HistoryStore.insert + getById round-trip', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h1', document_id: 'd1', job_id: 'j1',
      prompt: 'a cat', parameters_json: '{"resolved_verb":"generate","seed":42}',
      image_blob_id: 'b1', thumbnail_blob_id: 'b2',
      created_at: '2026-01-01T00:00:00.000Z',
      batch_size: 4, batch_position: 0,
    });
    const got = store.getById('h1');
    assert.ok(got);
    assert.equal(got!.prompt, 'a cat');
    assert.equal(got!.batch_size, 4);
    assert.equal(got!.applied_at, null);
    assert.equal(store.getById('nope'), null);
  }],
  ['HistoryStore.list filters by document_id, applied, discarded', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const baseTs = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 4; i += 1) {
      const ts = new Date(baseTs.getTime() + i * 1000).toISOString();
      store.insert({
        id: `h${i}`,
        document_id: i < 2 ? 'd1' : 'd2',
        job_id: null,
        prompt: `p${i}`,
        parameters_json: '{}',
        image_blob_id: null,
        thumbnail_blob_id: null,
        created_at: ts,
      });
    }
    // mark h1 applied, h2 discarded
    store.markApplied({ id: 'h1', layer_id: 'L1', applied_at: '2026-01-02T00:00:00.000Z' });
    store.markDiscarded({ id: 'h2', discarded_at: '2026-01-02T00:00:00.000Z' });

    const docOnly = store.list({ document_id: 'd1' });
    assert.equal(docOnly.items.length, 2);
    assert.deepEqual(docOnly.items.map((r) => r.id), ['h1', 'h0']);

    const appliedOnly = store.list({ applied: true });
    assert.equal(appliedOnly.items.length, 1);
    assert.equal(appliedOnly.items[0]?.id, 'h1');

    const includesDiscarded = store.list({ include_discarded: true });
    assert.equal(includesDiscarded.items.length, 4);

    const excludesDiscarded = store.list();
    assert.equal(excludesDiscarded.items.length, 3);
  }],
  ['HistoryStore.markApplied is blocked once discarded', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store.markDiscarded({ id: 'h', discarded_at: '2026-01-02T00:00:00.000Z' });
    const ok = store.markApplied({ id: 'h', layer_id: 'L', applied_at: '2026-01-03T00:00:00.000Z' });
    assert.equal(ok, false);
  }],
  ['HistoryStore.markDiscarded is idempotent', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(store.markDiscarded({ id: 'h', discarded_at: 't1' }), true);
    assert.equal(store.markDiscarded({ id: 'h', discarded_at: 't2' }), false);
  }],
  ['HistoryStore.unmarkApplied scoped by layer_id', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store.markApplied({ id: 'h', layer_id: 'L1', applied_at: 'ts' });
    assert.equal(store.unmarkApplied({ id: 'h', layer_id: 'L_other' }), false);
    assert.equal(store.unmarkApplied({ id: 'h', layer_id: 'L1' }), true);
    assert.equal(store.getById('h')?.applied_to_layer_id, null);
  }],

  // ---- Projection -------------------------------------------------------
  ['parseStoredParameters handles malformed JSON', () => {
    assert.deepEqual(parseStoredParameters('not json'), {});
  }],
  ['projectHistoryItemSummary fills defaults when params absent', () => {
    const row: HistoryItemRow = {
      id: 'h', document_id: 'd', job_id: null, prompt: 'p',
      parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null,
      applied_to_layer_id: null, applied_at: null, discarded_at: null,
      created_at: 'ts', batch_size: 1, batch_position: 0,
    };
    const proj = projectHistoryItemSummary(row, { image_blob: null, thumbnail_blob: null });
    assert.equal(proj['resolved_verb'], 'generate');
    assert.equal(proj['seed'], 0);
    assert.equal(proj['thumbnail_ref'], undefined);
  }],
  ['projectHistoryItemFull surfaces image_ref when blob meta exists', () => {
    const row: HistoryItemRow = {
      id: 'h', document_id: 'd', job_id: 'j', prompt: 'p',
      parameters_json: JSON.stringify({ resolved_verb: 'refine', seed: 7, strength: 75, control_layer_ids: ['c1'], region_ids: ['r1'] }),
      image_blob_id: 'B1', thumbnail_blob_id: 'B2',
      applied_to_layer_id: null, applied_at: null, discarded_at: null,
      created_at: 'ts', batch_size: 1, batch_position: 0,
    };
    const proj = projectHistoryItemFull(row, {
      image_blob: { bytes: 1, mime: 'image/png' },
      thumbnail_blob: { bytes: 1, mime: 'image/png' },
    });
    assert.equal(proj['resolved_verb'], 'refine');
    assert.equal(proj['strength'], 75);
    assert.deepEqual(proj['control_layer_ids'], ['c1']);
    const ref = proj['image_ref'] as { ref: { uri: string } };
    assert.equal(ref.ref.uri, 'diffusecraft://blob/B1');
  }],
  ['batchSummary returns undefined for non-batch items', () => {
    const row: HistoryItemRow = {
      id: 'h', document_id: 'd', job_id: 'j', prompt: 'p',
      parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null,
      applied_to_layer_id: null, applied_at: null, discarded_at: null,
      created_at: 'ts', batch_size: 1, batch_position: 0,
    };
    assert.equal(batchSummary(row), undefined);
    const batched = { ...row, batch_size: 4, batch_position: 2 };
    const summary = batchSummary(batched);
    assert.deepEqual(summary, { batch_job_id: 'j', batch_size: 4, batch_position: 2 });
  }],

  // ---- discard handler --------------------------------------------------
  ['discard_history_item handler is idempotent + 404s on unknown id', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}',
      image_blob_id: null, thumbnail_blob_id: null, created_at: 'ts',
    });
    const handler = createDiscardHistoryItemHandler(store);
    const { ctx } = makeCtx();
    const r1 = await handler({ history_item_id: 'h' as never }, ctx);
    assert.equal(r1.discarded, true);
    assert.ok(store.getById('h')?.discarded_at);
    const r2 = await handler({ history_item_id: 'h' as never }, ctx);
    assert.equal(r2.discarded, true);
    await assert.rejects(
      () => handler({ history_item_id: 'missing' as never }, ctx),
      (err: unknown) =>
        (err as { code?: string }).code === 'HISTORY_ITEM_NOT_FOUND',
    );
  }],

  // ---- get handler ------------------------------------------------------
  ['get_history_item handler returns the full projection', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: 'j', prompt: 'p',
      parameters_json: '{"resolved_verb":"generate","seed":1,"strength":100}',
      image_blob_id: 'b1', thumbnail_blob_id: 'b2',
      created_at: 'ts',
    });
    db.blobs.push(
      { id: 'b1', sha256: 'x', bytes: 100, mime: 'image/png', rel_path: 'b1', created_at: 'ts', expires_at: null },
      { id: 'b2', sha256: 'x', bytes: 50, mime: 'image/png', rel_path: 'b2', created_at: 'ts', expires_at: null },
    );
    const handler = createGetHistoryItemHandler(db as unknown as Database, store);
    const { ctx } = makeCtx();
    const out = await handler({ history_item_id: 'h' as never }, ctx);
    const unknownOut = out as unknown as Record<string, unknown>;
    assert.equal(unknownOut['id'], 'h');
    assert.equal(unknownOut['resolved_verb'], 'generate');
    assert.ok(unknownOut['image_ref']);
  }],

  // ---- apply handler ----------------------------------------------------
  ['apply_history_item: generate verb places at top + reversible Command', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    // pre-seed two layers
    db.layers.push(
      { id: 'L0', document_id: 'D', kind: 'paint', name: 'a', position: 0, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
      { id: 'L1', document_id: 'D', kind: 'paint', name: 'b', position: 1, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
    );
    store.insert({
      id: 'H', document_id: 'D', job_id: 'J', prompt: 'p',
      parameters_json: '{"resolved_verb":"generate","seed":1}',
      image_blob_id: 'B', thumbnail_blob_id: null, created_at: 'ts',
    });

    const handler = createApplyHistoryItemHandler(db as unknown as Database, store);
    const { ctx, events } = makeCtx({ document_id: 'D' });
    const out = await handler({ history_item_id: 'H' as never }, ctx);
    assert.equal(out.position, 2);
    assert.equal(db.layers.length, 3);
    const newLayer = db.layers.find((l) => l.id === out.layer_id);
    assert.ok(newLayer);
    assert.equal(newLayer!.position, 2);
    assert.equal(store.getById('H')?.applied_to_layer_id, out.layer_id);
    assert.ok(events.find((e) => e.name === 'document.changed'));

    // Reversible: revert removes the layer + clears applied_to_layer_id.
    const cmd = ctx.scratch['command'] as { revert: () => void | Promise<void>; reapply: () => void };
    await cmd.revert();
    assert.equal(db.layers.find((l) => l.id === out.layer_id), undefined);
    assert.equal(store.getById('H')?.applied_to_layer_id, null);

    // Re-apply yields a fresh layer id (FR-6 / B.5).
    cmd.reapply();
    const reapplied = store.getById('H')?.applied_to_layer_id;
    assert.ok(reapplied);
    assert.notEqual(reapplied, out.layer_id);
  }],
  ['apply_history_item: refine verb places above source layer', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    db.layers.push(
      { id: 'L0', document_id: 'D', kind: 'paint', name: 'a', position: 0, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
      { id: 'SRC', document_id: 'D', kind: 'paint', name: 'src', position: 1, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
      { id: 'L2', document_id: 'D', kind: 'paint', name: 'c', position: 2, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
    );
    store.insert({
      id: 'H', document_id: 'D', job_id: null, prompt: 'p',
      parameters_json: JSON.stringify({ resolved_verb: 'refine', source_layer_id: 'SRC' }),
      image_blob_id: 'B', thumbnail_blob_id: null, created_at: 'ts',
    });
    const handler = createApplyHistoryItemHandler(db as unknown as Database, store);
    const { ctx } = makeCtx({ document_id: 'D' });
    const out = await handler({ history_item_id: 'H' as never }, ctx);
    assert.equal(out.position, 2); // sourceIdx 1 + 1
  }],
  ['apply_history_item: source-layer-missing falls back to top + notice', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    db.layers.push(
      { id: 'L0', document_id: 'D', kind: 'paint', name: 'a', position: 0, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
    );
    store.insert({
      id: 'H', document_id: 'D', job_id: null, prompt: 'p',
      parameters_json: JSON.stringify({ resolved_verb: 'refine', source_layer_id: 'GONE' }),
      image_blob_id: 'B', thumbnail_blob_id: null, created_at: 'ts',
    });
    const handler = createApplyHistoryItemHandler(db as unknown as Database, store);
    const { ctx, events } = makeCtx({ document_id: 'D' });
    const out = await handler({ history_item_id: 'H' as never }, ctx);
    assert.equal(out.position, 1);
    const ev = events.find((e) => e.name === 'document.changed');
    assert.ok(ev);
    const payload = ev!.payload as { change_summary: string };
    assert.match(payload.change_summary, /no longer exists/);
  }],
  ['apply_history_item: fill verb above source + selection clip annotation', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    db.layers.push(
      { id: 'SRC', document_id: 'D', kind: 'paint', name: 'src', position: 0, opacity: 1, blend: 'normal', visible: 1, content_blob_id: null },
    );
    store.insert({
      id: 'H', document_id: 'D', job_id: null, prompt: 'p',
      parameters_json: JSON.stringify({
        resolved_verb: 'fill',
        source_layer_id: 'SRC',
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
      }),
      image_blob_id: 'B', thumbnail_blob_id: null, created_at: 'ts',
    });
    const handler = createApplyHistoryItemHandler(db as unknown as Database, store);
    const { ctx, events } = makeCtx({ document_id: 'D' });
    const out = await handler({ history_item_id: 'H' as never }, ctx);
    assert.equal(out.position, 1);
    const ev = events.find((e) => e.name === 'document.changed');
    const payload = ev!.payload as { change_summary: string };
    assert.match(payload.change_summary, /clip=rect/);
  }],
  ['apply_history_item rejects discarded items', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'H', document_id: 'D', job_id: null, prompt: 'p',
      parameters_json: '{"resolved_verb":"generate"}',
      image_blob_id: 'B', thumbnail_blob_id: null, created_at: 'ts',
    });
    store.markDiscarded({ id: 'H', discarded_at: 'ts' });
    const handler = createApplyHistoryItemHandler(db as unknown as Database, store);
    const { ctx } = makeCtx({ document_id: 'D' });
    await assert.rejects(
      () => handler({ history_item_id: 'H' as never }, ctx),
      (err: unknown) =>
        (err as { code?: string }).code === 'HISTORY_ITEM_DISCARDED',
    );
  }],

  // ---- Resource ---------------------------------------------------------
  ['readHistoryList paginates with cursor + filters by document_id', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    for (let i = 0; i < 5; i += 1) {
      const ts = new Date(2026, 0, 1, 0, 0, i).toISOString();
      store.insert({
        id: `h${i}`, document_id: i < 3 ? 'd1' : 'd2', job_id: null,
        prompt: `p${i}`, parameters_json: '{"resolved_verb":"generate","seed":1}',
        image_blob_id: null, thumbnail_blob_id: null, created_at: ts,
      });
    }
    const page1 = readHistoryList(db as unknown as Database, store, { document_id: 'd1', limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.next_cursor);
    const page2 = readHistoryList(db as unknown as Database, store, {
      document_id: 'd1',
      limit: 2,
      cursor: page1.next_cursor,
    });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.next_cursor, undefined);
  }],
  ['readHistoryList honours `since` for delta sync', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const t0 = '2026-01-01T00:00:00.000Z';
    const t1 = '2026-01-02T00:00:00.000Z';
    store.insert({ id: 'old', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}', image_blob_id: null, thumbnail_blob_id: null, created_at: t0 });
    store.insert({ id: 'new', document_id: 'd', job_id: null, prompt: '', parameters_json: '{}', image_blob_id: null, thumbnail_blob_id: null, created_at: t1 });
    const page = readHistoryList(db as unknown as Database, store, { since: t0 });
    assert.deepEqual(page.items.map((r) => (r as { id: string }).id), ['new']);
  }],
  ['readHistoryList projects fields when requested', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    store.insert({
      id: 'h', document_id: 'd', job_id: null,
      prompt: 'p', parameters_json: '{"resolved_verb":"generate","seed":1}',
      image_blob_id: null, thumbnail_blob_id: null, created_at: 'ts',
    });
    const page = readHistoryList(db as unknown as Database, store, { fields: ['id', 'prompt'] });
    const item = page.items[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(item).sort(), ['id', 'prompt']);
  }],
  ['readHistoryItem returns null for missing id', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    assert.equal(readHistoryItem(db as unknown as Database, store, 'nope'), null);
  }],

  // ---- GC ---------------------------------------------------------------
  ['HistoryGc deletes discarded items past the grace window', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const assets = new FakeAssetStore();
    db.blobs.push({ id: 'b1', sha256: 'x', bytes: 100, mime: 'image/png', rel_path: 'b1', created_at: 'ts', expires_at: null });
    assets.written.set('b1', { bytes: 100, mime: 'image/png' });

    const baseTs = new Date('2026-02-01T00:00:00.000Z');
    store.insert({
      id: 'old',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: 'b1',
      thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store.markDiscarded({ id: 'old', discarded_at: '2026-01-15T00:00:00.000Z' });

    const bus = new EventBus();
    const events: { name: string; payload: unknown }[] = [];
    bus.subscribe('history.gc-completed', (p) => {
      events.push({ name: 'history.gc-completed', payload: p });
    });

    const gc = new HistoryGc({
      store,
      assets: assets as never,
      bus,
      now: () => baseTs,
    });
    const result = await gc.run();
    assert.equal(result.items_deleted, 1);
    assert.ok(result.bytes_freed >= 100);
    assert.equal(store.getById('old'), null);
    assert.equal(events.length, 1);
  }],
  ['HistoryGc deletes unreferenced items past retention', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const assets = new FakeAssetStore();
    const baseTs = new Date('2026-03-01T00:00:00.000Z');
    store.insert({
      id: 'old',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: null,
      thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const bus = new EventBus();
    const gc = new HistoryGc({
      store,
      assets: assets as never,
      bus,
      now: () => baseTs,
    });
    await gc.run();
    assert.equal(store.getById('old'), null);
  }],
  ['HistoryGc preserves applied items even past retention', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const assets = new FakeAssetStore();
    const baseTs = new Date('2026-03-01T00:00:00.000Z');
    store.insert({
      id: 'applied',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: null,
      thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store.markApplied({ id: 'applied', layer_id: 'L', applied_at: '2026-01-02T00:00:00.000Z' });
    const bus = new EventBus();
    const gc = new HistoryGc({
      store,
      assets: assets as never,
      bus,
      now: () => baseTs,
    });
    await gc.run();
    assert.ok(store.getById('applied'));
  }],
  ['HistoryGc storage-budget eviction sweeps oldest unreferenced first', async () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    const assets = new FakeAssetStore();
    // Two unreferenced items, both well within retention.
    db.blobs.push(
      { id: 'b1', sha256: 'x', bytes: 600, mime: 'image/png', rel_path: 'b1', created_at: 'ts', expires_at: null },
      { id: 'b2', sha256: 'x', bytes: 600, mime: 'image/png', rel_path: 'b2', created_at: 'ts', expires_at: null },
    );
    assets.written.set('b1', { bytes: 600, mime: 'image/png' });
    assets.written.set('b2', { bytes: 600, mime: 'image/png' });
    store.insert({
      id: 'older',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: 'b1',
      thumbnail_blob_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store.insert({
      id: 'newer',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: 'b2',
      thumbnail_blob_id: null,
      created_at: '2026-01-02T00:00:00.000Z',
    });
    const bus = new EventBus();
    const baseTs = new Date('2026-01-03T00:00:00.000Z');
    const gc = new HistoryGc({
      store,
      assets: assets as never,
      bus,
      config: { max_size_bytes: 800 }, // total 1200 → must evict at least one
      now: () => baseTs,
    });
    await gc.run();
    // Older item evicted first.
    assert.equal(store.getById('older'), null);
    assert.ok(store.getById('newer'));
  }],
  ['HistoryGc startup check degrades items with missing blobs', () => {
    const db = new FakeDb();
    const store = new HistoryStore(db as unknown as Database);
    // image_blob_id `b1` has no row in `blobs` → orphan.
    store.insert({
      id: 'orphaned',
      document_id: 'd',
      job_id: null,
      prompt: '',
      parameters_json: '{}',
      image_blob_id: 'b1',
      thumbnail_blob_id: null,
      created_at: 'ts',
    });
    const assets = new FakeAssetStore();
    const bus = new EventBus();
    const gc = new HistoryGc({
      store,
      assets: assets as never,
      bus,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const r = gc.runStartupCheck();
    assert.equal(r.degraded, 1);
    assert.ok(store.getById('orphaned')?.discarded_at);
  }],

  // ---- In-memory transport URI matcher ---------------------------------
  ['InMemoryTransport.readResource matches list + path-id resources', async () => {
    const calls: Array<{ uri: string; query: Record<string, string | string[]> }> = [];
    const transport = new InMemoryTransport(
      { dispatch: async () => undefined, has: () => false } as never,
      new EventBus(),
      { append: () => undefined } as never,
      { info: () => {}, error: () => {} } as never,
      { in_memory_token_name: 'x', host_name: 'y' },
    );
    const list: ResourceResolver = (uri, query) => {
      calls.push({ uri, query });
      return { items: [], next_cursor: undefined };
    };
    const item: ResourceResolver = (uri, query) => {
      calls.push({ uri, query });
      return { id: query['id'] };
    };
    transport.registerResource('diffusecraft://history/list', list);
    transport.registerResource('diffusecraft://history/{id}', item);
    const r1 = await transport.readResource('diffusecraft://history/list?document_id=D1&limit=10');
    assert.deepEqual(r1, { items: [], next_cursor: undefined });
    assert.equal(calls[0]?.query['document_id'], 'D1');
    const r2 = await transport.readResource('diffusecraft://history/H_ULID');
    assert.deepEqual(r2, { id: 'H_ULID' });
  }],
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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
      console.error(`  FAIL ${name}\n        ${(err as Error).message}\n${(err as Error).stack ?? ''}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} history test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} history test(s) passed.`);
  }
})();
