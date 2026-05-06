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
  // TODO(regions): port krita-ai-diffusion `ai_diffusion/region.py`.
  void region_ids;
  return { graph, nextId: startId };
}
