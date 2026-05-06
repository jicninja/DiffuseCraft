/**
 * Blob garbage collection (B.5).
 *
 * Periodically (1h interval per design.md §4.6):
 *   1. Delete blobs whose `expires_at` has passed (5-min TTL refs).
 *   2. Delete orphans — blobs with no SQLite reference from layers,
 *      history_items, control_layers, or selections.
 *
 * NOTE: The orphan sweep is conservative: it only deletes blobs created more
 * than `min_age_seconds` ago (default 5 min) so an in-flight write doesn't
 * race with its row insert.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Database as DB } from 'better-sqlite3';

const ORPHAN_QUERY = `
  SELECT id, rel_path FROM blobs
  WHERE id NOT IN (SELECT content_blob_id FROM layers WHERE content_blob_id IS NOT NULL)
    AND id NOT IN (SELECT image_blob_id FROM history_items WHERE image_blob_id IS NOT NULL)
    AND id NOT IN (SELECT thumbnail_blob_id FROM history_items WHERE thumbnail_blob_id IS NOT NULL)
    AND id NOT IN (SELECT image_blob_id FROM control_layers WHERE image_blob_id IS NOT NULL)
    AND id NOT IN (SELECT mask_blob_id FROM selections WHERE mask_blob_id IS NOT NULL)
    AND created_at < ?
`;

const EXPIRED_QUERY = `
  SELECT id, rel_path FROM blobs
  WHERE expires_at IS NOT NULL AND expires_at < ?
`;

export interface BlobGcOptions {
  rootDir: string;
  minOrphanAgeSeconds?: number;
  intervalMs?: number;
}

export class BlobGc {
  private timer?: NodeJS.Timeout;
  private readonly rootDir: string;
  private readonly minOrphanAgeSeconds: number;
  private readonly intervalMs: number;

  constructor(
    private readonly db: DB,
    options: BlobGcOptions,
  ) {
    this.rootDir = options.rootDir;
    this.minOrphanAgeSeconds = options.minOrphanAgeSeconds ?? 300;
    this.intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    // Allow node to exit even if the timer is pending.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<{ expired: number; orphaned: number }> {
    const now = new Date();
    const expiredCutoff = now.toISOString();
    const orphanCutoff = new Date(now.getTime() - this.minOrphanAgeSeconds * 1000).toISOString();

    const expired = this.db
      .prepare<string, { id: string; rel_path: string }>(EXPIRED_QUERY)
      .all(expiredCutoff);
    const orphaned = this.db
      .prepare<string, { id: string; rel_path: string }>(ORPHAN_QUERY)
      .all(orphanCutoff);

    for (const row of [...expired, ...orphaned]) {
      await fs.unlink(path.join(this.rootDir, row.rel_path)).catch(() => undefined);
      this.db.prepare<string>('DELETE FROM blobs WHERE id = ?').run(row.id);
    }
    return { expired: expired.length, orphaned: orphaned.length };
  }
}
