/**
 * Capability mapping helpers (J.1 / J.2, requirements §3.10 FR-32 / FR-33,
 * design.md §3 — `capabilities` slot, §10.3 — sampling capability declaration).
 *
 * The DiffuseCraft catalog declares its own {@link ClientCapabilities} shape
 * (`accepts_lossy_images`, `max_inline_image_kb`, `streaming_supported`,
 * `prefers_resources_over_tools`, `active_workspace`) — that is what consumers
 * pass through `ClientConfig.capabilities` and what the server reads to tune
 * response serialisation (FR-37 / FR-38 of `mcp-tool-catalog`).
 *
 * The MCP protocol carries its own, smaller {@link McpClientCapabilities}
 * object (`{ sampling?, roots?, elicitation?, experimental?, ... }`) on every
 * `initialize` request. Those two shapes are NOT the same — the catalog
 * shape rides over the wire as `_meta` / handshake-extension fields the
 * server reads from a paired-device record, while the MCP-level slot tells
 * the SDK whether the client can be SAMPLED FROM (i.e. the server can ask
 * the client to call out to an LLM).
 *
 * This module owns the mapping. It exists so:
 *
 *   - Both transports (`http.ts`, `stdio.ts`) construct the MCP `Client`
 *     the same way (FR-7 / FR-8 / FR-10 — uniform behaviour across
 *     transports).
 *   - Sampling capability declaration follows the SamplingForwarder's
 *     state (design.md §10.3 — `supports_sampling: forwarder.supportsSampling`)
 *     instead of a static config flag, so consumers can attach a sampling
 *     handler at any time without re-wiring the transport.
 *   - Future MCP-level capability slots (`roots`, `elicitation`, `tasks`)
 *     can be added in one place when DiffuseCraft starts using them.
 *
 * The mapping deliberately keeps `experimental` empty — DiffuseCraft does
 * not advertise experimental MCP capabilities at the protocol level. The
 * catalog-level `accepts_lossy_images` etc. are read by the SERVER from
 * the paired-device's stored capability record, not from the MCP
 * `initialize` payload.
 */

import type { ClientCapabilities as CatalogClientCapabilities } from "@diffusecraft/mcp-tools";

/**
 * Subset of the MCP wire {@link ClientCapabilities} shape that the SDK
 * actually populates today. Mirrors the slots from
 * `@modelcontextprotocol/sdk`'s `ClientCapabilitiesSchema` we use; the SDK
 * accepts unknown slots so we keep this open-ended for forward
 * compatibility.
 *
 * The MCP SDK's own `ClientCapabilities` type is intentionally NOT
 * imported here — declaring the shape inline keeps the diffusion-client
 * type surface free of the SDK's `Zod`-derived recursive types and lets
 * the build keep the SDK as a peer dependency.
 */
export interface McpClientCapabilities {
  /** Server may ask the client to perform LLM sampling (design.md §10). */
  sampling?: Record<string, unknown>;
  /**
   * Filesystem roots the client exposes. Not used by DiffuseCraft today
   * (the server holds the document state); declared here for forward
   * compatibility.
   */
  roots?: { listChanged?: boolean };
  /** Experimental MCP capabilities — empty by default. */
  experimental?: Record<string, Record<string, unknown>>;
  /**
   * Open slot for future MCP capability namespaces (`elicitation`,
   * `tasks`, etc.). The SDK accepts unknown slots verbatim.
   */
  [key: string]: unknown;
}

/**
 * Inputs to {@link mapToMcpCapabilities}. The catalog capability record is
 * forwarded for documentation / future use; the boolean is the only field
 * that drives the v1 mapping (sampling slot toggle).
 */
export interface MapToMcpCapabilitiesInput {
  /**
   * The DiffuseCraft catalog-level client capabilities the consumer
   * declared on `ClientConfig.capabilities`. Not consumed at the MCP
   * layer in v1 — included so future MCP slot mappings can read from it
   * without changing the call sites.
   */
  catalog: CatalogClientCapabilities;
  /**
   * `true` when the SDK has a sampling handler wired at handshake time
   * (i.e. `forwarder.supportsSampling === true`). `false` when no
   * consumer has registered yet — the SDK omits the `sampling` slot so
   * the server does not believe it can route sampling to this client.
   *
   * Sourced from {@link SamplingForwarder.supportsSampling} which
   * already follows the consumer-registration lifecycle.
   */
  supportsSampling: boolean;
}

/**
 * Map the SDK's combined catalog + sampling-state input to the MCP wire
 * {@link McpClientCapabilities} shape. The result is what the SDK passes
 * to `new Client(clientInfo, { capabilities })` (Phase J.1 — the
 * consumer-declared capabilities surface during MCP `initialize`).
 *
 * Behaviour:
 *   - `supportsSampling: true` → `sampling: {}` (an empty object signals
 *     the capability is supported with no extra options — design.md
 *     §10.3 / MCP spec).
 *   - `supportsSampling: false` → no `sampling` key (omitting the field
 *     is the canonical "not supported" signal in the MCP spec).
 *   - `roots` is always omitted — DiffuseCraft does not expose
 *     filesystem roots to the server.
 *   - `experimental` is always omitted — DiffuseCraft does not advertise
 *     experimental MCP capabilities at the protocol level.
 *
 * The result is a fresh object so transport callers can mutate it in
 * place if they need to layer additional fields without affecting other
 * call sites. The catalog field is read but not echoed — server-side
 * reading happens via the paired-device record, not the MCP handshake.
 */
export function mapToMcpCapabilities(
  input: MapToMcpCapabilitiesInput,
): McpClientCapabilities {
  const out: McpClientCapabilities = {};
  if (input.supportsSampling) {
    out.sampling = {};
  }
  // `input.catalog` is intentionally unused at this layer; the field is
  // accepted so future mappings (e.g. surfacing
  // `streaming_supported` as an MCP-level hint) can add entries without
  // changing call sites. Reference it explicitly so `noUnusedParameters`
  // does not strip the parameter.
  void input.catalog;
  return out;
}
