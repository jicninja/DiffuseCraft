/**
 * Sampling barrel — re-exports the sampling forwarder (Phase I, design.md
 * §2 / §10).
 *
 * The {@link DiffuseCraftClient.sampling} field (design.md §3) wraps a
 * {@link SamplingForwarder} so consumers register a single handler via
 * `client.sampling.onSample(handler)`. The forwarder bridges that slot
 * to the transport's MCP sampling channel.
 */

export { SamplingForwarder } from "./forwarder";
export type { SamplingHandler } from "./forwarder";
