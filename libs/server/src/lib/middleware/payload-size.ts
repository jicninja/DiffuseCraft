/**
 * Early payload-size reject (D.5).
 *
 * Size measured by the transport layer and forwarded via `ctx.scratch.payload_bytes`.
 * If the transport doesn't supply a length, we estimate from the JSON-stringified
 * args (worst-case but avoids crashing for in-memory callers).
 */

import type { Middleware } from './chain.js';
import { PayloadTooLargeError } from '../../types/errors.js';

export function createPayloadSizeMw(maxBytes: number): Middleware {
  return async (args, ctx, next) => {
    const declared = (ctx.scratch['payload_bytes'] as number | undefined) ?? null;
    let bytes: number;
    if (declared !== null) {
      bytes = declared;
    } else {
      try {
        bytes = Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8');
      } catch {
        bytes = 0;
      }
    }
    if (bytes > maxBytes) throw new PayloadTooLargeError(bytes, maxBytes);
    return next();
  };
}
