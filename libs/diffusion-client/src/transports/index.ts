/**
 * Transports barrel. Re-exports the uniform `Transport` interface (A.5) and
 * its auxiliary types. Concrete transport implementations (HTTP, stdio,
 * in-memory) land in Phase B and will be re-exported from here as they ship.
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
