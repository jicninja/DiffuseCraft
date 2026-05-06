/**
 * Asset (blob) store: filesystem-backed image bytes addressed by ULID, with
 * SHA-256 stored for dedup. SQLite holds the metadata row; the file lives
 * under `<assets.directory>/blobs/<ulid>`.
 *
 * B.4 covers write/read/delete; B.5 covers GC (separate file).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Database as DB } from 'better-sqlite3';
import { newId } from '../id.js';

export interface BlobMetadata {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  rel_path: string;
  created_at: string;
  expires_at: string | null;
}

export class AssetStore {
  constructor(
    private readonly db: DB,
    private readonly rootDir: string,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.rootDir, 'blobs'), { recursive: true });
  }

  /**
   * Persist `bytes` to disk + record the metadata row. Returns the new
   * blob id (ULID).
   */
  async write(args: { bytes: Buffer; mime: string; ttl_seconds?: number }): Promise<BlobMetadata> {
    const id = newId();
    const sha256 = crypto.createHash('sha256').update(args.bytes).digest('hex');
    const relPath = path.join('blobs', id);
    const absPath = path.join(this.rootDir, relPath);
    await fs.writeFile(absPath, args.bytes);

    const now = new Date();
    const expiresAt =
      typeof args.ttl_seconds === 'number' && args.ttl_seconds > 0
        ? new Date(now.getTime() + args.ttl_seconds * 1000).toISOString()
        : null;
    const meta: BlobMetadata = {
      id,
      sha256,
      bytes: args.bytes.byteLength,
      mime: args.mime,
      rel_path: relPath,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    };
    this.db
      .prepare<[string, string, number, string, string, string, string | null]>(
        'INSERT INTO blobs (id, sha256, bytes, mime, rel_path, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(meta.id, meta.sha256, meta.bytes, meta.mime, meta.rel_path, meta.created_at, meta.expires_at);
    return meta;
  }

  async read(id: string): Promise<{ meta: BlobMetadata; bytes: Buffer } | null> {
    const meta = this.db
      .prepare<string, BlobMetadata>('SELECT * FROM blobs WHERE id = ?')
      .get(id);
    if (!meta) return null;
    const bytes = await fs.readFile(path.join(this.rootDir, meta.rel_path));
    return { meta, bytes };
  }

  async delete(id: string): Promise<void> {
    const meta = this.db
      .prepare<string, BlobMetadata>('SELECT * FROM blobs WHERE id = ?')
      .get(id);
    if (!meta) return;
    await fs.unlink(path.join(this.rootDir, meta.rel_path)).catch(() => undefined);
    this.db.prepare<string>('DELETE FROM blobs WHERE id = ?').run(id);
  }
}
