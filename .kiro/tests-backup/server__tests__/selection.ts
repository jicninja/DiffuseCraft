#!/usr/bin/env tsx
/**
 * Selection-tools handler unit tests.
 *
 * Exercises the Tier 1 surface (set/get/invert/select_all/refine) +
 * the Tier 2/4 stub paths (`MODEL_NOT_FOUND`, `SAMPLING_NOT_SUPPORTED`).
 *
 * The handlers depend on a `Database`-shaped object (better-sqlite3
 * surface) and a `HandlerContext`. We fake both — modelled on the
 * pattern in `__tests__/history.ts`.
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/selection.ts`.
 */
import { strict as assert } from 'node:assert';
import type { Database, Statement } from 'better-sqlite3';
import type { DocumentId } from '@diffusecraft/mcp-tools';

import { SelectionStore, type PersistedSelection } from '../lib/selection/store.js';
import { selectionBBox } from '../lib/selection/bounds.js';
import { persistedToCore } from '../lib/selection/encoding.js';
import { createSetSelectionHandler } from '../lib/handlers/set-selection.js';
import { createGetSelectionHandler } from '../lib/handlers/get-selection.js';
import { createInvertSelectionHandler } from '../lib/handlers/invert-selection.js';
import { createSelectAllHandler } from '../lib/handlers/select-all.js';
import { createRefineSelectionHandler } from '../lib/handlers/refine-selection.js';
import { createAutoSelectSubjectHandler } from '../lib/handlers/auto-select-subject.js';
import { createSelectByPromptHandler } from '../lib/handlers/select-by-prompt.js';
import { ServerError } from '../types/errors.js';
import type { HandlerContext } from '../types/handler-context.js';

// ---------------------------------------------------------------------------
// Tiny in-memory SQLite shim covering the queries the selection handlers
// touch: documents (lookup), selections (CRUD).
// ---------------------------------------------------------------------------

interface DocumentRowMutable {
  id: string;
  w: number;
  h: number;
}

interface SelectionRowMutable {
  document_id: string;
  mask_blob_id: string | null;
  bounds_json: string | null;
  updated_at: string;
}

class FakeDb implements Database {
  readonly open = true;
  readonly inTransaction = false;
  documents: DocumentRowMutable[] = [];
  selections: SelectionRowMutable[] = [];

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

    if (/^INSERT\s+INTO\s+selections/i.test(sql)) {
      const [document_id, mask_blob_id, bounds_json, updated_at] = params as [
        string,
        string | null,
        string,
        string,
      ];
      const idx = this.db.selections.findIndex((s) => s.document_id === document_id);
      const row: SelectionRowMutable = {
        document_id,
        mask_blob_id,
        bounds_json,
        updated_at,
      };
      if (idx === -1) this.db.selections.push(row);
      else this.db.selections[idx] = row;
      return { changes: 1, lastInsertRowid: 0 };
    }

    throw new Error(`fake-db.run: unhandled SQL: ${sql}`);
  }

  get(...params: unknown[]): unknown {
    const sql = this.sql.trim();
    if (/^SELECT\s+id,\s*w,\s*h\s+FROM\s+documents/i.test(sql)) {
      const [id] = params as [string];
      return this.db.documents.find((d) => d.id === id);
    }
    if (/^SELECT\s+id\s+FROM\s+documents/i.test(sql)) {
      const [id] = params as [string];
      const row = this.db.documents.find((d) => d.id === id);
      return row ? { id: row.id } : undefined;
    }
    if (/^SELECT\s+\*\s+FROM\s+selections/i.test(sql)) {
      const [document_id] = params as [string];
      return this.db.selections.find((s) => s.document_id === document_id);
    }
    throw new Error(`fake-db.get: unhandled SQL: ${sql}`);
  }

  all(...params: unknown[]): unknown[] {
    void params;
    throw new Error(`fake-db.all: unhandled SQL: ${this.sql}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOC_ID = '01HXK0000000000000000DOC01' as unknown as DocumentId;
const UNKNOWN_DOC_ID = '01HXK0000000000000000UNKWN' as unknown as DocumentId;

interface CapturedEvent {
  name: string;
  payload: unknown;
}

const makeContext = (): {
  ctx: HandlerContext;
  events: CapturedEvent[];
  scratch: Record<string, unknown>;
} => {
  const events: CapturedEvent[] = [];
  const scratch: Record<string, unknown> = {};
  const ctx: HandlerContext = {
    request_id: 'req-test',
    transport: 'in-memory',
    token_id: null,
    token_name: 'test-token',
    received_at: Date.now(),
    publish: (event: CapturedEvent) => {
      events.push(event);
    },
    audit: () => {
      /* no-op for tests */
    },
    logger: {
      info: () => {
        /* */
      },
      error: () => {
        /* */
      },
    },
  } as unknown as HandlerContext;
  // The handlers stash the active document_id and the reversible
  // command on the same context object — match the production wiring.
  (ctx as unknown as { scratch: Record<string, unknown> }).scratch = scratch;
  return { ctx, events, scratch };
};

const seedDoc = (db: FakeDb, w = 100, h = 100): string => {
  db.documents.push({ id: DOC_ID, w, h });
  return DOC_ID;
};

type Case = [name: string, run: () => Promise<void> | void];

const cases: Case[] = [
  // ---- SelectionStore round-trip ----
  [
    'SelectionStore.get returns null when no row exists',
    () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      assert.equal(store.get(DOC_ID), null);
    },
  ],
  [
    'SelectionStore.set + get round-trips a rect',
    () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      const sel: PersistedSelection = {
        kind: 'rect',
        rect: { x: 0, y: 0, w: 50, h: 50 },
      };
      store.set({ document_id: DOC_ID, selection: sel });
      const out = store.get(DOC_ID)!;
      assert.deepEqual(out.selection, sel);
    },
  ],
  [
    'SelectionStore.set + get round-trips a polygon',
    () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      const sel: PersistedSelection = {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      };
      store.set({ document_id: DOC_ID, selection: sel });
      const out = store.getOrNone(DOC_ID);
      assert.deepEqual(out, sel);
    },
  ],
  [
    'SelectionStore.set persists mask_blob_id only for `mask` kind',
    () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      store.set({
        document_id: DOC_ID,
        selection: {
          kind: 'mask',
          blob_id: '01HXK0000000000000000BLOB1',
          width: 10,
          height: 10,
        },
      });
      assert.equal(db.selections[0]!.mask_blob_id, '01HXK0000000000000000BLOB1');
      // Switching to rect clears the mask reference.
      store.set({
        document_id: DOC_ID,
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 8, h: 8 } },
      });
      assert.equal(db.selections[0]!.mask_blob_id, null);
    },
  ],
  [
    'SelectionStore.clear writes a kind:none row',
    () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      store.clear(DOC_ID);
      assert.equal(store.getOrNone(DOC_ID).kind, 'none');
    },
  ],

  // ---- Bounds derivation ----
  [
    'selectionBBox returns null for `none`',
    () => {
      assert.equal(selectionBBox({ kind: 'none' }), null);
    },
  ],
  [
    'selectionBBox returns the rect verbatim',
    () => {
      assert.deepEqual(
        selectionBBox({ kind: 'rect', rect: { x: 1, y: 2, w: 3, h: 4 } }),
        { x: 1, y: 2, w: 3, h: 4 },
      );
    },
  ],
  [
    'selectionBBox tight-fits a polygon',
    () => {
      assert.deepEqual(
        selectionBBox({
          kind: 'polygon',
          points: [
            { x: 5, y: 10 },
            { x: 8, y: 12 },
            { x: 5, y: 16 },
          ],
        }),
        { x: 5, y: 10, w: 3, h: 6 },
      );
    },
  ],

  // ---- Encoding ----
  [
    'persistedToCore translates polygon → lasso',
    () => {
      const out = persistedToCore({
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      });
      assert.equal(out.kind, 'lasso');
    },
  ],

  // ---- set_selection handler ----
  [
    'set_selection rect persists + emits document.changed',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx, events, scratch } = makeContext();
      const out = await handler(
        {
          document_id: DOC_ID,
          shape: { kind: 'rect', rect: { x: 0, y: 0, w: 50, h: 50 } },
          op: 'replace',
        },
        ctx,
      );
      assert.equal(out.active, true);
      assert.deepEqual(out.bbox, { x: 0, y: 0, w: 50, h: 50 });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.name, 'document.changed');
      assert.ok(scratch['command'], 'reversible command must be stashed');
    },
  ],
  [
    'set_selection clear empties the selection',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      // Pre-seed a selection.
      store.set({
        document_id: DOC_ID,
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
      });
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler(
        { document_id: DOC_ID, shape: { kind: 'clear' }, op: 'replace' },
        ctx,
      );
      assert.equal(out.active, false);
      assert.equal(out.bbox, undefined);
      assert.equal(store.getOrNone(DOC_ID).kind, 'none');
    },
  ],
  [
    'set_selection compose with op:add unions two rects',
    async () => {
      const db = new FakeDb();
      seedDoc(db, 100, 100);
      const store = new SelectionStore(db as unknown as Database);
      // Seed the first rect.
      store.set({
        document_id: DOC_ID,
        selection: { kind: 'rect', rect: { x: 0, y: 0, w: 50, h: 100 } },
      });
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler(
        {
          document_id: DOC_ID,
          shape: { kind: 'rect', rect: { x: 50, y: 0, w: 50, h: 100 } },
          op: 'add',
        },
        ctx,
      );
      assert.equal(out.active, true);
      // The two halves union into the entire 100x100 canvas.
      assert.deepEqual(out.bbox, { x: 0, y: 0, w: 100, h: 100 });
    },
  ],
  [
    'set_selection polygon persists (rect-shaped polygons reduce to rect)',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      // Non-rectangular polygon (triangle) — must persist as polygon.
      await handler(
        {
          document_id: DOC_ID,
          shape: {
            kind: 'polygon',
            points: [
              { x: 10, y: 5 },
              { x: 25, y: 25 },
              { x: 0, y: 25 },
            ],
          },
          op: 'replace',
        },
        ctx,
      );
      const persisted = store.getOrNone(DOC_ID);
      assert.equal(persisted.kind, 'polygon');
    },
  ],
  [
    'set_selection rejects an unknown document_id',
    async () => {
      const db = new FakeDb();
      const store = new SelectionStore(db as unknown as Database);
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      let thrown: ServerError | null = null;
      try {
        await handler(
          {
            document_id: UNKNOWN_DOC_ID,
            shape: { kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } },
            op: 'replace',
          },
          ctx,
        );
      } catch (err) {
        thrown = err as ServerError;
      }
      assert.ok(thrown);
      assert.equal((thrown as ServerError).code, 'DOCUMENT_NOT_FOUND');
    },
  ],
  [
    'set_selection magic_wand returns MAGIC_WAND_NOT_WIRED until layer fetch lands',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createSetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      let thrown: ServerError | null = null;
      try {
        await handler(
          {
            document_id: DOC_ID,
            shape: {
              kind: 'magic_wand',
              tap_point: { x: 1, y: 1 },
              tolerance: 32,
              contiguous: true,
              sample_composite: false,
            },
            op: 'replace',
          },
          ctx,
        );
      } catch (err) {
        thrown = err as ServerError;
      }
      assert.equal((thrown as ServerError).code, 'MAGIC_WAND_NOT_WIRED');
    },
  ],

  // ---- get_selection handler ----
  [
    'get_selection returns active=false when no selection has been set',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createGetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler({ document_id: DOC_ID, include_mask: false }, ctx);
      assert.equal(out.active, false);
      assert.equal(out.bbox, undefined);
    },
  ],
  [
    'get_selection returns the bbox of the persisted shape',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      store.set({
        document_id: DOC_ID,
        selection: { kind: 'rect', rect: { x: 5, y: 6, w: 7, h: 8 } },
      });
      const handler = createGetSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler({ document_id: DOC_ID, include_mask: false }, ctx);
      assert.equal(out.active, true);
      assert.deepEqual(out.bbox, { x: 5, y: 6, w: 7, h: 8 });
    },
  ],

  // ---- invert_selection handler ----
  [
    'invert_selection on `none` selects the entire canvas',
    async () => {
      const db = new FakeDb();
      seedDoc(db, 100, 200);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createInvertSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler({ document_id: DOC_ID }, ctx);
      assert.equal(out.active, true);
      assert.deepEqual(out.bbox, { x: 0, y: 0, w: 100, h: 200 });
    },
  ],
  [
    'invert_selection then revert restores the prior selection',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const prior: PersistedSelection = {
        kind: 'rect',
        rect: { x: 1, y: 2, w: 3, h: 4 },
      };
      store.set({ document_id: DOC_ID, selection: prior });
      const handler = createInvertSelectionHandler(db as unknown as Database, store);
      const { ctx, scratch } = makeContext();
      await handler({ document_id: DOC_ID }, ctx);
      // Selection changed.
      assert.notDeepEqual(store.getOrNone(DOC_ID), prior);
      // Reversible Command's revert restores it.
      const cmd = scratch['command'] as { revert: () => void };
      cmd.revert();
      assert.deepEqual(store.getOrNone(DOC_ID), prior);
    },
  ],

  // ---- select_all handler ----
  [
    'select_all sets selection to the canvas rect',
    async () => {
      const db = new FakeDb();
      seedDoc(db, 256, 128);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createSelectAllHandler(db as unknown as Database, store);
      const { ctx, scratch } = makeContext();
      const out = await handler({ document_id: DOC_ID }, ctx);
      assert.equal(out.active, true);
      assert.deepEqual(out.bbox, { x: 0, y: 0, w: 256, h: 128 });
      assert.ok(scratch['command']);
    },
  ],

  // ---- refine_selection handler ----
  [
    'refine_selection requires an active selection',
    async () => {
      const db = new FakeDb();
      seedDoc(db);
      const store = new SelectionStore(db as unknown as Database);
      const handler = createRefineSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      let thrown: ServerError | null = null;
      try {
        await handler({ document_id: DOC_ID, grow_px: 2 }, ctx);
      } catch (err) {
        thrown = err as ServerError;
      }
      assert.equal((thrown as ServerError).code, 'NO_SELECTION');
    },
  ],
  [
    'refine_selection grow expands the bounding box',
    async () => {
      const db = new FakeDb();
      seedDoc(db, 50, 50);
      const store = new SelectionStore(db as unknown as Database);
      store.set({
        document_id: DOC_ID,
        selection: { kind: 'rect', rect: { x: 10, y: 10, w: 10, h: 10 } },
      });
      const handler = createRefineSelectionHandler(db as unknown as Database, store);
      const { ctx } = makeContext();
      const out = await handler(
        { document_id: DOC_ID, grow_px: 2, threshold: 128 },
        ctx,
      );
      assert.ok(out.bbox);
      // The grown rect must be at least as wide as the input rect.
      assert.ok(out.bbox!.w >= 10);
      assert.ok(out.bbox!.h >= 10);
    },
  ],

  // ---- AI tier stubs ----
  [
    'auto_select_subject returns MODEL_NOT_FOUND when no segmentation client is wired',
    async () => {
      const handler = createAutoSelectSubjectHandler();
      let thrown: ServerError | null = null;
      try {
        await handler(
          { document_id: DOC_ID, quality: 'fast' },
          {} as unknown as HandlerContext,
        );
      } catch (err) {
        thrown = err as ServerError;
      }
      assert.equal((thrown as ServerError).code, 'MODEL_NOT_FOUND');
    },
  ],
  [
    'auto_select_subject delegates when a client is wired',
    async () => {
      let captured: { tap_point?: { x: number; y: number } } | null = null;
      const handler = createAutoSelectSubjectHandler({
        segmentationClient: {
          autoSelectSubject: async (args) => {
            captured = args;
            return {
              active: true,
              bbox: { x: 0, y: 0, w: 64, h: 64 },
              job_id: 'job-fake',
            };
          },
        },
      });
      const out = await handler(
        {
          document_id: DOC_ID,
          tap_point: { x: 10, y: 10 },
          quality: 'high',
        },
        {} as unknown as HandlerContext,
      );
      assert.equal(out.active, true);
      assert.equal(out.job_id, 'job-fake');
      assert.deepEqual(captured!.tap_point, { x: 10, y: 10 });
    },
  ],
  [
    'select_by_prompt returns SAMPLING_NOT_SUPPORTED without a client',
    async () => {
      const handler = createSelectByPromptHandler();
      let thrown: ServerError | null = null;
      try {
        await handler(
          { document_id: DOC_ID, prompt: 'the dog' },
          {} as unknown as HandlerContext,
        );
      } catch (err) {
        thrown = err as ServerError;
      }
      assert.equal((thrown as ServerError).code, 'SAMPLING_NOT_SUPPORTED');
    },
  ],
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
    console.error(`\n${failed}/${cases.length} selection test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} selection test(s) passed.`);
  }
}

void main();
