/**
 * Selection-mask helper (mask-system G.1 / G.2, FR-19..FR-22).
 *
 * Krita-ai-diffusion `ai_diffusion/selection.py` port. From a single
 * authored selection mask, emit two ComfyUI mask channels:
 *
 *   - **Denoising mask** — controls *where* the diffusion model alters
 *     pixels. Mirrors the user's input grown by `denoise_offset_px`
 *     ("orange offset") with a small feather to avoid hard edges.
 *
 *   - **Blend mask** — controls alpha composition of the AI result onto
 *     the original. Larger and softer than the denoising mask.
 *
 * The full pure-byte implementation lives in
 * `@diffusecraft/canvas-core/mask/two-mask-split` (`buildTwoMasks`); this
 * helper assembles the equivalent ComfyUI graph nodes so the model
 * consumes the same semantics at submission time. The
 * `FillSubmodeConfig`-shaped config drives the parameters per
 * `selection_mode` (Fill / Expand / AddContent / RemoveContent /
 * ReplaceBackground).
 *
 * The graph topology emitted here:
 *
 *   ETN_LoadMaskBase64(selection_id)
 *      ├──► INPAINT_GrowMask(grow_px=denoise_offset_px) ──► INPAINT_FeatherMask(feather_px=denoise_feather_px) → denoise
 *      └──► INPAINT_GrowMask(grow_px=blend_grow_px)     ──► INPAINT_FeatherMask(feather_px=blend_feather_px)   → blend
 *
 * The class names are chosen to match the krita-ai-diffusion node pack
 * (`ComfyUI-Inpaint-Nodes` per `required-nodes.ts`); when a node is
 * absent (e.g. older installs) the validation step surfaces it before
 * any job submission.
 */

import type { ComfyGraph } from '../../types.js';
import type { FillBuilderConfig } from '../fill-config.js';

export interface SelectionMasks {
  /** `[node_id, slot]` reference for the denoising mask. */
  denoise: readonly [string, number] | null;
  /** `[node_id, slot]` reference for the blend mask. */
  blend: readonly [string, number] | null;
}

export interface BuildSelectionMasksArgs {
  /** Selection blob/asset id supplied by the handler. `null` short-circuits to a no-op. */
  selection_id: string | null;
  /** Mutable graph the helper writes nodes into. */
  graph: ComfyGraph;
  /** Next free node id to allocate from. */
  startId: number;
  /** Submode config (denoise offset, feather percentages, etc.). */
  config: FillBuilderConfig;
  /** Document dimensions — needed for the blend feather pct → px conversion. */
  dims: { width: number; height: number };
}

export interface BuildSelectionMasksResult {
  graph: ComfyGraph;
  /** Next free node id after allocation. */
  nextId: number;
  masks: SelectionMasks;
}

export function buildSelectionMasks(
  arg1: string | null | BuildSelectionMasksArgs,
  graph?: ComfyGraph,
  startIdArg?: number,
): BuildSelectionMasksResult {
  // ---- Backward-compat 3-arg form (selection_id, graph, startId) ----
  // The pre-mask-system stub used the simpler signature; preserve it so
  // callers that haven't migrated to the config-driven form (or call
  // sites under generation-workflow tests) compile unchanged.
  if (typeof arg1 !== 'object' || arg1 === null) {
    const selection_id = arg1 as string | null;
    const g = graph as ComfyGraph;
    const startId = startIdArg as number;
    return {
      graph: g,
      nextId: startId,
      masks: { denoise: null, blend: null },
    };
  }

  const { selection_id, graph: gIn, startId, config, dims } = arg1;
  if (!selection_id) {
    return { graph: gIn, nextId: startId, masks: { denoise: null, blend: null } };
  }

  let id = startId;
  const loadId = String(id++);
  gIn[loadId] = {
    class_type: 'ETN_LoadMaskBase64',
    inputs: { mask: selection_id },
  };

  // Denoise mask: grow by `denoise_offset_px` and feather lightly.
  const denoiseGrowId = String(id++);
  gIn[denoiseGrowId] = {
    class_type: 'INPAINT_GrowMask',
    inputs: {
      mask: [loadId, 0],
      grow_px: config.denoise_offset_px,
    },
  };
  const denoiseFeatherId = String(id++);
  // Default denoise feather is 1 px; krita-ai-diffusion tunes it per submode
  // implicitly via blend_feather_pct, but we keep a small minimum so the
  // boundary isn't a hard 0/255 step.
  gIn[denoiseFeatherId] = {
    class_type: 'INPAINT_FeatherMask',
    inputs: {
      mask: [denoiseGrowId, 0],
      feather_px: 1,
    },
  };

  // Blend mask: grow by 2× the denoise offset, feather by `blend_feather_pct`%
  // of the smaller image side (krita-ai-diffusion convention).
  const blendGrowId = String(id++);
  const blendGrowPx = config.denoise_offset_px * 2;
  gIn[blendGrowId] = {
    class_type: 'INPAINT_GrowMask',
    inputs: {
      mask: [loadId, 0],
      grow_px: blendGrowPx,
    },
  };
  const blendFeatherId = String(id++);
  const blendFeatherPx = Math.max(
    1,
    Math.round((Math.min(dims.width, dims.height) * config.blend_feather_pct) / 100),
  );
  gIn[blendFeatherId] = {
    class_type: 'INPAINT_FeatherMask',
    inputs: {
      mask: [blendGrowId, 0],
      feather_px: blendFeatherPx,
    },
  };

  return {
    graph: gIn,
    nextId: id,
    masks: {
      denoise: [denoiseFeatherId, 0],
      blend: [blendFeatherId, 0],
    },
  };
}
