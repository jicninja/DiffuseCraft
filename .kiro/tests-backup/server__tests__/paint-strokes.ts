#!/usr/bin/env tsx
/**
 * `paint_strokes` handler tests (brush-system Phase F).
 *
 * Covers:
 *   - Successful paint into a blank layer with a built-in preset.
 *   - Built-in eraser preset reduces destination alpha without touching
 *     color channels.
 *   - Mask-layer routing writes alpha-only.
 *   - Unknown brush_id raises BRUSH_NOT_FOUND.
 *   - Layer-not-found raises NOT_FOUND.
 *   - Non-paint, non-mask layer kind raises INVALID_INPUT.
 *   - `ignore_selection: false` honours an active rectangular selection.
 *   - Existing layer raster is loaded via the codec and over-painted.
 *
 * The test uses an in-memory shim modeled on `history.ts` — it does not boot
 * the full server. Run:
 *   pnpm --filter @diffusecraft/server exec tsx src/__tests__/paint-strokes.ts
 */
import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';

import { paintStrokes as paintStrokesTool, type LayerId } from '@diffusecraft/mcp-tools';
import {
  BRUSH_PRESETS,
  composeStrokeIntoRaster,
  expandStrokeToStamps,
  parseBrushColor,
} from '@diffusecraft/canvas-core';

/** Branded-id cast helper for tests; ULIDs aren't required because we never
 *  hand IDs back to clients in these in-memory test cases. */
const asLayerId = (id: string): LayerId => id as unknown as LayerId;

import {
  RAW_RGBA_MIME,
  createPaintStrokesHandler,
  defaultRawRgbaCodec,
  resolveBuiltinBrush,
  type PaintStrokeAssetStore,
} from '../lib/handlers/paint-strokes.js';
import type { HandlerContext } from '../types/handler-context.js';
import { ServerError } from '../types/errors.js';

// ---------------------------------------------------------------------------
// Fakes
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
  content_blob_id: string | null;
}

interface SelectionRow {
  document_id: string;
  bounds_json: string | null;
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
    if (/^UPDATE\s+layers\s+SET\s+content_blob_id/i.test(sql)) {
      const [blob, id] = params as [string | null, string];
      const layer = this.db.layers.find((l) => l.id === id);
      if (!layer) return { changes: 0, lastInsertRowid: 0 };
      layer.content_blob_id = blob;
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
    if (/^SELECT\s+id,\s*document_id,\s*kind,\s*content_blob_id\s+FROM\s+layers/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.layers.find((l) => l.id === id);
      if (row) yield { ...row };
      return;
    }
    if (/^SELECT\s+id,\s*w,\s*h\s+FROM\s+documents/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.documents.find((d) => d.id === id);
      if (row) yield { ...row };
      return;
    }
    if (/^SELECT\s+document_id,\s*bounds_json\s+FROM\s+selections/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.selections.find((s) => s.document_id === id);
      if (row) yield { ...row };
      return;
    }
    throw new Error(`fake-db.iterate: unhandled SQL: ${sql}`);
  }
}

class FakeAssetStore implements PaintStrokeAssetStore {
  private next = 0;
  blobs: Map<string, { meta: { mime: string; bytes: number }; bytes: Buffer }> =
    new Map();

  async write(args: {
    bytes: Buffer;
    mime: string;
    ttl_seconds?: number;
  }): Promise<{ id: string }> {
    const id = `blob-${this.next++}`;
    this.blobs.set(id, {
      meta: { mime: args.mime, bytes: args.bytes.byteLength },
      bytes: args.bytes,
    });
    return { id };
  }

  async read(
    id: string,
  ): Promise<{ meta: { mime: string; bytes: number }; bytes: Buffer } | null> {
    return this.blobs.get(id) ?? null;
  }
}

interface CapturedEvent {
  name: string;
  payload: unknown;
}

function makeCtx(events: CapturedEvent[] = []): HandlerContext {
  return {
    request_id: 'test-req',
    transport: 'in-memory',
    token_id: 'tok-1',
    token_name: 'tester',
    received_at: Date.now(),
    publish: (event) => events.push(event),
    audit: () => undefined,
    logger: { info: () => undefined, error: () => undefined },
  };
}

// Shorthand to construct a stroke input with all defaults filled.
function strokeOf(brush_id: string, x: number, y: number, color: string, size = 12) {
  return {
    points: [
      { x, y, pressure: 1 },
      { x: x + 8, y, pressure: 1 },
    ],
    color,
    brush_id,
    size,
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'paintStrokes tool schema is wired through mcp-tools',
    () => {
      assert.equal(paintStrokesTool.name, 'paint_strokes');
      assert.equal(paintStrokesTool.category, 'write');
      assert.equal(paintStrokesTool.reversible, true);
    },
  ],
  [
    'resolveBuiltinBrush returns null for unknown id',
    () => {
      assert.equal(resolveBuiltinBrush('not-a-brush'), null);
      assert.equal(resolveBuiltinBrush('pen')?.id, 'pen');
    },
  ],
  [
    'defaultRawRgbaCodec round-trips bytes',
    () => {
      const raster = {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 200]),
      };
      const enc = defaultRawRgbaCodec.encode(raster);
      assert.equal(enc.mime, RAW_RGBA_MIME);
      const dec = defaultRawRgbaCodec.decode(enc.bytes, enc.mime, 2, 1);
      assert.ok(dec);
      assert.deepEqual([...dec!.data], [...raster.data]);
    },
  ],
  [
    'defaultRawRgbaCodec rejects unknown mime',
    () => {
      const dec = defaultRawRgbaCodec.decode(Buffer.from([0]), 'image/png', 1, 1);
      assert.equal(dec, null);
    },
  ],
  [
    'paint_strokes paints into a blank layer and stores the new raster',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-1', w: 16, h: 16 });
      db.layers.push({
        id: 'layer-1',
        document_id: 'doc-1',
        kind: 'paint',
        content_blob_id: null,
      });
      const events: CapturedEvent[] = [];
      const ctx = makeCtx(events);
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });

      const result = await handler(
        {
          layer_id: asLayerId('layer-1'),
          strokes: [strokeOf('pen', 4, 4, '#ff0000')],
          ignore_selection: false,
        },
        ctx,
      );

      assert.equal(result.applied, true);
      assert.ok(result.affected_bbox.w > 0);
      assert.ok(result.affected_bbox.h > 0);
      const updatedLayer = db.layers.find((l) => l.id === 'layer-1')!;
      assert.ok(updatedLayer.content_blob_id?.startsWith('blob-'));
      const blob = assets.blobs.get(updatedLayer.content_blob_id!);
      assert.ok(blob);
      assert.equal(blob!.meta.mime, RAW_RGBA_MIME);
      assert.equal(blob!.bytes.byteLength, 16 * 16 * 4);
      // At least one event emitted.
      assert.equal(events.length, 1);
      assert.equal(events[0]!.name, 'document.changed');
    },
  ],
  [
    'paint_strokes uses preset eraser to clear destination alpha only',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-2', w: 8, h: 8 });
      // Pre-fill layer with an opaque red raster.
      const initial = new Uint8ClampedArray(8 * 8 * 4);
      for (let i = 0; i < 8 * 8; i++) {
        initial[i * 4] = 255;
        initial[i * 4 + 1] = 0;
        initial[i * 4 + 2] = 0;
        initial[i * 4 + 3] = 255;
      }
      const initialBlob = await assets.write({
        bytes: Buffer.from(initial.buffer, initial.byteOffset, initial.byteLength),
        mime: RAW_RGBA_MIME,
      });
      db.layers.push({
        id: 'layer-2',
        document_id: 'doc-2',
        kind: 'paint',
        content_blob_id: initialBlob.id,
      });
      const ctx = makeCtx();
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      await handler(
        {
          layer_id: asLayerId('layer-2'),
          strokes: [
            {
              points: [{ x: 4, y: 4, pressure: 1 }],
              color: '#000000',
              brush_id: 'eraser',
              size: 4,
            },
          ],
          ignore_selection: true,
        },
        ctx,
      );

      const layer = db.layers.find((l) => l.id === 'layer-2')!;
      const finalBlob = assets.blobs.get(layer.content_blob_id!)!;
      // The center pixel should now be transparent but red preserved.
      const centerIdx = (4 * 8 + 4) * 4;
      assert.equal(finalBlob.bytes[centerIdx], 255, 'red preserved');
      assert.equal(finalBlob.bytes[centerIdx + 3], 0, 'alpha cleared');
    },
  ],
  [
    'paint_strokes on mask layer writes alpha only',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-3', w: 8, h: 8 });
      db.layers.push({
        id: 'mask-1',
        document_id: 'doc-3',
        kind: 'mask',
        content_blob_id: null,
      });
      const ctx = makeCtx();
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      await handler(
        {
          layer_id: asLayerId('mask-1'),
          strokes: [
            {
              points: [{ x: 4, y: 4, pressure: 1 }],
              color: '#ffffff',
              brush_id: 'marker',
              size: 4,
            },
          ],
          ignore_selection: true,
        },
        ctx,
      );
      const layer = db.layers.find((l) => l.id === 'mask-1')!;
      const blob = assets.blobs.get(layer.content_blob_id!)!;
      const centerIdx = (4 * 8 + 4) * 4;
      // Mask: RGB stays at zero (transparent baseline), alpha rises.
      assert.equal(blob.bytes[centerIdx], 0, 'r untouched');
      assert.equal(blob.bytes[centerIdx + 1], 0, 'g untouched');
      assert.equal(blob.bytes[centerIdx + 2], 0, 'b untouched');
      // Marker preset opacity is 0.6; with white luminance and full hardness
      // at the center, alpha lands around 153 (255 * 0.6).
      assert.ok(
        blob.bytes[centerIdx + 3]! > 100,
        `expected non-trivial alpha rise, got ${blob.bytes[centerIdx + 3]}`,
      );
    },
  ],
  [
    'paint_strokes throws BRUSH_NOT_FOUND for unknown brush_id',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-x', w: 8, h: 8 });
      db.layers.push({
        id: 'lx',
        document_id: 'doc-x',
        kind: 'paint',
        content_blob_id: null,
      });
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      try {
        await handler(
          {
            layer_id: asLayerId('lx'),
            strokes: [strokeOf('not-a-brush', 0, 0, '#000000')],
            ignore_selection: true,
          },
          makeCtx(),
        );
        assert.fail('expected BRUSH_NOT_FOUND');
      } catch (err) {
        assert.ok(err instanceof ServerError);
        assert.equal((err as ServerError).code, 'BRUSH_NOT_FOUND');
      }
    },
  ],
  [
    'paint_strokes throws NOT_FOUND for missing layer',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      try {
        await handler(
          {
            layer_id: asLayerId('missing'),
            strokes: [strokeOf('pen', 0, 0, '#000000')],
            ignore_selection: true,
          },
          makeCtx(),
        );
        assert.fail('expected NOT_FOUND');
      } catch (err) {
        assert.ok(err instanceof ServerError);
        assert.equal((err as ServerError).code, 'NOT_FOUND');
      }
    },
  ],
  [
    'paint_strokes throws INVALID_INPUT for non-paint, non-mask kind',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-c', w: 4, h: 4 });
      db.layers.push({
        id: 'ctrl',
        document_id: 'doc-c',
        kind: 'control',
        content_blob_id: null,
      });
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      try {
        await handler(
          {
            layer_id: asLayerId('ctrl'),
            strokes: [strokeOf('pen', 0, 0, '#000000')],
            ignore_selection: true,
          },
          makeCtx(),
        );
        assert.fail('expected INVALID_INPUT');
      } catch (err) {
        assert.ok(err instanceof ServerError);
        assert.equal((err as ServerError).code, 'INVALID_INPUT');
      }
    },
  ],
  [
    'paint_strokes drops stamps outside an active rect selection',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-s', w: 32, h: 32 });
      db.layers.push({
        id: 'ls',
        document_id: 'doc-s',
        kind: 'paint',
        content_blob_id: null,
      });
      // Selection sits in the bottom-right quadrant; stroke is in the
      // top-left, so all stamps should be filtered out.
      db.selections.push({
        document_id: 'doc-s',
        bounds_json: JSON.stringify({ x: 16, y: 16, w: 16, h: 16 }),
      });
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      const result = await handler(
        {
          layer_id: asLayerId('ls'),
          strokes: [
            {
              points: [
                { x: 2, y: 2, pressure: 1 },
                { x: 6, y: 6, pressure: 1 },
              ],
              color: '#00ff00',
              brush_id: 'pen',
              size: 4,
            },
          ],
          ignore_selection: false,
        },
        makeCtx(),
      );
      assert.equal(result.applied, false);
      // Layer raster should not have changed (still null content blob).
      const layer = db.layers.find((l) => l.id === 'ls')!;
      assert.equal(layer.content_blob_id, null);
    },
  ],
  [
    'paint_strokes ignore_selection bypasses selection clip',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-s2', w: 32, h: 32 });
      db.layers.push({
        id: 'ls2',
        document_id: 'doc-s2',
        kind: 'paint',
        content_blob_id: null,
      });
      db.selections.push({
        document_id: 'doc-s2',
        bounds_json: JSON.stringify({ x: 16, y: 16, w: 16, h: 16 }),
      });
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      const result = await handler(
        {
          layer_id: asLayerId('ls2'),
          strokes: [
            {
              points: [{ x: 4, y: 4, pressure: 1 }],
              color: '#00ff00',
              brush_id: 'pen',
              size: 4,
            },
          ],
          ignore_selection: true,
        },
        makeCtx(),
      );
      assert.equal(result.applied, true);
    },
  ],
  [
    'paint_strokes layers brushes onto an existing raster (over-paint)',
    async () => {
      const db = new FakeDb();
      const assets = new FakeAssetStore();
      db.documents.push({ id: 'doc-op', w: 8, h: 8 });

      // Pre-paint the layer with a blue dot.
      const blank = new Uint8ClampedArray(8 * 8 * 4);
      const seedRaster = composeStrokeIntoRaster(
        { width: 8, height: 8, data: blank },
        expandStrokeToStamps(
          BRUSH_PRESETS.marker,
          [{ x: 4, y: 4, pressure: 1 }],
          { smoothing: 0 },
        ),
        { color: parseBrushColor('#0000ff').color },
      );
      const seedBlob = await assets.write({
        bytes: Buffer.from(seedRaster.data.buffer, seedRaster.data.byteOffset, seedRaster.data.byteLength),
        mime: RAW_RGBA_MIME,
      });
      db.layers.push({
        id: 'l-op',
        document_id: 'doc-op',
        kind: 'paint',
        content_blob_id: seedBlob.id,
      });
      const handler = createPaintStrokesHandler({ db: db as unknown as Database, assets });
      // Now over-paint a green line through the same area.
      await handler(
        {
          layer_id: asLayerId('l-op'),
          strokes: [strokeOf('marker', 4, 4, '#00ff00', 8)],
          ignore_selection: true,
        },
        makeCtx(),
      );
      const layer = db.layers.find((l) => l.id === 'l-op')!;
      assert.notEqual(layer.content_blob_id, seedBlob.id, 'should write a fresh blob');
      const blob = assets.blobs.get(layer.content_blob_id!)!;
      const centerIdx = (4 * 8 + 4) * 4;
      // Green should now dominate over blue.
      assert.ok(
        blob.bytes[centerIdx + 1]! > blob.bytes[centerIdx + 2]!,
        `expected green > blue, got G=${blob.bytes[centerIdx + 1]} B=${blob.bytes[centerIdx + 2]}`,
      );
    },
  ],
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
let failed = 0;
async function main() {
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
    console.error(`\n${failed}/${cases.length} test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} test(s) passed.`);
  }
}

void main();
