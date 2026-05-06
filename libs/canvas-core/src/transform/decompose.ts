/**
 * Decompose / recompose between TransformDecomposed and TransformMatrix
 * (A.2 / A.6).
 *
 * Composition order matches the design's intuition: anchor-pivot-aware
 * scale → skew → rotate → flip → translate, applied around the layer's
 * anchor in local 0..1 coordinates.
 *
 * `composeMatrix(t, layer_w, layer_h)` builds the 3×3 matrix that maps a
 * point from the layer's local pixel space (0..w, 0..h) to canvas-space
 * pixels. Round-trip via `decomposeMatrix(m, layer_w, layer_h, anchor)` is
 * exact for the affine fields; `flip_h`/`flip_v` are recovered as negative
 * scale on the corresponding axis (callers may keep the original boolean
 * if they prefer the alternate spelling).
 */
import type { TransformPoint, TransformDecomposed, TransformMatrix } from './types';
import { IDENTITY_TRANSFORM } from './types';
import {
  IDENTITY_MATRIX,
  matrixMultiply,
  matrixRotate,
  matrixScale,
  matrixSkew,
  matrixTranslate,
} from './matrix';

/**
 * Build the 3×3 matrix for a decomposed transform, around its anchor in a
 * layer of size `layer_w` × `layer_h` (canvas px).
 *
 * The pipeline is, applied right-to-left to a local-space point `p`:
 *   1. shift anchor to origin     (`T(-anchor)`)
 *   2. flip                        (`S(±1, ±1)`)
 *   3. skew                        (`Skew(skew_x, skew_y)`)
 *   4. scale                       (`S(sx, sy)`)
 *   5. rotate                      (`R(rotation)`)
 *   6. shift back + translate      (`T(anchor + (tx, ty))`)
 */
export const composeMatrix = (
  t: TransformDecomposed,
  layer_w: number,
  layer_h: number,
): TransformMatrix => {
  const anchorPx = anchorInPx(t.anchor, layer_w, layer_h);
  const moveToOrigin = matrixTranslate(-anchorPx.x, -anchorPx.y);
  const flip = matrixScale(t.flip_h ? -1 : 1, t.flip_v ? -1 : 1);
  const skew = matrixSkew(t.skew_x_deg, t.skew_y_deg);
  const scale = matrixScale(t.sx, t.sy);
  const rotate = matrixRotate(t.rotation_deg);
  const moveBack = matrixTranslate(anchorPx.x + t.tx, anchorPx.y + t.ty);

  // M = moveBack * rotate * scale * skew * flip * moveToOrigin
  let m: TransformMatrix = IDENTITY_MATRIX;
  m = matrixMultiply(m, moveBack);
  m = matrixMultiply(m, rotate);
  m = matrixMultiply(m, scale);
  m = matrixMultiply(m, skew);
  m = matrixMultiply(m, flip);
  m = matrixMultiply(m, moveToOrigin);
  return m;
};

/**
 * Recover a `TransformDecomposed` from a 3×3 affine matrix `m`. The anchor
 * is supplied separately (matrix decomposition cannot recover the anchor
 * unambiguously — the caller knows what anchor was used at compose time
 * and passes it in for round-trip).
 *
 * `flip_h`/`flip_v` are returned `false`; sign on `sx`/`sy` carries the
 * mirror. Callers that prefer the boolean spelling can normalise via
 * `splitFlipFromScale`.
 *
 * Limitations: the input is assumed affine. Distort matrices are not
 * round-trippable through decomposition (use `distort_corners` instead).
 */
export const decomposeMatrix = (
  m: TransformMatrix,
  layer_w: number,
  layer_h: number,
  anchor: TransformPoint,
): TransformDecomposed => {
  const [a, b, c, d, e, f] = m;
  // The compose pipeline is (ignoring anchor for a moment):
  //   p' = (R · S · K · F) · p + (anchor + tx)
  // We work backwards. Strip the anchor pre/post offsets first.
  const anchorPx = anchorInPx(anchor, layer_w, layer_h);
  // After dropping anchor: linear part is `[a b; d e]`, translation is
  // `[c, f] - linear · anchorPx - anchorPx_back`. Specifically:
  //   compose translation = anchor + (tx, ty) - (R·S·K·F) · anchor
  //     => (tx, ty) = (c, f) - anchor + (R·S·K·F) · anchor
  // Linear part L = [a b; d e]. (anchor cancels via L·anchorPx then +anchorPx)
  const L00 = a;
  const L01 = b;
  const L10 = d;
  const L11 = e;
  // tx, ty: subtract anchor's contribution.
  const tx = c - anchorPx.x + (L00 * anchorPx.x + L01 * anchorPx.y);
  const ty = f - anchorPx.y + (L10 * anchorPx.x + L11 * anchorPx.y);

  // QR-style decomposition of L into rotation × scale × skew. We assume
  // skew_y = 0 (the more common authoring case): then
  //   L = R(theta) · diag(sx, sy) · [[1, tan_x], [0, 1]]
  //   = [[sx·cos, sx·cos·tan_x - sy·sin], [sx·sin, sx·sin·tan_x + sy·cos]]
  // From the first column: theta = atan2(L10, L00); sx = hypot(L00, L10).
  const theta = Math.atan2(L10, L00);
  const sx = Math.hypot(L00, L10);
  // Apply inverse rotation to the second column to recover (sy, sy·tan_x).
  // Equivalent: project second column onto basis after rotation.
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const u = L01 * cosT + L11 * sinT;          // sx · tan_x  (after derivation)
  const v = -L01 * sinT + L11 * cosT;         // sy
  const sy = v;
  const tan_x = sx === 0 ? 0 : u / sx;
  const skew_x_deg = (Math.atan(tan_x) * 180) / Math.PI;

  return {
    tx,
    ty,
    sx,
    sy,
    rotation_deg: normalizeAngleDeg((theta * 180) / Math.PI),
    skew_x_deg,
    skew_y_deg: 0,
    flip_h: false,
    flip_v: false,
    anchor,
  };
};

/**
 * Move negative-scale information into the dedicated `flip_h`/`flip_v`
 * booleans. After this call `sx`/`sy` are non-negative.
 */
export const splitFlipFromScale = (t: TransformDecomposed): TransformDecomposed => {
  const flip_h = t.sx < 0 ? !t.flip_h : t.flip_h;
  const flip_v = t.sy < 0 ? !t.flip_v : t.flip_v;
  return {
    ...t,
    sx: Math.abs(t.sx),
    sy: Math.abs(t.sy),
    flip_h,
    flip_v,
  };
};

/** Build an identity decomposed transform with the given anchor. */
export const identityDecomposed = (
  anchor: TransformPoint = IDENTITY_TRANSFORM.anchor,
): TransformDecomposed => ({
  ...IDENTITY_TRANSFORM,
  anchor,
});

/** True when two decomposed transforms are equal up to `epsilon`. */
export const decomposedApproxEqual = (
  a: TransformDecomposed,
  b: TransformDecomposed,
  epsilon = 1e-6,
): boolean => {
  return (
    Math.abs(a.tx - b.tx) < epsilon
    && Math.abs(a.ty - b.ty) < epsilon
    && Math.abs(a.sx - b.sx) < epsilon
    && Math.abs(a.sy - b.sy) < epsilon
    && Math.abs(normalizeAngleDeg(a.rotation_deg) - normalizeAngleDeg(b.rotation_deg)) < epsilon
    && Math.abs(a.skew_x_deg - b.skew_x_deg) < epsilon
    && Math.abs(a.skew_y_deg - b.skew_y_deg) < epsilon
    && a.flip_h === b.flip_h
    && a.flip_v === b.flip_v
    && Math.abs(a.anchor.x - b.anchor.x) < epsilon
    && Math.abs(a.anchor.y - b.anchor.y) < epsilon
  );
};

/** Convert anchor in 0..1 layer-local coords to canvas px. */
const anchorInPx = (anchor: TransformPoint, layer_w: number, layer_h: number): TransformPoint => ({
  x: anchor.x * layer_w,
  y: anchor.y * layer_h,
});

/** Normalise an angle to (-180, 180]. */
export const normalizeAngleDeg = (deg: number): number => {
  let r = deg % 360;
  if (r > 180) r -= 360;
  else if (r <= -180) r += 360;
  // Treat -0 as 0 for stability.
  return r === 0 ? 0 : r;
};
