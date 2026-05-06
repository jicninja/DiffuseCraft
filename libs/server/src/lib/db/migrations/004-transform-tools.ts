/**
 * Migration 004 — transform-tools (Phase C).
 *
 * Adds:
 *   - `layers.transform_json` (TEXT, NULL = identity) — persists the
 *     decomposed transform written by `transform_layer`. Storing the
 *     decomposed shape (rather than a raw 3×3 matrix) keeps the round-trip
 *     semantics from `canvas-core`'s decompose.ts intact and matches the
 *     spec (FR-1, design.md §3).
 *   - `layers.group_id` (TEXT, NULL = root) — references the
 *     canvas-core group model so `transform_layer` can resolve a group's
 *     member layers as one composite (FR-25, C.4). The
 *     `canvas-fundamentals` spec owns the `groups` table; this migration
 *     just provisions the foreign-key column on `layers`.
 *   - `idx_layers_group` partial index — accelerates group-membership
 *     lookup.
 *
 * Existing rows default to `NULL`. Older callers that select specific
 * columns are unaffected.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Migration } from '../migrator.js';

const SQL = `
  ALTER TABLE layers ADD COLUMN transform_json TEXT;
  ALTER TABLE layers ADD COLUMN group_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_layers_group
    ON layers(document_id, group_id)
    WHERE group_id IS NOT NULL;
`;

const migration: Migration = {
  name: '004-transform-tools',
  up(db: DB): void {
    db.exec(SQL);
  },
};

export default migration;
