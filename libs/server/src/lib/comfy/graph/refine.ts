/**
 * Refine (img2img) graph builder (H.3, FR-17).
 *
 * Scaffold-grade. Loads a source image, encodes it to latents, then runs
 * KSampler at `denoise = 1 - strength/100`. Helpers are stubbed; the full
 * port lives in `generation-workflow`.
 */

import { attachControlLayers } from './helpers/control-layers.js';
import { attachRegions } from './helpers/regions.js';
import { planResolution } from './helpers/resolution.js';
import type { BuilderInput, GraphContext } from './types.js';
import type { ComfyGraph } from '../types.js';

export function buildRefineGraph(input: BuilderInput, ctx: GraphContext): ComfyGraph {
  if (!input.source_image_blob_id) {
    throw new Error('refine requires source_image_blob_id');
  }
  const dims = planResolution({
    width: ctx.document.width,
    height: ctx.document.height,
    factor: ctx.preset.resolution_factor,
  });
  const denoise = (100 - (input.strength ?? 100)) / 100;
  const seed = input.seed === undefined || input.seed === 'random' ? Math.floor(Math.random() * 2 ** 53) : input.seed;

  const graph: ComfyGraph = {};
  let id = 1;
  const ckptId = String(id++);
  graph[ckptId] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ctx.preset.model } };

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

  // Source image → latent. ETN_LoadImageBase64 is the krita-ai-diffusion
  // entry point that lets the server send pixels inline (no file write on
  // the ComfyUI side); the helper is provided by `comfyui-tooling-nodes`.
  const loadId = String(id++);
  graph[loadId] = { class_type: 'ETN_LoadImageBase64', inputs: { image: input.source_image_blob_id } };

  const encodeId = String(id++);
  graph[encodeId] = {
    class_type: 'VAEEncode',
    inputs: { pixels: [loadId, 0], vae: [ckptId, 2] },
  };

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
      denoise,
      model: [ckptId, 0],
      positive: [positiveId, 0],
      negative: [negativeId, 0],
      latent_image: [encodeId, 0],
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

  // Document dims threaded for hires-fix decisions in the full builder.
  void dims;
  return graph;
}
