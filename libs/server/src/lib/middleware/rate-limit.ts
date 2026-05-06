/**
 * Token-bucket rate limiter per `token_id` (D.4).
 *
 * Default: 50 mutating tool calls/min/token (FR-37). Read-only tools are
 * exempted by `tool.category === 'read'` once the catalog manifest is
 * supplied. Until then, every call counts (conservative).
 */

import type { Middleware, MiddlewareCtx } from './chain.js';
import { RateLimitedError } from '../../types/errors.js';

interface Bucket {
  tokens: number;
  last_refill: number;
}

export interface RateLimiterOptions {
  /** Tokens per minute. */
  rate_per_minute: number;
  /** Bucket capacity (defaults to rate). */
  burst?: number;
  /** Function deciding whether the call is mutating. Defaults to true. */
  isMutating?: (toolName: string) => boolean;
}

export function createRateLimitMw(options: RateLimiterOptions): Middleware {
  const buckets = new Map<string, Bucket>();
  const cap = options.burst ?? options.rate_per_minute;
  const refillPerMs = options.rate_per_minute / 60000;

  return async (_args, ctx: MiddlewareCtx & { token_id: string | null; token_name: string; tool_name: string }, next) => {
    if (options.isMutating && !options.isMutating(ctx.tool_name)) return next();
    const key = ctx.token_id ?? `_unauth:${ctx.token_name}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: cap, last_refill: now };
      buckets.set(key, b);
    }
    const elapsed = now - b.last_refill;
    b.tokens = Math.min(cap, b.tokens + elapsed * refillPerMs);
    b.last_refill = now;
    if (b.tokens < 1) {
      const waitMs = Math.ceil((1 - b.tokens) / refillPerMs);
      throw new RateLimitedError(waitMs);
    }
    b.tokens -= 1;
    return next();
  };
}
