#!/usr/bin/env tsx
/**
 * Mask-system handler unit tests (mask-system Phase B.9).
 *
 * Exercises every mask handler (refine_mask, invert_mask, clear_mask,
 * fill_mask, selection_to_mask, mask_to_selection, bake_mask) against an
 * in-memory FakeDb + FakeAssetStore + a real SelectionStore wrapped on
 * the same FakeDb. The handlers' DB queries are limited to the mask /
 * layer / document / selection rows so the fake only needs to model
 * those.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/mask-handlers.ts`.
 */
import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';

import { SelectionStore, type PersistedSelection } from '../lib/selection/store.js';
import {
  createRefineMaskHandler,
  createInvertMaskHandler,
  createClearMaskHandler,
  createFillMaskHandler,
  createSelectionToMaskHandler,
  createMaskToSelectionHandler,
  createBakeMaskHandler,
  RAW_ALPHA_MIME,
  serializeMaskData,
  type MaskAssetStore,
} from '../lib/handlers/mask/index.js';
import type { HandlerContext } from '../types/handler-context.js';

// ---------------------------------------------------------------------------
// Fake DB modelling layers / documents / selections rows.
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

interface LayerRow {
  id: string;
  document_id: string;
  kind: string;
  name: string;
  position: number;
  opacity: number;
  blend: string;
  visible: number;
  content_blob_id: string | null;
  mask_data_json: string | null;
}

interface SelectionRow {
  document_id: string;
  mask_blob_id: string | null;
  bounds_json: string | null;
  updated_at: string;
}

class FakeDb implements Database {
  readonly open = true;
  readonly inTransaction = false;
  documents: DocumentRow[] = [];
  layers: LayerRow[] = [];
  selections: SelectionRow[] = [];

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

    if (/^UPDATE\s+layers\s+SET\s+content_blob_id\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [blob, id] = params as [string | null, string];
      const row = this.db.layers.find((l) => l.id === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.content_blob_id = blob;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+layers\s+SET\s+mask_data_json\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [meta, id] = params as [string | null, string];
      const row = this.db.layers.find((l) => l.id === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.mask_data_json = meta;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^UPDATE\s+layers\s+SET\s+mask_data_json\s*=\s*\?,\s*content_blob_id\s*=\s*\?/i.test(sql)) {
      const [meta, blob, id] = params as [string | null, string | null, string];
      const row = this.db.layers.find((l) => l.id === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.mask_data_json = meta;
      row.content_blob_id = blob;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+layers/i.test(sql)) {
      const [id, document_id, name, position, content_blob_id, mask_data_json] = params as [
        string, string, string, number, string, string,
      ];
      // IDs include OR IGNORE: skip if already present.
      if (/IGNORE/i.test(sql) && this.db.layers.some((l) => l.id === id)) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      this.db.layers.push({
        id,
        document_id,
        kind: 'mask',
        name,
        position,
        opacity: 1,
        blend: 'normal',
        visible: 1,
        content_blob_id,
        mask_data_json,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/^DELETE\s+FROM\s+layers\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [id] = params as [string];
      const before = this.db.layers.length;
      this.db.layers = this.db.layers.filter((l) => l.id !== id);
      return { changes: before - this.db.layers.length, lastInsertRowid: 0 };
    }
    if (/^INSERT\s+INTO\s+selections/i.test(sql)) {
      const [document_id, mask_blob_id, bounds_json, updated_at] = params as [
        string, string | null, string, string,
      ];
      const existing = this.db.selections.find((s) => s.document_id === document_id);
      if (existing) {
        existing.mask_blob_id = mask_blob_id;
        existing.bounds_json = bounds_json;
        existing.updated_at = updated_at;
      } else {
        this.db.selections.push({ document_id, mask_blob_id, bounds_json, updated_at });
      }
      return { changes: 1, lastInsertRowid: 0 };
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
    if (/^SELECT\s+id,\s*w,\s*h\s+FROM\s+documents/i.test(sql)) {
      const [id] = params as [string];
      const doc = this.db.documents.find((d) => d.id === id);
      if (doc) yield { ...doc };
      return;
    }
    if (/^SELECT\s+id,\s*document_id,\s*kind,\s*content_blob_id,\s*mask_data_json/i.test(sql)) {
      const [id] = params as [string];
      const layer = this.db.layers.find((l) => l.id === id);
      if (layer)
        yield {
          id: layer.id,
          document_id: layer.document_id,
          kind: layer.kind,
          content_blob_id: layer.content_blob_id,
          mask_data_json: layer.mask_data_json,
        };
      return;
    }
    if (/^SELECT\s+id,\s*document_id,\s*kind,\s*content_blob_id\s+FROM\s+layers/i.test(sql)) {
      const [id] = params as [string];
      const layer = this.db.layers.find((l) => l.id === id);
      if (layer)
        yield {
          id: layer.id,
          document_id: layer.document_id,
          kind: layer.kind,
          content_blob_id: layer.content_blob_id,
        };
      return;
    }
    if (/^SELECT\s+id,\s*content_blob_id\s+FROM\s+layers/i.test(sql)) {
      const [id] = params as [string];
      const layer = this.db.layers.find((l) => l.id === id);
      if (layer) yield { id: layer.id, content_blob_id: layer.content_blob_id };
      return;
    }
    if (/^SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+layers/i.test(sql)) {
      const [doc] = params as [string];
      yield { c: this.db.layers.filter((l) => l.document_id === doc).length };
      return;
    }
    if (/^SELECT\s+\*\s+FROM\s+selections\s+WHERE\s+document_id\s*=\s*\?/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.selections.find((s) => s.document_id === id);
      if (row) yield { ...row };
      return;
    }
    throw new Error(`fake-db.iterate: unhandled SQL: ${sql}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory asset store.
// ---------------------------------------------------------------------------

class FakeAssetStore implements MaskAssetStore {
  written = new Map<string, { mime: string; bytes: Buffer }>();
  private next = 0;
  async write(args: { bytes: Buffer; mime: string }): Promise<{ id: string }> {
    const id = `blob_${this.next++}`;
    this.written.set(id, { mime: args.mime, bytes: Buffer.from(args.bytes) });
    return { id };
  }
  async read(id: string): Promise<{ meta: { mime: string; bytes: number }; bytes: Buffer } | null> {
    const w = this.written.get(id);
    if (!w) return null;
    return {
      meta: { mime: w.mime, bytes: w.bytes.byteLength },
      bytes: w.bytes,
    };
  }
}

// ---------------------------------------------------------------------------
// Handler context fixture.
// ---------------------------------------------------------------------------

function makeCtx(document_id?: string): {
  ctx: HandlerContext & { scratch: Record<string, unknown> };
  events: { name: string; payload: unknown }[];
} {
  const events: { name: string; payload: unknown }[] = [];
  const ctx = {
    request_id: 'req',
    transport: 'in-memory' as const,
    token_id: null,
    token_name: 'test',
    received_at: Date.now(),
    document_id,
    publish: (e: { name: string; payload: unknown }) => events.push(e),
    audit: () => {},
    logger: { info: () => {}, error: () => {} },
    scratch: {} as Record<string, unknown>,
  };
  return { ctx, events };
}

// ---------------------------------------------------------------------------
// Test fixture builders.
// ---------------------------------------------------------------------------

function makeAlphaBlob(bytes: Uint8Array): { mime: string; bytes: Buffer } {
  return { mime: RAW_ALPHA_MIME, bytes: Buffer.from(bytes) };
}

function makeFixture() {
  const db = new FakeDb();
  const assets = new FakeAssetStore();
  db.documents.push({ id: 'D', w: 4, h: 4 });
  return { db, assets };
}

async function seedPaintedMask(
  db: FakeDb,
  assets: FakeAssetStore,
  bytes: Uint8Array,
): Promise<string> {
  const blob = makeAlphaBlob(bytes);
  const written = await assets.write(blob);
  const id = `mask_${db.layers.length}`;
  db.layers.push({
    id,
    document_id: 'D',
    kind: 'mask',
    name: 'Painted',
    position: db.layers.length,
    opacity: 1,
    blend: 'normal',
    visible: 1,
    content_blob_id: written.id,
    mask_data_json: serializeMaskData({ subkind: 'painted' }),
  });
  return id;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- refine_mask ----
  ['refine_mask grows a single-pixel mask and is reversible', async () => {
    const { db, assets } = makeFixture();
    const seed = new Uint8Array(16);
    seed[5] = 200; // (1,1) pixel set
    const layer_id = await seedPaintedMask(db, assets, seed);
    const handler = createRefineMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    const out = await handler(
      { layer_id: layer_id as never, threshold: 128, grow_px: 1 },
      ctx,
    );
    assert.equal(out.applied, true);
    const layer = db.layers.find((l) => l.id === layer_id)!;
    const newBlob = assets.written.get(layer.content_blob_id!)!;
    // Should have a 3×3 set centered at (1,1) → 9 set pixels.
    const set = Array.from(newBlob.bytes).filter((v) => v === 255).length;
    assert.equal(set, 9);

    // Revert restores original blob id.
    const cmd = ctx.scratch['command'] as { revert: () => void };
    const priorBlobId = layer.content_blob_id;
    await cmd.revert();
    const reverted = db.layers.find((l) => l.id === layer_id)!;
    assert.notEqual(reverted.content_blob_id, priorBlobId);
  }],
  ['refine_mask rejects from_layer subkind', async () => {
    const { db, assets } = makeFixture();
    db.layers.push({
      id: 'L_FROM',
      document_id: 'D',
      kind: 'mask',
      name: 'fromlayer',
      position: 0,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: null,
      mask_data_json: serializeMaskData({
        subkind: 'from_layer',
        source_layer_id: 'SRC' as never,
        channel: 'alpha',
        invert: false,
      }),
    });
    const handler = createRefineMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await assert.rejects(
      () => handler({ layer_id: 'L_FROM' as never, grow_px: 1 }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_INPUT',
    );
  }],

  // ---- invert_mask ----
  ['invert_mask flips painted alpha bytes and is reversible', async () => {
    const { db, assets } = makeFixture();
    const seed = new Uint8Array([0, 64, 128, 255]);
    // Pad to 4×4 = 16 bytes.
    const padded = new Uint8Array(16);
    padded.set(seed);
    const layer_id = await seedPaintedMask(db, assets, padded);
    const layer = db.layers.find((l) => l.id === layer_id)!;
    const priorBlob = layer.content_blob_id;
    const handler = createInvertMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await handler({ layer_id: layer_id as never }, ctx);
    const after = db.layers.find((l) => l.id === layer_id)!;
    const newBytes = assets.written.get(after.content_blob_id!)!.bytes;
    assert.equal(newBytes[0], 255);
    assert.equal(newBytes[3], 0);
    // Revert restores the prior blob id.
    const cmd = ctx.scratch['command'] as { revert: () => void };
    await cmd.revert();
    const reverted = db.layers.find((l) => l.id === layer_id)!;
    assert.equal(reverted.content_blob_id, priorBlob);
  }],
  ['invert_mask toggles from_layer.invert flag without writing a blob', async () => {
    const { db, assets } = makeFixture();
    db.layers.push({
      id: 'L_FROM',
      document_id: 'D',
      kind: 'mask',
      name: 'fromlayer',
      position: 0,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: null,
      mask_data_json: serializeMaskData({
        subkind: 'from_layer',
        source_layer_id: 'SRC' as never,
        channel: 'alpha',
        invert: false,
      }),
    });
    const handler = createInvertMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    const blobsBefore = assets.written.size;
    await handler({ layer_id: 'L_FROM' as never }, ctx);
    assert.equal(assets.written.size, blobsBefore, 'no new blob should be written');
    const meta = JSON.parse(db.layers.find((l) => l.id === 'L_FROM')!.mask_data_json!) as {
      invert: boolean;
    };
    assert.equal(meta.invert, true);
    // Reapply via revert toggles back.
    const cmd = ctx.scratch['command'] as { revert: () => void };
    await cmd.revert();
    const after = JSON.parse(db.layers.find((l) => l.id === 'L_FROM')!.mask_data_json!) as {
      invert: boolean;
    };
    assert.equal(after.invert, false);
  }],

  // ---- clear_mask ----
  ['clear_mask zeroes the bytes', async () => {
    const { db, assets } = makeFixture();
    const seed = new Uint8Array(16).fill(200);
    const layer_id = await seedPaintedMask(db, assets, seed);
    const handler = createClearMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await handler({ layer_id: layer_id as never }, ctx);
    const after = db.layers.find((l) => l.id === layer_id)!;
    const bytes = assets.written.get(after.content_blob_id!)!.bytes;
    assert.ok(Array.from(bytes).every((v) => v === 0));
  }],

  // ---- fill_mask ----
  ['fill_mask sets every byte to value and is reversible', async () => {
    const { db, assets } = makeFixture();
    const seed = new Uint8Array(16);
    const layer_id = await seedPaintedMask(db, assets, seed);
    const layer = db.layers.find((l) => l.id === layer_id)!;
    const priorBlob = layer.content_blob_id;
    const handler = createFillMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await handler({ layer_id: layer_id as never, value: 200 }, ctx);
    const after = db.layers.find((l) => l.id === layer_id)!;
    const bytes = assets.written.get(after.content_blob_id!)!.bytes;
    assert.ok(Array.from(bytes).every((v) => v === 200));
    const cmd = ctx.scratch['command'] as { revert: () => void };
    await cmd.revert();
    assert.equal(db.layers.find((l) => l.id === layer_id)!.content_blob_id, priorBlob);
  }],

  // ---- selection_to_mask ----
  ['selection_to_mask creates a new mask layer when layer_id omitted', async () => {
    const { db, assets } = makeFixture();
    const selectionStore = new SelectionStore(db as unknown as Database);
    const sel: PersistedSelection = { kind: 'rect', rect: { x: 0, y: 0, w: 2, h: 2 } };
    selectionStore.set({ document_id: 'D', selection: sel });
    const handler = createSelectionToMaskHandler({
      db: db as unknown as Database,
      assets,
      selectionStore,
    });
    const { ctx } = makeCtx('D');
    const out = await handler({ name: 'Test mask' }, ctx);
    assert.equal(out.created, true);
    const layer = db.layers.find((l) => l.id === out.layer_id);
    assert.ok(layer);
    assert.equal(layer!.kind, 'mask');
    assert.equal(layer!.name, 'Test mask');
    const meta = JSON.parse(layer!.mask_data_json!) as { subkind: string };
    assert.equal(meta.subkind, 'painted');
    // Bytes should match the rect → top-left 2×2 set.
    const bytes = assets.written.get(layer!.content_blob_id!)!.bytes;
    assert.equal(bytes[0], 255);
    assert.equal(bytes[1], 255);
    assert.equal(bytes[4], 255);
    assert.equal(bytes[5], 255);
    // Outside the rect must be 0.
    assert.equal(bytes[10], 0);
    // Revert removes the layer.
    const cmd = ctx.scratch['command'] as { revert: () => void };
    await cmd.revert();
    assert.equal(db.layers.find((l) => l.id === out.layer_id), undefined);
  }],
  ['selection_to_mask overwrites bytes when layer_id is provided', async () => {
    const { db, assets } = makeFixture();
    const selectionStore = new SelectionStore(db as unknown as Database);
    selectionStore.set({
      document_id: 'D',
      selection: { kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 } },
    });
    const layer_id = await seedPaintedMask(db, assets, new Uint8Array(16).fill(100));
    const handler = createSelectionToMaskHandler({
      db: db as unknown as Database,
      assets,
      selectionStore,
    });
    const { ctx } = makeCtx('D');
    const out = await handler({ layer_id: layer_id as never }, ctx);
    assert.equal(out.created, false);
    const layer = db.layers.find((l) => l.id === layer_id)!;
    const bytes = assets.written.get(layer.content_blob_id!)!.bytes;
    assert.equal(bytes[0], 255);
    assert.equal(bytes[1], 0);
  }],

  // ---- mask_to_selection ----
  ['mask_to_selection sets the active selection to a mask blob', async () => {
    const { db, assets } = makeFixture();
    const selectionStore = new SelectionStore(db as unknown as Database);
    const seed = new Uint8Array(16);
    for (let i = 0; i < seed.length; i++) seed[i] = i % 2 === 0 ? 200 : 50;
    const layer_id = await seedPaintedMask(db, assets, seed);
    const handler = createMaskToSelectionHandler({
      db: db as unknown as Database,
      assets,
      selectionStore,
    });
    const { ctx } = makeCtx('D');
    const out = await handler({ mask_layer_id: layer_id as never, threshold: 128 }, ctx);
    assert.equal(out.active, true);
    const sel = selectionStore.getOrNone('D');
    assert.equal(sel.kind, 'mask');
    if (sel.kind === 'mask') {
      const blob = assets.written.get(sel.blob_id);
      assert.ok(blob);
      // Threshold 128: every "200" → 255, every "50" → 0.
      assert.equal(blob!.bytes[0], 255);
      assert.equal(blob!.bytes[1], 0);
    }
  }],
  ['mask_to_selection roundtrip is lossless at threshold=128', async () => {
    const { db, assets } = makeFixture();
    const selectionStore = new SelectionStore(db as unknown as Database);
    const original = new Uint8Array(16);
    for (let i = 0; i < 16; i++) original[i] = i % 3 === 0 ? 255 : 0;
    const layer_id = await seedPaintedMask(db, assets, original);
    const handler = createMaskToSelectionHandler({
      db: db as unknown as Database,
      assets,
      selectionStore,
    });
    const { ctx } = makeCtx('D');
    await handler({ mask_layer_id: layer_id as never, threshold: 128 }, ctx);
    const sel = selectionStore.getOrNone('D');
    if (sel.kind === 'mask') {
      const blob = assets.written.get(sel.blob_id);
      assert.deepEqual(Array.from(blob!.bytes), Array.from(original));
    } else {
      assert.fail('expected kind: mask selection');
    }
  }],

  // ---- bake_mask ----
  ['bake_mask converts from_layer → painted with snapshot bytes', async () => {
    const { db, assets } = makeFixture();
    // Source layer = 4×4 RGBA, alpha varies.
    const srcRgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) srcRgba[i * 4 + 3] = i * 16;
    const srcWritten = await assets.write({
      bytes: Buffer.from(srcRgba),
      mime: 'application/x-diffusecraft-raster',
    });
    db.layers.push({
      id: 'SRC',
      document_id: 'D',
      kind: 'paint',
      name: 'src',
      position: 0,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: srcWritten.id,
      mask_data_json: null,
    });
    db.layers.push({
      id: 'L_FROM',
      document_id: 'D',
      kind: 'mask',
      name: 'fromlayer',
      position: 1,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: null,
      mask_data_json: serializeMaskData({
        subkind: 'from_layer',
        source_layer_id: 'SRC' as never,
        channel: 'alpha',
        invert: false,
      }),
    });
    const handler = createBakeMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    const out = await handler({ layer_id: 'L_FROM' as never }, ctx);
    assert.equal(out.applied, true);
    const layer = db.layers.find((l) => l.id === 'L_FROM')!;
    const meta = JSON.parse(layer.mask_data_json!) as { subkind: string };
    assert.equal(meta.subkind, 'painted');
    const bytes = assets.written.get(layer.content_blob_id!)!.bytes;
    // Alpha-mode bake: alpha[0]=0 → 0; alpha[15]=240 → 240.
    assert.equal(bytes[0], 0);
    assert.equal(bytes[15], 240);
  }],
  ['bake_mask rejects painted subkind', async () => {
    const { db, assets } = makeFixture();
    const layer_id = await seedPaintedMask(db, assets, new Uint8Array(16));
    const handler = createBakeMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await assert.rejects(
      () => handler({ layer_id: layer_id as never }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_INPUT',
    );
  }],
  ['bake_mask is reversible — restores from_layer metadata', async () => {
    const { db, assets } = makeFixture();
    db.layers.push({
      id: 'SRC',
      document_id: 'D',
      kind: 'paint',
      name: 's',
      position: 0,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: null,
      mask_data_json: null,
    });
    const priorMeta = serializeMaskData({
      subkind: 'from_layer',
      source_layer_id: 'SRC' as never,
      channel: 'luminance',
      invert: true,
    });
    db.layers.push({
      id: 'L_FROM',
      document_id: 'D',
      kind: 'mask',
      name: 'f',
      position: 1,
      opacity: 1,
      blend: 'normal',
      visible: 1,
      content_blob_id: null,
      mask_data_json: priorMeta,
    });
    const handler = createBakeMaskHandler({ db: db as unknown as Database, assets });
    const { ctx } = makeCtx('D');
    await handler({ layer_id: 'L_FROM' as never }, ctx);
    const cmd = ctx.scratch['command'] as { revert: () => void };
    await cmd.revert();
    const after = db.layers.find((l) => l.id === 'L_FROM')!;
    assert.equal(after.mask_data_json, priorMeta);
    assert.equal(after.content_blob_id, null);
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
      console.error(`  FAIL ${name}\n        ${(err as Error).stack ?? (err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} mask-handlers test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} mask-handlers test(s) passed.`);
  }
})();
