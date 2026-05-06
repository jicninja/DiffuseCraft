/**
 * Pure blend-mode formulas (C.1, C.3).
 *
 * Each formula maps a (source, destination) pair of normalized RGB channels
 * (each 0..1) to a single 0..1 blend output. Alpha compositing happens in
 * `compose.ts` on top of these formulas. The math matches Photoshop /
 * Procreate conventions for the subset listed in `formulas.md`.
 *
 * These functions are CPU-only; the Skia adapter delegates to GPU shaders
 * for the same operation when available, falling back to the JS path for
 * blend modes Skia lacks.
 */

import type { BlendMode } from '../layers/blend-modes';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Blend a single channel pair (0..1 each) per the named mode. */
export const blendChannel = (mode: BlendMode, src: number, dst: number): number => {
  switch (mode) {
    case 'normal':
      return src;
    case 'multiply':
      return src * dst;
    case 'screen':
      return 1 - (1 - src) * (1 - dst);
    case 'overlay':
      return dst < 0.5 ? 2 * src * dst : 1 - 2 * (1 - src) * (1 - dst);
    case 'darken':
      return Math.min(src, dst);
    case 'lighten':
      return Math.max(src, dst);
    case 'color_dodge':
      if (src >= 1) return 1;
      return clamp01(dst / (1 - src));
    case 'color_burn':
      if (src <= 0) return 0;
      return clamp01(1 - (1 - dst) / src);
    case 'hard_light':
      // Inverse of overlay: switch src and dst roles.
      return src < 0.5 ? 2 * src * dst : 1 - 2 * (1 - src) * (1 - dst);
    case 'soft_light':
      // Photoshop variant.
      return (1 - 2 * src) * dst * dst + 2 * src * dst;
    case 'difference':
      return Math.abs(src - dst);
    case 'exclusion':
      return src + dst - 2 * src * dst;
    case 'linear_burn':
      return clamp01(src + dst - 1);
    case 'linear_dodge':
      return clamp01(src + dst);
    case 'linear_light':
      // Equivalent to linear_burn or linear_dodge per src half.
      return clamp01(dst + 2 * src - 1);
    case 'pin_light':
      return src < 0.5 ? Math.min(dst, 2 * src) : Math.max(dst, 2 * src - 1);
    // Hue / Saturation / Color / Luminosity require full RGB context.
    // These are handled by `blendRgb`; channel-only invocation falls through.
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      // Channel-level no-op; real implementation is in `blendRgb`.
      return src;
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = mode;
      void _exhaustive;
      return src;
    }
  }
};

interface RGB {
  r: number;
  g: number;
  b: number;
}

const luminance = (c: RGB): number => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;

const setLum = (c: RGB, l: number): RGB => {
  const d = l - luminance(c);
  let r = c.r + d;
  let g = c.g + d;
  let b = c.b + d;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (min < 0) {
    r = lum + ((r - lum) * lum) / (lum - min);
    g = lum + ((g - lum) * lum) / (lum - min);
    b = lum + ((b - lum) * lum) / (lum - min);
  }
  if (max > 1) {
    r = lum + ((r - lum) * (1 - lum)) / (max - lum);
    g = lum + ((g - lum) * (1 - lum)) / (max - lum);
    b = lum + ((b - lum) * (1 - lum)) / (max - lum);
  }
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
};

const sat = (c: RGB): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

const setSat = (c: RGB, s: number): RGB => {
  const channels: Array<[keyof RGB, number]> = [
    ['r', c.r],
    ['g', c.g],
    ['b', c.b],
  ];
  channels.sort((a, b) => a[1] - b[1]);
  const result: RGB = { r: 0, g: 0, b: 0 };
  const min = channels[0]!;
  const mid = channels[1]!;
  const max = channels[2]!;
  if (max[1] > min[1]) {
    result[mid[0]] = ((mid[1] - min[1]) * s) / (max[1] - min[1]);
    result[max[0]] = s;
  } else {
    result[mid[0]] = 0;
    result[max[0]] = 0;
  }
  result[min[0]] = 0;
  return result;
};

/** Blend two RGB triples per the named mode. Used for HSL-space modes. */
export const blendRgb = (mode: BlendMode, src: RGB, dst: RGB): RGB => {
  switch (mode) {
    case 'hue': {
      // Replace dst's hue with src's; preserve dst's saturation & luminance.
      return setLum(setSat(src, sat(dst)), luminance(dst));
    }
    case 'saturation': {
      return setLum(setSat(dst, sat(src)), luminance(dst));
    }
    case 'color': {
      return setLum(src, luminance(dst));
    }
    case 'luminosity': {
      return setLum(dst, luminance(src));
    }
    default:
      return {
        r: blendChannel(mode, src.r, dst.r),
        g: blendChannel(mode, src.g, dst.g),
        b: blendChannel(mode, src.b, dst.b),
      };
  }
};
