// @diffusecraft/diffusion-client — implemented incrementally per the
// `client-sdk` spec (libs are scaffolded in Phase A, transports in Phase B,
// etc.). Public surface grows as tasks land.
export * from "./config";
export * from "./errors";

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
