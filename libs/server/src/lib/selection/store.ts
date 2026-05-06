/**
 * SelectionStore — server-side persistence for the per-document active
 * selection (selection-tools spec §3.6 + canvas-fundamentals schema).
 *
 * The `selections` table from migration 001 holds at most one row per
 * document:
 *
 *   document_id  TEXT PRIMARY KEY
 *   mask_blob_id TEXT NULL          -- pointer to a raster mask blob
 *   bounds_json  TEXT NULL          -- JSON-encoded Selection shape
 *   updated_at   TEXT NOT NULL
 *
 * `bounds_json` is the source of truth for the structured shape:
 * `{kind: 'none' | 'rect' | 'polygon' | 'mask', ...}`. When a tool that
 * needs raster compositing runs (boolean ops, refine, invert), the
 * handler rasterizes via canvas-core and persists the result either
 * inline as a polygon (small payload) or as a mask blob via
 * {@link AssetStore} (when the result is too irregular for a polygon).
 *
 * Tier 1 handlers (this implementation) keep selections inline as
 * `kind: 'rect' | 'polygon'` whenever possible to avoid blob churn —
 * mask-blob persistence is wired but unused until the AI tiers
 * (auto_select_subject, select_by_prompt) land their handlers.
 */

import type { Database as DB } from 'better-sqlite3';

export interface PersistedRect {
  kind: 'rect';
  rect: { x: number; y: number; w: number; h: number };
}

export interface PersistedPolygon {
  kind: 'polygon';
  points: ReadonlyArray<{ x: number; y: number }>;
}

export interface PersistedMaskRef {
  kind: 'mask';
  /** Asset blob id holding the raster mask bytes (PNG-encoded). */
  blob_id: string;
  width: number;
  height: number;
}

export interface PersistedNone {
  kind: 'none';
}

/** Union persisted in `selections.bounds_json`. */
export type PersistedSelection =
  | PersistedNone
  | PersistedRect
  | PersistedPolygon
  | PersistedMaskRef;

export interface SelectionRow {
  document_id: string;
  mask_blob_id: string | null;
  bounds_json: string | null;
  updated_at: string;
}

interface RawRow {
  document_id: string;
  mask_blob_id: string | null;
  bounds_json: string | null;
  updated_at: string;
}

export class SelectionStore {
  constructor(private readonly db: DB) {}

  /** Read the persisted selection for `document_id`, or `null` when never set. */
  get(document_id: string): { selection: PersistedSelection; updated_at: string } | null {
    const row = this.db
      .prepare<string, RawRow>('SELECT * FROM selections WHERE document_id = ?')
      .get(document_id);
    if (!row) return null;
    const selection = this.decode(row);
    return { selection, updated_at: row.updated_at };
  }

  /** Returns the current selection or `{kind: 'none'}` when no row exists. */
  getOrNone(document_id: string): PersistedSelection {
    return this.get(document_id)?.selection ?? { kind: 'none' };
  }

  /**
   * Upsert the selection row. `mask_blob_id` is set only when the
   * persisted shape is a mask reference; for rect/polygon/none the
   * column is cleared.
   */
  set(args: {
    document_id: string;
    selection: PersistedSelection;
    updated_at?: string;
  }): SelectionRow {
    const updated_at = args.updated_at ?? new Date().toISOString();
    const bounds_json = JSON.stringify(args.selection);
    const mask_blob_id =
      args.selection.kind === 'mask' ? args.selection.blob_id : null;
    this.db
      .prepare<[string, string | null, string, string]>(
        `INSERT INTO selections (document_id, mask_blob_id, bounds_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET
           mask_blob_id = excluded.mask_blob_id,
           bounds_json  = excluded.bounds_json,
           updated_at   = excluded.updated_at`,
      )
      .run(args.document_id, mask_blob_id, bounds_json, updated_at);
    return {
      document_id: args.document_id,
      mask_blob_id,
      bounds_json,
      updated_at,
    };
  }

  /** Clear the selection (writes a `kind: "none"` row to keep the audit trail). */
  clear(document_id: string, updated_at?: string): SelectionRow {
    return this.set({
      document_id,
      selection: { kind: 'none' },
      updated_at,
    });
  }

  private decode(row: RawRow): PersistedSelection {
    if (!row.bounds_json) {
      // Legacy row written without bounds_json — treat as 'none' but
      // preserve a mask reference if the column carries one.
      if (row.mask_blob_id) {
        return {
          kind: 'mask',
          blob_id: row.mask_blob_id,
          // Dimensions unknown without the json envelope; downstream
          // handlers MUST fetch the blob to get them.
          width: 0,
          height: 0,
        };
      }
      return { kind: 'none' };
    }
    try {
      const parsed = JSON.parse(row.bounds_json) as PersistedSelection;
      return parsed;
    } catch {
      return { kind: 'none' };
    }
  }
}
