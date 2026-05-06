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
