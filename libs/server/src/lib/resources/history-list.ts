/**
 * `diffusecraft://history/list` resource (C.1, FR-10/FR-11 §3.4).
 *
 * Reads paginated history rows from the SQLite store and projects each row
 * onto `HistoryItemSummary`. Supports the four query knobs from the spec:
 *   - `document_id` filter
 *   - `applied=true|false` filter (state)
 *   - `since=<ISO>` for delta sync (FR-46 catalog convention)
 *   - `fields` projection
 *   - `cursor` + `limit` pagination
 *
 * The companion `diffusecraft://history/{id}` resource returns the full
 * record + image ref (FR-3 — the full content the agent fetches just before
 * apply). Both functions return plain `Record<string, unknown>` projections;
 * the transport layer serializes them per the catalog's resource shapes.
 */

import type { Database as DB } from 'better-sqlite3';
import type { HistoryStore, HistoryItemRow } from '../history/store.js';
import { projectHistoryItemFull, projectHistoryItemSummary } from '../history/projection.js';

export interface HistoryListResourceQuery {
  document_id?: string;
  applied?: boolean;
  since?: string;
  cursor?: string;
  limit?: number;
  fields?: ReadonlyArray<string>;
  /** Default false. Toggle for "show discarded" UX (FR-18). */
  include_discarded?: boolean;
}

export interface HistoryListResourcePage {
  items: ReadonlyArray<Record<string, unknown>>;
  next_cursor?: string;
}

interface BlobMeta {
  bytes: number;
  mime: string;
}

/** Serve `diffusecraft://history/list` (paginated `HistoryItemSummary`). */
export function readHistoryList(
  db: DB,
  store: HistoryStore,
  query: HistoryListResourceQuery = {},
): HistoryListResourcePage {
  const page = store.list({
    document_id: query.document_id,
    applied: query.applied,
    since: query.since,
    cursor: query.cursor,
    limit: query.limit,
    include_discarded: query.include_discarded,
  });

  const items = page.items.map((row) => {
    const projection = projectHistoryItemSummary(row, {
      image_blob: null,
      thumbnail_blob: blobMeta(db, row.thumbnail_blob_id),
    });
    return projectFields(projection, query.fields);
  });

  return page.next_cursor
    ? { items, next_cursor: page.next_cursor }
    : { items };
}

/** Serve `diffusecraft://history/{id}` (full `HistoryItemFull`). */
export function readHistoryItem(
  db: DB,
  store: HistoryStore,
  id: string,
  fields?: ReadonlyArray<string>,
): Record<string, unknown> | null {
  const row: HistoryItemRow | null = store.getById(id);
  if (!row) return null;
  const full = projectHistoryItemFull(row, {
    image_blob: blobMeta(db, row.image_blob_id),
    thumbnail_blob: blobMeta(db, row.thumbnail_blob_id),
  });
  return projectFields(full, fields);
}

function blobMeta(db: DB, id: string | null): BlobMeta | null {
  if (!id) return null;
  return (
    db
      .prepare<string, BlobMeta>('SELECT bytes, mime FROM blobs WHERE id = ?')
      .get(id) ?? null
  );
}

function projectFields(
  obj: Record<string, unknown>,
  fields?: ReadonlyArray<string>,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) out[f] = obj[f];
  }
  return out;
}
