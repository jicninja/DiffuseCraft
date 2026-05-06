/**
 * `Transport` interface — the uniform abstraction underpinning the SDK's three
 * concrete transports (HTTP, stdio, in-memory).
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.3 (FR-6 uniform `Transport`; FR-7 HTTP /
 *     Streamable; FR-8 stdio; FR-9 in-memory; FR-10 transparent selection).
 *   - `client-sdk` design.md §2 (module layout — `transports/transport.ts`),
 *     §4 (Transport interface — `connect`, `send`, `readResource`,
 *     `subscribe`, `sampling.register`, `disconnect`, `isHealthy`).
 *
 * This file is **interface-only** (Phase A.5). Concrete implementations land
 * in Phase B (`http.ts`, `stdio.ts`, `in-memory.ts`). No runtime dependency
 * on the `@modelcontextprotocol/sdk` package is introduced here — that
 * coupling is B.3's job.
 *
 * Method signatures are typed against the `ToolName` / `ToolInput` /
 * `ToolOutput` / `EventName` / `EventPayload` / `ResourceUri` aliases that
 * the SDK re-exports from `@diffusecraft/mcp-tools` (per A.4 / FR-3). Each
 * concrete transport conforms to this surface, so the higher-level client
 * (`DiffuseCraftClient`, Phase B) is transport-agnostic at the type level
 * (FR-10).
 */

import type {
  ToolName,
  ToolInput,
  ToolOutput,
  EventName,
  EventPayload,
  ResourceUri,
  ServerCapabilities,
} from "@diffusecraft/mcp-tools";

// ---------------------------------------------------------------------------
// Auxiliary types
// ---------------------------------------------------------------------------

/**
 * Cancel a previously registered subscription / handler. Idempotent: calling
 * it more than once is a no-op. Returned by `subscribe(...)` and
 * `sampling.register(...)`.
 */
export type Unsubscribe = () => void;

/**
 * Result of a successful MCP `initialize` exchange. The transport returns
 * this from `connect()` so the client can store the negotiated server
 * capabilities (design.md §3 — `capabilities.server`) and forward any
 * server-provided session metadata to consumers.
 *
 * Phase B will tighten this once the actual MCP SDK handshake response is
 * wired in (`@modelcontextprotocol/sdk`); for A.5 the shape captures the
 * minimum the client class needs after `connect()` resolves.
 */
export interface HandshakeResult {
  /** Server capabilities reported during MCP `initialize`. */
  serverCapabilities: ServerCapabilities;
  /** Server-reported protocol version string (per MCP `initialize`). */
  protocolVersion: string;
  /** Optional human-readable server name (e.g. `"DiffuseCraft Server"`). */
  serverName?: string;
}

/**
 * Optional per-call options accepted by `send()`. `signal` supports
 * client-side cancellation (Q4 — `AbortSignal` resolved YES per design §1);
 * `timeout_ms` overrides the SDK-wide `request_timeout_ms` for a single call
 * (FR-15).
 */
export interface TransportSendOptions {
  signal?: AbortSignal;
  timeout_ms?: number;
}

/**
 * Optional per-call options accepted by `readResource()`. Mirrors `send`'s
 * cancellation slot. Resource reads do not currently honour a per-call
 * timeout override; if that becomes necessary it is added here.
 */
export interface TransportReadResourceOptions {
  signal?: AbortSignal;
}

/**
 * Resource read query parameters (`?since`, `?fields`, `?cursor`) per FR-17 /
 * FR-18. Passed through verbatim by the transport; the server interprets them
 * per `mcp-tool-catalog` FR-39 / FR-46.
 *
 * `since` and `fields` are the FR-17 sparse / delta knobs. `cursor` is the
 * pagination knob that the SDK's `iterate(...)` async-iterable helpers
 * (D.3 — `client.resources.<ns>.iterate(...)`) thread through successive
 * pages — the server returns `next_cursor` on the response envelope and the
 * iterator forwards it as `?cursor=<...>` on the next call. The transport
 * itself does not interpret cursors; it only round-trips the value.
 */
export interface ResourceReadQuery {
  /** RFC-3339 / ISO timestamp; resource returns deltas after this point. */
  since?: string;
  /** Sparse-fieldset selector; resource projects only these fields. */
  fields?: string[];
  /**
   * Opaque pagination cursor. The first page omits this; subsequent pages
   * pass the `next_cursor` returned by the previous page. The
   * `iterate(...)` helpers in `resources/generated.ts` (D.3) own the
   * paging loop; consumer code rarely needs to set this directly.
   */
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Sampling — minimal placeholder shapes for the transport boundary
// ---------------------------------------------------------------------------

/**
 * Forward declaration of the consumer-facing sampling request shape. The
 * canonical definition (with `messages`, `model_preferences`, `kind`, etc.)
 * lives in `libs/diffusion-client/src/sampling/forwarder.ts` (design.md
 * §10.1) which is implemented in a later phase.
 *
 * The transport only needs to round-trip whatever payload the SDK marshals;
 * `unknown` is the most honest type at this layer. The `SamplingForwarder`
 * narrows it before invoking the consumer-supplied handler.
 */
export type TransportSamplingRequest = unknown;

/**
 * Forward declaration of the consumer-facing sampling response shape. See
 * note on `TransportSamplingRequest` above; design.md §10.1 owns the
 * canonical type.
 */
export type TransportSamplingResponse = unknown;

/**
 * Sampling-side handler the SDK registers with the transport. The transport
 * invokes it whenever the server initiates a sampling request over the
 * channel (design.md §10.2 step 4).
 */
export interface TransportSamplingHandler {
  (request: TransportSamplingRequest): Promise<TransportSamplingResponse>;
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

/**
 * Uniform transport surface implemented by `HttpTransport`, `StdioTransport`,
 * and `InMemoryTransport` (Phase B). The `DiffuseCraftClient` class depends
 * only on this interface; backend selection is therefore transparent at the
 * API layer (FR-10 / design.md §4).
 *
 * Method names mirror design.md §4 verbatim (`connect` / `disconnect` /
 * `isHealthy`). FR-6 spells the close hook as `close()`; the SDK's outer
 * `dispose()` in `DiffuseCraftClient` (design.md §3) calls `disconnect()`
 * here, so the FR-6 wording is satisfied at the public surface.
 */
export interface Transport {
  /**
   * Establish the transport connection and complete the MCP `initialize`
   * handshake. Resolves with the negotiated server capabilities (FR-32).
   * Throws `ConnectionError` on transport failure.
   */
  connect(): Promise<HandshakeResult>;

  /**
   * Invoke a catalog tool by name. The compiler infers the argument and
   * return shapes from the tool's Zod schemas via the `ToolInput<N>` /
   * `ToolOutput<N>` aliases (FR-12).
   *
   * `opts.signal` cancels in-flight requests (Q4 — design.md §1: pre-send
   * abort skips the request; post-send abort is the transport's
   * responsibility to cascade — typically by sending `cancel_job` for
   * job-shaped tools). `opts.timeout_ms` overrides the SDK default
   * (FR-15); on expiry the transport rejects with `RequestTimeoutError`.
   */
  send<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts?: TransportSendOptions,
  ): Promise<ToolOutput<N>>;

  /**
   * Read an MCP resource by URI. `query.since` / `query.fields` map to
   * FR-17 (sparse / delta reads). Returns the resource payload as
   * `unknown`; Phase D will tighten this to a discriminated union derived
   * from `ResourceUri` (the typed `TypedResourceReaders` surface in
   * design.md §3) so consumers do not cast at the call site.
   */
  readResource<U extends ResourceUri = ResourceUri>(
    uri: U,
    query?: ResourceReadQuery,
    opts?: TransportReadResourceOptions,
  ): Promise<unknown>;

  /**
   * Subscribe to a typed event stream (FR-19). Returns an `Unsubscribe`
   * callback. The buffered event bus (`events/bus.ts`, Phase B) layers
   * late-attach replay (FR-20) on top of this primitive.
   */
  subscribe<E extends EventName>(
    eventName: E,
    handler: (payload: EventPayload<E>) => void,
  ): Unsubscribe;

  /**
   * MCP sampling channel (design.md §10). The SDK's `SamplingForwarder`
   * registers a single handler per session; the transport forwards every
   * server-initiated sampling request to it. Returns an `Unsubscribe` to
   * tear the handler down (matches `SamplingForwarder.register` in §10.1).
   */
  sampling: {
    register(handler: TransportSamplingHandler): Unsubscribe;
  };

  /**
   * Tear down the transport. After this resolves, no further calls to
   * `send` / `readResource` / `subscribe` are valid; concrete
   * implementations reject in-flight calls with `ConnectionError`. Aliases
   * the FR-6 `close()` hook at the SDK boundary (the outer client's
   * `dispose()` invokes this).
   */
  disconnect(): Promise<void>;

  /**
   * Synchronous health probe used by reconnection orchestration
   * (`reconnect.ts`, design.md §8) and by the `getStatus()` projection on
   * the public client. `true` means the transport is connected and ready
   * to accept calls; `false` covers `disconnected`, `connecting`,
   * `reconnecting`, and `error` states.
   */
  isHealthy(): boolean;
}
