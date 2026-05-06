/**
 * stdio transport (`client-sdk` FR-6, FR-8, FR-10, design.md §2 + §4).
 *
 * The stdio transport spawns a server child process and exchanges MCP
 * JSON-RPC messages over its stdin/stdout. Per the spec we delegate the
 * wire-protocol work to `@modelcontextprotocol/sdk`'s `StdioClientTransport`
 * + `Client` rather than reimplementing MCP framing — the SDK already
 * handles `child_process.spawn`, the SIGTERM-then-SIGKILL escalation on
 * `close()` (verified against
 * `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`'s
 * implementation), and the `initialize` handshake.
 *
 * Lifecycle:
 *
 *   - `connect()` constructs `StdioClientTransport({ command, args, env })`,
 *     constructs a `Client({ name: "diffusecraft-client", version }, {
 *     capabilities: {} })`, calls `client.connect(transport)` (which
 *     internally `spawn`s the child and runs the MCP `initialize`
 *     exchange), and returns a {@link HandshakeResult} populated from the
 *     SDK-reported server version + protocol version. The DiffuseCraft
 *     domain-level `ServerCapabilities` (catalog version range, ComfyUI
 *     status, supported workspaces, sampling-supported flag, audit-log
 *     flag — `mcp-tools` `shared/capabilities.ts`) are NOT carried in the
 *     standard MCP `initialize` response; Phase G replaces this stub with
 *     a real read of the `diffusecraft://server/info` resource once the
 *     resource catalog lands.
 *
 *   - `disconnect()` calls `client.close()`. The MCP SDK's `Client.close()`
 *     awaits the underlying transport's `close()`, which the stdio
 *     transport implements as: end stdin → race against 2 s timer → if
 *     still alive, SIGTERM → race against 2 s timer → SIGKILL fallback.
 *     This satisfies FR-8's "SIGTERM on dispose" contract. The 5 s grace
 *     window mentioned by spec is therefore covered (2 s + 2 s + immediate
 *     kill ≤ 5 s); the SDK already logs nothing on the kill path so we
 *     surface a `logger.warn` if the close promise has not resolved
 *     within 5 s wall-clock to give consumers visibility.
 *
 *   - `isHealthy()` flips on after a successful `connect()` and flips off
 *     on `disconnect()` or on the SDK transport's `onclose` callback (i.e.
 *     when the child exits unexpectedly).
 *
 *   - `send()` calls `client.callTool({ name, arguments }, undefined,
 *     { timeout })`. {@link McpError} responses are wrapped as
 *     {@link ServerError} with `mcp_error_code` populated from the SDK
 *     error's numeric code. Pre-aborted `signal`s short-circuit before
 *     calling the SDK; mid-flight cancellation cascade lands in C.5.
 *
 *   - `readResource()` calls `client.readResource({ uri })`. The MCP
 *     `readResource` request does not natively accept query parameters,
 *     so `?since` / `?fields` are appended to the URI as a query string
 *     (FR-17). Phase D tightens the resource layer.
 *
 *   - `subscribe()` is NOT yet wired to MCP notifications. The DiffuseCraft
 *     server's stdio transport (`libs/server/src/lib/transports/stdio.ts`)
 *     publishes domain events to the in-process `EventBus` only — there
 *     is currently no path that converts those events into MCP
 *     `notifications/<eventName>` messages on the wire. Until that
 *     upstream gap is closed (tracked by `server-architecture`), this
 *     method throws {@link ConnectionError} so callers cannot silently
 *     wait for events that will never arrive.
 *
 *   - `sampling.register()` registers an MCP request handler for
 *     `sampling/createMessage` via `client.setRequestHandler`. The
 *     consumer-supplied `TransportSamplingHandler` receives the raw MCP
 *     params payload (typed `unknown` at the transport boundary;
 *     {@link SamplingForwarder} narrows it). The MCP SDK requires the
 *     handler to return an MCP `CreateMessageResult` shape; for now we
 *     accept any shape from the handler and trust the
 *     {@link SamplingForwarder} (Phase I) to format it correctly. Returns
 *     an unregister callback that removes the request handler.
 *
 * The MCP SDK is declared as a peer dependency
 * (`libs/diffusion-client/package.json`); this file imports types and
 * runtime values from the published entry points. Consumers that pick the
 * stdio transport must have `@modelcontextprotocol/sdk` installed in
 * their workspace (Node-only — `child_process` is unavailable in the
 * browser, which matches FR-8's "stdio is Node-only" contract).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
 * Constructor configuration for {@link StdioTransport}. Mirrors the
 * `transport.kind === "stdio"` slot in `ClientConfigSchema` (`config.ts`)
 * plus an optional `env` map (FR-8 spawn semantics). The MCP SDK's
 * `StdioServerParameters` accepts more fields (`stderr`, `cwd`); they are
 * not exposed at the SDK boundary in v1 to keep `ClientConfig` minimal,
 * and can be threaded later without breaking the `Transport` contract.
 */
export interface StdioTransportConfig {
  /** Executable to spawn (e.g. `"npx"`, `"node"`). */
  command: string;
  /** Argv passed to the executable (e.g. `["@diffusecraft/server", "--stdio"]`). */
  args: string[];
  /**
   * Optional environment overrides. Merged on top of the MCP SDK's
   * default-inherited env (`DEFAULT_INHERITED_ENV_VARS` — `HOME`, `PATH`,
   * `USER`, etc.). Defaults to inheriting the parent's env subset only.
   */
  env?: Record<string, string>;
  /**
   * Optional client identity advertised in the MCP `initialize` request.
   * Defaults to `{ name: "diffusecraft-client", version: "0.0.0" }`.
   */
  clientInfo?: { name: string; version: string };
  /**
   * Maximum wall-clock grace, in milliseconds, that {@link disconnect} will
   * wait for the child to exit before logging a warning. Defaults to
   * 5 000 ms per spec ("5 s grace timer").
   */
  disconnect_grace_ms?: number;
}

// ---------------------------------------------------------------------------
// Stub logger
// ---------------------------------------------------------------------------

/**
 * Minimal logger surface used for the disconnect-grace warning. The full
 * `Logger` from `config.ts` carries `pino`-style methods; the transport
 * only needs `warn` here so the slot is intentionally narrow. Phase B.6
 * (the outer client) will pass the SDK-wide logger through when
 * constructing the transport.
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
// StdioTransport
// ---------------------------------------------------------------------------

/**
 * Concrete {@link Transport} that talks to a DiffuseCraft server over
 * stdio. Wraps `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport`
 * pair so the SDK's MCP framing, handshake, and SIGTERM-on-close logic are
 * reused verbatim (FR-8). All catalog-typed surface is preserved (FR-10).
 */
export class StdioTransport implements Transport {
  /**
   * The MCP SDK client wrapper. Constructed lazily inside `connect()` so
   * the transport can be instantiated without immediately spawning the
   * child (matches the in-memory transport's lazy-narrow pattern in B.1).
   */
  private client: Client | null = null;

  /**
   * The underlying `StdioClientTransport` reference. Held so we can
   * inspect / fall through to it in `disconnect()` if the SDK's
   * `client.close()` ever stops doing the SIGTERM cascade (defensive —
   * verified to do so today against the SDK source).
   */
  private sdkTransport: StdioClientTransport | null = null;

  /**
   * Connection state (FR-31 channel input). Flipped to `true` after a
   * successful `connect()`, back to `false` on `disconnect()` or on the
   * SDK transport's `onclose` callback (child exited unexpectedly).
   */
  private connected = false;

  /**
   * Sampling handler registered via {@link sampling.register}. The MCP
   * SDK's `setRequestHandler` overrides the previous handler for the
   * same method, so we only ever keep one slot.
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
    private readonly config: StdioTransportConfig,
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
            // The MCP SDK does not expose a public "remove request
            // handler" for arbitrary methods on the Client subclass, so
            // we replace with a stub that throws "no handler" semantics
            // — see installSamplingHandler. This matches the "register
            // a single handler per session" contract from design.md
            // §10.2.
            if (this.client) {
              this.installSamplingHandler(this.client);
            }
          }
        };
      },
    };
  }

  /**
   * Spawn the child process and run the MCP `initialize` handshake. The
   * MCP SDK's `Client.connect(transport)` performs both steps in one
   * call. Throws {@link ConnectionError} on spawn or handshake failure.
   *
   * Returns a placeholder {@link HandshakeResult}: the standard MCP
   * `initialize` response only carries `protocolVersion` + `serverInfo`
   * + MCP-level `capabilities` (`tools`, `resources`, `prompts`,
   * `logging`, `sampling`, `experimental`), NOT the DiffuseCraft
   * domain-level shape (`catalog_version_range`, `comfyui_status`, etc.)
   * defined in `mcp-tools` `shared/capabilities.ts`. Phase G reads
   * those from the `diffusecraft://server/info` resource after the
   * resource catalog ships and replaces this stub.
   */
  async connect(): Promise<HandshakeResult> {
    if (this.connected) {
      throw new ConnectionError("stdio transport already connected", {
        transport_kind: "stdio",
      });
    }

    const sdkTransport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      ...(this.config.env !== undefined ? { env: this.config.env } : {}),
    });

    const clientInfo = this.config.clientInfo ?? {
      name: "diffusecraft-client",
      version: "0.0.0",
    };
    const client = new Client(clientInfo, { capabilities: {} });

    // Wire the unexpected-close path so `isHealthy()` reflects the truth
    // when the child exits without our `disconnect()` driving it.
    sdkTransport.onclose = () => {
      this.connected = false;
    };

    try {
      await client.connect(sdkTransport);
    } catch (err) {
      // Make sure no half-spawned child outlives a failed handshake.
      try {
        await sdkTransport.close();
      } catch {
        // Best-effort cleanup; the original error is the one that
        // matters.
      }
      throw new ConnectionError(
        `stdio transport: connect failed (${err instanceof Error ? err.message : String(err)})`,
        { transport_kind: "stdio", cause: err },
      );
    }

    this.client = client;
    this.sdkTransport = sdkTransport;
    this.connected = true;

    // Attach the sampling request handler if the consumer registered
    // one before we connected (legitimate per design.md §10.2 — the
    // forwarder may be wired at construction time).
    this.installSamplingHandler(client);

    // Snapshot the SDK-reported server identity. Both fields are
    // optional on the SDK side; fall back to safe placeholders so the
    // returned shape matches the `HandshakeResult` contract (Phase G
    // tightens these to real values from the server-info resource).
    const protocolVersion =
      (sdkTransport as unknown as { protocolVersion?: string }).protocolVersion ?? "unknown";
    const serverVersion = client.getServerVersion();
    const serverName = serverVersion?.name;

    return {
      // Placeholder shape — matches the in-memory transport's stub
      // (B.1) so callers see a stable surface. Phase G replaces with
      // real values read from `diffusecraft://server/info`.
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
   * The MCP SDK's `callTool` has its own `RequestOptions.timeout`; we
   * pass `opts.timeout_ms` through verbatim. Pre-aborted signals throw
   * `Error("aborted")` — Phase C.5 replaces this with the canonical
   * abort error shape and adds mid-flight cancellation cascade.
   */
  async send<N extends ToolName>(
    toolName: N,
    args: ToolInput<N>,
    opts?: TransportSendOptions,
  ): Promise<ToolOutput<N>> {
    if (opts?.signal?.aborted) {
      // Phase C.5 (AbortSignal plumbing) replaces this minimal
      // placeholder with the SDK's canonical abort error shape.
      throw new Error("aborted");
    }
    const client = this.requireClient();

    try {
      const result = await client.callTool(
        {
          name: toolName,
          // The MCP SDK types `arguments` as `Record<string, unknown> |
          // undefined`; tool inputs are object-shaped per the catalog
          // schema, so this cast is safe at runtime.
          arguments: args as Record<string, unknown>,
        },
        undefined,
        opts?.timeout_ms !== undefined ? { timeout: opts.timeout_ms } : undefined,
      );
      // The catalog's `ToolOutput<N>` is the post-Zod-validation shape;
      // the MCP SDK returns the wire payload (with `content` /
      // `structuredContent` wrappers). Phase C.4 introduces the
      // server-output unwrap layer; for now we cast through `unknown`
      // so the transport surface stays type-correct and the unwrap
      // happens above us.
      return result as unknown as ToolOutput<N>;
    } catch (err) {
      throw this.wrapMcpError(err, toolName);
    }
  }

  /**
   * Read an MCP resource by URI. `query.since` / `query.fields` are
   * appended as a query string (FR-17). The MCP SDK does not type the
   * resource payload; we return `unknown` here and tighten in Phase D.
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
   * stdio**: the DiffuseCraft server publishes domain events to its
   * in-process `EventBus` only (see `libs/server/src/lib/transports/stdio.ts`
   * — `publish: (event) => this.bus.publish(event)`); there is no path
   * that converts those events into MCP `notifications/<eventName>`
   * messages on the wire. Throwing {@link ConnectionError} is the
   * honest signal — silently returning a fake unsubscribe would let
   * consumers wait forever for events that never arrive.
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
      "Event subscription over stdio not implemented yet — the DiffuseCraft server " +
        "publishes events only to in-memory subscribers; MCP-side notification " +
        "publication is an upstream gap tracked by the server-architecture spec.",
      { transport_kind: "stdio" },
    );
  }

  /**
   * Tear down the transport. Calls `client.close()` (which awaits the
   * SDK's stdio transport `close()`, which itself runs the SIGTERM →
   * SIGKILL escalation per FR-8). A 5 s grace timer surfaces a
   * `logger.warn` if the child has not exited by then; the SDK's own
   * timers (2 s + 2 s = 4 s before SIGKILL) should normally beat this.
   */
  async disconnect(): Promise<void> {
    const client = this.client;
    if (!client || !this.connected) {
      this.connected = false;
      return;
    }

    this.connected = false;

    const grace = this.config.disconnect_grace_ms ?? 5_000;
    const closePromise = client.close().catch((err: unknown) => {
      // The SDK's close path swallows kill errors internally; surface
      // anything that does escape so it does not become a silent leak.
      this.logger.warn(
        { err, transport: "stdio" },
        "stdio transport: client.close() rejected",
      );
    });

    let warned = false;
    const warnTimer = setTimeout(() => {
      warned = true;
      this.logger.warn(
        { grace_ms: grace, transport: "stdio" },
        "stdio transport: child did not exit within grace window after disconnect()",
      );
    }, grace);
    // Avoid pinning the event loop on the warn timer alone.
    if (typeof (warnTimer as { unref?: () => void }).unref === "function") {
      (warnTimer as { unref: () => void }).unref();
    }

    try {
      await closePromise;
    } finally {
      clearTimeout(warnTimer);
      // If we already warned, leave the warning in the log; otherwise
      // we exited cleanly and there is nothing more to say.
      void warned;
      this.client = null;
      this.sdkTransport = null;
      this.samplingHandler = null;
    }
  }

  /**
   * Synchronous health probe. `true` between a successful `connect()`
   * and the next `disconnect()` / unexpected child exit. The SDK
   * transport's `onclose` callback is what flips this to `false` for
   * the unexpected-exit case.
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
        "stdio transport: not connected — call connect() before send/readResource/subscribe",
        { transport_kind: "stdio" },
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
        // The forwarder will normally have wrapped this with a proper
        // SamplingNotSupportedError before we get here; this branch is
        // a defensive fallback for the "no consumer handler attached"
        // case (design.md §10.4 — `SAMPLING_NOT_SUPPORTED`).
        throw new McpError(
          -32601,
          "Sampling handler not registered on this client",
        );
      }
      // Forward the raw MCP params to the consumer-supplied handler;
      // {@link SamplingForwarder} (Phase I) narrows / formats both
      // sides. The transport boundary is intentionally `unknown`.
      const response = await handler(request.params);
      // The MCP SDK validates the result against
      // `CreateMessageResultSchema` after we return it; the forwarder
      // is responsible for producing that shape. We cast to `never`
      // here so the typecheck does not try to verify the shape from
      // the handler's `Promise<unknown>` return.
      return response as never;
    });
  }

  /**
   * Convert an SDK-thrown error into the SDK's typed
   * {@link ServerError}. Rethrows non-MCP errors verbatim so the caller
   * sees the original (e.g. transport-level Node errors keep their
   * stack).
   */
  private wrapMcpError(err: unknown, toolName: string | undefined): unknown {
    if (err instanceof McpError) {
      return new ServerError(
        toolName !== undefined
          ? `stdio transport: tool '${toolName}' failed: ${err.message}`
          : `stdio transport: ${err.message}`,
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
 * Factory mirror for callers that prefer functional construction over
 * `new StdioTransport(config)`. Returns the same instance shape; the
 * SDK's higher-level `createDiffuseCraftClient` (Phase B.6) routes
 * through this factory when `transport.kind === "stdio"`.
 */
export function createStdioTransport(
  config: StdioTransportConfig,
): Transport {
  return new StdioTransport(config);
}
