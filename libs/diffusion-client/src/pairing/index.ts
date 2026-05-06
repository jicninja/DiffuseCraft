/**
 * Public surface of the `pairing/` module (design.md §2 / §9,
 * FR-22…FR-25). The root `index.ts` re-exports from here so consumers
 * import as `import { PairingClient, ... } from "@diffusecraft/diffusion-client"`.
 */

export { PairingClient } from "./client";
export type { PairingClientOptions } from "./client";
export type {
  DiscoverOptions,
  DiscoveredBackend,
  ManualPayload,
  PairResult,
  QrPayload,
  RequestPairOptions,
} from "./types";
