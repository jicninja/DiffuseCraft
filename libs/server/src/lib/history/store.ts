/**
 * History store — DB-level access for the `generation-history` spec.
 *
 * Encapsulates every read/write the handlers, resource, OutputFetcher hook,
 * and GC job perform against the `history_items` table. Keeping the SQL in
 * one place lets the spec evolve the schema (migration 003 added
 * `applied_at`, `discarded_at`, `batch_size`, `batch_position`) without
 * leaking column names across the codebase.
 *
 * NB: the `applied_to_layer_id` column predates this spec (initial schema)
 * but is reused as the field tracking the most recent application (FR-6).
 */

import type { Database as DB } from 'better-sqlite3';

/**
 * Raw row shape returned by `SELECT * FROM history_items`. Mirrors the
 * union of migrations 001 + 003.
 */
export interface HistoryItemRow {
  id: string;
  document_id: string;
  job_id: string | null;
  prompt: string;
  parameters_json: string;
  image_blob_id: string | null;
  thumbnail_blob_id: string | null;
  applied_to_layer_id: string | null;
  applied_at: string | null;
  discarded_at: string | null;
  created_at: string;
  batch_size: number;
  batch_position: number;
}

/**
 * Insert payload — what the OutputFetcher (or any other producer) hands the
 * store at creation time. `id` and `created_at` are required so callers stay
 * in control of timing/correlation.
 */
export interface HistoryItemInsert {
  id: string;
  document_id: string;
  job_id: string | null;
  prompt: string;
  parameters_json: string;
  image_blob_id: string | null;
  thumbnail_blob_id: string | null;
  created_at: string;
  batch_size?: number;
  batch_position?: number;
}

/**
 * Filter / pagination shape for `list()` (FR-10/FR-11 §3.4).
 */
export interface HistoryListQuery {
  document_id?: string;
  applied?: boolean;
  /** ISO-8601 timestamp; only items strictly newer are returned. */
  since?: string;
  /** Opaque cursor — the previous page's last `id`. */
  cursor?: string;
  /** Page size, server-clamped to [1, 50]. */
  limit?: number;
  /** Include items with `discarded_at NOT NULL`. Defaults to false. */
  include_discarded?: boolean;
}

export interface HistoryListPage {
  items: ReadonlyArray<HistoryItemRow>;
  next_cursor?: string;
}

/**
 * Storage budget snapshot used by the GC job to decide whether eviction is
 * needed. Computed via SUM over the `blobs` table joined to `history_items`.
 */
export interface HistoryBlobBudget {
  total_bytes: number;
  item_count: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export class HistoryStore {
  constructor(private readonly db: DB) {}

  // ---- Reads ---------------------------------------------------------------

  /** Returns the row for `id`, or `null` if no such item exists. */
  getById(id: string): HistoryItemRow | null {
    const row = this.db
      .prepare<string, HistoryItemRow>('SELECT * FROM history_items WHERE id = ?')
      .get(id);
    return row ?? null;
  }

  /**
   * Paginated list (FR-10 / §3.4). Sorted by `created_at DESC`, then by `id
   * DESC` to deterministically tie-break batch siblings.
   */
  list(query: HistoryListQuery = {}): HistoryListPage {
    const limit = clampLimit(query.limit ?? DEFAULT_LIMIT);
    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (query.document_id !== undefined) {
      where.push('document_id = ?');
      params.push(query.document_id);
    }
    if (query.applied === true) {
      where.push('applied_to_layer_id IS NOT NULL');
    } else if (query.applied === false) {
      where.push('applied_to_layer_id IS NULL');
    }
    if (!query.include_discarded) {
      where.push('discarded_at IS NULL');
    }
    if (query.since !== undefined) {
      where.push('created_at > ?');
      params.push(query.since);
    }
    if (query.cursor !== undefined) {
      // Cursor pagination — items strictly older than the boundary tuple.
      // The cursor is the previous page's last `id`; we look up its
      // created_at so the keyset compare stays correct under DESC ordering.
      const boundary = this.db
        .prepare<string, { created_at: string; id: string }>(
          'SELECT created_at, id FROM history_items WHERE id = ?',
        )
        .get(query.cursor);
      if (boundary) {
        where.push('(created_at < ? OR (created_at = ? AND id < ?))');
        params.push(boundary.created_at, boundary.created_at, boundary.id);
      }
    }

    // Fetch one extra row to detect a next page.
    const sql = `SELECT * FROM history_items WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`;
    const rows = this.db
      .prepare<unknown[], HistoryItemRow>(sql)
      .all(...params, limit + 1);
    const slice = rows.slice(0, limit);
    const next = rows.length > limit ? slice[slice.length - 1]?.id : undefined;
    return next ? { items: slice, next_cursor: next } : { items: slice };
  }

  /**
   * Find every history item that shares a `job_id`. Used to compute
   * `batch_position` when the OutputFetcher creates a new row, and to power
   * the `batch_summary` projection (FR-21 / Q4 / A.2).
   */
  countByJobId(job_id: string): number {
    const row = this.db
      .prepare<string, { c: number }>(
        'SELECT COUNT(*) AS c FROM history_items WHERE job_id = ?',
      )
      .get(job_id);
    return row?.c ?? 0;
  }

  // ---- Inserts -------------------------------------------------------------

  insert(payload: HistoryItemInsert): void {
    this.db
      .prepare<
        [
          string, string, string | null, string, string,
          string | null, string | null, string,
          number, number,
        ]
      >(
        `INSERT INTO history_items
           (id, document_id, job_id, prompt, parameters_json,
            image_blob_id, thumbnail_blob_id, created_at,
            batch_size, batch_position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.id,
        payload.document_id,
        payload.job_id,
        payload.prompt,
        payload.parameters_json,
        payload.image_blob_id,
        payload.thumbnail_blob_id,
        payload.created_at,
        payload.batch_size ?? 1,
        payload.batch_position ?? 0,
      );
  }

  // ---- State transitions ---------------------------------------------------

  /**
   * Mark a history item as applied. Returns true if a row was updated. The
   * UPDATE is conditional on the item not being discarded (FR-5 §3.2: an
   * already-discarded preview is not applicable).
   */
  markApplied(args: { id: string; layer_id: string; applied_at: string }): boolean {
    const res = this.db
      .prepare<[string, string, string]>(
        `UPDATE history_items
            SET applied_to_layer_id = ?, applied_at = ?
          WHERE id = ? AND discarded_at IS NULL`,
      )
      .run(args.layer_id, args.applied_at, args.id);
    return res.changes > 0;
  }

  /**
   * Reverse a previous apply for the same `layer_id` — used by the
   * reversible Command path. Idempotent; returns false if the row is no
   * longer attached to that layer.
   */
  unmarkApplied(args: { id: string; layer_id: string }): boolean {
    const res = this.db
      .prepare<[string, string]>(
        `UPDATE history_items
            SET applied_to_layer_id = NULL, applied_at = NULL
          WHERE id = ? AND applied_to_layer_id = ?`,
      )
      .run(args.id, args.layer_id);
    return res.changes > 0;
  }

  /**
   * Mark a history item discarded (FR-5 §3.2). Idempotent — repeated calls
   * preserve the original `discarded_at` and return false.
   */
  markDiscarded(args: { id: string; discarded_at: string }): boolean {
    const res = this.db
      .prepare<[string, string]>(
        `UPDATE history_items
            SET discarded_at = ?
          WHERE id = ? AND discarded_at IS NULL`,
      )
      .run(args.discarded_at, args.id);
    return res.changes > 0;
  }

  /**
   * Delete a history item by id. Used by GC. Returns the row prior to
   * deletion so the caller can clean up the referenced blobs.
   */
  deleteById(id: string): HistoryItemRow | null {
    const row = this.getById(id);
    if (!row) return null;
    this.db.prepare<string>('DELETE FROM history_items WHERE id = ?').run(id);
    return row;
  }

  // ---- GC helpers ----------------------------------------------------------

  /** Items where `discarded_at` is older than `cutoff_iso`. */
  selectDiscardedOlderThan(cutoff_iso: string): ReadonlyArray<HistoryItemRow> {
    return this.db
      .prepare<string, HistoryItemRow>(
        'SELECT * FROM history_items WHERE discarded_at IS NOT NULL AND discarded_at < ?',
      )
      .all(cutoff_iso);
  }

  /**
   * Items unreferenced by any layer (`applied_to_layer_id IS NULL`) and
   * older than `cutoff_iso`. Discarded items also count as unreferenced.
   */
  selectUnreferencedOlderThan(cutoff_iso: string): ReadonlyArray<HistoryItemRow> {
    return this.db
      .prepare<string, HistoryItemRow>(
        'SELECT * FROM history_items WHERE applied_to_layer_id IS NULL AND created_at < ?',
      )
      .all(cutoff_iso);
  }

  /** Oldest-first slice of unreferenced items, capped at `limit`. */
  selectOldestUnreferenced(limit: number): ReadonlyArray<HistoryItemRow> {
    return this.db
      .prepare<number, HistoryItemRow>(
        'SELECT * FROM history_items WHERE applied_to_layer_id IS NULL ORDER BY created_at ASC, id ASC LIMIT ?',
      )
      .all(limit);
  }

  /**
   * Sum of bytes across blobs referenced by history items. Used by the
   * storage-budget enforcement loop (FR-13 §3.5).
   */
  totalReferencedBytes(): HistoryBlobBudget {
    const row = this.db
      .prepare<[], { total_bytes: number | null; item_count: number }>(
        `SELECT
            COALESCE(SUM(b.bytes), 0) AS total_bytes,
            COUNT(DISTINCT h.id) AS item_count
         FROM history_items h
         LEFT JOIN blobs b
           ON b.id = h.image_blob_id OR b.id = h.thumbnail_blob_id`,
      )
      .get() ?? { total_bytes: 0, item_count: 0 };
    return {
      total_bytes: row.total_bytes ?? 0,
      item_count: row.item_count,
    };
  }

  /**
   * Items whose referenced image or thumbnail blob is missing from the
   * `blobs` table — used at startup to degrade them to discarded (FR Q6).
   */
  selectItemsWithMissingBlobs(): ReadonlyArray<HistoryItemRow> {
    return this.db
      .prepare<[], HistoryItemRow>(
        `SELECT h.* FROM history_items h
         WHERE
           h.discarded_at IS NULL
           AND (
             (h.image_blob_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = h.image_blob_id))
             OR
             (h.thumbnail_blob_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = h.thumbnail_blob_id))
           )`,
      )
      .all();
  }
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(n)), MAX_LIMIT);
}
