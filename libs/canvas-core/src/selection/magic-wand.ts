/**
 * Magic-wand selection (FR-6/FR-7/FR-8).
 *
 * Inputs: RGBA pixel bytes for the active layer (or composite), the
 * canvas dims, the tap point in document coordinates, a tolerance
 * (0..255), and a `contiguous` flag.
 *
 * Output: a {@link RasterMask} where every pixel within `tolerance` of
 * the sampled colour (Chebyshev / L∞ distance over R/G/B) is set to
 * 255, otherwise 0.
 *
 * Two strategies:
 * - `contiguous: true` (default) — 4-neighbour flood fill from the tap
 *   point. Stack-based to avoid recursion depth limits on large images.
 * - `contiguous: false` — single linear scan over the whole image; no
 *   neighbour check. Equivalent to "select all pixels of this colour".
 */

import type { Point2D, RasterMask } from './types';
import { createMask } from './raster';

/** RGB sample, 0..255 per channel. */
export interface RgbSample {
  r: number;
  g: number;
  b: number;
}

/** Default tolerance (FR-7). */
export const DEFAULT_TOLERANCE = 32;

/** Read RGB at a pixel from an RGBA buffer. Bounds-checked. */
export const sampleRgb = (
  imageBytes: Uint8Array,
  width: number,
  height: number,
  point: Point2D,
): RgbSample | null => {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const i = (y * width + x) * 4;
  return {
    r: imageBytes[i] ?? 0,
    g: imageBytes[i + 1] ?? 0,
    b: imageBytes[i + 2] ?? 0,
  };
};

/** Chebyshev (max-axis) distance — Photoshop's tolerance metric. */
export const colorDistance = (a: RgbSample, b: RgbSample): number => {
  const dr = Math.abs(a.r - b.r);
  const dg = Math.abs(a.g - b.g);
  const db = Math.abs(a.b - b.b);
  return Math.max(dr, dg, db);
};

const matches = (
  imageBytes: Uint8Array,
  px: number,
  py: number,
  width: number,
  sample: RgbSample,
  tolerance: number,
): boolean => {
  const i = (py * width + px) * 4;
  const r = imageBytes[i] ?? 0;
  const g = imageBytes[i + 1] ?? 0;
  const b = imageBytes[i + 2] ?? 0;
  const dr = Math.abs(r - sample.r);
  const dg = Math.abs(g - sample.g);
  const db = Math.abs(b - sample.b);
  const d = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
  return d <= tolerance;
};

/**
 * Run the magic-wand selection algorithm. See module-level comment for
 * the contract.
 */
export const magicWandSelect = (args: {
  imageBytes: Uint8Array;
  width: number;
  height: number;
  tapPoint: Point2D;
  tolerance?: number;
  contiguous?: boolean;
}): RasterMask => {
  const { imageBytes, width, height, tapPoint } = args;
  const tolerance = args.tolerance ?? DEFAULT_TOLERANCE;
  const contiguous = args.contiguous ?? true;
  if (imageBytes.length !== width * height * 4) {
    throw new Error(
      `magicWandSelect: expected ${width * height * 4} bytes (RGBA), got ${imageBytes.length}`,
    );
  }
  const mask = createMask(width, height);
  const sample = sampleRgb(imageBytes, width, height, tapPoint);
  if (!sample) return mask;

  if (!contiguous) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (matches(imageBytes, x, y, width, sample, tolerance)) {
          mask.data[y * width + x] = 255;
        }
      }
    }
    return mask;
  }

  // 4-neighbour flood fill, iterative.
  const startX = Math.floor(tapPoint.x);
  const startY = Math.floor(tapPoint.y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return mask;
  }
  if (!matches(imageBytes, startX, startY, width, sample, tolerance)) {
    return mask;
  }
  const stack: number[] = [startY * width + startX];
  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (mask.data[idx] === 255) continue;
    const x = idx % width;
    const y = (idx - x) / width;
    if (!matches(imageBytes, x, y, width, sample, tolerance)) continue;
    mask.data[idx] = 255;
    if (x > 0) stack.push(idx - 1);
    if (x + 1 < width) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y + 1 < height) stack.push(idx + width);
  }
  return mask;
};
