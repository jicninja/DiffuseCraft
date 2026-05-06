/**
 * Handler dispatcher (D.1).
 *
 * - `register<T>(tool, handler)` is the typed registration API (FR-20). The
 *   handler signature is inferred from the tool's Zod schemas.
 * - `dispatch(toolName, args, ctx)` runs the middleware chain and returns
 *   the final response payload.
 * - `has(name)` / `list()` satisfy the `HandlerRegistry` contract used by
 *   `assertCatalogConformance`.
 */

import type { z } from 'zod';
import type { ToolDefinition } from './catalog/types.js';
import type { HandlerContext, ToolHandler } from '../types/handler-context.js';
import type { Middleware, MiddlewareCtx } from './middleware/chain.js';
import { compose } from './middleware/chain.js';
import { ToolNotFoundError } from '../types/errors.js';

interface RegisteredHandler<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly tool: ToolDefinition<I, O>;
  readonly handler: ToolHandler<I, O>;
}

export class HandlerDispatcher {
  private readonly handlers = new Map<string, RegisteredHandler>();
  private chain: Middleware | null = null;

  /** Register a typed handler against a `ToolDefinition`. */
  register<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
    tool: ToolDefinition<I, O>,
    handler: ToolHandler<I, O>,
  ): void {
    if (this.handlers.has(tool.name)) {
      throw new Error(`duplicate handler registration for tool ${tool.name}`);
    }
    this.handlers.set(tool.name, { tool, handler } as unknown as RegisteredHandler);
  }

  /** Set the middleware chain (called once at start()). */
  setChain(middlewares: readonly Middleware[]): void {
    this.chain = compose(middlewares);
  }

  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  list(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Look up the tool's input zod schema (used by validateInputMw via
   * `ctx.scratch.input_schema`).
   */
  getInputSchema(toolName: string): z.ZodTypeAny | null {
    return this.handlers.get(toolName)?.tool.inputSchema ?? null;
  }

  getRegistration(toolName: string): RegisteredHandler | null {
    return this.handlers.get(toolName) ?? null;
  }

  /** Lookup by tool's `since` for the version-compat middleware. */
  getToolSince(toolName: string): string | null {
    return this.handlers.get(toolName)?.tool.since ?? null;
  }

  /**
   * Dispatch a request through the middleware chain. The transport supplies
   * `ctx`; this method stamps `tool_name` + `scratch.input_schema`.
   */
  async dispatch(toolName: string, args: unknown, ctx: HandlerContext): Promise<unknown> {
    if (!this.handlers.has(toolName)) throw new ToolNotFoundError(toolName);
    if (!this.chain) throw new Error('dispatcher chain not configured; did start() run?');
    const reg = this.handlers.get(toolName)!;
    const mwCtx: HandlerContext & MiddlewareCtx = Object.assign(ctx, {
      tool_name: toolName,
      scratch: { input_schema: reg.tool.inputSchema } as Record<string, unknown>,
    });
    const result = await this.chain(args, mwCtx, async () => undefined);
    return result;
  }
}
