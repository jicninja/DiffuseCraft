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
} from "./transport.js";

/**
 * In-memory transport (FR-9 / FR-10, B.1). Public so embedding hosts
 * (MeshCraft, integration tests) can construct it directly without
 * routing through `createDiffuseCraftClient`.
 */
export { InMemoryTransport, createInMemoryTransport } from "./in-memory.js";
