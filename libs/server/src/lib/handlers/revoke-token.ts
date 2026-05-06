/**
 * `revoke_token` handler (D.4 / FR-26 / FR-27 / FR-28).
 *
 * Idempotent: revoking an already-revoked token returns `revoked=true` with
 * the original `revoked_at`. Subsequent requests carrying the token will
 * fail bearer auth with 401.
 *
 * Self-revocation is allowed (FR-27): if the calling token's id equals the
 * input id, the call still succeeds and the session is implicitly closed
 * once the response leaves (the transport rejects the next request).
 */

import { revokeToken as revokeTokenTool } from '@diffusecraft/mcp-tools';
import type { Database as DB } from 'better-sqlite3';
import type { ToolHandler } from '../../types/handler-context.js';
import type { PairingManager } from '../pairing/manager.js';

export function createRevokeTokenHandler(
  db: DB,
  pairing: PairingManager,
): ToolHandler<typeof revokeTokenTool.inputSchema, typeof revokeTokenTool.outputSchema> {
  return async (input, ctx) => {
    const targetId = input.token_id;
    const existing = db
      .prepare<string, { revoked_at: string | null }>(
        'SELECT revoked_at FROM tokens WHERE id = ?',
      )
      .get(targetId);
    if (existing?.revoked_at) {
      return { revoked: true, revoked_at: existing.revoked_at };
    }
    pairing.revokeToken(targetId, ctx.token_id);
    const after = db
      .prepare<string, { revoked_at: string | null }>(
        'SELECT revoked_at FROM tokens WHERE id = ?',
      )
      .get(targetId);
    return { revoked: true, revoked_at: after?.revoked_at ?? new Date().toISOString() };
  };
}
