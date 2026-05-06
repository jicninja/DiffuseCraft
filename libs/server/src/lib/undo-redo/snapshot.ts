/**
 * Document snapshot type + SQLite-backed provider for the
 * `UndoRedoManager` (undo-redo-system task A.4).
 *
 * Implements requirements.md §3.3 (FR-10..FR-12: full document
 * snapshot every N ops) and §3.7 (FR-24: in-memory only — the snapshot
 * captured here is held by the per-`(token, document)` stack, never
 * persisted to disk) per design.md §5 (`captureDocumentSnapshot`).
 *
 * ## Why a structural snapshot, not blob bytes
 *
 * The snapshot is a **structural** copy of the rows the
 * `001-initial-schema.ts` migration declares for a document:
 * `documents`, `layers`, `selections`, `regions`, `control_layers`. We
 * intentionally keep blob *id* references rather than the actual bytes:
 *
 *   1. Blobs in the asset store are content-addressed and immutable;
 *      the row's `content_blob_id` (or `mask_blob_id`, etc.) is
 *      sufficient to reattach pixel data on revert. Copying bytes into
 *      every snapshot would balloon memory by orders of magnitude
 *      (FR-29 caps per-Command revert payload at 16 MB; full snapshots
 *      may exceed that — see FR-29 — but only because they aggregate
 *      DB rows, not because they duplicate blob bytes).
 *   2. `revert()` restores DB rows; bytes live by id in the blob store
 *      regardless. Phase B (eviction) reads
 *      {@link DocumentSnapshot}-shaped payloads through
 *      `JSON.stringify` heuristics — the structural shape is JSON-safe.
 *
 * ## Out of scope (tracked by other tasks)
 *
 *   - Restoring from snapshot: the manager's `undo` Phase doesn't yet
 *     consult snapshots; it just calls `command.revert()`. Phase B and
 *     the deeper revert path own snapshot-based restore.
 *   - Diff snapshots (FR-11): v1 captures full snapshots; diffing is a
 *     post-v1 optimization once memory pressure is observed in real-
 *     world testing.
 *   - Schema migrations 002..005 add additive columns (transform_json,
 *     group_id, mask_data_json, applied_at, …). Those are not yet
 *     required by `revert()` semantics for v1 reversible tools — A.4
 *     captures the *core* shape and a future task may extend.
 */

import type { Database as DB } from 'better-sqlite3';

import type { DocumentId } from './command.js';

/**
 * Document row as stored in the `documents` table (001-initial-schema).
 * `created_at` and `modified_at` are ISO-8601 strings.
 */
export interface DocumentRow {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly created_at: string;
  readonly modified_at: string;
}

/**
 * Layer row as stored in the `layers` table. Captures the columns
 * defined in 001-initial-schema. Additive columns from 004/005
 * (`transform_json`, `group_id`, `mask_data_json`) are intentionally
 * not in the v1 snapshot — they are reattached by their owning specs'
 * revert handlers; A.4 keeps the snapshot focused on the universal
 * shape.
 */
export interface LayerRow {
  readonly id: string;
  readonly document_id: string;
  readonly kind: string;
  readonly name: string;
  readonly position: number;
  readonly opacity: number;
  readonly blend: string;
  /** SQLite stores booleans as INTEGER (0/1). */
  readonly visible: number;
  readonly content_blob_id: string | null;
}

/** Region row (`regions` table). */
export interface RegionRow {
  readonly id: string;
  readonly document_id: string;
  readonly paint_layer_id: string;
  readonly prompt: string;
}

/** Control-layer row (`control_layers` table). */
export interface ControlLayerRow {
  readonly id: string;
  readonly document_id: string;
  readonly type: string;
  readonly image_blob_id: string | null;
  readonly weight: number;
  readonly scope: string;
}

/**
 * Active selection mask row (`selections` table). The `bounds_json`
 * column is forwarded verbatim as a string (parsing is the selection
 * handler's concern).
 */
export interface SelectionRow {
  readonly document_id: string;
  readonly mask_blob_id: string | null;
  readonly bounds_json: string | null;
  readonly updated_at: string;
}

/**
 * Full document snapshot. Anchored on the {@link Command} that
 * triggered capture (the cadence boundary), used by the stack as a
 * bounded restore point per FR-10.
 *
 * The shape is deliberately JSON-safe: every field is a primitive, an
 * array of primitive-shaped rows, or `null`. This lets the stack's
 * `estimateBytes` heuristic call `JSON.stringify` to size the payload.
 */
export interface DocumentSnapshot {
  readonly document: DocumentRow;
  /** Ordered by `position` ASC. */
  readonly layers: readonly LayerRow[];
  readonly regions: readonly RegionRow[];
  readonly control_layers: readonly ControlLayerRow[];
  readonly selection: SelectionRow | null;
}

/**
 * Asynchronous snapshot capture function. Pluggable: production code
 * uses {@link createSqliteSnapshotProvider}; tests may pass a fake.
 *
 * MUST throw if `document_id` does not exist — silent empty results
 * would mask bugs and produce unrestorable anchors.
 */
export type DocumentSnapshotProvider = (
  document_id: DocumentId,
) => Promise<DocumentSnapshot>;

/**
 * Build a {@link DocumentSnapshotProvider} backed by `better-sqlite3`.
 *
 * The provider runs every SELECT inside a single read transaction so
 * the snapshot is consistent with respect to concurrent writers (FR-2:
 * deterministic apply/revert needs a coherent prior state).
 * `better-sqlite3` is synchronous by design; we wrap it in `async` to
 * match the {@link DocumentSnapshotProvider} contract and to leave the
 * door open for an async backend later.
 */
export const createSqliteSnapshotProvider = (
  db: DB,
): DocumentSnapshotProvider => {
  // Prepare statements once; they are reused across captures.
  const selectDoc = db.prepare<string, DocumentRow>(
    'SELECT id, name, w, h, created_at, modified_at FROM documents WHERE id = ?',
  );
  const selectLayers = db.prepare<string, LayerRow>(
    `SELECT id, document_id, kind, name, position, opacity, blend, visible, content_blob_id
       FROM layers
      WHERE document_id = ?
      ORDER BY position ASC, id ASC`,
  );
  const selectRegions = db.prepare<string, RegionRow>(
    `SELECT id, document_id, paint_layer_id, prompt
       FROM regions
      WHERE document_id = ?
      ORDER BY id ASC`,
  );
  const selectControlLayers = db.prepare<string, ControlLayerRow>(
    `SELECT id, document_id, type, image_blob_id, weight, scope
       FROM control_layers
      WHERE document_id = ?
      ORDER BY id ASC`,
  );
  const selectSelection = db.prepare<string, SelectionRow>(
    `SELECT document_id, mask_blob_id, bounds_json, updated_at
       FROM selections
      WHERE document_id = ?`,
  );

  /**
   * Synchronous capture inside a single transaction. We assemble the
   * snapshot here and return it; the `async` wrapper below adapts the
   * sync result to the provider's `Promise<...>` contract.
   */
  const capture = db.transaction((document_id: string): DocumentSnapshot => {
    const document = selectDoc.get(document_id);
    if (!document) {
      throw new Error(
        `createSqliteSnapshotProvider: unknown document_id ${document_id}`,
      );
    }
    const layers = selectLayers.all(document_id);
    const regions = selectRegions.all(document_id);
    const control_layers = selectControlLayers.all(document_id);
    const selection = selectSelection.get(document_id) ?? null;
    return { document, layers, regions, control_layers, selection };
  });

  return async (document_id: DocumentId) => capture(document_id);
};
