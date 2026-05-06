/**
 * `from_layer` mask derivation (mask-system A.4, FR-15..FR-17).
 *
 * Given a paint layer's RGBA bytes, derive an alpha-only Uint8Array using
 * either:
 *
 *   - `alpha`     — direct copy of the source's alpha channel.
 *   - `luminance` — Rec. 709 weighted greyscale of RGB (alpha-aware:
 *                   transparent pixels contribute zero so a sparse paint
 *                   layer doesn't bleed into the mask).
 *
 * Then optionally invert. Caller is responsible for caching and
 * invalidating the result when the source layer's content blob changes —
 * the helper itself is pure / cache-free.
 */
import type { FromLayerChannel } from './types';

export interface DeriveFromLayerOps {
  readonly channel: FromLayerChannel;
  readonly invert: boolean;
}

/**
 * Derive a mask from RGBA bytes of a source layer.
 *
 * `rgba` length MUST equal `4 * width * height`. Output length equals
 * `width * height`. The function never mutates the input.
 */
export function deriveFromLayer(
  rgba: Uint8Array,
  width: number,
  height: number,
  ops: DeriveFromLayerOps,
): Uint8Array {
  const expected = 4 * width * height;
  if (rgba.length !== expected) {
    throw new Error(
      `deriveFromLayer: rgba length ${rgba.length} != expected ${expected} for ${width}×${height}.`,
    );
  }
  const out = new Uint8Array(width * height);
  if (ops.channel === 'alpha') {
    for (let i = 0, p = 0; p < rgba.length; i++, p += 4) {
      out[i] = rgba[p + 3]!;
    }
  } else {
    // Rec. 709 luminance, modulated by alpha so transparent pixels read 0.
    for (let i = 0, p = 0; p < rgba.length; i++, p += 4) {
      const a = rgba[p + 3]! / 255;
      const r = rgba[p]!;
      const g = rgba[p + 1]!;
      const b = rgba[p + 2]!;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      out[i] = Math.round(lum * a);
    }
  }
  if (ops.invert) {
    for (let i = 0; i < out.length; i++) out[i] = 255 - out[i]!;
  }
  return out;
}
