/**
 * Execute the registered handler with the validated input (D.8).
 *
 * Catches unhandled handler errors and wraps them in `INTERNAL_ERROR` so the
 * stack never leaks across the wire (FR-23). The full error is logged
 * separately via `ctx.logger.error`.
 */

import type { Middleware } from './chain.js';
import { ServerError } from '../../types/errors.js';

export type RegisteredHandlerFn = (input: unknown, ctx: unknown) => Promise<unknown>;

export function createExecuteMw(getHandler: (toolName: string) => RegisteredHandlerFn | null): Middleware {
  return async (_args, ctx, next) => {
    const handler = getHandler(ctx.tool_name);
    if (!handler) throw new ServerError({ code: 'TOOL_NOT_FOUND', message: ctx.tool_name });
    try {
      const input = ctx.scratch['input'];
      const out = await handler(input, ctx);
      ctx.scratch['output'] = out;
      return next();
    } catch (err) {
      if (err instanceof ServerError) throw err;
      ctx.logger.error({ err, tool: ctx.tool_name }, 'handler threw');
      throw new ServerError({
        code: 'INTERNAL_ERROR',
        message: 'internal server error',
        cause: err,
      });
    }
  };
}
