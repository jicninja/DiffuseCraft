/**
 * Fill sub-mode configuration table (generation-workflow A.2 / FR-9).
 *
 * Maps each `selection_mode` (Fill / Expand / AddContent / RemoveContent /
 * ReplaceBackground) to the denoising-mask, blend-mask, and conditioning
 * parameters the fill-graph builder reads. Values mirror krita-ai-diffusion
 * (`ai_diffusion/selection.py`) defaults; the table is the single source of
 * truth so visual-regression tests (G.4) can pin the numbers.
 *
 * Per FR-19-quat the table is pure data — graph builders consume it; the
 * helpers themselves never read it directly.
 */
export type SelectionSubMode =
  | 'Fill'
  | 'Expand'
  | 'AddContent'
  | 'RemoveContent'
  | 'ReplaceBackground';

export interface FillBuilderConfig {
  /**
   * Pixels by which the denoise mask is dilated outward of the user's
   * selection — krita-ai-diffusion's "orange offset". Larger = more
   * surrounding context absorbed in the diffusion pass.
   */
  denoise_offset_px: number;
  /**
   * Feather (gaussian-blur radius) applied to the blend mask, expressed
   * as a percentage of the selection's smaller side. 0 = hard edge.
   */
  blend_feather_pct: number;
  /**
   * Multiplier on the prompt's CLIP conditioning. <1 weakens the prompt
   * (so surroundings dominate); >1 amplifies it.
   */
  prompt_weight: number;
  /**
   * 0 → ignore surroundings (let prompt drive); 1 → match surroundings
   * (continuation). Routed to the bias parameters of inpaint-aware nodes.
   */
  bias_to_surroundings: number;
  /**
   * When true the builder MUST attach a foreground-preserving control
   * (pose/depth/segmentation) before the fill pass. Used by
   * ReplaceBackground.
   */
  foreground_preserve?: boolean;
  /** Human-readable rationale; surfaced in error hints + audit metadata. */
  description: string;
}

export const FILL_SUBMODE_CONFIG: Readonly<Record<SelectionSubMode, FillBuilderConfig>> = {
  Fill: {
    denoise_offset_px: 8,
    blend_feather_pct: 10,
    prompt_weight: 1.0,
    bias_to_surroundings: 0.5,
    description: 'General purpose inpaint balancing flexibility and blending.',
  },
  Expand: {
    denoise_offset_px: 0,
    blend_feather_pct: 4,
    prompt_weight: 0.5,
    bias_to_surroundings: 0.9,
    description: 'Canvas extension; prefers continuations of existing content.',
  },
  AddContent: {
    denoise_offset_px: 12,
    blend_feather_pct: 6,
    prompt_weight: 1.5,
    bias_to_surroundings: 0.2,
    description: 'Prompt-driven content; allows drastic deviation from surroundings.',
  },
  RemoveContent: {
    denoise_offset_px: 16,
    blend_feather_pct: 12,
    prompt_weight: 0.0,
    bias_to_surroundings: 1.0,
    description: 'Erase + fill from surroundings; prompt optional.',
  },
  ReplaceBackground: {
    denoise_offset_px: 8,
    blend_feather_pct: 8,
    prompt_weight: 1.0,
    bias_to_surroundings: 0.0,
    foreground_preserve: true,
    description: 'Preserve foreground subject (pose/depth detection); replace rest.',
  },
};

/** All five sub-modes as a runtime-iterable array. */
export const SELECTION_SUB_MODES: ReadonlyArray<SelectionSubMode> = [
  'Fill',
  'Expand',
  'AddContent',
  'RemoveContent',
  'ReplaceBackground',
];
