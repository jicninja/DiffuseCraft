/**
 * Two-mask split for AI fill (mask-system A.5, FR-19..FR-22).
 *
 * Krita-ai-diffusion `ai_diffusion/selection.py` port. From a single
 * user-authored input mask, produce two derived masks:
 *
 *   - **denoising mask** — controls *where* the diffusion model alters
 *     pixels. Built by dilating the input ("orange offset") and lightly
 *     feathering. Ensures the AI sees a small surrounding context.
 *
 *   - **blend mask** — controls *how* the AI result composites onto the
 *     original. Larger and softer than the denoising mask so the boundary
 *     is invisible.
 *
 * Both derivations are pure functions of the input mask + a small config
 * (`FillSubmodeConfig`-shaped). Callers (the server's
 * `selection-masks.ts` ComfyUI helper) plug the result into the graph.
 */
import { refineMaskBytes } from './operations';

/**
 * Configuration shape consumed by `buildTwoMasks`. Mirrors the relevant
 * subset of `FILL_SUBMODE_CONFIG[mode]` declared in
 * `comfyui-management/graph/fill-config.ts`.
 *
 * Kept structurally typed (no import) so `canvas-core` does not pull
 * `@diffusecraft/server` types — the canvas package stays render/IO-free.
 */
export interface TwoMaskConfig {
  /** Pixels to dilate the denoise mask outward of the user's selection. */
  denoise_offset_px: number;
  /** Edge feather (sigma, px) applied to the denoise mask. */
  denoise_feather_px?: number;
  /** Pixels to dilate the blend mask. Defaults to 2× denoise offset. */
  blend_grow_px?: number;
  /** Blend feather as a percentage of the smaller image side (0..100). */
  blend_feather_pct: number;
}

export interface TwoMasks {
  /** Denoising mask — same dimensions as the input. */
  readonly denoising: Uint8Array;
  /** Blend mask — same dimensions as the input. */
  readonly blend: Uint8Array;
}

/**
 * Build the (denoising, blend) pair from a single authored mask.
 *
 * @param inputMask  User-authored alpha (selection rasterized OR mask layer
 *                   bytes). Length MUST equal `dims.width * dims.height`.
 */
export function buildTwoMasks(
  inputMask: Uint8Array,
  dims: { width: number; height: number },
  config: TwoMaskConfig,
): TwoMasks {
  const expected = dims.width * dims.height;
  if (inputMask.length !== expected) {
    throw new Error(
      `buildTwoMasks: mask length ${inputMask.length} != expected ${expected} for ${dims.width}×${dims.height}.`,
    );
  }
  const denoiseFeather = config.denoise_feather_px ?? 1;
  const denoising = refineMaskBytes(inputMask, dims.width, dims.height, {
    grow_px: config.denoise_offset_px,
    feather_px: denoiseFeather,
  });
  const blendGrow = config.blend_grow_px ?? config.denoise_offset_px * 2;
  const blendFeatherPx = Math.round(
    (Math.min(dims.width, dims.height) * config.blend_feather_pct) / 100,
  );
  const blend = refineMaskBytes(inputMask, dims.width, dims.height, {
    grow_px: blendGrow,
    feather_px: Math.max(1, blendFeatherPx),
  });
  return { denoising, blend };
}
