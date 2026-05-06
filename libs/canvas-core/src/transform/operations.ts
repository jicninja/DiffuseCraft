/**
 * Pure operations on `TransformDecomposed` (A.4).
 *
 * Every operation returns a new immutable transform value. Composition into
 * actual matrices for rendering happens in `decompose.ts` via
 * `composeMatrix(t, layer_w, layer_h)`.
 *
 * Conventions:
 *   - `translate(t, dx, dy)`: additive in canvas px.
 *   - `scale(t, sx, sy, opts)`: multiplicative on existing scale; `opts`
 *     toggles aspect-preservation and from-centre semantics.
 *   - `rotate(t, deg)`: additive degrees; result normalised to (-180, 180].
 *   - `flip(t, axis)`: toggles `flip_h` or `flip_v`.
 *   - `skew(t, dx_deg, dy_deg)`: additive degrees on each axis.
 *   - `distortFourCorner(t, corners)`: replaces (or sets) `distort_corners`.
 *   - `clearDistort(t)`: drops the projective override.
 *   - `setAnchor(t, anchor)`: sets the anchor in 0..1 layer-local coords.
 *   - `reset()`: identity transform.
 */
import type { TransformPoint, TransformDecomposed } from './types';
import { IDENTITY_TRANSFORM } from './types';
import { normalizeAngleDeg } from './decompose';

export interface ScaleOptions {
  /** When true, sy is forced to equal sx (uniform). Default: `false`. */
  readonly preserve_aspect?: boolean;
  /**
   * When true, scaling pivots around the current anchor (FR-7 "from
   * centre"). `false` is the default — equivalent to scaling around the
   * top-left of the local rect, which keeps a corner-handle drag feeling
   * "natural" for affine-only scaling.
   *
   * NOTE: this flag is preserved on the value, not actively used to
   * recompute `tx`/`ty` here — the controller layer is responsible for
   * applying any compensating translation when it pivots. The current
   * implementation just records the multiplicative scale change so
   * tablet/keyboard parity stays simple.
   */
  readonly from_center?: boolean;
}

/** Translate a transform by `(dx, dy)` canvas px. */
export const translate = (
  t: TransformDecomposed,
  dx: number,
  dy: number,
): TransformDecomposed => ({
  ...t,
  tx: t.tx + dx,
  ty: t.ty + dy,
});

/** Multiply the current scale by `(sx, sy)`, with optional aspect preservation. */
export const scale = (
  t: TransformDecomposed,
  sx: number,
  sy: number,
  opts: ScaleOptions = {},
): TransformDecomposed => {
  const preserve = opts.preserve_aspect ?? false;
  const finalSx = sx;
  const finalSy = preserve ? sx : sy;
  return {
    ...t,
    sx: t.sx * finalSx,
    sy: t.sy * finalSy,
  };
};

/** Add `deg` to the existing rotation, normalising to (-180, 180]. */
export const rotate = (t: TransformDecomposed, deg: number): TransformDecomposed => ({
  ...t,
  rotation_deg: normalizeAngleDeg(t.rotation_deg + deg),
});

/** Toggle horizontal or vertical flip. */
export const flip = (
  t: TransformDecomposed,
  axis: 'h' | 'v',
): TransformDecomposed =>
  axis === 'h' ? { ...t, flip_h: !t.flip_h } : { ...t, flip_v: !t.flip_v };

/** Add `dx_deg` and `dy_deg` to the existing skew on each axis. */
export const skew = (
  t: TransformDecomposed,
  dx_deg: number,
  dy_deg: number,
): TransformDecomposed => ({
  ...t,
  skew_x_deg: t.skew_x_deg + dx_deg,
  skew_y_deg: t.skew_y_deg + dy_deg,
});

/** Set 4-corner projective override (Distort sub-mode). */
export const distortFourCorner = (
  t: TransformDecomposed,
  corners: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint],
): TransformDecomposed => ({
  ...t,
  distort_corners: corners,
});

/** Drop the 4-corner override and return to affine-only behaviour. */
export const clearDistort = (t: TransformDecomposed): TransformDecomposed => {
  if (!t.distort_corners) return t;
  const next: TransformDecomposed = { ...t };
  // Drop the optional field cleanly without using `delete` on a const arg.
  return Object.fromEntries(
    Object.entries(next).filter(([k]) => k !== 'distort_corners'),
  ) as TransformDecomposed;
};

/** Set the anchor in 0..1 layer-local coordinates. */
export const setAnchor = (
  t: TransformDecomposed,
  anchor: TransformPoint,
): TransformDecomposed => ({
  ...t,
  anchor,
});

/**
 * Reset to the identity transform (FR-4 three-finger drag, FR §3.7 reset
 * buttons). Anchor returns to the centre.
 */
export const reset = (): TransformDecomposed => ({ ...IDENTITY_TRANSFORM });
