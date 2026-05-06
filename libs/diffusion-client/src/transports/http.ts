/**
 * HTTP transport (`client-sdk` FR-6, FR-7, FR-10, design.md §2 + §4).
 *
 * The HTTP transport speaks MCP over the Streamable HTTP profile defined by
 * the Model Context Protocol spec — HTTP `POST` for outbound JSON-RPC frames
 * and a long-lived Server-Sent-Events channel for the response stream and
 * server-initiated notifications. The SDK mirrors the stdio transport's
 * structure (B.2): the wire-protocol work is delegated to
 * `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport` + `Client`
 * pair (verified against
 * `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts`)
 * rather than reimplementing MCP framing.
 *
 * Differences from the stdio transport:
 *
 *   - **Authentication** (FR-7, FR-4 token slot, design.md Q4): the bearer
 *     token rides on the `Authorization` header of every HTTP request. The
 *     header is supplied via the SDK's `requestInit.headers` option; the
 *     SDK merges it onto each fetch (POST + GET-SSE + DELETE alike). The
 *     token may be a literal string or a `TokenProvider` (`() => string |
 *     Promise<string>`); when a provider is supplied we resolve it once
 *     during `connect()` and cache the resolved string for the lifetime of
 *     the connection. Refresh-on-401 lands in K.3.
 *
 *   - **Long-lived event channel** (FR-7): the SDK manages SSE
 *     (re)connection internally — opening the GET-SSE stream after the
 *     `initialize` handshake completes, replaying via `Last-Event-ID`
 *     headers on its own internal reconnect timer, etc. SDK-level
 *     reconnection options exist (`maxRetries`, backoff factors) but are
 *     left at SDK defaults here; the higher-level orchestration (FR-29 /
 *     FR-30 / FR-31, design.md §8 — handshake re-issue, event re-emission,
 *     status-error transition) lives in `transports/reconnect.ts` (Phase
 *     B.4) and wraps this transport.
 *
 *   - **No child process**: unlike stdio, there is nothing to SIGTERM. The
 *     5 s grace timer in `disconnect()` covers any in-flight HTTP requests
 *     the SDK may still be unwinding (it aborts them via its internal
 *     `AbortController` on `close()`).
 *
 * Lifecycle:
 *
 *   - `connect()` resolves the bearer token, instantiates
 *     `StreamableHTTPClientTransport(new URL(url), { requestInit })`,
 *     constructs `new Client(...)`, calls `client.connect(transport)` (which
 *     POSTs the MCP `initialize` exchange and opens the SSE stream), and
 *     returns a {@link HandshakeResult} populated from the SDK-reported
 *     server identity. The DiffuseCraft domain-level `ServerCapabilities`
 *     are stubbed identically to B.1/B.2 — Phase G replaces the placeholder
 *     by reading `diffusecraft://server/info`.
 *
 *   - `disconnect()` calls `client.close()`. The SDK aborts in-flight
 *     fetches via its internal `AbortController` and tears down the SSE
 *     reader; we wrap the close promise in a 5 s grace timer that surfaces
 *     a `logger.warn` if the close has not resolved by then.
 *
 *   - `isHealthy()` flips on after a successful `connect()` and flips off
 *     on `disconnect()` or on the SDK transport's `onclose` callback (i.e.
 *     when the server tears down the SSE stream / session).
 *
 *   - `send()` calls `client.callTool({ name, arguments }, undefined,
 *     { timeout })`. {@link McpError} responses are wrapped as
 *     {@link ServerError}. Pre-aborted `signal`s short-circuit before
 *     calling the SDK; mid-flight cancellation cascade lands in C.5.
 *
 *   - `readResource()` calls `client.readResource({ uri })`. `?since` /
 *     `?fields` are appended to the URI string via {@link appendResourceQuery}
 *     (shared with stdio) so FR-17 is honoured at the transport boundary.
 *
 *   - `subscribe()` is NOT yet wired to MCP notifications. The DiffuseCraft
 *     server publishes domain events to its in-process `EventBus` only — the
 *     same upstream gap noted in `transports/stdio.ts`. Throwing
 *     {@link ConnectionError} is the honest signal until `server-architecture`
 *     ships notification publication.
 *
 *   - `sampling.register()` registers an MCP request handler for
 *     `sampling/createMessage` via `client.setRequestHandler` (same as
 *     stdio).
 *
 * The MCP SDK is declared as a peer dependency
 * (`libs/diffusion-client/package.json`); this file imports types and
 * runtime values from the published entry points. Consumers that pick the
 * HTTP transport must have `@modelcontextprotocol/sdk` installed in their
 * workspace. Unlike stdio, the HTTP transport has NO Node-only dependency
 * (it uses `fetch` + `URL`, both available in browsers) — so this module
 * is safe to import from any runtime that ships those globals.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CreateMessageRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  EventName,
  EventPayload,
  ResourceUri,
  ToolInput,
  ToolName,
  ToolOutput,
} from "@diffusecraft/mcp-tools";

import type { TokenProvider } from "../config.js";
import { ConnectionError, ServerError } from "../errors.js";
import { appendResourceQuery } from "./_query.js";
import {
  RECONNECT_FAILED_CAUSE,
  Reconnector,
  reconnectFailedError,
  type ReconnectConfig,
  type ReconnectStatus,
} from "./reconnect.js";
import type {
  HandshakeResult,
  ResourceReadQuery,
  Transport,
  TransportReadResourceOptions,
  TransportSamplingHandler,
  TransportSendOptions,
  Unsubscribe,
} from "./transport.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Constructor configuration for {@link HttpTransport}. Mirrors the
 * `transport.kind === "http"` slot in `ClientConfigSchema` (`config.ts`)
 * plus a few low-level overrides exposed for advanced consumers (custom
 * `fetch`, extra headers). The MCP SDK's `StreamableHTTPClientTransportOptions`
 * carries more fields (`authProvider`, `sessionId`, `reconnectionOptions`);
 * those are intentionally NOT exposed at the SDK boundary in v1 — pairing
 * tokens are simple bearer tokens (no OAuth), session resumption is the
 * SDK's responsibility, and the higher-level reconnector orchestration
 * lives in B.4.
 */
export interface HttpTransportConfig {
  /**
   * Server endpoint, e.g. `"https://server.example.com/mcp"` or the LAN
   * pairing URL emitted by the server's QR code. Parsed via `new URL(url)`
   * before being handed to the SDK; relative URLs are rejected by the
   * `URL` constructor.
   */
  url: string;
  /**
   * Bearer token. May be a literal string OR a {@link TokenProvider}
   * function returning a string (sync or async). When a provider is
   * supplied, it is invoked once during `connect()` and cached for the
   * lifetime of the connection (FR-27 — the ~5 minute cache is enforced
   * at the consumer layer; the transport keeps its resolved value until
   * the next `disconnect()`/`connect()` cycle). Per-request refresh on
   * 401 is K.3.
   */
  token: string | TokenProvider;
  /**
   * Default per-request timeout, in milliseconds. Forwarded to
   * `client.callTool` / `client.readResource` when the per-call options
   * do not override it. Defaults to 30 000 ms when omitted (mirrors the
   * top-level `request_timeout_ms` default in `config.ts`).
   */
  request_timeout_ms?: number;
  /**
   * Optional client identity advertised in the MCP `initialize` request.
   * Defaults to `{ name: "diffusecraft-client", version: "0.0.0" }`.
   */
  clientInfo?: { name: string; version: string };
  /**
   * Maximum wall-clock grace, in milliseconds, that {@link disconnect} will
   * wait for the SDK's `client.close()` to resolve before logging a
   * warning. Defaults to 5 000 ms per spec ("5 s grace timer").
   */
  disconnect_grace_ms?: number;
  /**
   * Extra request headers merged onto every HTTP request. The transport
   * always sets `Authorization: Bearer <token>`; consumer-supplied
   * headers may NOT override the `Authorization` slot (the transport
   * filters it on merge so a malformed override cannot leak the bearer
   * token to a malformed scheme). All other headers (e.g. tracing
   * headers) are passed through verbatim.
   */
  headers?: Record<string, string>;
  /**
   * Custom `fetch` implementation. Defaults to the runtime's global
   * `fetch` (Node 18+ / browser). Forwarded to the SDK transport's
   * `fetch` option.
   */
  fetch?: typeof fetch;
  /**
   * Reconnect policy (FR-29 / FR-30 / FR-31, design.md §8). When the
   * SDK's `StreamableHTTPClientTransport` fires `onclose` while the
   * wrapper is still in the `connected === true` state (i.e. the close
   * was unsolicited), the transport runs the configured backoff loop —
   * implemented in `reconnect.ts` — to rebuild the SDK client, re-issue
   * the handshake, re-install the sampling handler, and replay
   * in-flight `send()` calls.
   *
   * Defaults (when omitted): enabled, `max_attempts: 5`, `backoff_ms:
   * [500, 1000, 2000, 4000, 8000]` — same as `ReconnectConfigSchema` in
   * `config.ts`. Set `enabled: false` to disable reconnect entirely;
   * unsolicited closes then propagate `ConnectionError` to pending
   * callers immediately.
   */
  reconnect?: Partial<ReconnectConfig>;
}

/**
 * Default reconnect policy applied when `HttpTransportConfig.reconnect`
 * is omitted or partially specified. Mirrors `ReconnectConfigSchema` in
 * `config.ts` so the transport-level default matches the
 * `ClientConfig`-level default exactly.
 */
const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  max_attempts: 5,
  backoff_ms: [500, 1000, 2000, 4000, 8000],
};

// ---------------------------------------------------------------------------
// Stub logger
// ---------------------------------------------------------------------------

/**
 * Minimal logger surface used for the disconnect-grace warning. Mirrors
 * the {@link import("./stdio.js").StdioTransport} logger slot — Phase B.6
 * threads the SDK-wide `Logger` through.
 */
interface WarnLogger {
  warn(obj: unknown, msg?: string): void;
}

const NOOP_LOGGER: WarnLogger = {
  warn() {
    // no-op
  },
};

// ---------------------------------------------------------------------------
// HttpTransport
// ---------------------------------------------------------------------------

/**
 * Concrete {@link Transport} that talks to a DiffuseCraft server over the
 * MCP Streamable HTTP profile. Wraps `@modelcontextprotocol/sdk`'s
 * `Client` + `StreamableHTTPClientTransport` pair so MCP framing, the
 * `initialize` handshake, and SSE-stream management are reused verbatim
 * (FR-7). All catalog-typed surface is preserved (FR-10).
 *
 * Reconnect orchestration (FR-29 / FR-30 / FR-31, design.md §8) is wired
 * here using the {@link Reconnector} loop driver from `reconnect.ts`. The
 * SDK's own internal SSE-reconnect timer is still active (it transparently
 * replays missed events via `Last-Event-ID` while the SSE stream is
 * recoverable); this layer sits ABOVE that and orchestrates the full
 * higher-level recovery — re-construct the SDK transport + `Client`,
 * re-resolve the bearer token (the `TokenProvider` may have rotated it
 * between attempts), re-issue the `initialize` handshake, re-install the
 * sampling request handler, replay in-flight `send()` calls (bounded to
 * one retry per request to avoid duplicate side-effects on `job` tools),
 * and emit `reconnecting` → `connected` | `failed` connection-status
 * transitions for consumer surfaces.
 */
export class HttpTransport implements Transport {
  /**
   * The MCP SDK client wrapper. Constructed lazily inside `connect()` so
   * the transport can be instantiated without immediately opening a
   * network connection (matches the in-memory and stdio transports).
   */
  private client: Client | null = null;

  /**
   * The underlying `StreamableHTTPClientTransport` reference. Held so
   * `disconnect()` can fall through to the SDK transport directly if
   * needed and so future reconnect orchestration (B.4) can poke at SDK
   * internals without re-constructing the wrapper.
   */
  private sdkTransport: StreamableHTTPClientTransport | null = null;

  /**
   * Connection state. Flipped to `true` after a successful `connect()`,
   * back to `false` on `disconnect()` or on the SDK transport's
   * `onclose` callback (server tore down the session).
   */
  private connected = false;

  /**
   * Cached resolved bearer token. Set during `connect()` from either the
   * literal-string config or the `TokenProvider` invocation, and cleared
   * on `disconnect()`. Refresh-on-401 lands in K.3.
   */
  private resolvedToken: string | null = null;

  /**
   * Sampling handler registered via {@link sampling.register}. Same
   * single-slot semantics as the stdio transport — design.md §10.2 — so
   * the SDK only ever forwards to one consumer.
   */
  private samplingHandler: TransportSamplingHandler | null = null;

  /**
   * Sampling namespace shape required by the {@link Transport} interface.
   * Bound in the constructor so `this` is captured for the closure that
   * actually wires the MCP request handler.
   */
  public readonly sampling: {
    register(handler: TransportSamplingHandler): Unsubscribe;
  };

  /** Logger used for the disconnect-grace warning (defaults to no-op). */
  private readonly logger: WarnLogger;

  /**
   * Effective reconnect policy. Resolved in the constructor by overlaying
   * `config.reconnect` (when supplied) onto {@link DEFAULT_RECONNECT_CONFIG}.
   * Held as a frozen reference so the reconnect loop reads a stable value
   * even if the caller mutates the config object after construction.
   */
  private readonly reconnectConfig: ReconnectConfig;

  /**
   * Set in `disconnect()` for the duration of the user-initiated tear-down.
   * Read by the SDK transport's `onclose` callback to distinguish the
   * "user asked to disconnect" path (no reconnect) from the "server tore
   * down the session unexpectedly" path (run reconnect). Cleared after
   * `disconnect()` resolves so a subsequent `connect()` starts fresh.
   */
  private userInitiatedClose = false;

  /**
   * Terminal failure flag. Set by the reconnect loop's `onFatal` after
   * `max_attempts` is exhausted (or when `reconnect.enabled === false`).
   * Once set, every future `send()` / `readResource()` call rejects with
   * the stored {@link reconnectError} immediately rather than touching the
   * SDK. Cleared by a fresh `connect()` (the consumer can re-initialise
   * the transport explicitly after a fatal reconnect failure).
   */
  private failed = false;

  /**
   * Reconnect-failed `ConnectionError` (`cause: "reconnect-failed"`,
   * `transport_kind: "http"`). Built once by the reconnect loop and
   * reused for every pending request rejection AND every post-failure
   * call rejection — so callers get a stable error reference and a
   * consistent stack.
   */
  private reconnectError: ConnectionError | null = null;

  /**
   * Active reconnect orchestration. `null` outside reconnect windows.
   * Held so `disconnect()` can call `stop()` if the user tears the
   * transport down mid-reconnect.
   */
  private activeReconnector: Reconnector | null = null;

  /**
   * Promise resolved when the in-flight reconnect attempt finishes.
   * Used by `send()` / `readResource()` so calls that arrive while a
   * reconnect is running queue up rather than failing fast — and so the
   * Phase B.6 logger can `await` the loop for diagnostics.
   */
  private reconnectingPromise: Promise<void> | null = null;

  /**
   * In-flight `send()` calls. Each entry holds the controls needed to
   * replay the request on the new client after reconnect — the tool
   * name, the original args, the per-call options, and the
   * resolve/reject pair of the outer promise. The `attempts` counter
   * caps replay at one retry per request (FR-29 — "in-flight requests
   * are queued"; the spec mandates at-most-one retry to avoid
   * duplicate side-effects on `job` tools).
   *
   * Indexed by an opaque numeric id minted on every `send()` so the
   * map can hold multiple concurrent calls without `args` collisions.
   */
  private pendingSends = new Map<number, PendingSend>();

  /** Monotonic id source for `pendingSends`. */
  private nextSendId = 1;

  /**
   * Connection-status listeners (FR-21 / FR-31). Phase B.6's
   * `DiffuseCraftClient.events.onConnectionStatus(...)` registers here
   * so consumers see `reconnecting` / `connected` / `failed`
   * transitions emitted by the loop. Kept as a `Set` so `register` /
   * `unregister` is O(1) and order-insensitive.
   */
  private statusListeners = new Set<(status: ReconnectStatus) => void>();

  constructor(
    private readonly config: HttpTransportConfig,
    logger?: WarnLogger,
  ) {
    this.logger = logger ?? NOOP_LOGGER;
    this.reconnectConfig = resolveReconnectConfig(config.reconnect);
    this.sampling = {
      register: (handler: TransportSamplingHandler): Unsubscribe => {
        this.samplingHandler = handler;
        // If we've already connected, attach the request handler now.
        // Otherwise `connect()` will install it after handshake.
        if (this.client) {
          this.installSamplingHandler(this.client);
        }
        return () => {
          if (this.samplingHandler === handler) {
            this.samplingHandler = null;
            // Replace with the no-handler stub (matches stdio
            // semantics — design.md §10.4 `SAMPLING_NOT_SUPPORTED`).
            if (this.client) {
              this.installSamplingHandler(this.client);
            }
          }
        };
      },
    };
  }

  /**
   * Resolve the bearer token and open the HTTP/SSE connection. The MCP
   * SDK's `Client.connect(transport)` performs the `initialize` exchange
   * over POST and starts the SSE response stream in one call. Throws
   * {@link ConnectionError} on URL parse, token resolution, or handshake
   * failure.
   *
   * Returns a placeholder {@link HandshakeResult}: the standard MCP
   * `initialize` response only carries `protocolVersion` + `serverInfo`
   * + MCP-level `capabilities`, NOT the DiffuseCraft domain-level shape.
   * Phase G reads those from `diffusecraft://server/info` after the
   * resource catalog ships and replaces this stub.
   */
  async connect(): Promise<HandshakeResult> {
    if (this.connected) {
      throw new ConnectionError("http transport already connected", {
        transport_kind: "http",
      });
    }

    // A fresh `connect()` clears any prior terminal-failure state. The
    // reconnect loop only ever sets `failed = true` after exhausting all
    // attempts, and the spec contract is "future `send()` calls reject
    // immediately with the same error" — but a deliberate, externally-
    // driven re-`connect()` is the consumer signalling intent to reset.
    this.failed = false;
    this.reconnectError = null;
    this.userInitiatedClose = false;

    // 1) Parse the URL up front — `new URL(...)` throws on malformed
    //    input; we surface that as `ConnectionError` rather than letting
    //    the raw `TypeError` escape (consumers do `instanceof
    //    ConnectionError` per the errors.ts taxonomy).
    let url: URL;
    try {
      url = new URL(this.config.url);
    } catch (err) {
      throw new ConnectionError(
        `http transport: invalid url '${this.config.url}'`,
        { transport_kind: "http", cause: err },
      );
    }

    // 2) Resolve the bearer token. Literal strings are used verbatim;
    //    `TokenProvider` functions are invoked once and the result is
    //    cached on the instance for the lifetime of the connection.
    let token: string;
    try {
      token = await resolveToken(this.config.token);
    } catch (err) {
      throw new ConnectionError(
        `http transport: token resolution failed (${err instanceof Error ? err.message : String(err)})`,
        { transport_kind: "http", cause: err },
      );
    }
    if (token.length === 0) {
      throw new ConnectionError("http transport: token resolved to empty string", {
        transport_kind: "http",
      });
    }
    this.resolvedToken = token;

    // 3) Build the MCP-side request init. The SDK merges this onto
    //    every fetch it issues (POST, GET-SSE, DELETE on session
    //    teardown), so the bearer token is attached to all of them.
    //    Consumer-supplied headers are merged in BUT may not override
    //    the `Authorization` slot — the transport always wins for the
    //    bearer (a malformed override would either drop auth entirely
    //    or expose the token under a different scheme).
    const headers: Record<string, string> = {};
    if (this.config.headers) {
      for (const [name, value] of Object.entries(this.config.headers)) {
        if (name.toLowerCase() === "authorization") continue;
        headers[name] = value;
      }
    }
    headers["Authorization"] = `Bearer ${token}`;

    const sdkTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      ...(this.config.fetch !== undefined ? { fetch: this.config.fetch } : {}),
    });

    const clientInfo = this.config.clientInfo ?? {
      name: "diffusecraft-client",
      version: "0.0.0",
    };
    const client = new Client(clientInfo, { capabilities: {} });

    // Wire the unexpected-close path so `isHealthy()` reflects truth
    // when the server tears down the session without our `disconnect()`
    // driving it. The SDK invokes `onclose` after its own internal
    // teardown completes.
    //
    // When the close was unsolicited AND reconnect is enabled, kick the
    // {@link Reconnector} loop. When it was user-initiated (the
    // `disconnect()` path sets `userInitiatedClose = true` before
    // calling `client.close()`), do nothing — the higher-level path
    // handles the tear-down.
    sdkTransport.onclose = () => {
      this.connected = false;
      if (this.userInitiatedClose) return;
      // Fire-and-forget: the reconnect loop runs asynchronously and
      // updates `pendingSends` / `failed` / `reconnectError` as it
      // goes. Errors thrown synchronously from `triggerReconnect` are
      // already surfaced by the loop's `onFatal` path — there is no
      // additional handling needed here.
      void this.triggerReconnect();
    };

    try {
      await client.connect(sdkTransport);
    } catch (err) {
      // Best-effort cleanup; the SDK will already have torn its own
      // state down on connect failure but we ensure no SSE reader is
      // left dangling.
      try {
        await sdkTransport.close();
      } catch {
        // The original error is the one that matters.
      }
      this.resolvedToken = null;
      throw new ConnectionError(
        `http transport: connect failed (${err instanceof Error ? err.message : String(err)})`,
        { transport_kind: "http", cause: err },
      );
    }

    this.client = client;
    this.sdkTransport = sdkTransport;
    this.connected = true;

    // Attach the sampling request handler if the consumer registered
    // one before we connected.
    this.installSamplingHandler(client);

    // Snapshot the SDK-reported server identity. Same placeholder
    // shape as stdio (B.2) — Phase G replaces with real values from
    // `diffusecraft://server/info`.
    const protocolVersion = sdkTransport.protocolVersion ?? "unknown";
    const serverVersion = client.getServerVersion();
    const serverName = serverVersion?.name;

    return {
      serverCapabilities: {
        catalog_version_range: ["0", "0"],
        comfyui_status: "unknown",
        supported_workspaces: [],
        sampling_supported: false,
        audit_log_enabled: false,
      },
      protocolVersion,
      ...(serverName !== undefined ? { serverName } : {}),
    };
  }

  /**
   * Invoke a catalog tool. Wraps `client.callTool({ name, arguments })`
   * and converts {@link McpError} responses to {@link ServerError}.
   *
   * The MCP SDK's `callTool` accepts a `RequestOptions.timeout`; we
   * honour `opts.timeout_ms` first and fall back to
   * `config.request_timeout_ms`. Pre-aborted signals throw
   * `Error("aborted")` — Phase C.5 replaces this with the canonical
   * abort error shape and adds mid-flight cancellation cascade.
   */
  async send<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts?: TransportSendOptions,
  ): Promise<ToolOutput<N>> {
    if (opts?.signal?.aborted) {
      throw new Error("aborted");
    }

    // Reconnect-failure terminal state — every future call rejects with
    // the same `ConnectionError` until the consumer explicitly
    // re-`connect()`s.
    if (this.failed) {
      throw this.reconnectError ?? reconnectFailedError("transport failed");
    }

    // If a reconnect is currently in flight, queue this call: track it
    // in `pendingSends` and wait for the reconnect to resolve before
    // attempting the SDK call. The reconnect loop's success path
    // replays every entry in `pendingSends`; the failure path rejects
    // every entry.
    if (this.reconnectingPromise) {
      return this.queueDuringReconnect(toolName, args, opts);
    }

    return this.dispatchSend(toolName, args, opts, /* attemptCount */ 0);
  }

  /**
   * Read an MCP resource by URI. `query.since` / `query.fields` are
   * appended via the shared {@link appendResourceQuery} helper (FR-17).
   * The MCP SDK does not type the resource payload; we return `unknown`
   * here and tighten in Phase D.
   */
  async readResource<U extends ResourceUri = ResourceUri>(
    uri: U,
    query?: ResourceReadQuery,
    opts?: TransportReadResourceOptions,
  ): Promise<unknown> {
    if (opts?.signal?.aborted) {
      throw new Error("aborted");
    }

    // Reconnect-failure terminal state mirrors `send()`.
    if (this.failed) {
      throw this.reconnectError ?? reconnectFailedError("transport failed");
    }

    // Resource reads aren't tracked in `pendingSends` (no side effects
    // to deduplicate, no replay budget needed). When a reconnect is in
    // flight, await it and dispatch on the new client. Pre-aborted
    // signal is checked again post-await in case the consumer aborted
    // while we waited.
    if (this.reconnectingPromise) {
      try {
        await this.reconnectingPromise;
      } catch {
        // Loop reports failure via `failed` / `reconnectError`; fall
        // through to the gate below.
      }
      if (opts?.signal?.aborted) {
        throw new Error("aborted");
      }
      if (this.failed) {
        throw this.reconnectError ?? reconnectFailedError("transport failed");
      }
    }

    const client = this.requireClient();
    const finalUri = appendResourceQuery(uri, query);
    try {
      const result = await client.readResource({ uri: finalUri });
      return result;
    } catch (err) {
      throw this.wrapMcpError(err, undefined);
    }
  }

  /**
   * Subscribe to a typed event stream. **Not yet implemented over MCP
   * HTTP**: although the SDK's SSE channel is fully wired and would
   * carry `notifications/<eventName>` messages from the server, the
   * DiffuseCraft server publishes domain events to its in-process
   * `EventBus` only — there is currently no path that converts those
   * events into MCP notifications on the wire. Throwing
   * {@link ConnectionError} is the honest signal — silently returning a
   * fake unsubscribe would let consumers wait forever for events that
   * never arrive.
   *
   * The unblocker is upstream in `server-architecture` (or whichever
   * spec owns server-side MCP notification publication). Once the
   * server emits notifications, this implementation switches to
   * `client.setNotificationHandler(notificationSchema, ...)` keyed on
   * `notifications/<eventName>`.
   */
  subscribe<E extends EventName>(
    _eventName: E,
    _handler: (payload: EventPayload<E>) => void,
  ): Unsubscribe {
    throw new ConnectionError(
      "Event subscription over http not implemented yet — the DiffuseCraft server " +
        "publishes events only to in-memory subscribers; MCP-side notification " +
        "publication is an upstream gap tracked by the server-architecture spec.",
      { transport_kind: "http" },
    );
  }

  /**
   * Tear down the transport. Calls `client.close()` (which aborts any
   * in-flight HTTP fetches via the SDK's internal `AbortController` and
   * tears down the SSE reader). Wrapped in a 5 s grace timer that
   * surfaces a `logger.warn` if the close has not resolved by then.
   *
   * No SIGTERM cascade is relevant here (no child process); the grace
   * window simply gives any in-flight `fetch()` calls a chance to unwind
   * cleanly before we log.
   */
  async disconnect(): Promise<void> {
    // Mark the close as user-initiated up front so the SDK's `onclose`
    // callback (which fires from inside `client.close()`) does NOT
    // trigger the reconnect loop.
    this.userInitiatedClose = true;

    // Cancel any in-flight reconnect attempt. `stop()` is idempotent and
    // safe even when the loop has already resolved. It does NOT reject
    // the queued `pendingSends`; we do that below so all paths converge
    // on the same rejection.
    if (this.activeReconnector) {
      this.activeReconnector.stop();
      this.activeReconnector = null;
    }
    this.reconnectingPromise = null;

    // Reject any requests queued during a reconnect. From the consumer's
    // perspective, calling `disconnect()` is an unconditional abandon —
    // pending calls cannot resume against a transport that is being torn
    // down on purpose.
    if (this.pendingSends.size > 0) {
      const err = new ConnectionError(
        "http transport: disconnect() called while requests pending",
        { transport_kind: "http" },
      );
      for (const pending of this.pendingSends.values()) {
        pending.reject(err);
      }
      this.pendingSends.clear();
    }

    const client = this.client;
    if (!client || !this.connected) {
      this.connected = false;
      this.resolvedToken = null;
      this.statusListeners.clear();
      this.userInitiatedClose = false;
      return;
    }

    this.connected = false;

    const grace = this.config.disconnect_grace_ms ?? 5_000;
    const closePromise = client.close().catch((err: unknown) => {
      this.logger.warn(
        { err, transport: "http" },
        "http transport: client.close() rejected",
      );
    });

    let warned = false;
    const warnTimer = setTimeout(() => {
      warned = true;
      this.logger.warn(
        { grace_ms: grace, transport: "http" },
        "http transport: client.close() did not resolve within grace window after disconnect()",
      );
    }, grace);
    if (typeof (warnTimer as { unref?: () => void }).unref === "function") {
      (warnTimer as { unref: () => void }).unref();
    }

    try {
      await closePromise;
    } finally {
      clearTimeout(warnTimer);
      void warned;
      this.client = null;
      this.sdkTransport = null;
      this.samplingHandler = null;
      this.resolvedToken = null;
      this.statusListeners.clear();
      this.userInitiatedClose = false;
    }
  }

  /**
   * Synchronous health probe. `true` between a successful `connect()`
   * and the next `disconnect()` / unexpected SSE teardown. The SDK
   * transport's `onclose` callback flips this to `false` for the
   * unexpected-close case.
   */
  isHealthy(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Resolve the MCP `Client` reference, throwing {@link ConnectionError}
   * when called pre-`connect()` or post-`disconnect()`. Centralises the
   * not-connected guard so each public method stays focused on its own
   * call.
   */
  private requireClient(): Client {
    if (this.failed) {
      throw this.reconnectError ?? reconnectFailedError("transport failed");
    }
    if (!this.client || !this.connected) {
      throw new ConnectionError(
        "http transport: not connected — call connect() before send/readResource/subscribe",
        { transport_kind: "http" },
      );
    }
    return this.client;
  }

  /**
   * Install (or re-install) the MCP request handler for
   * `sampling/createMessage`. When a consumer handler is registered we
   * forward the params verbatim; when none is registered we install a
   * stub that throws so the server sees a clean MCP error rather than
   * a hang.
   */
  private installSamplingHandler(client: Client): void {
    const handler = this.samplingHandler;
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      if (!handler) {
        throw new McpError(
          -32601,
          "Sampling handler not registered on this client",
        );
      }
      const response = await handler(request.params);
      return response as never;
    });
  }

  /**
   * Convert an SDK-thrown error into the SDK's typed
   * {@link ServerError}. Rethrows non-MCP errors verbatim so the caller
   * sees the original (e.g. transport-level network errors keep their
   * stack).
   */
  private wrapMcpError(err: unknown, toolName: string | undefined): unknown {
    if (err instanceof McpError) {
      return new ServerError(
        toolName !== undefined
          ? `http transport: tool '${toolName}' failed: ${err.message}`
          : `http transport: ${err.message}`,
        {
          mcp_error_code: err.code,
          details: err.data,
          cause: err,
        },
      );
    }
    return err;
  }

  // -------------------------------------------------------------------
  // Reconnect orchestration
  // -------------------------------------------------------------------

  /**
   * Register a connection-status listener (FR-21 / FR-31). Called by
   * Phase B.6's `DiffuseCraftClient.events.onConnectionStatus(...)`.
   * The transport emits `reconnecting` once when the loop starts, then
   * either `connected` (successful reconnect) or `failed` (max attempts
   * exhausted) when the loop terminates.
   *
   * Returns an `Unsubscribe` callback. Calling it after the transport
   * has been disposed is a no-op (the set is cleared in
   * `disconnect()`).
   */
  onConnectionStatus(handler: (status: ReconnectStatus) => void): Unsubscribe {
    this.statusListeners.add(handler);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  /**
   * Dispatch a single `send()` against the current SDK client. Wraps
   * the SDK's `callTool` with the same {@link ServerError} translation
   * as the public `send()` plus the in-flight tracking that makes
   * reconnect-time replay possible.
   *
   * `attemptCount` is the number of times THIS request has already
   * been attempted across reconnects. Capped at 1 retry per request
   * (FR-29) — a `send()` that disconnects mid-call gets ONE replay on
   * the new client; a second mid-call disconnect rejects the call so
   * job-shaped tools never see a third execution.
   */
  private async dispatchSend<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts: TransportSendOptions | undefined,
    attemptCount: number,
  ): Promise<ToolOutput<N>> {
    if (this.failed) {
      throw this.reconnectError ?? reconnectFailedError("transport failed");
    }
    const client = this.requireClient();
    const timeout = opts?.timeout_ms ?? this.config.request_timeout_ms;

    const id = this.nextSendId++;
    // Track the in-flight call so a mid-call disconnect can resume it.
    // We hold the original args + opts (NOT the AbortSignal — the
    // signal's controller is owned by the caller and stays attached
    // across replays) and a resolve/reject pair that the replay path
    // settles instead of the original `callTool` await.
    let outerResolve!: (value: ToolOutput<N>) => void;
    let outerReject!: (err: unknown) => void;
    const outer = new Promise<ToolOutput<N>>((resolve, reject) => {
      outerResolve = resolve;
      outerReject = reject;
    });
    const pending: PendingSend = {
      toolName,
      args: args as Record<string, unknown>,
      opts,
      attempts: attemptCount + 1,
      resolve: outerResolve as (value: unknown) => void,
      reject: outerReject,
    };
    this.pendingSends.set(id, pending);

    // Fire the SDK call; settle `outer` from its resolution path. We
    // intentionally do NOT `await` here — the disconnect-during-send
    // window needs `outer` to remain pending so the reconnect loop
    // can decide whether to replay.
    client
      .callTool(
        { name: toolName, arguments: args as Record<string, unknown> },
        undefined,
        timeout !== undefined ? { timeout } : undefined,
      )
      .then(
        (result) => {
          if (this.pendingSends.get(id) !== pending) {
            // The reconnect loop has already taken ownership of this
            // request (via `replayPending`). Drop the result silently
            // — the replay path will resolve `outer`.
            return;
          }
          this.pendingSends.delete(id);
          outerResolve(result as unknown as ToolOutput<N>);
        },
        (err) => {
          if (this.pendingSends.get(id) !== pending) {
            // Same as above — the reconnect loop owns the entry.
            return;
          }
          // If the SDK call failed because the connection dropped
          // (i.e. the SDK transport's `onclose` fired and our
          // reconnect loop is now running), do NOT settle `outer`
          // yet: the reconnect loop will replay (or reject) it.
          if (this.reconnectingPromise && pending.attempts <= 2) {
            // Bump the attempt counter so the loop's replay caps
            // total executions at 2 (original + one retry).
            return;
          }
          this.pendingSends.delete(id);
          outerReject(this.wrapMcpError(err, toolName));
        },
      );

    return outer;
  }

  /**
   * Queue a `send()` call that arrived while a reconnect was already
   * in flight. The call's promise stays pending until the reconnect
   * loop terminates: on success the entry is replayed against the new
   * client; on failure it is rejected with the reconnect-failed
   * error.
   */
  private queueDuringReconnect<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts: TransportSendOptions | undefined,
  ): Promise<ToolOutput<N>> {
    return new Promise<ToolOutput<N>>((resolve, reject) => {
      const id = this.nextSendId++;
      const pending: PendingSend = {
        toolName,
        args: args as Record<string, unknown>,
        opts,
        // attempts=0 here means "never tried on the wire yet"; the
        // replay path will run a real attempt and increment.
        attempts: 0,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.pendingSends.set(id, pending);
    });
  }

  /**
   * Kick off the reconnect loop after an unsolicited disconnect. Idempotent
   * across overlapping `onclose` invocations — the second caller sees
   * `reconnectingPromise` already set and returns immediately.
   *
   * The supplied `reconnect` closure (`rebuildClient`) re-resolves the
   * bearer token, re-constructs `StreamableHTTPClientTransport` +
   * `Client`, re-issues the `initialize` handshake, re-installs the
   * sampling request handler, and flips `connected` back to `true` —
   * matching the original `connect()` invariants. The Reconnector
   * observes only success / failure; on success we replay every entry
   * in `pendingSends` against the new client.
   */
  private async triggerReconnect(): Promise<void> {
    if (this.userInitiatedClose) return;
    if (this.reconnectingPromise) return;
    if (this.failed) return;

    const reconnector = new Reconnector({
      config: this.reconnectConfig,
      reconnect: () => this.rebuildClient(),
      onStatusChange: (status) => {
        for (const listener of this.statusListeners) {
          try {
            listener(status);
          } catch (err) {
            // Listener errors must not break the loop.
            this.logger.warn(
              { err, transport: "http" },
              "http transport: connection-status listener threw",
            );
          }
        }
      },
      onFatal: (err) => {
        // The loop has given up. Mark terminal failure, store the
        // canonical error reference, and reject every queued request.
        this.failed = true;
        this.reconnectError =
          err instanceof ConnectionError ? err : reconnectFailedError("loop reported fatal");
        const failure = this.reconnectError;
        for (const pending of this.pendingSends.values()) {
          pending.reject(failure);
        }
        this.pendingSends.clear();
      },
    });

    this.activeReconnector = reconnector;
    let resolveDone!: () => void;
    this.reconnectingPromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    try {
      const outcome = await reconnector.start();
      if (outcome === "connected") {
        await this.replayPending();
      }
      // `failed` and `cancelled` outcomes have already settled
      // `pendingSends` via `onFatal` / `disconnect()` respectively;
      // nothing else to do here.
    } finally {
      this.activeReconnector = null;
      this.reconnectingPromise = null;
      resolveDone();
    }
  }

  /**
   * Re-resolve the bearer token, re-construct the SDK transport +
   * client, re-issue the handshake, and re-install the sampling
   * handler. Throws on any step's failure — the {@link Reconnector}
   * loop catches and retries per the configured backoff schedule.
   *
   * On success, leaves `this.client`, `this.sdkTransport`,
   * `this.connected`, and `this.resolvedToken` populated against the
   * new connection — matching the post-condition of the original
   * `connect()` so subsequent calls find a healthy transport.
   */
  private async rebuildClient(): Promise<void> {
    let url: URL;
    try {
      url = new URL(this.config.url);
    } catch (err) {
      throw new ConnectionError(
        `http transport: invalid url '${this.config.url}'`,
        { transport_kind: "http", cause: err },
      );
    }

    // Re-resolve the bearer token. A `TokenProvider` may have rotated
    // it between attempts; honouring that is the whole reason FR-7
    // calls out per-attempt token resolution.
    let token: string;
    try {
      token = await resolveToken(this.config.token);
    } catch (err) {
      throw new ConnectionError(
        `http transport: token resolution failed (${err instanceof Error ? err.message : String(err)})`,
        { transport_kind: "http", cause: err },
      );
    }
    if (token.length === 0) {
      throw new ConnectionError("http transport: token resolved to empty string", {
        transport_kind: "http",
      });
    }

    const headers: Record<string, string> = {};
    if (this.config.headers) {
      for (const [name, value] of Object.entries(this.config.headers)) {
        if (name.toLowerCase() === "authorization") continue;
        headers[name] = value;
      }
    }
    headers["Authorization"] = `Bearer ${token}`;

    const sdkTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      ...(this.config.fetch !== undefined ? { fetch: this.config.fetch } : {}),
    });

    const clientInfo = this.config.clientInfo ?? {
      name: "diffusecraft-client",
      version: "0.0.0",
    };
    const client = new Client(clientInfo, { capabilities: {} });

    // Same onclose wiring as the original connect: re-trigger the
    // reconnect loop on subsequent unsolicited closes.
    sdkTransport.onclose = () => {
      this.connected = false;
      if (this.userInitiatedClose) return;
      void this.triggerReconnect();
    };

    try {
      await client.connect(sdkTransport);
    } catch (err) {
      try {
        await sdkTransport.close();
      } catch {
        // The original error is the one that matters.
      }
      throw err;
    }

    // Tear down the previous SDK references (best-effort — the SDK
    // already fired `onclose` for them, so they should be torn down,
    // but we explicitly null them out to free the GC root).
    this.client = client;
    this.sdkTransport = sdkTransport;
    this.connected = true;
    this.resolvedToken = token;

    // Re-install the sampling handler so the new client honours the
    // already-registered consumer handler.
    this.installSamplingHandler(client);
  }

  /**
   * Replay every entry in `pendingSends` against the new (post-reconnect)
   * client. Bounded to one retry per request: entries with `attempts >=
   * 2` are rejected with a {@link ConnectionError} carrying `cause:
   * "reconnect-replay-exhausted"` so the consumer can distinguish a
   * replay-bound rejection from a fresh server error.
   *
   * The replay goes through `dispatchSend` so the SDK call is tracked
   * the same way a fresh call is — any subsequent disconnect during
   * replay observes the existing `attempts` counter and respects the
   * cap.
   */
  private async replayPending(): Promise<void> {
    if (this.pendingSends.size === 0) return;

    // Snapshot + clear the map up front so `dispatchSend` can repopulate
    // it with fresh entries (each replay registers itself anew under a
    // new id; the old entries are no longer the canonical handle).
    const entries = Array.from(this.pendingSends.values());
    this.pendingSends.clear();

    for (const entry of entries) {
      if (entry.attempts >= 2) {
        // Replay budget exhausted. Reject with a stable error shape.
        entry.reject(
          new ConnectionError(
            `http transport: replay budget exhausted for tool '${entry.toolName}'`,
            { transport_kind: "http", cause: "reconnect-replay-exhausted" },
          ),
        );
        continue;
      }

      // Fire the replay; settle the original `outer` promise from the
      // dispatch's resolution path. Using `.then` (not `await`) so all
      // pending requests fan out concurrently — the original `send()`
      // calls were already concurrent, and serialising them on replay
      // would be a behavioural change.
      this.dispatchSend(entry.toolName as ToolName, entry.args as ToolInput<ToolName>, entry.opts, entry.attempts)
        .then(
          (result) => entry.resolve(result),
          (err) => entry.reject(err),
        );
    }
  }
}

/**
 * Resolve a {@link HttpTransportConfig.token} value to a concrete string.
 * Strings are returned verbatim; functions are invoked and the result is
 * awaited (the `TokenProvider` signature returns `string | Promise<string>`,
 * so awaiting a sync return is a no-op).
 */
async function resolveToken(token: string | TokenProvider): Promise<string> {
  if (typeof token === "string") return token;
  return await token();
}

/**
 * Internal record tracking a `send()` call from the moment it dispatches
 * (or is queued during reconnect) until it resolves or rejects. The
 * reconnect loop reads `toolName` / `args` / `opts` to replay against
 * the new client; `attempts` caps total executions at 2 (original + one
 * retry, FR-29); `resolve` / `reject` settle the outer promise the
 * caller is awaiting.
 *
 * Held in `HttpTransport.pendingSends` only — not exported. Phase B.5
 * unit tests (deferred per project convention) would assert against
 * the map's contents indirectly via the reconnect outcome.
 */
interface PendingSend {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly opts: TransportSendOptions | undefined;
  /**
   * Number of times this request has been dispatched on the wire. 0
   * when first queued during a reconnect (no wire attempt yet); 1
   * after the initial `dispatchSend`; 2 after one replay. The replay
   * cap rejects entries with `attempts >= 2`.
   */
  attempts: number;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * Overlay user-supplied `reconnect` config onto {@link DEFAULT_RECONNECT_CONFIG}
 * — a shallow merge that preserves the default schedule when the user
 * supplies only `enabled` or only `max_attempts`. Returns a frozen
 * shape so the loop reads stable values across attempts.
 */
function resolveReconnectConfig(
  partial: Partial<ReconnectConfig> | undefined,
): ReconnectConfig {
  if (!partial) return { ...DEFAULT_RECONNECT_CONFIG };
  return Object.freeze({
    enabled: partial.enabled ?? DEFAULT_RECONNECT_CONFIG.enabled,
    max_attempts: partial.max_attempts ?? DEFAULT_RECONNECT_CONFIG.max_attempts,
    backoff_ms: partial.backoff_ms ?? [...DEFAULT_RECONNECT_CONFIG.backoff_ms],
  });
}

// `RECONNECT_FAILED_CAUSE` is imported above; re-export at the type level
// is unnecessary because `reconnectFailedError` already returns a
// `ConnectionError` whose `cause` is the sentinel. This `void` statement
// pins the symbol so `noUnusedLocals` does not strip it before its first
// transitive use lands in Phase C.
void RECONNECT_FAILED_CAUSE;

/**
 * Factory mirror for callers that prefer functional construction over
 * `new HttpTransport(config)`. Returns the same instance shape; the
 * SDK's higher-level `createDiffuseCraftClient` (Phase B.6) routes
 * through this factory when `transport.kind === "http"`.
 */
export function createHttpTransport(config: HttpTransportConfig): Transport {
  return new HttpTransport(config);
}
