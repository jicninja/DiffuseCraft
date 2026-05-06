/**
 * stdio transport (E.2, FR-16).
 *
 * Mounted only when `config.transports.stdio === true`. Auth is trust-by-
 * process — Claude Desktop / agent CLI spawning the server inherits the
 * caller's identity at the OS level. We log every call under a synthetic
 * `_stdio` token name.
 *
 * Real wiring: `@modelcontextprotocol/sdk/server/stdio` exposes the inbound
 * channel; we forward to the dispatcher.
 *
 * TODO(server-architecture): integrate the SDK transport once the
 * dispatcher integration test harness is in place. The skeleton below
 * registers start/stop and a request shim so the lifecycle code can mount
 * + unmount; the actual MCP framing is left to the SDK on connect.
 */

import type { Logger } from 'pino';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import type { HandlerContext, UndoRedoManagerLike } from '../../types/handler-context.js';
import { newRequestId } from '../id.js';

export class StdioTransport {
  private mounted = false;

  constructor(
    private readonly dispatcher: HandlerDispatcher,
    private readonly bus: EventBus,
    private readonly audit: AuditLog,
    private readonly logger: Logger,
    /**
     * Undo/redo manager facade — stamped onto every handler ctx so
     * reversible handlers can call `ctx.undoRedo.execute(...)`
     * (undo-redo-system FR-34). Optional so existing tests that mount
     * stdio without the full server bootstrap keep working; in that
     * case the stub at the bottom of this file throws on use.
     */
    private readonly undoRedo?: UndoRedoManagerLike,
  ) {}

  async start(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;
    // TODO(server-architecture): replace with @modelcontextprotocol/sdk
    // stdio transport. The SDK will deliver tool invocations into
    // `this.dispatchInvocation(name, args)` once attached.
    this.logger.info('stdio transport mounted (skeleton)');
  }

  async stop(): Promise<void> {
    if (!this.mounted) return;
    this.mounted = false;
    this.logger.info('stdio transport unmounted');
  }

  /** Helper used by the SDK adaptor (once wired) to dispatch a call. */
  async dispatchInvocation(name: string, args: unknown): Promise<unknown> {
    const ctx: HandlerContext = {
      request_id: newRequestId(),
      transport: 'stdio',
      token_id: null,
      token_name: '_stdio',
      received_at: Date.now(),
      publish: (event) => this.bus.publish(event),
      audit: ({ operation, outcome, latency_ms, args_summary }) =>
        void this.audit.append({
          token_id: null,
          token_name: '_stdio',
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
}

/**
 * Defensive stub used when stdio is constructed without a real
 * {@link UndoRedoManagerLike}. Calling `execute` throws synchronously
 * so misconfiguration surfaces immediately; non-reversible handlers
 * keep working in stripped-down test harnesses since they never reach
 * for `ctx.undoRedo`.
 */
const STUB_UNDO_REDO: UndoRedoManagerLike = {
  execute() {
    throw new Error(
      'ctx.undoRedo is not configured on this transport; handler must not call execute()',
    );
  },
};
