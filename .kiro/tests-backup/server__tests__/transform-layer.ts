#!/usr/bin/env tsx
/**
 * Tests for the `transform_layer` server handler (Phase C — C.5).
 *
 * Covers:
 *   - Schema is wired through `@diffusecraft/mcp-tools`.
 *   - Single-layer transform stores decomposed JSON + emits
 *     `document.changed` + registers a reversible Command (P27).
 *   - Partial-input merge: missing fields preserve previous state (Q7).
 *   - Delta input applies relative changes.
 *   - Reversibility: revert restores the prior transform on every layer.
 *   - Group transform: writes to every layer member in one Command.
 *   - DOCUMENT_REQUIRED + INVALID_INPUT + TARGET_NOT_FOUND errors.
 *
 * Uses an in-memory `FakeDb` mimicking the schema columns we touch
 * (`layers.id`, `layers.document_id`, `layers.group_id`,
 * `layers.transform_json`).
 */

import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';

import { transformLayer as transformLayerTool } from '@diffusecraft/mcp-tools';
import {
  createTransformLayerHandler,
  decodeStoredTransform,
} from '../lib/handlers/transform-layer.js';
import type { HandlerContext } from '../types/handler-context.js';

interface LayerRow {
  id: string;
  document_id: string;
  position: number;
  group_id: string | null;
  transform_json: string | null;
}

class FakeDb implements Database {
  readonly open = true;
  readonly inTransaction = false;
  layers: LayerRow[] = [];

  prepare<TParams = unknown, TRow = unknown>(sql: string): Statement<TParams, TRow> {
    return new FakeStatement(this, sql) as unknown as Statement<TParams, TRow>;
  }
  exec(_sql: string): Database {
    return this;
  }
  pragma(_p: string): unknown {
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
    if (/^UPDATE\s+layers\s+SET\s+transform_json = \?\s+WHERE\s+id = \?/i.test(sql)) {
      const [transform_json, id] = params as [string | null, string];
      const row = this.db.layers.find((l) => l.id === id);
      if (!row) return { changes: 0, lastInsertRowid: 0 };
      row.transform_json = transform_json;
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
    if (
      /^SELECT\s+id,\s*document_id,\s*transform_json\s+FROM\s+layers\s+WHERE\s+id = \?\s+AND\s+document_id = \?/i.test(
        sql,
      )
    ) {
      const [id, doc] = params as [string, string];
      const row = this.db.layers.find((l) => l.id === id && l.document_id === doc);
      if (row) {
        yield {
          id: row.id,
          document_id: row.document_id,
          transform_json: row.transform_json,
        };
      }
      return;
    }
    if (
      /^SELECT\s+id,\s*document_id,\s*transform_json\s+FROM\s+layers\s+WHERE\s+document_id = \?\s+AND\s+group_id = \?/i.test(
        sql,
      )
    ) {
      const [doc, group] = params as [string, string];
      const rows = this.db.layers
        .filter((l) => l.document_id === doc && l.group_id === group)
        .sort((a, b) => a.position - b.position);
      for (const r of rows) {
        yield {
          id: r.id,
          document_id: r.document_id,
          transform_json: r.transform_json,
        };
      }
      return;
    }
    throw new Error(`fake-db.iterate: unhandled SQL: ${sql}`);
  }
}

// ---------------------------------------------------------------------------
// Test helper context.
// ---------------------------------------------------------------------------

function makeCtx(overrides?: { document_id?: string }): {
  ctx: HandlerContext & { scratch: Record<string, unknown> };
  events: { name: string; payload: unknown }[];
} {
  const events: { name: string; payload: unknown }[] = [];
  const ctx = {
    request_id: 'req_test',
    transport: 'in-memory' as const,
    token_id: null,
    token_name: 'tester',
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
// Cases.
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  ['transformLayer tool definition exposes write+reversible', () => {
    assert.equal(transformLayerTool.name, 'transform_layer');
    assert.equal(transformLayerTool.category, 'write');
    assert.equal(transformLayerTool.reversible, true);
  }],

  ['decodeStoredTransform falls back to identity on null/garbage', () => {
    const id = decodeStoredTransform(null);
    assert.equal(id.tx, 0);
    assert.equal(id.sx, 1);
    assert.equal(id.rotation_deg, 0);
    const fallback = decodeStoredTransform('not json');
    assert.equal(fallback.sx, 1);
    assert.equal(fallback.flip_h, false);
  }],

  ['transform_layer: single layer absolute partial merges into existing transform', async () => {
    const db = new FakeDb();
    db.layers.push({
      id: 'L1', document_id: 'D', position: 0, group_id: null,
      transform_json: JSON.stringify({ tx: 10, ty: 5, sx: 2, sy: 2, rotation_deg: 0, skew_x_deg: 0, skew_y_deg: 0, flip_h: false, flip_v: false, anchor: { x: 0.5, y: 0.5 } }),
    });
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx, events } = makeCtx({ document_id: 'D' });
    const out = await handler(
      { layer_id: 'L1' as never, transform: { tx: 99 } },
      ctx,
    );
    assert.equal(out.layer_id, 'L1');
    assert.equal(out.transform!.tx, 99);
    // Other fields preserved.
    assert.equal(out.transform!.ty, 5);
    assert.equal(out.transform!.sx, 2);
    // Persisted on the row.
    const row = db.layers.find((l) => l.id === 'L1')!;
    assert.equal(JSON.parse(row.transform_json!).tx, 99);
    // Event emitted.
    assert.ok(events.some((e) => e.name === 'document.changed'));
    assert.deepEqual(out.affected_layer_ids, ['L1']);
  }],

  ['transform_layer: delta input applies relative translate + rotate', async () => {
    const db = new FakeDb();
    db.layers.push({ id: 'L1', document_id: 'D', position: 0, group_id: null, transform_json: null });
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    const out = await handler(
      {
        layer_id: 'L1' as never,
        transform: { translate: { dx: 10, dy: 20 }, rotate_deg: 45 },
      },
      ctx,
    );
    assert.equal(out.transform!.tx, 10);
    assert.equal(out.transform!.ty, 20);
    assert.ok(Math.abs(out.transform!.rotation_deg - 45) < 1e-9);
  }],

  ['transform_layer: reversible Command restores prior transform', async () => {
    const db = new FakeDb();
    db.layers.push({
      id: 'L1', document_id: 'D', position: 0, group_id: null,
      transform_json: JSON.stringify({ tx: 1, ty: 2, sx: 1, sy: 1, rotation_deg: 0, skew_x_deg: 0, skew_y_deg: 0, flip_h: false, flip_v: false, anchor: { x: 0.5, y: 0.5 } }),
    });
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    await handler({ layer_id: 'L1' as never, transform: { tx: 99 } }, ctx);
    const cmd = ctx.scratch['command'] as { revert: () => void; reapply: () => void };
    assert.ok(cmd, 'command was registered');
    // Apply again post-revert restores original.
    cmd.revert();
    const row = db.layers.find((l) => l.id === 'L1')!;
    assert.equal(JSON.parse(row.transform_json!).tx, 1);
    // Reapply restores the new transform.
    cmd.reapply();
    assert.equal(JSON.parse(row.transform_json!).tx, 99);
  }],

  ['transform_layer: revert clears the column when prior transform was identity', async () => {
    const db = new FakeDb();
    db.layers.push({ id: 'L1', document_id: 'D', position: 0, group_id: null, transform_json: null });
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    await handler({ layer_id: 'L1' as never, transform: { tx: 50 } }, ctx);
    const cmd = ctx.scratch['command'] as { revert: () => void };
    cmd.revert();
    const row = db.layers.find((l) => l.id === 'L1')!;
    assert.equal(row.transform_json, null);
  }],

  ['transform_layer: group transform writes every member in one Command', async () => {
    const db = new FakeDb();
    db.layers.push(
      { id: 'A', document_id: 'D', position: 0, group_id: 'G1', transform_json: null },
      { id: 'B', document_id: 'D', position: 1, group_id: 'G1', transform_json: null },
      { id: 'C', document_id: 'D', position: 2, group_id: null, transform_json: null }, // not in group
    );
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx, events } = makeCtx({ document_id: 'D' });
    const out = await handler(
      { group_id: 'G1', transform: { translate: { dx: 7, dy: 0 } } },
      ctx,
    );
    assert.equal(out.group_id, 'G1');
    assert.deepEqual([...out.affected_layer_ids].sort(), ['A', 'B']);
    // Both group members got the translate.
    const a = db.layers.find((l) => l.id === 'A')!;
    const b = db.layers.find((l) => l.id === 'B')!;
    const c = db.layers.find((l) => l.id === 'C')!;
    assert.equal(JSON.parse(a.transform_json!).tx, 7);
    assert.equal(JSON.parse(b.transform_json!).tx, 7);
    // Non-member untouched.
    assert.equal(c.transform_json, null);
    // One document.changed event for the call.
    const dc = events.filter((e) => e.name === 'document.changed');
    assert.equal(dc.length, 1);

    // Revert restores both.
    const cmd = ctx.scratch['command'] as { revert: () => void };
    cmd.revert();
    assert.equal(db.layers.find((l) => l.id === 'A')!.transform_json, null);
    assert.equal(db.layers.find((l) => l.id === 'B')!.transform_json, null);
  }],

  ['transform_layer: missing document raises DOCUMENT_REQUIRED', async () => {
    const db = new FakeDb();
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx();
    await assert.rejects(
      () => handler({ layer_id: 'L1' as never, transform: { tx: 1 } }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'DOCUMENT_REQUIRED',
    );
  }],

  ['transform_layer: missing both layer_id and group_id raises INVALID_INPUT', async () => {
    const db = new FakeDb();
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    await assert.rejects(
      () => handler({ transform: { tx: 1 } }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_INPUT',
    );
  }],

  ['transform_layer: unknown layer raises TARGET_NOT_FOUND', async () => {
    const db = new FakeDb();
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    await assert.rejects(
      () => handler({ layer_id: 'GHOST' as never, transform: { tx: 1 } }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'TARGET_NOT_FOUND',
    );
  }],

  ['transform_layer: empty group raises TARGET_NOT_FOUND', async () => {
    const db = new FakeDb();
    const handler = createTransformLayerHandler(db as unknown as Database);
    const { ctx } = makeCtx({ document_id: 'D' });
    await assert.rejects(
      () => handler({ group_id: 'EMPTY', transform: { translate: { dx: 1, dy: 0 } } }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'TARGET_NOT_FOUND',
    );
  }],
];

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
    console.error(`\n${failed}/${cases.length} transform-layer test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} transform-layer test(s) passed.`);
  }
}

void main();
