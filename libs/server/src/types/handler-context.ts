/**
 * Per-request and per-handler context types.
 *
 * `RequestContext` carries the inbound transport, peer identity, and request
 * id. `HandlerContext` is what a registered handler receives; it composes
 * `RequestContext` with subsystem accessors granted to the handler (event bus
 * publish, audit append, undo/redo enrol, etc.).
 *
 * `EmbeddingContext` is what hosts (MeshCraft, the standalone binary, tests)
 * see when they invoke the in-memory transport — strictly less surface than
 * `HandlerContext`; only what an embedding caller may legitimately observe.
 */

import type { z } from 'zod';
import type { Command as ParametricCommand, DocumentId } from '../lib/undo-redo/command.js';

export type TransportKind = 'stdio' | 'http' | 'in-memory';

export interface RequestContext {
  /** Stable id for tracing one inbound MCP call across logs / events. */
  readonly request_id: string;
  /** Which transport delivered this request. */
  readonly transport: TransportKind;
  /**
   * The token id (DB primary key) for HTTP / in-memory; `null` for stdio
   * (auth-trusted-by-process per FR-16).
   */
  readonly token_id: string | null;
  /** Human-readable token name (audit display only). */
  readonly token_name: string;
  /** Wall-clock timestamp the request arrived (ms since epoch). */
  readonly received_at: number;
  /**
   * Optional active document id. Mutating handlers fail if absent and the
   * tool is document-scoped.
   */
  readonly document_id?: string;
}

export interface EmbeddingContext {
  /** The host name (`config.host_name`). */
  readonly host_name: string;
  /** Synthetic token name applied to in-memory invocations (FR-Q4 resolved). */
  readonly in_memory_token_name: string;
}

/**
 * Structural facade exposed to reversible handlers (undo-redo-system §11
 * cross-spec contract; FR-34). The full {@link UndoRedoManager} class
 * implements this interface — the type alias only surfaces `execute(...)`
 * to keep the handler API tight: handlers must NEVER reach for `undo`,
 * `redo`, lifecycle hooks, or eviction primitives. Those are owned by
 * `lib/handlers/undo.ts` + `redo.ts` and the server-bootstrap wiring.
 *
 * Typed as a structural interface (rather than re-exporting the class
 * type) so test harnesses can stub it without instantiating the full
 * manager and the manager's many private knobs stay invisible to
 * handlers.
 */
export interface UndoRedoManagerLike {
  /**
   * Apply + push + emit a {@link ParametricCommand}. The manager calls
   * `command.apply()` itself — handlers MUST NOT pre-apply. The manager
   * also publishes `document.changed` on the bus, so handlers MUST NOT
   * publish that event themselves for the same mutation.
   */
  execute<R>(
    token_name: string,
    token_id: string,
    document_id: DocumentId,
    command: ParametricCommand<R>,
  ): Promise<R>;
}

export interface HandlerContext extends RequestContext {
  /**
   * Publish a typed catalog event onto the event bus. Validated at publish
   * time in dev (C.2).
   */
  publish(event: { name: string; payload: unknown }): void;
  /**
   * Append a row to the audit log. The middleware pipeline calls this
   * automatically; handlers normally do not need to.
   */
  audit(args: { operation: string; outcome: 'ok' | 'error'; latency_ms: number; args_summary: string }): void;
  /** Get the configured logger scoped to this request. */
  readonly logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /**
   * Undo/redo manager facade (undo-redo-system FR-34, design.md §11).
   * Reversible handlers MUST go through `ctx.undoRedo.execute(...)` rather
   * than mutating directly + setting `ctx.scratch.command`. The manager
   * owns the apply call AND the `document.changed` emission.
   */
  readonly undoRedo: UndoRedoManagerLike;
  /**
   * Optional MCP-sampling capability for the calling agent
   * (prompt-enhancement FR-10/FR-11). Transports that participate in MCP
   * sampling expose a client implementing
   * `prompt-enhancement/types.SamplingClient`; transports that don't
   * (e.g. the in-memory fallback) leave it `undefined`.
   *
   * Typed as `unknown` here so the core types module avoids circular
   * dependencies on `lib/prompt-enhancement/types`. The handler casts at
   * the boundary.
   */
  readonly samplingClient?: unknown;
}

/**
 * Generic registered-handler signature. Input/output are inferred from the
 * tool's Zod schemas (`ToolDefinition`).
 */
export type ToolHandler<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = (
  input: z.infer<I>,
  ctx: HandlerContext,
) => Promise<z.infer<O>>;
