#!/usr/bin/env tsx
/**
 * Unit tests for `createSqliteSnapshotProvider` and the
 * {@link DocumentSnapshot} shape (undo-redo-system task A.4).
 *
 * Asserts requirements.md §3.3 (FR-10..FR-12: full document snapshot
 * captured every N ops; structural shape drawn from the SQLite tables
 * declared in `001-initial-schema.ts` plus the additive columns
 * 002..005). The snapshot stores only blob *id* references — the actual
 * blob bytes are immutable in the blob store and live by id, so the
 * snapshot's job is to capture the row-level shape that `revert()`
 * needs to restore.
 *
 * ## DB shim rationale
 *
 * The rest of `libs/server/src/__tests__/*` runs without the
 * `better-sqlite3` native binding (the workspace doesn't compile it in
 * CI); each suite ships a `FakeDb` implementing the small subset of
 * `Database` that the code under test exercises. We follow the same
 * pattern here: a `FakeDb` that handles the four `SELECT` shapes the
 * snapshot provider issues, with seed helpers that mirror the
 * production `INSERT` paths. This keeps the suite hermetic and matches
 * the pre-existing test infrastructure exactly.
 *
 * Behaviors covered:
 *   - Provider returns the document row + ordered layers (by `position`)
 *     + regions + control_layers + selection (or null) for a populated
 *     document.
 *   - Empty document: doc row + empty arrays + `selection: null`.
 *   - The returned snapshot is JSON-serializable and round-trips through
 *     `JSON.stringify` / `JSON.parse` — important because the stack's
 *     `estimateBytes` heuristic calls `JSON.stringify` to measure size.
 *   - Unknown `document_id`: provider throws (no silent empty result).
 *
 * Runner: `tsx`. Run:
 *   `pnpm exec tsx \
 *     src/lib/undo-redo/__tests__/snapshot.test.ts`.
 */
import { strict as assert } from 'node:assert';

import type { Database, Statement } from 'better-sqlite3';

import {
  createSqliteSnapshotProvider,
  type DocumentSnapshot,
} from '../snapshot.js';

// ---------------------------------------------------------------------------
// FakeDb — implements only the shapes `createSqliteSnapshotProvider`
// prepares + executes. The provider issues five SELECTs (documents,
// layers, regions, control_layers, selections) inside a single
// `db.transaction` block.
// ---------------------------------------------------------------------------

interface DocRow {
  id: string;
  name: string;
  w: number;
  h: number;
  created_at: string;
  modified_at: string;
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
}
interface RegionRow {
  id: string;
  document_id: string;
  paint_layer_id: string;
  prompt: string;
}
interface ControlRow {
  id: string;
  document_id: string;
  type: string;
  image_blob_id: string | null;
  weight: number;
  scope: string;
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
  documents: DocRow[] = [];
  layers: LayerRow[] = [];
  regions: RegionRow[] = [];
  control_layers: ControlRow[] = [];
  selections: SelectionRow[] = [];

  prepare<TParams = unknown, TRow = unknown>(
    sql: string,
  ): Statement<TParams, TRow> {
    return new FakeStatement(this, sql) as unknown as Statement<TParams, TRow>;
  }

  exec(_sql: string): Database {
    return this;
  }

  pragma(_pragma: string): unknown {
    return null;
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    // Synchronous pass-through — the provider doesn't rely on rollback.
    return ((...args: never[]) => fn(...args)) as T;
  }

  close(): void {}
}

class FakeStatement {
  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  /** SELECT … LIMIT 1 — matches `selectDoc` and `selectSelection`. */
  get(...params: unknown[]): unknown {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (/FROM documents WHERE id = \?/i.test(sql)) {
      const [id] = params as [string];
      return this.db.documents.find((d) => d.id === id);
    }
    if (/FROM selections WHERE document_id = \?/i.test(sql)) {
      const [id] = params as [string];
      return this.db.selections.find((s) => s.document_id === id);
    }
    throw new Error(`FakeStatement.get: unhandled SQL: ${sql}`);
  }

  /** SELECT … (multiple rows). */
  all(...params: unknown[]): unknown[] {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (/FROM layers WHERE document_id = \?/i.test(sql)) {
      const [id] = params as [string];
      return this.db.layers
        .filter((l) => l.document_id === id)
        .slice()
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    if (/FROM regions WHERE document_id = \?/i.test(sql)) {
      const [id] = params as [string];
      return this.db.regions
        .filter((r) => r.document_id === id)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    if (/FROM control_layers WHERE document_id = \?/i.test(sql)) {
      const [id] = params as [string];
      return this.db.control_layers
        .filter((c) => c.document_id === id)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    throw new Error(`FakeStatement.all: unhandled SQL: ${sql}`);
  }

  run(): { changes: number; lastInsertRowid: number } {
    throw new Error(`FakeStatement.run not used by the snapshot provider`);
  }
}

// ---------------------------------------------------------------------------
// Seed helpers (mirror production INSERTs)
// ---------------------------------------------------------------------------

const seedDocument = (db: FakeDb, doc: Partial<DocRow> & { id: string }): void => {
  db.documents.push({
    id: doc.id,
    name: doc.name ?? 'Doc',
    w: doc.w ?? 1,
    h: doc.h ?? 1,
    created_at: doc.created_at ?? '2026-01-01T00:00:00.000Z',
    modified_at: doc.modified_at ?? '2026-01-01T00:00:00.000Z',
  });
};

const seedLayer = (db: FakeDb, layer: Partial<LayerRow> & {
  id: string;
  document_id: string;
  position: number;
}): void => {
  db.layers.push({
    id: layer.id,
    document_id: layer.document_id,
    kind: layer.kind ?? 'paint',
    name: layer.name ?? 'L',
    position: layer.position,
    opacity: layer.opacity ?? 1.0,
    blend: layer.blend ?? 'normal',
    visible: layer.visible ?? 1,
    content_blob_id: layer.content_blob_id ?? null,
  });
};

const seedRegion = (db: FakeDb, region: RegionRow): void => {
  db.regions.push(region);
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'populated document: snapshot returns rows verbatim, layers ordered by position',
    async () => {
      const db = new FakeDb();
      seedDocument(db, { id: 'doc_A', name: 'Sample', w: 1024, h: 768 });
      // Insert layers OUT OF ORDER to verify ORDER BY position.
      seedLayer(db, {
        id: 'layer_top',
        document_id: 'doc_A',
        kind: 'paint',
        name: 'Top',
        position: 1,
        opacity: 0.8,
        blend: 'normal',
        visible: 1,
        content_blob_id: 'blob_top',
      });
      seedLayer(db, {
        id: 'layer_bottom',
        document_id: 'doc_A',
        kind: 'paint',
        name: 'Bottom',
        position: 0,
        opacity: 1.0,
        blend: 'multiply',
        visible: 0,
        content_blob_id: null,
      });
      seedRegion(db, {
        id: 'region_1',
        document_id: 'doc_A',
        paint_layer_id: 'layer_top',
        prompt: 'a red barn',
      });

      const provider = createSqliteSnapshotProvider(db as unknown as Database);
      const snap: DocumentSnapshot = await provider('doc_A');

      assert.equal(snap.document.id, 'doc_A');
      assert.equal(snap.document.name, 'Sample');
      assert.equal(snap.document.w, 1024);
      assert.equal(snap.document.h, 768);
      assert.equal(typeof snap.document.created_at, 'string');
      assert.equal(typeof snap.document.modified_at, 'string');

      assert.equal(snap.layers.length, 2, 'two layers captured');
      // Layers ordered by position ascending: bottom (0), then top (1).
      assert.equal(snap.layers[0]!.id, 'layer_bottom');
      assert.equal(snap.layers[0]!.position, 0);
      assert.equal(snap.layers[0]!.kind, 'paint');
      assert.equal(snap.layers[0]!.name, 'Bottom');
      assert.equal(snap.layers[0]!.opacity, 1.0);
      assert.equal(snap.layers[0]!.blend, 'multiply');
      assert.equal(snap.layers[0]!.visible, 0);
      assert.equal(snap.layers[0]!.content_blob_id, null);
      assert.equal(snap.layers[1]!.id, 'layer_top');
      assert.equal(snap.layers[1]!.position, 1);
      assert.equal(snap.layers[1]!.opacity, 0.8);
      assert.equal(snap.layers[1]!.content_blob_id, 'blob_top');

      assert.equal(snap.regions.length, 1, 'one region captured');
      assert.equal(snap.regions[0]!.id, 'region_1');
      assert.equal(snap.regions[0]!.paint_layer_id, 'layer_top');
      assert.equal(snap.regions[0]!.prompt, 'a red barn');

      assert.equal(snap.control_layers.length, 0);
      assert.equal(snap.selection, null);
    },
  ],
  [
    'empty document: snapshot returns doc row + empty arrays + selection null',
    async () => {
      const db = new FakeDb();
      seedDocument(db, { id: 'doc_empty', name: 'Empty', w: 256, h: 256 });

      const provider = createSqliteSnapshotProvider(db as unknown as Database);
      const snap = await provider('doc_empty');

      assert.equal(snap.document.id, 'doc_empty');
      assert.equal(snap.document.w, 256);
      assert.equal(snap.document.h, 256);
      assert.deepEqual(snap.layers, []);
      assert.deepEqual(snap.regions, []);
      assert.deepEqual(snap.control_layers, []);
      assert.equal(snap.selection, null);
    },
  ],
  [
    'snapshot is JSON-serializable and round-trips intact',
    async () => {
      const db = new FakeDb();
      seedDocument(db, { id: 'doc_J', name: 'JSON test', w: 512, h: 512 });
      seedLayer(db, {
        id: 'layer_J',
        document_id: 'doc_J',
        kind: 'paint',
        name: 'L',
        position: 0,
        content_blob_id: 'blob_X',
      });

      const provider = createSqliteSnapshotProvider(db as unknown as Database);
      const snap = await provider('doc_J');

      // estimateBytes() in stack.ts calls JSON.stringify on the snapshot
      // — assert that succeeds and the round-trip is lossless.
      const json = JSON.stringify(snap);
      assert.equal(typeof json, 'string');
      assert.ok(json.length > 0);
      const parsed = JSON.parse(json) as DocumentSnapshot;
      assert.deepEqual(parsed, snap, 'JSON round-trip preserves shape');
    },
  ],
  [
    'unknown document_id: provider throws (no silent empty result)',
    async () => {
      const db = new FakeDb();
      const provider = createSqliteSnapshotProvider(db as unknown as Database);
      await assert.rejects(() => provider('doc_nonexistent'));
    },
  ],
];

async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).message}`);
      if ((err as Error).stack) {
        // eslint-disable-next-line no-console
        console.error((err as Error).stack);
      }
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} snapshot.test cases failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} snapshot.test cases passed.`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('unexpected error:', err);
  process.exit(1);
});
