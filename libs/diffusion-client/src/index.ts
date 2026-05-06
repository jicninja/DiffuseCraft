// @diffusecraft/diffusion-client — implemented incrementally per the
// `client-sdk` spec (libs are scaffolded in Phase A, transports in Phase B,
// etc.). Public surface grows as tasks land.
export * from "./config";
export * from "./errors";

/**
 * `createDiffuseCraftClient(config)` factory + `DiffuseCraftClient`
 * interface (FR-1 / FR-2, design.md §3). The factory composes every
 * Phase-A-through-K artifact (transports, event bus, tool methods,
 * resource readers, pairing client, image helpers, sampling forwarder)
 * into a single typed client surface — the entry point every consumer
 * uses.
 */
export { createDiffuseCraftClient } from "./client.js";
export type { DiffuseCraftClient } from "./client.js";

/**
 * `Transport` interface (FR-6 / design.md §4). Re-exported on the public
 * surface so consumers can declare custom transports — e.g. test doubles,
 * embedded harnesses — that the `DiffuseCraftClient` will accept verbatim.
 */
export type {
  Transport,
  Unsubscribe,
  HandshakeResult,
  TransportSendOptions,
  TransportReadResourceOptions,
  ResourceReadQuery,
  TransportSamplingRequest,
  TransportSamplingResponse,
  TransportSamplingHandler,
} from "./transports";

/**
 * In-memory transport (FR-9, B.1). Hosts that own the server in-process
 * (MeshCraft, integration tests, the `client-state-architecture` test
 * harness) construct this directly and pass it to the eventual
 * `createDiffuseCraftClient` (Phase B.6).
 */
export { InMemoryTransport, createInMemoryTransport } from "./transports";

/**
 * stdio transport (FR-8, B.2). Spawns a child process via
 * `@modelcontextprotocol/sdk`'s `StdioClientTransport` and exchanges
 * MCP framing on stdin/stdout. Node-only — must not be imported from
 * browser environments.
 */
export { StdioTransport, createStdioTransport } from "./transports";
export type { StdioTransportConfig } from "./transports";

/**
 * HTTP transport (FR-7, B.3). Speaks MCP over the Streamable HTTP profile
 * via `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`,
 * carrying a bearer token on the `Authorization` header of every fetch
 * (POST + long-lived SSE GET + DELETE). Runtime-portable across Node
 * 18+ and modern browsers. Reconnect orchestration (FR-29 / FR-30 /
 * FR-31) lives in B.4.
 */
export { HttpTransport, createHttpTransport } from "./transports";
export type { HttpTransportConfig } from "./transports";

/**
 * Type re-exports from `@diffusecraft/mcp-tools` (requirements §3.1 FR-3,
 * design.md §3). Consumers can call typed SDK methods without taking a
 * direct dependency on the catalog package.
 */
export type {
  ToolName,
  ToolInput,
  ToolOutput,
  EventName,
  EventPayload,
  ResourceUri,
  ImageEnvelope,
} from "@diffusecraft/mcp-tools";

/**
 * Generated tool methods (FR-11 / FR-12, design.md §3 + §5, C.1).
 * `TypedToolMethods` is the mapped type one-method-per-catalog-tool; the
 * `DiffuseCraftClient.tools` field (Phase B.6) holds an instance built
 * by `createToolMethods(transport)`. Hand-written wrappers (C.2) plug in
 * via the `wrappers` argument; client-side Zod validation (C.3), typed
 * server errors (C.4), and `AbortSignal` cascading (C.5) layer on top.
 */
export {
  abortError,
  callToolWithAbort,
  createToolMethods,
  toCamelCase,
  validateToolInput,
} from "./tools/index.js";
export type {
  CamelCase,
  TypedToolMethods,
  ToolCallOptions,
  ToolMethodWrappers,
} from "./tools/index.js";

/**
 * Generated resource readers (FR-16 / FR-17 / FR-18, design.md §3 + §6,
 * D.1 + D.2 + D.3). `TypedResourceReaders` is the namespace tree the
 * `DiffuseCraftClient.resources` field (Phase B.6) holds, built at
 * construction time by `createResourceReaders(transport)`. Per-call
 * `ResourceReadOptions` carry `since` / `fields` (FR-17, D.2) and an
 * optional `AbortSignal`; paginated namespaces additionally expose
 * `iterate(...)` async iterators (FR-18, D.3) that thread `next_cursor`
 * through successive reads.
 */
export {
  camelCaseSegments,
  createResourceReaders,
  fillResourceUri,
  isPaginatedSchema,
  parseResourceUri,
} from "./resources/index.js";
export type {
  ParamIterator,
  ParamReader,
  ParsedResourceUri,
  PaginatedPage,
  ResourceIterateOptions,
  ResourceNamespace,
  ResourceReadOptions,
  TypedResourceReaders,
  ZeroArgIterator,
  ZeroArgReader,
} from "./resources/index.js";

/**
 * Buffered event bus (FR-19 / FR-20 / FR-21, design.md §3 + §7, E.1 + E.2 +
 * E.3). `EventBus` owns per-event-name listener sets, a per-event-name FIFO
 * buffer capped at `event_buffer_size` (FIFO discard with logger.warn on
 * overflow), and the connection-status channel (`onConnectionStatus`,
 * `markStatus`). The eventual `DiffuseCraftClient` (B.6) constructs one
 * bus per session and exposes the typed `events` namespace on top of it;
 * the in-memory transport delivers events synchronously while HTTP / stdio
 * subscriptions are gated by the `server-architecture` upstream
 * notification-publication gap (the bus logs a warning and proceeds).
 */
export { EventBus } from "./events/index.js";
export type {
  ConnectionStatus,
  ConnectionStatusListener,
  EventBusOptions,
  EventListener,
  HttpStatusSource,
} from "./events/index.js";

/**
 * Pairing client (FR-22 / FR-23 / FR-24 / FR-25, design.md §9, F.1–F.5).
 * `PairingClient` exposes the four entry points the tablet (and any
 * other consumer) uses to onboard against a server: `discover()` (mDNS
 * via the consumer-supplied {@link MdnsAdapter}), `requestPair()`
 * (POST `/pair` + host-approval hook wait), `parseQr()` (decode the
 * base64url QR payload), and `parseManual()` (parse the
 * `?t=<token>` paste line). The eventual `DiffuseCraftClient.pairing`
 * field (Phase B.6) holds an instance constructed from the consumer's
 * adapters.
 */
export { PairingClient } from "./pairing/index.js";
export type {
  DiscoverOptions,
  DiscoveredBackend,
  ManualPayload,
  PairingClientOptions,
  PairResult,
  QrPayload,
  RequestPairOptions,
} from "./pairing/index.js";

/**
 * mDNS adapter constants + auxiliary types (FR-22, design §12, F.1).
 * The authoritative `MdnsAdapter` interface is re-exported from
 * `config.ts` (above, via `export * from "./config"`) so consumers can
 * spell it the same way they spell other config-side adapter types.
 * {@link DEFAULT_MDNS_SERVICE_NAME} is the canonical service type the
 * server advertises (`_diffusecraft._tcp.local`).
 */
export { DEFAULT_MDNS_SERVICE_NAME } from "./adapters/mdns.js";
export type { MdnsScanOptions } from "./adapters/mdns.js";

/**
 * Secure-store adapter (G.1, FR-26 / FR-28, design §12). Consumers
 * supply a concrete adapter via `ClientConfig.adapters.secureStore`;
 * tests + Node-side use can opt into the bundled
 * {@link InMemorySecureStoreAdapter}. The interface re-exported from
 * `config.ts` (above) is structurally identical — both spellings
 * resolve to the same shape.
 */
export { InMemorySecureStoreAdapter } from "./adapters/secure-store.js";

/**
 * QR-scanner adapter (G.2, FR-22, design §12). Consumers supply a
 * concrete adapter via `ClientConfig.adapters.qrScanner` (the tablet
 * uses Expo Camera + ML Kit). The auxiliary {@link QrScannerScanOptions}
 * shape is re-exported here so consumers can declare adapter
 * implementations against the canonical type.
 */
export type { QrScannerScanOptions } from "./adapters/qr-scanner.js";

/**
 * Image envelope helpers (H.1 + H.2, FR-34 / FR-35, design §11).
 * Consumers usually call `client.image.fetch(envelope)` /
 * `client.image.upload(bytes, format, transport, opts)` after Phase B.6
 * wires the namespace; the standalone functions are re-exported here
 * so test harnesses + advanced consumers can call them without going
 * through the full client.
 */
export { fetchImage, uploadImage } from "./image/index.js";
export type { UploadImageOptions } from "./image/index.js";

/**
 * Sampling forwarder (Phase I, FR-2 sampling slot, design.md §10).
 * `SamplingForwarder` is the canonical bridge between the SDK's
 * transport-level sampling channel and a single consumer-registered
 * handler. The {@link DiffuseCraftClient.sampling} field wraps an
 * instance internally; advanced consumers / tests can construct one
 * directly to drive the forwarder against a custom transport.
 *
 * `SamplingHandler` is the consumer-facing handler signature surfaced
 * via `client.sampling.onSample(handler)`.
 */
export { SamplingForwarder } from "./sampling/index.js";
export type { SamplingHandler } from "./sampling/index.js";

/**
 * Token-provider helpers (K.1 + K.2 + K.3, FR-26 / FR-27 / FR-23,
 * design §3 / §9 / §11).
 *
 * - {@link TokenCache}: ~5 minute resolver cache around a
 *   {@link TokenProvider} (FR-27). Used internally by
 *   {@link HttpTransport}; re-exported so consumers / tests can
 *   construct one directly.
 * - {@link TokenStore}: {@link SecureStoreAdapter}-backed persistence
 *   wrapper (FR-26 / FR-28).
 * - {@link TokenRotationHook}: token-rotation observer + persistence
 *   fan-out (FR-23). Wired-in placeholder until the catalog gains a
 *   wire-level rotation event; the SDK side is a fully functional
 *   observer ready for consumers (the connection store) to register
 *   listeners against.
 */
export {
  DEFAULT_TOKEN_CACHE_TTL_MS,
  DEFAULT_TOKEN_STORAGE_KEY,
  TokenCache,
  TokenStore,
  TokenRotationHook,
} from "./shared/token-provider.js";
export type {
  TokenRotationEvent,
  TokenRotationListener,
} from "./shared/token-provider.js";

/**
 * Catalog → MCP capability mapping (J.1, FR-32, design.md §10.3).
 * Re-exported so test harnesses + advanced consumers can verify the
 * exact MCP wire shape advertised at handshake without going through
 * the full transport.
 */
export { mapToMcpCapabilities } from "./shared/capabilities-map.js";
export type {
  McpClientCapabilities,
  MapToMcpCapabilitiesInput,
} from "./shared/capabilities-map.js";
