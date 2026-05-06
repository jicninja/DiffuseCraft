/**
 * In-memory transport (E.1, FR-14).
 *
 * Always-on; cannot be disabled. Provides:
 *   - `invokeTool(name, args)` for dynamic call sites.
 *   - `tools.<name>(args)` typed accessors generated lazily from the catalog.
 *   - `readResource(uri)` for resource subscribers.
 *
 * In-memory invocations log under the synthetic
 * `_in_process_<host_name>` token (Q4 resolution).
 */

import type { HandlerDispatcher } from '../dispatcher.js';
import type { HandlerContext, TransportKind, UndoRedoManagerLike } from '../../types/handler-context.js';
import type { Logger } from 'pino';
import { newRequestId } from '../id.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';

/**
 * Per-resource-read calling context. Resource resolvers that need to
 * scope their output to the caller (e.g., the per-`(token, document)`
 * undo/redo stacks at `diffusecraft://undo-stack/{document-id}` and
 * `diffusecraft://redo-stack/{document-id}` — undo-redo-system D.1/D.2)
 * read this third arg. Existing resolvers (history-list,
 * history-by-id) ignore it and remain unchanged.
 *
 * `token_id` is `null` for stdio (auth-trusted-by-process) — callers
 * fall back to `token_name` as a stack key in that case (mirrors
 * `libs/server/src/lib/handlers/undo.ts:61`).
 */
export interface ResourceContext {
  readonly token_id: string | null;
  readonly token_name: string;
  readonly transport: TransportKind;
}

/**
 * Handler signature for `readResource`. Resource paths register against
 * the URI scheme (without query string); the transport decodes query
 * params and hands them to the resolver. Returning `null` flips the
 * outer call to a `RESOURCE_NOT_FOUND` error.
 *
 * `ctx` is supplied on every call (even for in-process embedding reads —
 * the transport synthesizes one from `options.in_memory_token_name`).
 * Resolvers that don't need calling-token scope simply ignore it.
 */
export type ResourceResolver = (
  uri: string,
  query: Record<string, string | string[]>,
  ctx: ResourceContext,
) => unknown | Promise<unknown>;

export interface InMemoryTransportOptions {
  in_memory_token_name: string;
  host_name: string;
}

export class InMemoryTransport {
  constructor(
    private readonly dispatcher: HandlerDispatcher,
    private readonly bus: EventBus,
    private readonly audit: AuditLog,
    private readonly logger: Logger,
    private readonly options: InMemoryTransportOptions,
    /**
     * Undo/redo manager facade — stamped onto every handler ctx so
     * reversible handlers can call `ctx.undoRedo.execute(...)`
     * (undo-redo-system FR-34). Optional only because some test
     * harnesses construct the transport directly without the full
     * server bootstrap.
     */
    private readonly undoRedo?: UndoRedoManagerLike,
  ) {}

  async invokeTool(name: string, args: unknown): Promise<unknown> {
    const ctx: HandlerContext = {
      request_id: newRequestId(),
      transport: 'in-memory',
      token_id: null,
      token_name: this.options.in_memory_token_name,
      received_at: Date.now(),
      publish: (event) => this.bus.publish(event),
      audit: ({ operation, outcome, latency_ms, args_summary }) =>
        void this.audit.append({
          token_id: null,
          token_name: this.options.in_memory_token_name,
          operation,
          outcome,
          latency_ms,
          args_summary,
        }),
      logger: {
        info: (...rest) => this.logger.info(...rest),
        error: (...rest) => this.logger.error(...rest),
      },
      undoRedo: this.undoRedo ?? STUB_UNDO_REDO,
    };
    return this.dispatcher.dispatch(name, args, ctx);
  }

  /**
   * Lazily-typed accessor proxy. Hosts call `transport.tools.generate_image(args)`
   * and the proxy routes to `invokeTool('generate_image', args)`.
   *
   * TODO(mcp-tool-catalog): generate strongly-typed accessors keyed by tool
   * names from the manifest at build time.
   */
  readonly tools: Record<string, (args: unknown) => Promise<unknown>> = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        return (args: unknown) => this.invokeTool(name, args);
      },
    },
  );

  /**
   * Per-pattern resource resolvers. Patterns may include `{param}` segments
   * (path parameters) — matched in `readResource` below. Order is the
   * registration order; first match wins.
   */
  private readonly resolvers: Array<{ pattern: string; resolve: ResourceResolver }> = [];

  /**
   * Register a resource resolver. Patterns:
   *   - `diffusecraft://history/list`        — exact match
   *   - `diffusecraft://history/{id}`        — `{id}` matches one ULID
   *
   * The transport decodes the query string and hands `{ key: value | value[] }`
   * to the resolver. The query param `id` from a `{id}` capture is also
   * surfaced under the captured name.
   */
  registerResource(pattern: string, resolve: ResourceResolver): void {
    this.resolvers.push({ pattern, resolve });
  }

  async readResource(uri: string, ctx?: ResourceContext): Promise<unknown> {
    const url = new URL(uri);
    const path = `${url.protocol}//${url.host}${url.pathname}`;
    const query = parseQuery(url.searchParams);
    // Synthesize an in-process embedding ctx when the caller (e.g., a
    // host that holds the transport directly via `mcp.readResource`) did
    // not supply one. Mirrors the `invokeTool` synthetic identity above.
    const effectiveCtx: ResourceContext = ctx ?? {
      token_id: this.options.in_memory_token_name,
      token_name: this.options.in_memory_token_name,
      transport: 'in-memory',
    };
    for (const { pattern, resolve } of this.resolvers) {
      const captured = matchPattern(pattern, path);
      if (!captured) continue;
      const merged = { ...query, ...captured };
      const out = await resolve(uri, merged, effectiveCtx);
      if (out === null) {
        throw new Error(`RESOURCE_NOT_FOUND: ${uri}`);
      }
      return out;
    }
    throw new Error(`RESOURCE_NOT_FOUND: ${uri}`);
  }
}

/**
 * Defensive stub used when a transport is constructed without a real
 * {@link UndoRedoManagerLike}. Calling `execute` throws synchronously so
 * a misconfiguration surfaces immediately in development, but the type
 * shape stays satisfied so non-reversible handlers (which never touch
 * `ctx.undoRedo`) keep working in stripped-down test harnesses.
 */
const STUB_UNDO_REDO: UndoRedoManagerLike = {
  execute() {
    throw new Error(
      'ctx.undoRedo is not configured on this transport; handler must not call execute()',
    );
  },
};

function parseQuery(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of params.keys()) {
    const all = params.getAll(key);
    out[key] = all.length === 1 ? (all[0] as string) : all;
  }
  return out;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const pSegs = pattern.split('/');
  const sSegs = path.split('/');
  if (pSegs.length !== sSegs.length) return null;
  const captured: Record<string, string> = {};
  for (let i = 0; i < pSegs.length; i += 1) {
    const p = pSegs[i] ?? '';
    const s = sSegs[i] ?? '';
    if (p.startsWith('{') && p.endsWith('}')) {
      captured[p.slice(1, -1)] = s;
    } else if (p !== s) {
      return null;
    }
  }
  return captured;
}
