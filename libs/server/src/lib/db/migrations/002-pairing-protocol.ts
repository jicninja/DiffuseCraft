/**
 * Migration 002 — pairing-protocol persistence.
 *
 * Implements `design.md` §3.1 + §3.2:
 *   1. New `pairing_windows` table tracking each opened pairing window with
 *      mode (any | mdns | qr | code | manual), optional numeric_code, and
 *      optional pre-issued token.
 *   2. Extension of the `tokens` table with `status` (pending | active |
 *      revoked), `pairing_method`, `pairing_window_id` and `expires_at`
 *      columns. `expires_at` is non-null only for pending tokens; active
 *      tokens are non-expiring per P18.
 *
 * SQLite's `ALTER TABLE` only supports adding columns, which is enough for
 * the additive shape we need here.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Migration } from '../migrator.js';

const SQL = `
  CREATE TABLE pairing_windows (
    id                   TEXT PRIMARY KEY,
    opened_at            TEXT NOT NULL,
    expires_at           TEXT NOT NULL,
    closed_at            TEXT,
    close_reason         TEXT,           -- "expired" | "claimed" | "stopped"
    mode                 TEXT NOT NULL,  -- "any" | "mdns" | "qr" | "code" | "manual"
    numeric_code         TEXT,
    pre_issued_token_id  TEXT REFERENCES tokens(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_pairing_windows_open ON pairing_windows(closed_at, expires_at);
  CREATE INDEX idx_pairing_windows_code ON pairing_windows(numeric_code) WHERE numeric_code IS NOT NULL;

  ALTER TABLE tokens ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE tokens ADD COLUMN pairing_method TEXT;
  ALTER TABLE tokens ADD COLUMN pairing_window_id TEXT;
  ALTER TABLE tokens ADD COLUMN expires_at TEXT;
  CREATE INDEX idx_tokens_status ON tokens(status);
`;

const migration: Migration = {
  name: '002-pairing-protocol',
  up(db: DB): void {
    db.exec(SQL);
  },
};

export default migration;
