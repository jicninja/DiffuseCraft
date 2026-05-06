/**
 * Pure mask operations (mask-system A.2, FR-7..FR-11).
 *
 * Single-channel alpha (`Uint8Array`) is the universal currency. All ops
 * are pure: take a mask + dims (+ params), return a brand-new
 * `Uint8Array`. The server uses these directly for ≤4K masks; the tablet
 * uses them for live previews. Image-filter primitives (morphology,
 * gaussian blur) are implemented here in straight TypeScript — fast
 * enough for live preview at 1024² and below; the server fast-path may
 * swap in `sharp` for 4K masks (the `refine_mask` handler chooses).
 *
 * Per FR-26 painted masks are full document resolution. The mask
 * `Uint8Array`'s length must equal `width * height`.
 *
 * Names are intentionally distinct from `selection-tools/refine.ts` (which
 * operates on `RasterMask`): the mask-system targets the raw byte layer
 * that lives on disk in `content_blob_id`, while selection-tools refines
 * the in-memory selection bitmap. They share semantics; both can be
 * imported from this package without symbol clashes.
 */

/** Invert mask — `255 - v` for every byte. Returns a new array. */
export const invertMaskBytes = (mask: Uint8Array): Uint8Array => {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 255 - mask[i]!;
  return out;
};

/** Empty mask (all zeros) at the given pixel count. */
export const clearMaskBytes = (size: number): Uint8Array => new Uint8Array(size);

/** Solid-fill mask at the given alpha value (clamped to 0..255). */
export const fillMaskBytes = (size: number, value: number): Uint8Array => {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  const out = new Uint8Array(size);
  out.fill(v);
  return out;
};

/**
 * Threshold to pure 0 / 255 at the given alpha. `>= threshold` → 255.
 */
export const thresholdMaskBytes = (mask: Uint8Array, threshold: number): Uint8Array => {
  const t = Math.max(0, Math.min(255, Math.round(threshold)));
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i]! >= t ? 255 : 0;
  return out;
};

/**
 * Box-shaped morphology (dilate or erode). Radius is in pixels.
 *
 * `dilate` widens regions of "set" pixels — used for `grow`. `erode`
 * shrinks them. Implementation: separable horizontal + vertical max/min
 * pass with O(W*H*r) — adequate for up to ~256 px radius at 1024²; for
 * larger masks the server may prefer `sharp`.
 */
export function morphology(
  mask: Uint8Array,
  width: number,
  height: number,
  op: 'dilate' | 'erode',
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask.slice();
  const r = Math.min(Math.max(0, Math.floor(radius)), Math.max(width, height));
  const reducer = op === 'dilate' ? Math.max : Math.min;
  const seed = op === 'dilate' ? 0 : 255;
  const intermediate = new Uint8Array(mask.length);
  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = seed;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      for (let i = x0; i <= x1; i++) acc = reducer(acc, mask[row + i]!);
      intermediate[row + x] = acc;
    }
  }
  const out = new Uint8Array(mask.length);
  // Vertical pass over the intermediate.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let acc = seed;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(height - 1, y + r);
      for (let j = y0; j <= y1; j++) acc = reducer(acc, intermediate[j * width + x]!);
      out[y * width + x] = acc;
    }
  }
  return out;
}

/**
 * Box-blur approximation of gaussian blur — three box passes per axis.
 *
 * Sigma → box-radius derivation via the standard "average of three boxes"
 * formula; sufficient for live preview / mask softening.
 */
export function gaussianBlurBytes(
  mask: Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Uint8Array {
  if (sigma <= 0) return mask.slice();
  const r = Math.max(1, Math.round(sigma));
  let out = boxBlurOnce(mask, width, height, r);
  for (let pass = 1; pass < 3; pass++) {
    out = boxBlurOnce(out, width, height, r);
  }
  return out;
}

function boxBlurOnce(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const intermediate = new Uint8Array(mask.length);
  const denom = radius * 2 + 1;
  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      sum += mask[row + clamp(i, 0, width - 1)]!;
    }
    for (let x = 0; x < width; x++) {
      intermediate[row + x] = Math.round(sum / denom);
      const next = mask[row + clamp(x + radius + 1, 0, width - 1)]!;
      const prev = mask[row + clamp(x - radius, 0, width - 1)]!;
      sum += next - prev;
    }
  }
  const out = new Uint8Array(mask.length);
  // Vertical pass.
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      sum += intermediate[clamp(i, 0, height - 1) * width + x]!;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / denom);
      const next = intermediate[clamp(y + radius + 1, 0, height - 1) * width + x]!;
      const prev = intermediate[clamp(y - radius, 0, height - 1) * width + x]!;
      sum += next - prev;
    }
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Edge-feather: a small gaussian blur applied uniformly. The visible
 * effect is at the edge; flat-zero and flat-255 regions stay flat.
 */
export const featherEdgeBytes = (
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array => gaussianBlurBytes(mask, width, height, radius);

export interface RefineMaskOps {
  /** Threshold first to crisp 0/255, e.g. 128. */
  threshold?: number;
  /** Dilate radius (pixels). */
  grow_px?: number;
  /** Erode radius (pixels). */
  shrink_px?: number;
  /** Edge feather (gaussian sigma, pixels). */
  feather_px?: number;
  /** Whole-mask gaussian blur (pixels). */
  blur_px?: number;
}

/**
 * Combined mask refinement (FR-8). Applies threshold → grow → shrink →
 * feather → blur, in that order; missing fields are no-ops. Each step is
 * a pure function returning a new `Uint8Array`. Distinct from
 * `selection-tools/refine.ts` `refineMask`, which works on `RasterMask`.
 */
export const refineMaskBytes = (
  mask: Uint8Array,
  width: number,
  height: number,
  ops: RefineMaskOps,
): Uint8Array => {
  let result: Uint8Array = mask;
  if (ops.threshold !== undefined) {
    result = thresholdMaskBytes(result, ops.threshold);
  }
  if (ops.grow_px && ops.grow_px > 0) {
    result = morphology(result, width, height, 'dilate', ops.grow_px);
  }
  if (ops.shrink_px && ops.shrink_px > 0) {
    result = morphology(result, width, height, 'erode', ops.shrink_px);
  }
  if (ops.feather_px && ops.feather_px > 0) {
    result = featherEdgeBytes(result, width, height, ops.feather_px);
  }
  if (ops.blur_px && ops.blur_px > 0) {
    result = gaussianBlurBytes(result, width, height, ops.blur_px);
  }
  // Defensive copy when no ops applied so callers cannot accidentally
  // mutate the input via the returned reference.
  return result === mask ? mask.slice() : result;
};
