/**
 * Upscale graph builder (H.5, FR-17).
 *
 * Scaffold-grade tile-based upscale. Loads the source image, runs an
 * `UpscaleModelLoader` + `ImageUpscaleWithModel` pair, then saves. Tile
 * splitting + per-tile diffusion refinement (Ultimate SD Upscale) are
 * owned by the `upscale-and-tiling` spec.
 */

import type { BuilderInput, GraphContext } from './types.js';
import type { ComfyGraph } from '../types.js';

export function buildUpscaleGraph(input: BuilderInput, ctx: GraphContext): ComfyGraph {
  if (!input.source_image_blob_id) throw new Error('upscale requires source_image_blob_id');
  const factor = input.factor ?? 2;
  const upscaler = input.upscaler_model ?? 'RealESRGAN_x4plus.pth';
  void factor;

  const graph: ComfyGraph = {};
  let id = 1;
  const loadId = String(id++);
  graph[loadId] = { class_type: 'ETN_LoadImageBase64', inputs: { image: input.source_image_blob_id } };

  const upscalerId = String(id++);
  graph[upscalerId] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaler } };

  const upscaleId = String(id++);
  graph[upscaleId] = {
    class_type: 'ImageUpscaleWithModel',
    inputs: { upscale_model: [upscalerId, 0], image: [loadId, 0] },
  };

  const saveId = String(id++);
  graph[saveId] = {
    class_type: 'SaveImage',
    inputs: { images: [upscaleId, 0], filename_prefix: `diffusecraft/${ctx.job_id}` },
  };

  return graph;
}
