/**
 * Resolution helpers (H.9, FR-18).
 *
 * Trim ComfyUI dimensions to multiples of N (8 / 16 / 64), apply a
 * `resolution_multiplier`, and decide whether to enable hires-fix when the
 * target size exceeds the model's native trained range.
 *
 * The full algorithm (with batch splitting + max pixel cap) is owned by
 * the `resolution-handling` spec; this file ships the minimal surface
 * `comfyui-management` needs for the scaffold builders.
 */

export interface ResolutionInput {
  width: number;
  height: number;
  /** ComfyUI requires width/height to be multiples of this factor. */
  factor: number;
  /** Optional pre-multiplier (preset-driven). */
  multiplier?: number;
  /** Cap on total pixel count; aspect ratio preserved when scaling down. */
  max_pixels?: number;
}

export interface ResolutionPlan {
  width: number;
  height: number;
  /**
   * `true` iff the requested dimensions exceed the model's native range,
   * meaning the builder should compose two passes (latent + upscale + 2nd
   * sampler with `denoise: 0.4-0.6`).
   */
  hires_fix: boolean;
}

/**
 * Round dimensions to a multiple of `factor` and apply the multiplier +
 * max-pixel cap. Returns the adjusted dimensions plus whether hires-fix
 * should be applied.
 */
export function planResolution(input: ResolutionInput): ResolutionPlan {
  const mult = input.multiplier ?? 1;
  let w = Math.max(input.factor, Math.round((input.width * mult) / input.factor) * input.factor);
  let h = Math.max(input.factor, Math.round((input.height * mult) / input.factor) * input.factor);

  if (input.max_pixels && w * h > input.max_pixels) {
    const scale = Math.sqrt(input.max_pixels / (w * h));
    w = Math.max(input.factor, Math.round((w * scale) / input.factor) * input.factor);
    h = Math.max(input.factor, Math.round((h * scale) / input.factor) * input.factor);
  }

  // Heuristic: SDXL's native is ~1024x1024 (~1M pixels). Anything ≥1.5x is
  // hires-fix territory. Engines with different native ranges should
  // override via the resolution-handling spec.
  const native = 1024 * 1024;
  const hires_fix = w * h > native * 1.5;
  return { width: w, height: h, hires_fix };
}
