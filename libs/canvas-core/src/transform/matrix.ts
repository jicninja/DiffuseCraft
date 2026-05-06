/**
 * 3×3 matrix math for transform-tools (A.2).
 *
 * Row-major storage:
 *   [ a, b, tx,
 *     c, d, ty,
 *     p, q, w  ]
 *
 * Affine transforms have `p = q = 0, w = 1`. Projective transforms (Distort)
 * use the full 3×3 form. All operations are pure.
 */
import type { TransformPoint, TransformMatrix } from './types';

/** 3×3 identity matrix. */
export const IDENTITY_MATRIX: TransformMatrix = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
];

/** Build a translation-only matrix. */
export const matrixTranslate = (tx: number, ty: number): TransformMatrix => [
  1, 0, tx,
  0, 1, ty,
  0, 0, 1,
];

/** Build a scale-only matrix. */
export const matrixScale = (sx: number, sy: number): TransformMatrix => [
  sx, 0, 0,
  0, sy, 0,
  0, 0, 1,
];

/** Build a rotation-only matrix. `deg` is rotation in degrees. */
export const matrixRotate = (deg: number): TransformMatrix => {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  ];
};

/**
 * Build a skew matrix. `skew_x_deg` shears along the X axis as a function
 * of Y; `skew_y_deg` shears along the Y axis as a function of X.
 */
export const matrixSkew = (skew_x_deg: number, skew_y_deg: number): TransformMatrix => {
  const tx = Math.tan((skew_x_deg * Math.PI) / 180);
  const ty = Math.tan((skew_y_deg * Math.PI) / 180);
  return [
    1, tx, 0,
    ty, 1, 0,
    0, 0, 1,
  ];
};

/** Multiply two 3×3 matrices: `a · b`. */
export const matrixMultiply = (a: TransformMatrix, b: TransformMatrix): TransformMatrix => {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  ];
};

/** Determinant of a 3×3 matrix. */
export const matrixDeterminant = (m: TransformMatrix): number => {
  const [a, b, c, d, e, f, g, h, i] = m;
  return (
    a * (e * i - f * h)
    - b * (d * i - f * g)
    + c * (d * h - e * g)
  );
};

/**
 * Invert a 3×3 matrix. Throws if the matrix is singular (determinant ≈ 0).
 *
 * @throws Error when the determinant is below `1e-12`.
 */
export const matrixInvert = (m: TransformMatrix): TransformMatrix => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = matrixDeterminant(m);
  if (Math.abs(det) < 1e-12) {
    throw new Error('matrixInvert: singular matrix');
  }
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
};

/** Apply a 3×3 matrix to a 2D point in homogeneous coordinates. */
export const matrixApplyPoint = (m: TransformMatrix, p: TransformPoint): TransformPoint => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const w = g * p.x + h * p.y + i;
  if (Math.abs(w) < 1e-12) {
    // Point at infinity — keep deterministic behaviour by returning origin.
    return { x: 0, y: 0 };
  }
  return {
    x: (a * p.x + b * p.y + c) / w,
    y: (d * p.x + e * p.y + f) / w,
  };
};

/** True when two matrices are equal up to `epsilon` per element. */
export const matrixApproxEqual = (
  a: TransformMatrix,
  b: TransformMatrix,
  epsilon = 1e-9,
): boolean => {
  for (let n = 0; n < 9; n += 1) {
    if (Math.abs(a[n]! - b[n]!) > epsilon) return false;
  }
  return true;
};
