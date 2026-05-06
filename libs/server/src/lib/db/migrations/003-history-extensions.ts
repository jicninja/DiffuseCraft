/**
 * Migration 003 — generation-history extensions (A.1).
 *
 * Adds the columns the `generation-history` spec requires on top of the
 * baseline `history_items` table introduced in 001:
 *   - `applied_at`            — ISO timestamp set on `apply_history_item`.
 *   - `discarded_at`          — ISO timestamp set on `discard_history_item`.
 *   - `batch_size` / `batch_position` — batch grouping (FR-21 / Q4).
 *
 * The pre-existing `applied_to_layer_id` column is reused as-is (FR-1 §3.1).
 *
 * Indexes:
 *   - `idx_history_applied`   — partial index on applied items (hot lookup
 *                               for "show only applied" filter).
 *   - `idx_history_discarded` — partial index on discarded items (GC scan).
 *   - `idx_history_job`       — batch grouping by job_id.
 *
 * SQLite's `ALTER TABLE` only supports adding columns; the additions land
 * cleanly without rewriting the table.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Migration } from '../migrator.js';

const SQL = `
  ALTER TABLE history_items ADD COLUMN applied_at TEXT;
  ALTER TABLE history_items ADD COLUMN discarded_at TEXT;
  ALTER TABLE history_items ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE history_items ADD COLUMN batch_position INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_history_applied
    ON history_items(applied_to_layer_id)
    WHERE applied_to_layer_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_history_discarded
    ON history_items(discarded_at)
    WHERE discarded_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_history_job
    ON history_items(job_id);
`;

const migration: Migration = {
  name: '003-history-extensions',
  up(db: DB): void {
    db.exec(SQL);
  },
};

export default migration;
