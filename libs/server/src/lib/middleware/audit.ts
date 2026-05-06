/**
 * Audit middleware (D.10, FR-36).
 *
 * Wraps the rest of the chain in a try/finally so we always emit an audit
 * row — including for failed calls. Latency is measured from middleware
 * entry; the final entry shape is described in `audit/log.ts`.
 */

import type { Middleware } from './chain.js';
import type { AuditLog } from '../audit/log.js';

export function createAuditMw(audit: AuditLog): Middleware {
  return async (args, ctx, next) => {
    const start = Date.now();
    let outcome: 'ok' | 'error' = 'ok';
    try {
      return await next();
    } catch (err) {
      outcome = 'error';
      throw err;
    } finally {
      const latency = Date.now() - start;
      audit.append({
        token_id: ctx.token_id,
        token_name: ctx.token_name,
        operation: ctx.tool_name,
        args_summary: summarizeArgs(args),
        outcome,
        latency_ms: latency,
      });
    }
  };
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return String(args ?? '');
  // Drop large fields and stringify to a bounded length for storage.
  const stripped = Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) => {
      if (typeof v === 'string' && v.length > 200) return [k, `<string:${v.length}>`];
      if (Buffer.isBuffer?.(v as never)) return [k, `<buffer:${(v as Buffer).byteLength}>`];
      return [k, v];
    }),
  );
  try {
    const json = JSON.stringify(stripped);
    return json.length > 1024 ? `${json.slice(0, 1021)}...` : json;
  } catch {
    return '<unserialisable>';
  }
}
