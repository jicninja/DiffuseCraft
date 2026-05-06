/**
 * Token issuance + verification helpers (FR-16, FR-17, FR-18, NFR-1, NFR-2).
 *
 * Per spec design.md §4.2, v1 stores SHA-256 hashes of the cleartext token
 * (matching the existing `tokens.hash` index used by the HTTP transport).
 * The CLAUDE.md task guidance is explicit: 32-byte randomBytes, hex-encoded,
 * persisted as SHA-256 hash. The tasks.md mention of argon2id stays as a
 * follow-up note: a hash-table lookup is required to keep the HTTP auth path
 * O(1), and argon2id would force the linear scan described in the design's
 * NFR-2 fallback. We therefore keep SHA-256 here for v1 and document the
 * future argon2id upgrade with a TODO marker.
 *
 * Tokens are formatted with a `dcft_` prefix (FR-16) for log readability.
 * The prefix is part of the cleartext and hashed with the rest.
 */

import * as crypto from 'node:crypto';
import type { Database as DB } from 'better-sqlite3';
import { newId } from '../id.js';

/** Length in bytes of the random core of a pairing token. */
export const TOKEN_CORE_BYTES = 32;

/** Deterministic informational prefix kept on cleartext tokens. */
export const TOKEN_PREFIX = 'dcft_';

export interface TokenRow {
  id: string;
  name: string;
  hash: string;
  status: 'pending' | 'active' | 'revoked';
  pairing_method: string | null;
  pairing_window_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** Returns a fresh opaque cleartext token, e.g. `dcft_<64-hex-chars>`. */
export function generateClearTextToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_CORE_BYTES).toString('hex');
}

/** SHA-256 hash of a cleartext token (hex). Matches the existing index. */
export function hashToken(cleartext: string): string {
  return crypto.createHash('sha256').update(cleartext).digest('hex');
}

/**
 * Insert a new token row. Returns the cleartext (caller must surface it
 * exactly once per FR-18) and the persisted row id.
 */
export function insertToken(
  db: DB,
  args: {
    name: string;
    status: 'pending' | 'active';
    pairing_method: string | null;
    pairing_window_id: string | null;
    /** ISO8601; only set for pending tokens. */
    expires_at?: string | null;
  },
): { cleartext: string; token_id: string } {
  const cleartext = generateClearTextToken();
  const hash = hashToken(cleartext);
  const id = newId();
  db.prepare<
    [string, string, string, string, string, string | null, string | null, string | null]
  >(
    `INSERT INTO tokens (id, name, hash, status, created_at, pairing_method, pairing_window_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.name,
    hash,
    args.status,
    new Date().toISOString(),
    args.pairing_method,
    args.pairing_window_id,
    args.expires_at ?? null,
  );
  return { cleartext, token_id: id };
}

/** Mark a single token as revoked. Returns true if a row was actually changed. */
export function markTokenRevoked(db: DB, token_id: string): boolean {
  const now = new Date().toISOString();
  const res = db
    .prepare<[string, string, string]>(
      "UPDATE tokens SET status='revoked', revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND status != ?",
    )
    .run(now, token_id, 'revoked');
  return res.changes > 0;
}

/** Set a token's `name`. Used after first claim to rename the pre-issued row. */
export function renameToken(db: DB, token_id: string, name: string): void {
  db.prepare<[string, string]>('UPDATE tokens SET name = ? WHERE id = ?').run(name, token_id);
}
