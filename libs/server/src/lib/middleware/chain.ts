/**
 * Async middleware chain runner (D.2).
 *
 * Each middleware receives `(args, ctx, next)` and either calls `next()` to
 * forward or returns a value (short-circuit). The chain unwinds in reverse
 * for post-processing (audit, capability shaping).
 */

import type { HandlerContext } from '../../types/handler-context.js';

export type Middleware = (
  args: unknown,
  ctx: HandlerContext & MiddlewareCtx,
  next: () => Promise<unknown>,
) => Promise<unknown>;

export interface MiddlewareCtx {
  /** Tool name being invoked. */
  readonly tool_name: string;
  /**
   * Mutable per-request scratch space. Middleware uses this to thread state
   * (e.g., parsed input, latency_start, validated_input).
   */
  readonly scratch: Record<string, unknown>;
}

export function compose(middlewares: readonly Middleware[]): Middleware {
  return async (args, ctx, next): Promise<unknown> => {
    let i = -1;
    const dispatch = async (idx: number): Promise<unknown> => {
      if (idx <= i) throw new Error('next() called multiple times');
      i = idx;
      const fn = middlewares[idx] ?? next;
      if (!fn) return undefined;
      return fn(args, ctx, () => dispatch(idx + 1));
    };
    return dispatch(0);
  };
}
