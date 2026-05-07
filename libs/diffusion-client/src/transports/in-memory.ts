/**
 * In-memory transport (`client-sdk` FR-9 / FR-10, design.md §2 + §4).
 *
 * The in-memory transport accepts a `DiffuseCraftServer` reference and
 * dispatches every operation against the server's public programmatic
 * surface (`server.mcp.invokeTool`, `server.mcp.readResource`,
 * `server.events.subscribe`). No serialization, no network — the call
 * crosses a function boundary inside the same process.
 *
 * Design contract (per the canonical `Transport` interface in
 * `transports/transport.ts` and `client-sdk` design.md §4):
 *
 *   - `connect()` is a no-op. The in-memory transport is always
 *     "connected" once constructed (FR-9). A placeholder
 *     {@link HandshakeResult} is returned so the client class — which
 *     stores `capabilities.server` after `connect()` (design.md §3) — has
 *     a non-null value to keep. The placeholder's protocol version
 *     mirrors the catalog's expected MCP protocol version slot; Phase G
 *     (handshake / capability negotiation) replaces this with the real
 *     server-reported tuple once the server's public API exposes its
 *     negotiated capabilities.
 *
 *   - `disconnect()` is a no-op resolved promise. Tearing down the
 *     in-memory transport doesn't stop the server itself; embedding hosts
 *     (MeshCraft) own the server's lifecycle separately.
 *
 *   - `isHealthy()` returns `true` while the underlying server reference
 *     is alive. The transport doesn't know when the host shuts the server
 *     down — Phase G's status projection layer can subscribe to
 *     `lifecycle.stopped` (now reachable via FR-9's `events.subscribe`) and
 *     flip a flag if hosts need that signal pre-Phase-G.
 *
 *   - `send()` forwards to `server.mcp.invokeTool(toolName, args)`. The
 *     pre-send `signal.aborted` short-circuit is a minimal Phase B
 *     placeholder; the full {@link AbortSignal} cooperation lands in
 *     Phase C (C.5 — `AbortSignal` plumbing).
 *
 *   - `readResource()` forwards to `server.mcp.readResource(uri)`. The
 *     current server API ignores the `?since` / `?fields` query (FR-17);
 *     Phase D tightens the resource layer to honour the query. Until
 *     then, the query is silently dropped on the in-memory leg — every
 *     read returns the full resource payload.
 *
 *   - `subscribe()` forwards to `server.events.subscribe(name, handler)`
 *     and returns the host-supplied {@link Unsubscribe}. The bus delivers
 *     payloads as `unknown`; the transport casts to the catalog's
 *     {@link EventPayload} shape so the typed event bus
 *     (`events/bus.ts`, Phase F) layered on top sees the correct
 *     handler signature. The cast is safe because the server publishes
 *     payloads validated against the same catalog schemas.
 *
 *   - `sampling.register()` stores the consumer-supplied handler locally
 *     and returns an unregister callback. End-to-end forwarding (the
 *     server invoking this handler when it wants to delegate sampling
 *     to the calling client) requires server-side wiring that lands in
 *     Phase I (sampling forwarder integration). The transport does NOT
 *     throw — registering ahead of full forwarding support is legitimate
 *     so callers can attach a handler at construction time and not have
 *     to retro-attach when Phase I lands.
 *
 *   - **Error translation (FR-14): NOT performed by this transport.**
 *     Unlike `stdio.ts` and `http.ts` — which translate MCP wire errors
 *     via `transports/_errors.ts` (`wrapServerError` for thrown
 *     `McpError`s, `serverErrorFromIsErrorResult` for the SDK's
 *     `isError: true` tool-result path) — the in-memory transport has
 *     no wire-framing layer. `server.mcp.invokeTool` is a direct
 *     in-process function call that throws domain errors verbatim
 *     (e.g. `ServerError`, `ValidationError`, `ConnectionError` from
 *     `errors.ts`), so the transport forwards them unchanged. The
 *     translation step is unnecessary because the server is the source
 *     of those typed errors — there is nothing to "wrap" back into the
 *     same shape.
 *
 * Typing strategy: the constructor accepts `unknown` and narrows
 * structurally on first use. `import type` from `@diffusecraft/server`
 * is intentionally avoided so the dependency direction stays one-way
 * (client → server is forbidden as a build dependency); the transport
 * exposes the same surface contract the server documents in its
 * `EventsInterface` / `McpInterface` types.
 */

import type {
  EventName,
  EventPayload,
  ResourceUri,
  ToolInput,
  ToolName,
  ToolOutput,
} from "@diffusecraft/mcp-tools";

import { ConnectionError } from "../errors";
import type {
  HandshakeResult,
  ResourceReadQuery,
  Transport,
  TransportReadResourceOptions,
  TransportSamplingHandler,
  TransportSendOptions,
  Unsubscribe,
} from "./transport";

// ---------------------------------------------------------------------------
// Structural narrowing helpers
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape the in-memory transport requires from its
 * `server` argument. Mirrors `@diffusecraft/server`'s `McpInterface`,
 * `EventsInterface`, and `CapabilitiesInterface`
 * (`libs/server/src/public-api.ts`) but is declared inline so this file
 * does not take a runtime or type dependency on the server package.
 *
 * `capabilities` is optional so older server builds that predate FR-9's
 * snapshot surface still construct successfully — `connect()` then falls
 * back to the legacy minimum-shape handshake.
 */
interface ServerShape {
  readonly mcp: {
    invokeTool: (name: string, args: unknown) => Promise<unknown>;
    readResource: (uri: string) => Promise<unknown>;
  };
  readonly events: {
    subscribe: (
      name: string,
      handler: (payload: unknown) => void,
    ) => Unsubscribe;
  };
  readonly capabilities?: {
    snapshot: () => HandshakeResult;
  };
}

/**
 * Verify `server` exposes the call-site shape required by the in-memory
 * transport (`mcp.invokeTool`, `mcp.readResource`, `events.subscribe`).
 * Throws {@link ConnectionError} with `transport_kind: "in-memory"` when
 * any required method is missing or non-callable; the SDK's higher-level
 * client surfaces this as a connection failure (per the FR-31 error
 * channel) rather than a generic `TypeError`.
 */
function narrowServer(server: unknown): ServerShape {
  if (server === null || typeof server !== "object") {
    throw new ConnectionError(
      "in-memory transport requires a non-null server reference",
      { transport_kind: "in-memory" },
    );
  }

  const candidate = server as {
    mcp?: unknown;
    events?: unknown;
  };

  const mcp = candidate.mcp as
    | { invokeTool?: unknown; readResource?: unknown }
    | undefined;
  if (
    !mcp ||
    typeof mcp !== "object" ||
    typeof (mcp as { invokeTool?: unknown }).invokeTool !== "function" ||
    typeof (mcp as { readResource?: unknown }).readResource !== "function"
  ) {
    throw new ConnectionError(
      "in-memory transport: server.mcp must expose invokeTool() and readResource()",
      { transport_kind: "in-memory" },
    );
  }

  const events = candidate.events as { subscribe?: unknown } | undefined;
  if (
    !events ||
    typeof events !== "object" ||
    typeof (events as { subscribe?: unknown }).subscribe !== "function"
  ) {
    throw new ConnectionError(
      "in-memory transport: server.events must expose subscribe()",
      { transport_kind: "in-memory" },
    );
  }

  return server as ServerShape;
}

// ---------------------------------------------------------------------------
// InMemoryTransport
// ---------------------------------------------------------------------------

/**
 * Concrete {@link Transport} that dispatches against an in-process
 * `DiffuseCraftServer`. Constructor performs a structural shape check on
 * first call (lazy) — if the supplied `server` lacks the required
 * methods, the first invocation throws {@link ConnectionError}. This
 * matches the lazy-narrowing pattern in `client-sdk` design.md §2 (the
 * `transport.kind === "in-memory"` schema slot is opaque
 * `z.unknown()` — see `config.ts`).
 */
export class InMemoryTransport implements Transport {
  /**
   * Lazily-narrowed reference; populated on first use so consumers can
   * construct the transport with a server that hasn't been `start()`ed
   * yet (the `events` namespace requires internals which only exist
   * post-start). The narrow itself is cached so repeat calls are cheap.
   */
  private narrowed: ServerShape | null = null;

  /**
   * Sampling handler registered via {@link sampling.register}. The
   * server-initiated forwarding path that calls into this handler lands
   * in Phase I; until then the field is held so callers can attach early
   * without retro-wiring.
   */
  private samplingHandler: TransportSamplingHandler | null = null;

  /**
   * Sampling namespace shape required by the {@link Transport} interface.
   * Bound in the constructor so `this` is captured for the closure that
   * actually mutates {@link samplingHandler}.
   */
  public readonly sampling: {
    register(handler: TransportSamplingHandler): Unsubscribe;
  };

  constructor(private readonly server: unknown) {
    this.sampling = {
      register: (handler: TransportSamplingHandler): Unsubscribe => {
        this.samplingHandler = handler;
        return () => {
          if (this.samplingHandler === handler) this.samplingHandler = null;
        };
      },
    };
  }

  /**
   * Resolve the structural narrow on first use. Throws
   * {@link ConnectionError} if the server reference's shape is invalid.
   */
  private getServer(): ServerShape {
    if (this.narrowed === null) {
      this.narrowed = narrowServer(this.server);
    }
    return this.narrowed;
  }

  /**
   * Handshake — the in-memory transport is always connected once
   * constructed. Reads the server's live {@link CapabilitiesInterface}
   * snapshot when available (FR-9 / design.md §4) so the result reflects
   * real `comfyui_status` / `sampling_supported` / `catalog_version_range`
   * values instead of a placeholder. Falls back to a conservative shape
   * for older server builds that predate the snapshot surface.
   */
  async connect(): Promise<HandshakeResult> {
    // Resolve the narrow eagerly so connection-shape errors surface here
    // (matching how a real handshake would fail at connect time) instead
    // of on the first send/readResource/subscribe call.
    const server = this.getServer();
    if (server.capabilities && typeof server.capabilities.snapshot === "function") {
      return server.capabilities.snapshot();
    }
    return {
      serverCapabilities: {
        catalog_version_range: ["0", "0"],
        comfyui_status: "unknown",
        supported_workspaces: [],
        sampling_supported: false,
        audit_log_enabled: false,
      },
      protocolVersion: "in-memory",
      serverName: "in-memory",
    };
  }

  /**
   * Invoke a catalog tool by name. Forwards verbatim to
   * `server.mcp.invokeTool(toolName, args)` and casts the response to
   * the catalog's `ToolOutput<N>` shape — the server's dispatcher
   * validates outputs against the same schema, so the cast is safe.
   *
   * `opts.signal` is honoured only as a pre-invocation short-circuit:
   * if the signal is already aborted when `send` is called, the call
   * rejects without dispatching to the server. Post-send abort with
   * `cancel_job` cascade for job-shaped tools is orchestrated one layer
   * above (`tools/generated.ts` — `callToolWithAbort`); the transport
   * layer only owns the pre-flight short-circuit. The `opts.timeout_ms`
   * slot is unused on this transport because in-memory dispatch is
   * synchronous-ish (a microtask hop) and the SDK-wide
   * `request_timeout_ms` is enforced at the client wrapper.
   */
  async send<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts?: TransportSendOptions,
  ): Promise<ToolOutput<N>> {
    if (opts?.signal?.aborted) {
      // Canonical Web-standard abort error (C.5 — design.md §1 Q4).
      // `signal.reason` is honoured when set so consumer-provided abort
      // causes propagate; otherwise we fall back to the spec-defined
      // `DOMException('Aborted', 'AbortError')`.
      throw opts.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const result = await this.getServer().mcp.invokeTool(toolName, args);
    return result as ToolOutput<N>;
  }

  /**
   * Read an MCP resource by URI. Forwards verbatim to
   * `server.mcp.readResource(uri)`.
   *
   * The current `McpInterface.readResource(uri)` signature ignores the
   * caller-supplied `?since` / `?fields` query (FR-17). Phase D tightens
   * the resource layer (server + transport) to honour the query; until
   * then the `query` argument is dropped on the in-memory leg and every
   * read returns the full resource payload. The `opts.signal` slot is
   * accepted for shape compatibility but not yet propagated (C.5).
   */
  async readResource<U extends ResourceUri = ResourceUri>(
    uri: U,
    _query?: ResourceReadQuery,
    opts?: TransportReadResourceOptions,
  ): Promise<unknown> {
    if (opts?.signal?.aborted) {
      // Canonical Web-standard abort error (C.5 — design.md §1 Q4).
      throw opts.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return this.getServer().mcp.readResource(uri);
  }

  /**
   * Subscribe to a typed event stream. Forwards to
   * `server.events.subscribe(name, handler)`. The host returns the
   * unsubscribe callback verbatim. The bus emits payloads as `unknown`;
   * the cast to the catalog's `EventPayload<E>` shape mirrors the
   * server-side guarantee (handlers in `lib/handlers/**` publish
   * payloads validated against the same catalog schemas).
   */
  subscribe<E extends EventName>(
    eventName: E,
    handler: (payload: EventPayload<E>) => void,
  ): Unsubscribe {
    return this.getServer().events.subscribe(eventName, (payload) => {
      handler(payload as EventPayload<E>);
    });
  }

  /**
   * No-op disconnect. The transport does not own the server's lifecycle —
   * the embedding host (MeshCraft, integration tests) owns the server
   * and stops it independently. Resolves immediately so the SDK's outer
   * `dispose()` (design.md §3) can chain other teardown work.
   */
  async disconnect(): Promise<void> {
    // No-op: server lifecycle is the host's responsibility.
  }

  /**
   * In-memory transport is always healthy once constructed. The
   * transport doesn't observe the server's lifecycle; Phase G can layer
   * a `lifecycle.stopped` subscription on top to flip this to `false`
   * if a host needs that signal earlier.
   */
  isHealthy(): boolean {
    return true;
  }
}

/**
 * Factory mirror for callers that prefer functional construction over
 * `new InMemoryTransport(server)`. Returns the same instance shape; the
 * SDK's higher-level `createDiffuseCraftClient` (Phase B.6) routes
 * through this factory when `transport.kind === "in-memory"`.
 */
export function createInMemoryTransport(server: unknown): Transport {
  return new InMemoryTransport(server);
}
