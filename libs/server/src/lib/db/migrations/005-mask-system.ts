/**
 * Migration 005 — mask-system (Phase B).
 *
 * Adds:
 *   - `layers.mask_data_json` (TEXT, NULL = no mask metadata). Persists the
 *     `MaskData` discriminator written by mask-system handlers
 *     (`add_layer({ kind: "mask", subkind })`, `bake_mask`,
 *     `selection_to_mask`). Format mirrors `canvas-core/mask/types.ts`:
 *     `{"subkind":"painted"}` or
 *     `{"subkind":"from_layer","source_layer_id":"…","channel":"alpha","invert":false}`.
 *
 * Painted-mask alpha bytes still live in `layers.content_blob_id` (raw
 * single-channel `Uint8Array` blob). `from_layer` masks have no
 * `content_blob_id` (they're derived at use time).
 *
 * Existing rows default to NULL. Older callers ignoring this column are
 * unaffected.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Migration } from '../migrator.js';

const SQL = `
  ALTER TABLE layers ADD COLUMN mask_data_json TEXT;
`;

const migration: Migration = {
  name: '005-mask-system',
  up(db: DB): void {
    db.exec(SQL);
  },
};

export default migration;
