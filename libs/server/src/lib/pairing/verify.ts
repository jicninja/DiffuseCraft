/**
 * Token verification (D.1 / design.md §4.2).
 *
 * The HTTP transport's bearer auth uses this helper to look up the token row
 * by SHA-256 hash, validate its status, honor `expires_at` for the bootstrap
 * admin token, and touch `last_used_at`. Returns null on every failure mode
 * (the caller maps null → 401).
 *
 * Constant-time hash comparison is implicit: we look up by primary index on
 * `tokens.hash` (SHA-256 hex). For SHA-256 hex equality the lookup itself is
 * the comparison; argon2id-style verification is a future upgrade
 * documented as `TODO(pairing-protocol): argon2id`.
 */

import type { Database as DB } from 'better-sqlite3';
import { hashToken } from './tokens.js';

export interface TokenContext {
  token_id: string;
  token_name: string;
}

interface VerifyRow {
  id: string;
  name: string;
  status: string;
  revoked_at: string | null;
  expires_at: string | null;
}

export function verifyToken(rawToken: string, db: DB): TokenContext | null {
  if (!rawToken) return null;
  const hash = hashToken(rawToken);
  const row = db
    .prepare<string, VerifyRow>(
      'SELECT id, name, status, revoked_at, expires_at FROM tokens WHERE hash = ?',
    )
    .get(hash);
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  db.prepare<[string, string]>('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id,
  );
  return { token_id: row.id, token_name: row.name };
}
