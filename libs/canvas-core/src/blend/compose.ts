/**
 * Pure RGBA pixel compositor (C.3).
 *
 * `compose(src, dst, mode, opacity)` applies the named blend mode to every
 * pixel pair and returns a new buffer. Used for thumbnail simulation and
 * tests; the production renderer is the Skia adapter.
 *
 * RGBA buffers are `Uint8ClampedArray`s in straight-alpha (not premultiplied)
 * order [r,g,b,a, r,g,b,a, ...]. All channels normalize to 0..1 internally.
 */

import type { BlendMode } from '../layers/blend-modes';
import { blendRgb } from './formulas';

export interface RasterBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const u8 = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);

/**
 * Composite `src` onto `dst` with the given mode + global opacity.
 * Result has the same dimensions as `dst`.
 */
export const compose = (
  src: RasterBuffer,
  dst: RasterBuffer,
  mode: BlendMode,
  opacity: number,
): RasterBuffer => {
  if (src.width !== dst.width || src.height !== dst.height) {
    throw new Error('compose: src/dst dimensions mismatch.');
  }
  const out = new Uint8ClampedArray(dst.data.length);
  const opa = Math.max(0, Math.min(1, opacity));
  for (let i = 0; i < dst.data.length; i += 4) {
    const sr = src.data[i]! / 255;
    const sg = src.data[i + 1]! / 255;
    const sb = src.data[i + 2]! / 255;
    const sa = (src.data[i + 3]! / 255) * opa;
    const dr = dst.data[i]! / 255;
    const dg = dst.data[i + 1]! / 255;
    const db = dst.data[i + 2]! / 255;
    const da = dst.data[i + 3]! / 255;
    const blended = blendRgb(mode, { r: sr, g: sg, b: sb }, { r: dr, g: dg, b: db });
    // Standard "source-over" composition with mode-blended source color.
    const outA = sa + da * (1 - sa);
    if (outA <= 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    const mixA = sa / outA;
    out[i] = u8(blended.r * mixA + dr * (1 - mixA));
    out[i + 1] = u8(blended.g * mixA + dg * (1 - mixA));
    out[i + 2] = u8(blended.b * mixA + db * (1 - mixA));
    out[i + 3] = u8(outA);
  }
  return { width: dst.width, height: dst.height, data: out };
};

/** Build an empty raster filled with `[r,g,b,a]` (each 0..255). */
export const fillRaster = (
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RasterBuffer => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
};
