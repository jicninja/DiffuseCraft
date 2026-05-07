/**
 * `DiffuseCraftClient` (FR-1 / FR-2, design.md §3) and the
 * `createDiffuseCraftClient(config)` factory.
 *
 * This is the public-API entry point referenced by every story in the
 * `client-sdk` requirements: consumers (tablet, MeshCraft, agent
 * integrations, integration tests) call `createDiffuseCraftClient(config)`
 * to get a fully-assembled client wired against the chosen transport.
 * The factory composes everything Phases A–H + K shipped — config
 * validation (A.2/A.3), transports (B.1/B.2/B.3 + B.4 reconnect), the
 * event bus (E.1–E.3), typed tool methods (C.1+), typed resource
 * readers (D.1+), the pairing client (F.1–F.5), image helpers (H.1+H.2),
 * and the sampling forwarder (Phase I) — into a single typed surface.
 *
 * Source of truth:
 *   - `client-sdk` requirements §3.1 FR-1 + FR-2 (factory + exposed
 *     surface), §3.10 FR-32 (server-capabilities slot).
 *   - `client-sdk` design.md §2 (`client.ts` module slot), §3 (Public
 *     API — `DiffuseCraftClient` interface), §10 (sampling lifecycle).
 *
 * Design notes:
 *
 *   - **Transport-agnostic at the type level (FR-10).** The client
 *     depends only on the `Transport` interface; backend selection
 *     (`http` / `stdio` / `in-memory`) is performed once during
 *     construction by branching on `config.transport.kind`.
 *
 *   - **No runtime import of `@diffusecraft/server`.** The in-memory
 *     transport accepts an opaque `server` reference and structurally
 *     narrows it at first use. This file mirrors that boundary —
 *     `import type` only — so building the client SDK does not require
 *     the server bundle.
 *
 *   - **Connection-status orchestration.** The {@link EventBus} owns
 *     the connection-status channel (E.3 / FR-21). The client class
 *     calls `markStatus(...)` from `connect()` (`disconnected` →
 *     `connecting` → `connected`) and `disconnect()` (→ `disconnected`).
 *     The HTTP transport's reconnect-loop emissions are bridged
 *     automatically by the bus when the transport exposes
 *     `onConnectionStatus(...)` (B.4) — so the client does not have to
 *     wire reconnect-status forwarding itself.
 *
 *   - **Server capabilities are populated from `transport.connect()`
 *     and `diffusecraft://server/info`.** The transports return a
 *     {@link HandshakeResult} carrying a placeholder `serverCapabilities`
 *     (the standard MCP `initialize` response does not carry the
 *     DiffuseCraft domain shape). After the handshake resolves, J.2's
 *     {@link populateServerCapabilitiesFromInfo} reads the
 *     `diffusecraft://server/info` resource and projects the payload
 *     onto the catalog's {@link ServerCapabilities} shape, replacing
 *     the placeholder. A failed read (the server-info resource handler
 *     is an upstream gap tracked by `server-architecture`) leaves the
 *     placeholder intact and emits a structured warning — `connect()`
 *     does NOT fail when capabilities are unavailable.
 *
 *   - **Disposal cascade.** `dispose()` and `disconnect()` both fire
 *     the same teardown chain: stop the sampling forwarder, dispose the
 *     event bus, then `transport.disconnect()`. `dispose()` additionally
 *     marks the client as disposed so further calls throw a clear
 *     {@link ConnectionError}; `disconnect()` leaves the client
 *     reusable so a subsequent `connect()` re-establishes the session.
 */

// `ServerCapabilities` / `ServerInfo` are Zod schemas (runtime values)
// AND inferred TypeScript types — `@diffusecraft/mcp-tools` exports both
// under the same name. Import them as values; the type narrowing rides
// on the same identifier (per Zod's `z.infer<typeof T>` pattern).
import {
  ServerCapabilities,
  ServerInfo,
} from "@diffusecraft/mcp-tools";

import type {
  ToolInput,
  ToolName,
  ToolOutput,
} from "@diffusecraft/mcp-tools";
import type {
  ClientCapabilities,
  ClientConfig,
  Logger,
} from "./config";
import { parseClientConfig } from "./config";
import { ConnectionError } from "./errors";
import { EventBus } from "./events/index";
import type {
  ConnectionStatus,
  ConnectionStatusListener,
  EventListener,
  Unsubscribe,
} from "./events/index";
import { fetchImage, uploadImage } from "./image/index";
import type { UploadImageOptions } from "./image/index";
import { PairingClient } from "./pairing/index";
import { createResourceReaders } from "./resources/index";
import type { TypedResourceReaders } from "./resources/index";
import { SamplingForwarder } from "./sampling/index";
import type { SamplingHandler } from "./sampling/index";
import { createToolMethods } from "./tools/index";
import type { TypedToolMethods } from "./tools/index";
import {
  HttpTransport,
  InMemoryTransport,
  StdioTransport,
} from "./transports/index";
import type { Transport } from "./transports/index";
import type { ImageEnvelope, ImageFormat } from "@diffusecraft/mcp-tools";
import type {
  DiscoverOptions,
  DiscoveredBackend,
  ManualPayload,
  PairResult,
  QrPayload,
  RequestPairOptions,
} from "./pairing/index";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Public client interface (design.md §3, FR-2).
 *
 * Returned by {@link createDiffuseCraftClient}. Every consumer-facing
 * field is typed against the catalog so wrong-shape arguments fail at
 * compile time (FR-12). Lifecycle methods are awaitable; namespaces
 * (`tools`, `resources`, `events`, `pairing`, `image`, `sampling`) are
 * fully populated at construction time so consumers can attach
 * listeners or invoke methods before `connect()` resolves (the
 * underlying transport queues until ready).
 */
export interface DiffuseCraftClient {
  /**
   * Establish the transport connection and complete the MCP
   * `initialize` handshake. Emits `connecting` → `connected` on the
   * bus's connection-status channel (FR-21). Throws
   * {@link ConnectionError} on transport failure; the bus stays at
   * `disconnected`.
   */
  connect(): Promise<void>;

  /**
   * Tear down the transport connection and emit a final
   * `disconnected` status. Subsequent `connect()` calls re-establish
   * the session — `disconnect()` is reversible.
   */
  disconnect(): Promise<void>;

  /**
   * Tear down the client permanently. Disposes the sampling forwarder,
   * the event bus, the pairing client (no-op today), and the
   * transport. Subsequent calls on this client reject with
   * {@link ConnectionError}; consumers should call
   * {@link createDiffuseCraftClient} to obtain a new instance.
   */
  dispose(): Promise<void>;

  /**
   * Synchronous status projection (design.md §3 — the same enum the
   * `events.onConnectionStatus(...)` channel emits).
   */
  getStatus(): ConnectionStatus;

  /** Typed tool methods, one per catalog tool (FR-11 / FR-12, design §3 / §5). */
  tools: TypedToolMethods;

  /**
   * String-keyed tool dispatch (parallels {@link tools}). Forwards `name`
   * and `args` directly to the underlying transport's `send`. Useful for
   * adapters / generic surfaces that need to call a tool by its
   * snake_case catalog name (e.g., the `DiffuseCraftClientLike` shape
   * consumed by `@diffusecraft/core`'s store provider, where call sites
   * speak the catalog vocabulary rather than the camelCased typed
   * methods on `tools`). The generic parameters are advisory: pass a
   * known `ToolName` to inherit catalog-derived input / output typing,
   * or call with `unknown` args at consumers who only know the wire
   * shape.
   */
  invokeTool<N extends ToolName>(
    name: N,
    args: ToolInput<N>,
  ): Promise<ToolOutput<N>>;
  invokeTool<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
  ): Promise<TResult>;

  /**
   * Read a `diffusecraft://` resource URI by dynamic name. Wire shape is
   * normalised so callers receive the underlying resource payload
   * directly (no `{ contents: [{ text }] }` wrapper). Useful when the
   * caller speaks raw URIs (the `@diffusecraft/core` store provider
   * does); typed namespace helpers live on {@link resources}.
   */
  readResource<TResult = unknown>(uri: string): Promise<TResult>;

  /** Typed resource readers, one namespace per catalog resource (FR-16+, design §3 / §6). */
  resources: TypedResourceReaders;

  /**
   * Buffered, typed event subscription bus (FR-19 / FR-20 / FR-21,
   * design §3 / §7).
   */
  events: {
    on<E extends Parameters<EventBus["on"]>[0]>(
      name: E,
      handler: EventListener<E>,
    ): Unsubscribe;
    onConnectionStatus(handler: ConnectionStatusListener): Unsubscribe;
  };

  /** Pairing flow (FR-22…FR-25, design §9). */
  pairing: {
    discover(opts?: DiscoverOptions): AsyncIterable<DiscoveredBackend>;
    requestPair(
      backend: { url: string },
      opts?: RequestPairOptions,
    ): Promise<PairResult>;
    parseQr(payload: string): QrPayload;
    parseManual(input: string): ManualPayload;
  };

  /**
   * Negotiated capabilities (FR-32, design.md §3). `client` is what the
   * SDK declared at construction time and is forwarded to the server
   * on the MCP `initialize` request (mapped to the wire shape via
   * {@link mapToMcpCapabilities} — J.1). `server` is populated by
   * `connect()`: starts with the transport's handshake placeholder,
   * then is replaced by the projection of `diffusecraft://server/info`
   * when that resource is reachable (J.2). `null` only between
   * construction and the first successful `connect()`, and after
   * `disconnect()`.
   */
  capabilities: {
    client: ClientCapabilities;
    server: ServerCapabilities | null;
  };

  /** Image envelope helpers (FR-34 / FR-35, design §11). */
  image: {
    fetch(envelope: ImageEnvelope): Promise<Uint8Array>;
    upload(
      bytes: Uint8Array,
      format: ImageFormat,
      opts: UploadImageOptions,
    ): Promise<{ ref: { uri: string } }>;
  };

  /**
   * MCP sampling channel (Q3 / design §10). Consumers register a
   * single handler the SDK forwards every server-initiated sampling
   * request to; throws {@link import("./errors.js").SamplingNotSupportedError}
   * when the server requests a sample with no handler attached.
   */
  sampling: {
    onSample(handler: SamplingHandler): Unsubscribe;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a fully-wired {@link DiffuseCraftClient}. The factory:
 *
 *   1. Validates `config` via {@link parseClientConfig} — applies
 *      defaults and throws {@link import("./errors.js").ClientValidationError}
 *      with a populated `field_path` on the first offending Zod issue.
 *   2. Constructs the concrete {@link Transport} based on
 *      `config.transport.kind` (`http` → {@link HttpTransport};
 *      `stdio` → {@link StdioTransport}; `in-memory` →
 *      {@link InMemoryTransport}).
 *   3. Wires an {@link EventBus} against the transport (E.3 — the bus
 *      auto-bridges the HTTP transport's reconnect-status channel
 *      when present).
 *   4. Builds the typed tool methods, resource readers, image helper
 *      thunks, pairing client, and sampling forwarder.
 *
 * The returned client is reusable across multiple `connect()` /
 * `disconnect()` cycles. Each cycle re-runs the handshake; the
 * `capabilities.server` slot is replaced on every successful connect
 * (or cleared back to `null` on disconnect).
 *
 * @example
 * ```ts
 * const client = createDiffuseCraftClient({
 *   transport: { kind: "in-memory", server },
 * });
 * await client.connect();
 * const out = await client.tools.getServerInfo({});
 * await client.dispose();
 * ```
 */
export function createDiffuseCraftClient(config: ClientConfig): DiffuseCraftClient {
  const validated = parseClientConfig(config);
  return new DiffuseCraftClientImpl(validated);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Tiny no-op logger used when the consumer omits `config.logger`.
 * Matches the no-op slot the EventBus / Pairing client already use so
 * the SDK has a single fallback shape.
 */
const NOOP_LOGGER: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

class DiffuseCraftClientImpl implements DiffuseCraftClient {
  private readonly transport: Transport;
  private readonly bus: EventBus;
  private readonly samplingForwarder: SamplingForwarder;
  private readonly pairingClient: PairingClient;
  private readonly logger: Logger;

  /** Declared client capabilities (FR-32). Frozen so consumers see a stable shape. */
  private readonly clientCapabilities: ClientCapabilities;

  /**
   * Server-reported capabilities snapshot. Populated by
   * {@link connect} from the transport's handshake result; cleared on
   * {@link disconnect} so re-connect observes a fresh value.
   */
  private serverCapabilities: ServerCapabilities | null = null;

  /**
   * Permanent-disposal flag. Once `dispose()` resolves, public methods
   * either reject with {@link ConnectionError} (lifecycle methods) or
   * fall through to safe no-ops (subscribe paths) so consumers holding
   * a stale reference do not crash.
   */
  private disposed = false;

  /** Public namespaces — built once in the constructor. */
  public readonly tools: TypedToolMethods;
  public readonly resources: TypedResourceReaders;
  public readonly events: DiffuseCraftClient["events"];
  public readonly pairing: DiffuseCraftClient["pairing"];
  public readonly image: DiffuseCraftClient["image"];
  public readonly sampling: DiffuseCraftClient["sampling"];
  public readonly capabilities: DiffuseCraftClient["capabilities"];

  constructor(config: ClientConfig) {
    this.logger = config.logger ?? NOOP_LOGGER;
    this.clientCapabilities = config.capabilities;

    // 1) Construct the concrete transport. The forwarder-backed
    //    `getSupportsSampling` callback is supplied via a thunk so the
    //    transport can read the live state at every handshake (J.1 +
    //    Phase I integration). Because the forwarder is constructed
    //    AFTER the transport (it needs the transport reference), the
    //    thunk reads through `this.samplingForwarder` after assignment.
    //    Pre-assignment evaluations return `false` (no handler can be
    //    registered before the forwarder exists).
    this.transport = buildTransport(config, {
      getSupportsSampling: () => this.samplingForwarder?.supportsSampling ?? false,
    });

    // 2) Construct the event bus. The bus auto-bridges the HTTP
    //    transport's reconnect-status channel when present (B.4 / E.3),
    //    so reconnect transitions reach consumers via
    //    `events.onConnectionStatus(...)` without extra wiring here.
    this.bus = new EventBus({
      transport: this.transport,
      bufferSize: config.event_buffer_size,
      logger: this.logger,
      // Default `bridgeHttpTransport: true` is correct — the bus drives
      // its own status channel for HTTP reconnects while the client
      // class handles the connect/disconnect transitions explicitly.
    });

    // 3) Construct the sampling forwarder. It immediately registers a
    //    transport-level handler so server-initiated sampling requests
    //    flow even before a consumer attaches an `onSample` handler
    //    (the forwarder throws SamplingNotSupportedError in that
    //    branch — design.md §10.4). The transport's
    //    `getSupportsSampling` thunk (wired above) reads
    //    `this.samplingForwarder.supportsSampling` once this assignment
    //    completes — so the FIRST `connect()` after a consumer calls
    //    `client.sampling.onSample(handler)` advertises sampling on
    //    the MCP `initialize` payload.
    this.samplingForwarder = new SamplingForwarder(this.transport);

    // 4) Construct the typed tool methods + resource readers.
    this.tools = createToolMethods(this.transport);
    this.resources = createResourceReaders(this.transport);

    // 5) Construct the pairing client with the consumer-supplied mDNS
    //    adapter (when present) so `client.pairing.discover()` works.
    //    parseQr / parseManual / requestPair work without an adapter.
    this.pairingClient = new PairingClient({
      ...(config.adapters?.mdns ? { mdnsAdapter: config.adapters.mdns } : {}),
      logger: this.logger,
    });

    // 6) Wire the public namespaces. The events namespace mirrors the
    //    bus's typed `on(...)` and `onConnectionStatus(...)` methods so
    //    consumers see the catalog-typed surface declared in design §3.
    this.events = {
      on: <E extends Parameters<EventBus["on"]>[0]>(
        name: E,
        handler: EventListener<E>,
      ): Unsubscribe => this.bus.on(name, handler),
      onConnectionStatus: (handler: ConnectionStatusListener): Unsubscribe =>
        this.bus.onConnectionStatus(handler),
    };

    this.pairing = {
      discover: (opts?: DiscoverOptions): AsyncIterable<DiscoveredBackend> =>
        this.pairingClient.discover(opts),
      requestPair: (
        backend: { url: string },
        opts?: RequestPairOptions,
      ): Promise<PairResult> => this.pairingClient.requestPair(backend, opts),
      parseQr: (payload: string): QrPayload => this.pairingClient.parseQr(payload),
      parseManual: (input: string): ManualPayload =>
        this.pairingClient.parseManual(input),
    };

    this.image = {
      fetch: (envelope: ImageEnvelope): Promise<Uint8Array> =>
        fetchImage(envelope, this.transport),
      upload: (
        bytes: Uint8Array,
        format: ImageFormat,
        opts: UploadImageOptions,
      ): Promise<{ ref: { uri: string } }> =>
        uploadImage(bytes, format, this.transport, opts),
    };

    this.sampling = {
      onSample: (handler: SamplingHandler): Unsubscribe =>
        this.samplingForwarder.onSample(handler),
    };

    // Bind `self` so the `server` getter on the capabilities literal
    // closes over the current instance — `this` inside an object-literal
    // getter does NOT refer to the enclosing constructor's `this`, so we
    // capture it explicitly. The getter projects the latest server
    // capabilities snapshot so consumers always see the post-handshake
    // value (or `null` pre-connect / post-disconnect) without needing to
    // re-read `client.capabilities` after every transition.
    const self = this;
    this.capabilities = {
      client: this.clientCapabilities,
      get server(): ServerCapabilities | null {
        return self.serverCapabilities;
      },
    };
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  async connect(): Promise<void> {
    this.assertNotDisposed("connect");

    // Mark the connecting transition before the transport's network
    // round-trip starts so consumers (the connection store) see the
    // intermediate state.
    this.bus.markStatus("connecting");

    let handshake;
    try {
      handshake = await this.transport.connect();
    } catch (err) {
      // Surface the failure on the status channel and re-throw so the
      // caller can branch (design §8 — consumer decides whether to
      // retry).
      this.bus.markStatus("error");
      throw err instanceof Error
        ? err
        : new ConnectionError(`transport connect failed: ${String(err)}`);
    }

    // J.2 — replace the transport's placeholder `serverCapabilities`
    // (HTTP / stdio return a stub from the standard MCP `initialize`
    // response, design.md §3) with a real read of
    // `diffusecraft://server/info` (resource catalog manifest at
    // `libs/mcp-tools/src/resources/manifest.ts:38`).
    //
    // The handshake placeholder is stored first so a failed read does
    // not leave `capabilities.server` null — connect() succeeds with
    // best-available capabilities even when the server-info resource is
    // unreachable. The read is bounded by the SDK's request timeout
    // (configured at the transport layer) and by `connect()`'s own
    // surrounding error path.
    this.serverCapabilities = handshake.serverCapabilities;
    await this.populateServerCapabilitiesFromInfo();

    this.bus.markStatus("connected");
  }

  /**
   * Best-effort read of `diffusecraft://server/info` (J.2 / FR-32). On
   * success, projects the {@link ServerInfo} payload into the catalog's
   * {@link ServerCapabilities} shape and replaces the placeholder
   * stored in {@link serverCapabilities}. On failure, logs a warning
   * and leaves the placeholder intact — `connect()` does NOT fail when
   * the resource is unavailable (the consumer still has a usable
   * client; only the negotiated capability surface degrades).
   *
   * Known upstream gap: the server does not yet register a resource
   * resolver for `diffusecraft://server/info`
   * (`libs/server/src/lib/server.ts:726+` registers history / undo /
   * redo only). The catalog manifest declares the URI, but the
   * `RESOURCE_NOT_FOUND` thrown by the in-memory transport (and the
   * equivalent MCP error from HTTP / stdio) is the runtime symptom
   * until the resource handler ships in the `server-architecture`
   * spec. The placeholder snapshot already covers
   * the consumer-observable shape (`catalog_version_range`,
   * `comfyui_status`, `supported_workspaces`, `sampling_supported`,
   * `audit_log_enabled` — all populated with safe defaults), so the
   * client surface stays type-correct in the meantime.
   *
   * Additionally, the {@link ServerInfo} schema does NOT carry every
   * field declared on {@link ServerCapabilities}: it lacks
   * `supported_workspaces` and `sampling_supported`. The projection
   * below preserves the placeholder values for those fields when they
   * are not present on the read payload — a forward-compatible merge
   * so a future server that DOES populate them lights up the slot
   * automatically.
   */
  private async populateServerCapabilitiesFromInfo(): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.transport.readResource("diffusecraft://server/info");
    } catch (err) {
      this.logger.warn(
        { err },
        "DiffuseCraftClient: failed to read diffusecraft://server/info — keeping handshake placeholder capabilities",
      );
      return;
    }

    const payload = extractResourcePayload(raw);
    if (payload === undefined) {
      this.logger.warn(
        { raw_shape: typeof raw },
        "DiffuseCraftClient: server/info payload unrecognised — keeping handshake placeholder capabilities",
      );
      return;
    }

    // Try the most specific shape first: a full `ServerCapabilities`
    // object. Older / forward-compatible servers may decide to inline
    // the negotiated capabilities directly under the resource URI; we
    // accept that shape so the migration path is one-step.
    const directCaps = ServerCapabilities.safeParse(payload);
    if (directCaps.success) {
      this.serverCapabilities = directCaps.data;
      return;
    }

    // Standard shape: a `ServerInfo` payload. Project the overlapping
    // fields onto `ServerCapabilities` and preserve the placeholder
    // for `supported_workspaces` / `sampling_supported` (not carried
    // by `ServerInfo` today — see method docstring).
    const info = ServerInfo.safeParse(payload);
    if (info.success) {
      const placeholder = this.serverCapabilities;
      this.serverCapabilities = {
        catalog_version_range: info.data.catalog_version_range,
        comfyui_status: info.data.comfyui_status,
        supported_workspaces: placeholder?.supported_workspaces ?? [],
        sampling_supported: placeholder?.sampling_supported ?? false,
        audit_log_enabled: info.data.audit_log_enabled,
      };
      return;
    }

    this.logger.warn(
      { issues: info.error.issues, fallback: directCaps.error.issues },
      "DiffuseCraftClient: server/info payload failed schema validation — keeping handshake placeholder capabilities",
    );
  }

  async disconnect(): Promise<void> {
    this.assertNotDisposed("disconnect");

    try {
      await this.transport.disconnect();
    } finally {
      this.serverCapabilities = null;
      this.bus.markStatus("disconnected");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Tear down sampling forwarder first so the transport's request
    // handlers do not fire against a half-disposed bus / client.
    try {
      this.samplingForwarder.dispose();
    } catch (err) {
      this.logger.warn({ err }, "DiffuseCraftClient: sampling dispose threw");
    }

    // Dispose the bus before tearing down the transport so the bus's
    // wire-level subscriptions unhook against a still-valid transport.
    try {
      this.bus.dispose();
    } catch (err) {
      this.logger.warn({ err }, "DiffuseCraftClient: event bus dispose threw");
    }

    try {
      await this.transport.disconnect();
    } catch (err) {
      this.logger.warn(
        { err },
        "DiffuseCraftClient: transport disconnect threw during dispose",
      );
    }

    this.serverCapabilities = null;
  }

  getStatus(): ConnectionStatus {
    return this.bus.getStatus();
  }

  // -------------------------------------------------------------------
  // Generic tool dispatch
  // -------------------------------------------------------------------

  /**
   * String-keyed tool dispatch — forwards directly to the underlying
   * transport's `send`. Mirrors the catalog name (`generate_image`,
   * `undo`, etc.) rather than the camelCased shape on `this.tools`,
   * which is the vocabulary `@diffusecraft/core`'s `DiffuseCraftClientLike`
   * shape speaks. Bypasses the `createToolMethods` validation +
   * abort-cascade layer because the typed-methods surface (`this.tools`)
   * is the authoritative entry point for ergonomic callers; this method
   * is the thin passthrough adapters / generic surfaces use.
   */
  invokeTool<N extends ToolName>(
    name: N,
    args: ToolInput<N>,
  ): Promise<ToolOutput<N>>;
  invokeTool<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
  ): Promise<TResult>;
  async invokeTool(name: string, args: unknown): Promise<unknown> {
    this.assertNotDisposed("invokeTool");
    return this.transport.send(
      name as ToolName,
      args as ToolInput<ToolName>,
    );
  }

  /**
   * Read a `diffusecraft://` resource URI. Normalises the MCP wire shape
   * (`{ contents: [{ text }] }`) so callers receive the underlying
   * resource payload directly. The in-memory transport short-circuits
   * this normalisation step.
   */
  async readResource<TResult = unknown>(uri: string): Promise<TResult> {
    this.assertNotDisposed("readResource");
    const raw = await this.transport.readResource(uri as never);
    const payload = extractResourcePayload(raw);
    return payload as TResult;
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * Reject lifecycle calls made after {@link dispose}. Subscribe-side
   * calls (`events.on`, `events.onConnectionStatus`,
   * `sampling.onSample`) are deliberately tolerant of a disposed client
   * — the underlying components return safe no-op unsubscribes — so
   * consumers holding a stale reference do not crash.
   */
  private assertNotDisposed(op: string): void {
    if (this.disposed) {
      throw new ConnectionError(
        `DiffuseCraftClient: ${op}() called after dispose()`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

/**
 * Extra wiring threaded into `buildTransport` from the client class.
 * Held separately from `ClientConfig` because the values close over the
 * client instance (specifically the {@link SamplingForwarder} reference)
 * which only exists after the transport has been constructed. The thunks
 * are invoked lazily — at handshake time — so the forwarder is fully
 * wired by the time the transport reads them.
 */
interface BuildTransportExtras {
  /**
   * Live read of `forwarder.supportsSampling` for J.1 / design.md §10.3.
   * Returns `true` when the consumer has registered a sampling handler;
   * `false` otherwise. The HTTP transport re-evaluates this on every
   * reconnect attempt so a handler attached after the initial `connect()`
   * is observed by the next handshake.
   */
  getSupportsSampling: () => boolean;
}

/**
 * Branch on `config.transport.kind` and return the matching concrete
 * {@link Transport}. The factory uses this once during construction;
 * subsequent reconnect-on-failure logic lives inside the transport
 * itself (HTTP only, B.4) — the client class never re-builds a
 * transport.
 *
 * Threads `clientCapabilities` and the live sampling-state getter
 * (J.1, design.md §10.3) into the wire-bound transports. The in-memory
 * transport ignores both — its handshake is in-process and does not
 * cross an MCP `initialize` boundary.
 */
function buildTransport(
  config: ClientConfig,
  extras: BuildTransportExtras,
): Transport {
  const t = config.transport;
  switch (t.kind) {
    case "in-memory":
      return new InMemoryTransport(t.server);
    case "stdio":
      return new StdioTransport({
        command: t.command,
        args: t.args ?? [],
        clientCapabilities: config.capabilities,
        getSupportsSampling: extras.getSupportsSampling,
      });
    case "http": {
      const reconnect = config.reconnect;
      return new HttpTransport({
        url: t.url,
        token: t.token,
        request_timeout_ms: config.request_timeout_ms,
        clientCapabilities: config.capabilities,
        getSupportsSampling: extras.getSupportsSampling,
        reconnect: {
          enabled: reconnect.enabled,
          max_attempts: reconnect.max_attempts,
          backoff_ms: reconnect.backoff_ms,
        },
      });
    }
    default: {
      // Exhaustiveness guard — Zod has already rejected unknown kinds
      // by this point, but the switch keeps the compiler honest if the
      // discriminated union grows in a future spec.
      const exhaustive: never = t;
      throw new ConnectionError(
        `unknown transport kind: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Resource payload extraction (J.2)
// ---------------------------------------------------------------------------

/**
 * Normalise an MCP `readResource` response into the underlying resource
 * payload. The MCP wire shape returned by HTTP / stdio transports is:
 *
 * ```
 * { contents: [{ uri, mimeType?, text?, blob? }, ...] }
 * ```
 *
 * with the actual payload encoded in `text` (typically JSON) or `blob`
 * (base64 bytes). The in-memory transport short-circuits this and
 * returns the raw payload object directly. This helper accepts BOTH
 * shapes:
 *
 *   - A plain object → returned verbatim (in-memory case).
 *   - A `{ contents: [{ text }] }` object → JSON-parses the first
 *     content's `text` field.
 *   - Anything else → returns `undefined` so callers can log and fall
 *     back to the placeholder.
 *
 * Returning `undefined` (rather than throwing) lets callers log a
 * structured warning without unwinding `connect()` — the spec contract
 * for J.2 is "log but don't fail connect".
 */
function extractResourcePayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return undefined;

  // MCP wire shape: `{ contents: [{ text, ... }] }`.
  const candidate = raw as { contents?: unknown };
  if (Array.isArray(candidate.contents)) {
    const first = candidate.contents[0];
    if (
      first !== null &&
      typeof first === "object" &&
      typeof (first as { text?: unknown }).text === "string"
    ) {
      try {
        return JSON.parse((first as { text: string }).text);
      } catch {
        // Non-JSON text is unexpected for the server/info resource;
        // signal "unrecognised" so the caller falls back gracefully.
        return undefined;
      }
    }
    // Some servers may return structured content directly without a
    // `text` wrapper. Pass that first item through verbatim.
    if (first !== null && typeof first === "object") {
      return first;
    }
    return undefined;
  }

  // In-memory transport short-circuit: the resource resolver returns
  // the raw payload object directly. Pass it through.
  return raw;
}
