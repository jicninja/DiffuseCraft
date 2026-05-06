/**
 * Bearer-token verification middleware (D.3, FR-17).
 *
 * The token verification itself happens at the transport layer (HTTP) and
 * stamps `ctx.token_id` / `ctx.token_name` before the dispatcher runs. This
 * middleware re-asserts the invariant for safety.
 *
 * Stdio is auth-trusted-by-process (FR-16) and arrives with `token_id=null`
 * + `token_name` set to a synthetic stdio identifier; we let it through.
 *
 * In-memory invocations carry the synthetic `_in_process_<host_name>` token
 * name (Q4 resolution).
 */

import type { Middleware } from './chain.js';
import { UnauthorizedError } from '../../types/errors.js';

export const authMw: Middleware = async (args, ctx, next) => {
  if (!ctx.token_name) throw new UnauthorizedError('missing token_name on context');
  if (ctx.transport === 'http' && !ctx.token_id) {
    throw new UnauthorizedError('http transport requires a paired token');
  }
  return next();
};
