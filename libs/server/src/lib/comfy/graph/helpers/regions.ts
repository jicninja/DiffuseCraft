/**
 * Region helper stub (H.7, FR-18 partial).
 *
 * Per-region prompt + mask conditioning. Full implementation lives in the
 * `regions` spec (krita-ai-diffusion `ai_diffusion/region.py` port). The
 * stub keeps the verb builder dispatch path linear.
 */

import type { ComfyGraph } from '../../types.js';
import type { GraphContext } from '../types.js';

export interface AttachRegionsResult {
  graph: ComfyGraph;
  nextId: number;
}

export function attachRegions(
  region_ids: ReadonlyArray<string>,
  graph: ComfyGraph,
  startId: number,
  _ctx: GraphContext,
): AttachRegionsResult {
  if (region_ids.length === 0) {
    return { graph, nextId: startId };
  }
  // Non-empty: the krita-ai-diffusion `ai_diffusion/region.py` port
  // (~550 LOC) is owned by the `regions` spec. Refuse loudly so callers
  // observe a clear error instead of a silently-dropped argument.
  throw Object.assign(new Error('REGIONS_NOT_IMPLEMENTED'), {
    code: 'REGIONS_NOT_IMPLEMENTED',
    cause: {
      hint: 'region_ids is currently unsupported (regions spec pending). Pass [] or omit the field.',
      requested_count: region_ids.length,
    },
  });
}
