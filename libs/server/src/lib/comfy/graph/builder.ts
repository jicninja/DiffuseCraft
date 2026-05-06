/**
 * Graph builder dispatch (H.1, FR-19-bis).
 *
 * The single entry point downstream code uses to obtain a ComfyUI graph
 * for any resolved verb. Per FR-19-quat, helpers do not call each other —
 * cross-helper composition lives **only** in the verb files (`generate.ts`,
 * `refine.ts`, `fill.ts`, `upscale.ts`).
 *
 * The dispatcher is intentionally thin (5 lines of switch); business logic
 * sits in the per-verb modules.
 */

import { buildFillGraph } from './fill.js';
import { buildGenerateGraph } from './generate.js';
import { buildRefineGraph } from './refine.js';
import { buildUpscaleGraph } from './upscale.js';
import type { BuilderInput, GraphContext } from './types.js';
import type { ComfyGraph } from '../types.js';

export type ResolvedVerb = 'generate' | 'refine' | 'fill' | 'constrained_variation' | 'upscale';

/**
 * Build a workflow graph from the resolved verb + builder input.
 *
 * `constrained_variation` is the strength<100 + selection case from
 * `generate_image`; it shares logic with refine but threads the selection
 * id through. The scaffold builders treat it as `refine` with the selection
 * preserved.
 */
export function buildGraph(verb: ResolvedVerb, input: BuilderInput, ctx: GraphContext): ComfyGraph {
  switch (verb) {
    case 'generate':
      return buildGenerateGraph(input, ctx);
    case 'refine':
      return buildRefineGraph(input, ctx);
    case 'fill':
      return buildFillGraph(input, ctx);
    case 'constrained_variation':
      return buildRefineGraph(input, ctx);
    case 'upscale':
      return buildUpscaleGraph(input, ctx);
  }
}

export type { BuilderInput, GraphContext, GraphPreset } from './types.js';
