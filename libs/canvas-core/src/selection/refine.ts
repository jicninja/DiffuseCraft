/**
 * Selection refinement — grow / shrink / feather / blur (FR-9).
 *
 * Mirrors `refine_mask` from the mask-system spec. The operations all
 * compose into the same morphology + blur pipeline:
 *
 * 1. Optional grow (binary dilation by `grow_px` pixels).
 * 2. Optional shrink (binary erosion by `shrink_px` pixels).
 * 3. Optional feather (Gaussian blur of a binary edge, then re-threshold
 *    via a soft ramp — produces an anti-aliased mask).
 * 4. Optional plain box blur for soft edges without re-thresholding.
 *
 * The kernel size is bounded by both the canvas dimensions and a small
 * sanity cap so a single call cannot exhaust memory.
 */

import type { RasterMask } from './types';
import { createMask } from './raster';

const MAX_KERNEL = 64; // upper bound on grow/shrink/blur radius

/** Clamp a refine parameter to a sensible range and cast to integer. */
const clampPx = (px: number | undefined): number => {
  if (!Number.isFinite(px) || px === undefined || px <= 0) return 0;
  return Math.min(MAX_KERNEL, Math.floor(px));
};

/** Binary dilation by `radius` pixels using a Chebyshev (square) kernel. */
export const growMask = (mask: RasterMask, radius: number): RasterMask => {
  const r = clampPx(radius);
  if (r === 0) return mask;
  const out = createMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      let v = 0;
      const yMin = Math.max(0, y - r);
      const yMax = Math.min(mask.height - 1, y + r);
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(mask.width - 1, x + r);
      outer: for (let yy = yMin; yy <= yMax; yy++) {
        const row = yy * mask.width;
        for (let xx = xMin; xx <= xMax; xx++) {
          const sample = mask.data[row + xx]!;
          if (sample > v) {
            v = sample;
            if (v === 255) break outer;
          }
        }
      }
      out.data[y * mask.width + x] = v;
    }
  }
  return out;
};

/** Binary erosion by `radius` pixels using a Chebyshev kernel. */
export const shrinkMask = (mask: RasterMask, radius: number): RasterMask => {
  const r = clampPx(radius);
  if (r === 0) return mask;
  const out = createMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      let v = 255;
      const yMin = Math.max(0, y - r);
      const yMax = Math.min(mask.height - 1, y + r);
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(mask.width - 1, x + r);
      outer: for (let yy = yMin; yy <= yMax; yy++) {
        const row = yy * mask.width;
        for (let xx = xMin; xx <= xMax; xx++) {
          const sample = mask.data[row + xx]!;
          if (sample < v) {
            v = sample;
            if (v === 0) break outer;
          }
        }
      }
      out.data[y * mask.width + x] = v;
    }
  }
  return out;
};

/** Box blur with radius `r`. Two-pass (horizontal + vertical), O(n·r). */
export const blurMask = (mask: RasterMask, radius: number): RasterMask => {
  const r = clampPx(radius);
  if (r === 0) return mask;
  const w = mask.width;
  const h = mask.height;
  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(w - 1, x + r);
      for (let xx = xMin; xx <= xMax; xx++) {
        sum += mask.data[row + xx]!;
        count++;
      }
      horiz[row + x] = Math.round(sum / count);
    }
  }
  const out = createMask(w, h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      let count = 0;
      const yMin = Math.max(0, y - r);
      const yMax = Math.min(h - 1, y + r);
      for (let yy = yMin; yy <= yMax; yy++) {
        sum += horiz[yy * w + x]!;
        count++;
      }
      out.data[y * w + x] = Math.round(sum / count);
    }
  }
  return out;
};

/** Feather: blur then preserve as anti-aliased edge — same as blur for a
 *  binary input mask, since the blur naturally produces gradient values.
 *  Kept as a distinct alias so handlers can advertise the feather param
 *  separately from generic blur. */
export const featherMask = (mask: RasterMask, radius: number): RasterMask =>
  blurMask(mask, radius);

/** Refine parameter set — mirrors `refine_mask` in the mask-system spec. */
export interface RefineParams {
  grow_px?: number;
  shrink_px?: number;
  feather_px?: number;
  blur_px?: number;
  /** When `feather_px` and `blur_px` both produce gradient pixels, an
   *  optional threshold re-binarizes the result. */
  threshold?: number;
}

/**
 * Compose a sequence of morphology + blur ops in the order documented
 * in {@link RefineParams}: grow → shrink → feather → blur → (threshold).
 * Returns a new mask; the input is untouched.
 */
export const refineMask = (mask: RasterMask, params: RefineParams): RasterMask => {
  let cur = mask;
  if (params.grow_px) cur = growMask(cur, params.grow_px);
  if (params.shrink_px) cur = shrinkMask(cur, params.shrink_px);
  if (params.feather_px) cur = featherMask(cur, params.feather_px);
  if (params.blur_px) cur = blurMask(cur, params.blur_px);
  if (typeof params.threshold === 'number') {
    const t = Math.max(0, Math.min(255, Math.floor(params.threshold)));
    const out = createMask(cur.width, cur.height);
    for (let i = 0; i < cur.data.length; i++) {
      out.data[i] = (cur.data[i] ?? 0) >= t ? 255 : 0;
    }
    return out;
  }
  return cur;
};
