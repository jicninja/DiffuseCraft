/**
 * Branded id types — re-exported from `@diffusecraft/mcp-tools` (A.3).
 *
 * The MCP catalog is the single source of truth for nominal id types; this
 * file forwards them so canvas-core consumers can `import { LayerId } from
 * '@diffusecraft/canvas-core'` without reaching into the contract layer.
 */
export {
  DocumentId,
  LayerId,
  HistoryItemId,
  JobId,
  RegionId,
  ControlLayerId,
  PresetId,
  BlobId,
  TokenId,
  Ulid,
  asUlid,
} from '@diffusecraft/mcp-tools';
