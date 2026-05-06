/**
 * Fill (inpaint) graph builder (H.4, FR-17).
 *
 * Scaffold-grade. Composes a source image + a denoising mask (selection,
 * via the mask helper) and runs the inpaint pipeline. The full implementation
 * — selection-aware blending, fooocus inpaint head, the four selection_mode
 * variants (Fill / Expand / AddContent / RemoveContent / ReplaceBackground)
 * — lives in `generation-workflow` + `mask-system`.
 */

import { attachControlLayers } from './helpers/control-layers.js';
import { attachRegions } from './helpers/regions.js';
import { buildSelectionMasks } from './helpers/selection-masks.js';
import { planResolution } from './helpers/resolution.js';
import { FILL_SUBMODE_CONFIG, type SelectionSubMode } from './fill-config.js';
import type { BuilderInput, GraphContext } from './types.js';
import type { ComfyGraph } from '../types.js';

export function buildFillGraph(input: BuilderInput, ctx: GraphContext): ComfyGraph {
  if (!input.source_image_blob_id) throw new Error('fill requires source_image_blob_id');
  if (!input.selection_id) throw new Error('fill requires selection_id');
  // Sub-mode → mask + conditioning weights table. Defaults to "Fill" so the
  // strength<100 + selection ("constrained_variation") path can re-use the
  // builder without re-asserting the discriminator (resolveVerb routes it).
  const subMode: SelectionSubMode = (input.selection_mode as SelectionSubMode | undefined) ?? 'Fill';
  const submodeCfg = FILL_SUBMODE_CONFIG[subMode];

  const dims = planResolution({
    width: ctx.document.width,
    height: ctx.document.height,
    factor: ctx.preset.resolution_factor,
  });
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

  // Sub-mode → conditioning strength on the prompt branch. The scaffold
  // surfaces the sub-mode weight via `ConditioningSetAreaStrength` so
  // graph-level inspection (tests + audit) can pin which submode produced
  // which cond weight without exhuming KSampler internals.
  const condWeightId = String(id++);
  graph[condWeightId] = {
    class_type: 'ConditioningSetAreaStrength',
    inputs: {
      conditioning: [positiveId, 0],
      strength: submodeCfg.prompt_weight,
    },
  };

  const loadId = String(id++);
  graph[loadId] = { class_type: 'ETN_LoadImageBase64', inputs: { image: input.source_image_blob_id } };

  // Selection masks (denoise + blend). Mask-system G.1 / G.2 wires the
  // helper to emit ComfyUI grow + feather nodes for both masks per
  // krita-ai-diffusion semantics; the references are stashed for the
  // KSampler / blend stages downstream specs will wire.
  const selMasks = buildSelectionMasks({
    selection_id: input.selection_id,
    graph,
    startId: id,
    config: submodeCfg,
    dims: { width: dims.width, height: dims.height },
  });
  id = selMasks.nextId;
  void selMasks.masks;

  // ReplaceBackground requires a foreground-preserving control attachment
  // (pose / depth / segmentation). The scaffold injects an inpaint-aware
  // mask blend node so visual-regression baselines can pin the topology;
  // the real ControlNet wiring lands when `control-layers` ports
  // krita-ai-diffusion's preprocessor stack.
  if (submodeCfg.foreground_preserve) {
    const fgPreserveId = String(id++);
    graph[fgPreserveId] = {
      class_type: 'INPAINT_DenoiseToMask',
      inputs: {
        denoise_offset_px: submodeCfg.denoise_offset_px,
        bias_to_surroundings: submodeCfg.bias_to_surroundings,
        feather_pct: submodeCfg.blend_feather_pct,
        preserve_foreground: true,
      },
    };
  }

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
      denoise: 1.0,
      model: [ckptId, 0],
      positive: [condWeightId, 0],
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

  void dims;
  return graph;
}
