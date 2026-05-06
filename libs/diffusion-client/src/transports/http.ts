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
}

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
 * Reconnect orchestration is intentionally NOT implemented here — that
 * concern belongs to `transports/reconnect.ts` (Phase B.4), which wraps
 * this transport. The SDK's own internal SSE-reconnect timer remains
 * active (it transparently replays missed events via `Last-Event-ID`),
 * but the application-level reconnect lifecycle (`reconnecting` status,
 * handshake re-issue on success, status-error transition on max-attempts)
 * is layered on top.
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

  constructor(
    private readonly config: HttpTransportConfig,
    logger?: WarnLogger,
  ) {
    this.logger = logger ?? NOOP_LOGGER;
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
    sdkTransport.onclose = () => {
      this.connected = false;
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
    const client = this.requireClient();

    const timeout = opts?.timeout_ms ?? this.config.request_timeout_ms;

    try {
      const result = await client.callTool(
        {
          name: toolName,
          arguments: args as Record<string, unknown>,
        },
        undefined,
        timeout !== undefined ? { timeout } : undefined,
      );
      return result as unknown as ToolOutput<N>;
    } catch (err) {
      throw this.wrapMcpError(err, toolName);
    }
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
    const client = this.client;
    if (!client || !this.connected) {
      this.connected = false;
      this.resolvedToken = null;
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
 * Factory mirror for callers that prefer functional construction over
 * `new HttpTransport(config)`. Returns the same instance shape; the
 * SDK's higher-level `createDiffuseCraftClient` (Phase B.6) routes
 * through this factory when `transport.kind === "http"`.
 */
export function createHttpTransport(config: HttpTransportConfig): Transport {
  return new HttpTransport(config);
}
