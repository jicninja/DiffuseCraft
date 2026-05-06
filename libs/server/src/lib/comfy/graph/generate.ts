/**
 * Generate (txt2img) graph builder (H.2, FR-17).
 *
 * Scaffold-grade implementation per the comfyui-management spec scope.
 * Produces a valid ComfyUI graph with the canonical 7-node txt2img
 * topology:
 *
 *   CheckpointLoaderSimple → CLIPTextEncode (positive)
 *                           → CLIPTextEncode (negative)
 *                           → EmptyLatentImage
 *                           → KSampler → VAEDecode → SaveImage
 *
 * Control-layer / region / selection-mask attachment goes through the
 * helpers (currently stubs). The full krita-ai-diffusion port lands per
 * the `generation-workflow` spec; this build is sufficient to round-trip
 * a `prompt_id` through the mock ComfyUI in our tests.
 */

import { attachControlLayers } from './helpers/control-layers.js';
import { attachRegions } from './helpers/regions.js';
import { planResolution } from './helpers/resolution.js';
import type { BuilderInput, GraphContext } from './types.js';
import type { ComfyGraph } from '../types.js';

export function buildGenerateGraph(input: BuilderInput, ctx: GraphContext): ComfyGraph {
  const dims = planResolution({
    width: ctx.document.width,
    height: ctx.document.height,
    factor: ctx.preset.resolution_factor,
  });
  const seed = input.seed === undefined || input.seed === 'random' ? randomSeed() : input.seed;
  const batch = input.batch_size ?? 1;

  const graph: ComfyGraph = {};
  let id = 1;
  const ckptId = String(id++);
  graph[ckptId] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: ctx.preset.model },
  };

  const positiveId = String(id++);
  graph[positiveId] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: input.prompt, clip: [ckptId, 1] },
  };

  const negativeId = String(id++);
  graph[negativeId] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: input.negative_prompt ?? '', clip: [ckptId, 1] },
  };

  const latentId = String(id++);
  graph[latentId] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: dims.width, height: dims.height, batch_size: batch },
  };

  // Helpers — currently no-op pass-throughs in scaffold form.
  ({ nextId: id } = attachControlLayers(input.control_layer_ids ?? [], graph, id, ctx));
  ({ nextId: id } = attachRegions(input.region_ids ?? [], graph, id, ctx));

  const samplerId = String(id++);
  graph[samplerId] = {
    class_type: 'KSampler',
    inputs: {
      seed,
      steps: ctx.preset.steps,
      cfg: ctx.preset.cfg,
      sampler_name: ctx.preset.sampler,
      scheduler: ctx.preset.scheduler,
      denoise: 1.0,
      model: [ckptId, 0],
      positive: [positiveId, 0],
      negative: [negativeId, 0],
      latent_image: [latentId, 0],
    },
  };

  const decodeId = String(id++);
  graph[decodeId] = {
    class_type: 'VAEDecode',
    inputs: { samples: [samplerId, 0], vae: [ckptId, 2] },
  };

  const saveId = String(id++);
  graph[saveId] = {
    class_type: 'SaveImage',
    inputs: { images: [decodeId, 0], filename_prefix: `diffusecraft/${ctx.job_id}` },
  };

  return graph;
}

function randomSeed(): number {
  // ComfyUI accepts a 64-bit seed; we generate a 53-bit safe-integer seed
  // because JS numbers are doubles. Good enough for `seed = "random"`.
  return Math.floor(Math.random() * 2 ** 53);
}
