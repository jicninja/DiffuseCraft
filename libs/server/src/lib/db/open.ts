/**
 * SQLite open + WAL configuration.
 *
 * Returns a `better-sqlite3` Database with WAL mode enabled and a sane
 * `busy_timeout` (NFR-3, B.3).
 */

import Database, { type Database as DB } from 'better-sqlite3';

export interface OpenDbOptions {
  /** `:memory:` for tests, otherwise an absolute path. */
  filename: string;
  /** Default 5000ms; overridable by tests. */
  busy_timeout_ms?: number;
}

export function openDb(opts: OpenDbOptions): DB {
  const db = new Database(opts.filename);
  // WAL is essential for concurrent reads during writes (FR-NFR-3).
  if (opts.filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma(`busy_timeout = ${opts.busy_timeout_ms ?? 5000}`);
  db.pragma('foreign_keys = ON');
  return db;
}
