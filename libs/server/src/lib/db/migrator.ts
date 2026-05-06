/**
 * SQLite migration runner.
 *
 * - Migrations live under `lib/db/migrations/<NNN>-<slug>.ts` and each
 *   default-exports an `up(db)` function (B.1).
 * - The runner records applied migrations in `_migrations(name TEXT PRIMARY
 *   KEY, applied_at TEXT)` and is idempotent.
 * - Apply order is lexicographic by file name.
 */

import type { Database as DB } from 'better-sqlite3';

export interface Migration {
  /** File-name slug, e.g. `001-initial-schema`. Used as the PK. */
  readonly name: string;
  /** Idempotent SQL/JS to bring the DB from the previous version forward. */
  up(db: DB): void;
}

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

export class Migrator {
  constructor(private readonly db: DB) {
    this.db.exec(ENSURE_TABLE);
  }

  /**
   * Apply each migration in lexicographic order, skipping any whose `name`
   * already appears in `_migrations`.
   */
  apply(migrations: readonly Migration[]): { applied: string[]; skipped: string[] } {
    const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
    const applied: string[] = [];
    const skipped: string[] = [];
    const isApplied = this.db.prepare<string, { name: string }>(
      'SELECT name FROM _migrations WHERE name = ?',
    );
    const insert = this.db.prepare<[string, string]>(
      'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
    );

    const txn = this.db.transaction((m: Migration) => {
      m.up(this.db);
      insert.run(m.name, new Date().toISOString());
    });

    for (const m of sorted) {
      if (isApplied.get(m.name)) {
        skipped.push(m.name);
        continue;
      }
      txn(m);
      applied.push(m.name);
    }
    return { applied, skipped };
  }
}
