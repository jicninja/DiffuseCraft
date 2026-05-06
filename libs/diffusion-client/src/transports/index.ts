/**
 * Transports barrel. Re-exports the uniform `Transport` interface (A.5) and
 * its auxiliary types. Concrete transport implementations (HTTP, stdio,
 * in-memory) land in Phase B and are re-exported from here as they ship.
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
} from "./transport";

/**
 * In-memory transport (FR-9 / FR-10, B.1). Public so embedding hosts
 * (MeshCraft, integration tests) can construct it directly without
 * routing through `createDiffuseCraftClient`.
 */
export { InMemoryTransport, createInMemoryTransport } from "./in-memory";

/**
 * stdio transport (FR-8 / FR-10, B.2). Public so Node-side hosts (CLI
 * harnesses, agent integrations) can construct it directly. Browser
 * environments must not import this — it depends on `child_process`
 * via `@modelcontextprotocol/sdk/client/stdio`.
 */
export { StdioTransport, createStdioTransport } from "./stdio";
export type { StdioTransportConfig } from "./stdio";

/**
 * HTTP transport (FR-7 / FR-10, B.3). Wraps
 * `@modelcontextprotocol/sdk/client/streamableHttp` and rides bearer-token
 * auth on the `Authorization` header of every fetch. Runtime-portable —
 * Node 18+ and modern browsers ship the required `fetch` + `URL` globals.
 * Reconnect orchestration (FR-29 / FR-30 / FR-31) lives in B.4.
 */
export { HttpTransport, createHttpTransport } from "./http";
export type { HttpTransportConfig } from "./http";

/**
 * Reconnect orchestration (FR-29 / FR-30 / FR-31, B.4). Public surface
 * exposes the policy type and the status enum so Phase B.6's
 * `DiffuseCraftClient.events.onConnectionStatus(...)` and the
 * `getStatus()` projection can speak the same vocabulary as the
 * transport-level emitter.
 */
export { Reconnector, RECONNECT_FAILED_CAUSE } from "./reconnect";
export type { ReconnectConfig, ReconnectStatus, ReconnectorParams, ReconnectOutcome } from "./reconnect";
