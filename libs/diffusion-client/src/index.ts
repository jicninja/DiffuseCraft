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
