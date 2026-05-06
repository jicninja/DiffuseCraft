/**
 * 4-point projective math for Distort sub-mode (A.3).
 *
 * Maps the layer's local rectangle `(0,0)..(w,h)` onto four arbitrary
 * canvas-space corners (TL, TR, BR, BL). The result is a 3×3 matrix in
 * row-major form. The mapping is exactly invertible (FR-3, NFR-4) since
 * a non-degenerate quad has a unique projective inverse.
 *
 * Algorithm: solve for the matrix that takes the unit square corners
 * `[(0,0), (1,0), (1,1), (0,1)]` to the destination corners, multiplied
 * by the source rectangle's diagonal scale. Standard textbook approach
 * (see Heckbert, "Fundamentals of Texture Mapping and Image Warping").
 */
import type { TransformPoint, TransformMatrix } from './types';
import { matrixInvert, matrixMultiply } from './matrix';

/**
 * Build the 3×3 projective matrix mapping the layer's local
 * `(0,0)..(layer_w, layer_h)` rect to the four canvas-space corners
 * `[TL, TR, BR, BL]`.
 *
 * @throws Error when the destination quad is degenerate (collinear corners).
 */
export const projectiveFromQuad = (
  corners: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint],
  layer_w: number,
  layer_h: number,
): TransformMatrix => {
  if (layer_w <= 0 || layer_h <= 0) {
    throw new Error('projectiveFromQuad: layer dimensions must be positive');
  }
  // Step 1: matrix from unit square (0,0)-(1,0)-(1,1)-(0,1) to dest quad.
  const u2dest = unitSquareToQuad(corners);
  // Step 2: matrix from layer rect (0,0)-(w,h) to unit square.
  const layer2unit: TransformMatrix = [
    1 / layer_w, 0, 0,
    0, 1 / layer_h, 0,
    0, 0, 1,
  ];
  return matrixMultiply(u2dest, layer2unit);
};

/**
 * Inverse mapping: from a canvas-space point back to the layer's local
 * coordinates given the four destination corners. Useful for hit-testing
 * and inverse distort during gesture commit.
 */
export const projectiveToLocal = (
  corners: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint],
  layer_w: number,
  layer_h: number,
): TransformMatrix => matrixInvert(projectiveFromQuad(corners, layer_w, layer_h));

/**
 * Compute the matrix that maps the unit square's four corners to an
 * arbitrary quad. Solves the standard 8-equation system; row 7 is fixed at
 * `w = 1` to remove scale ambiguity.
 *
 * @throws Error when the destination quad is degenerate.
 */
const unitSquareToQuad = (
  q: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint],
): TransformMatrix => {
  const [p0, p1, p2, p3] = q;
  // Δx = p0 - p1 + p2 - p3, Δy = p0 - p1 + p2 - p3 likewise.
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let g: number;
  let h: number;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    // Affine case (parallelogram).
    g = 0;
    h = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denom) < 1e-12) {
      throw new Error('unitSquareToQuad: degenerate destination quad');
    }
    g = (dx3 * dy2 - dx2 * dy3) / denom;
    h = (dx1 * dy3 - dx3 * dy1) / denom;
  }

  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;
  return [
    a, b, c,
    d, e, f,
    g, h, 1,
  ];
};

/**
 * True when the four corners form a non-degenerate convex (or
 * non-self-intersecting) quad. Used as a precondition guard before
 * accepting a distort gesture.
 */
export const isNonDegenerateQuad = (
  corners: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint],
): boolean => {
  // Compute the signed cross products of consecutive edges. They should
  // share a sign for a strictly-convex quad. We allow either sign so that
  // either winding order (CW/CCW) is OK; what we reject is a flat or
  // self-crossing quad.
  let prev = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const c = corners[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (prev !== 0 && Math.sign(cross) !== Math.sign(prev)) return false;
    prev = cross;
  }
  return true;
};
