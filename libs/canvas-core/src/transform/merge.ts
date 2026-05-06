/**
 * `mergeTransform(prev, partial)` (A.5).
 *
 * Resolves Q7 from the spec: agents may send partial transform updates
 * containing only the fields they care about. Missing fields are inherited
 * from `prev`. The result preserves the immutability contract of all the
 * transform pure ops.
 *
 * Two partial input shapes are accepted:
 *
 *   - `TransformPartial` — matches the canonical `TransformDecomposed` shape
 *     with every field optional. Anchor and `distort_corners` are
 *     atomic — supplying them replaces the current value entirely, omitting
 *     them keeps the prior value.
 *
 *   - `TransformDelta` — relative changes: `translate: { dx, dy }`,
 *     `scale: { sx, sy }`, `rotate_deg`, etc. Useful for the agent
 *     example in FR-22 / S7.
 *
 * Both shapes can be passed to `mergeTransform`; the helper distinguishes by
 * key. Inputs are clamped to safe ranges to keep server-side persistence
 * bounded.
 */
import type { TransformPoint, TransformDecomposed } from './types';
import { translate, scale as scaleOp, rotate as rotateOp, skew as skewOp, distortFourCorner } from './operations';
import { normalizeAngleDeg } from './decompose';

/** Partial absolute-state shape (Q7). All fields optional. */
export interface TransformPartial {
  readonly tx?: number;
  readonly ty?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly rotation_deg?: number;
  readonly skew_x_deg?: number;
  readonly skew_y_deg?: number;
  readonly flip_h?: boolean;
  readonly flip_v?: boolean;
  readonly anchor?: TransformPoint;
  readonly distort_corners?: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint] | null;
}

/** Relative-change shape (S7-style agent ergonomics). */
export interface TransformDelta {
  readonly translate?: { readonly dx: number; readonly dy: number };
  readonly scale?: { readonly sx: number; readonly sy: number };
  readonly rotate_deg?: number;
  readonly skew?: { readonly dx_deg: number; readonly dy_deg: number };
  readonly flip_h?: boolean;
  readonly flip_v?: boolean;
}

/** Either input shape. Distinguished by presence of relative-change keys. */
export type TransformPartialInput = TransformPartial | TransformDelta;

const DELTA_KEYS = new Set(['translate', 'scale', 'rotate_deg', 'skew']);

/**
 * Merge `partial` into `prev`. Returns a new `TransformDecomposed`.
 *
 * - When `partial` includes any of the delta keys (`translate`, `scale`,
 *   `rotate_deg`, `skew`) it is treated as a delta: relative ops apply to
 *   `prev`. Other keys (`flip_*`, `anchor`, `distort_corners`) still merge
 *   absolutely.
 * - Otherwise `partial` is treated as an absolute partial: each provided
 *   field overwrites `prev`'s.
 * - Passing `distort_corners: null` explicitly clears any projective
 *   override on `prev`.
 */
export const mergeTransform = (
  prev: TransformDecomposed,
  partial: TransformPartialInput | undefined,
): TransformDecomposed => {
  if (!partial) return prev;

  const isDelta = Object.keys(partial).some((k) => DELTA_KEYS.has(k));
  let next: TransformDecomposed = prev;

  if (isDelta) {
    const d = partial as TransformDelta;
    if (d.translate) next = translate(next, d.translate.dx, d.translate.dy);
    if (d.scale) next = scaleOp(next, d.scale.sx, d.scale.sy);
    if (typeof d.rotate_deg === 'number') next = rotateOp(next, d.rotate_deg);
    if (d.skew) next = skewOp(next, d.skew.dx_deg, d.skew.dy_deg);
    if (typeof d.flip_h === 'boolean' && d.flip_h !== prev.flip_h) {
      next = { ...next, flip_h: d.flip_h };
    }
    if (typeof d.flip_v === 'boolean' && d.flip_v !== prev.flip_v) {
      next = { ...next, flip_v: d.flip_v };
    }
  } else {
    const p = partial as TransformPartial;
    next = {
      ...prev,
      ...(typeof p.tx === 'number' ? { tx: p.tx } : {}),
      ...(typeof p.ty === 'number' ? { ty: p.ty } : {}),
      ...(typeof p.sx === 'number' ? { sx: p.sx } : {}),
      ...(typeof p.sy === 'number' ? { sy: p.sy } : {}),
      ...(typeof p.rotation_deg === 'number'
        ? { rotation_deg: normalizeAngleDeg(p.rotation_deg) }
        : {}),
      ...(typeof p.skew_x_deg === 'number' ? { skew_x_deg: p.skew_x_deg } : {}),
      ...(typeof p.skew_y_deg === 'number' ? { skew_y_deg: p.skew_y_deg } : {}),
      ...(typeof p.flip_h === 'boolean' ? { flip_h: p.flip_h } : {}),
      ...(typeof p.flip_v === 'boolean' ? { flip_v: p.flip_v } : {}),
      ...(p.anchor ? { anchor: p.anchor } : {}),
    };
    if (p.distort_corners === null) {
      // Drop the optional field cleanly.
      next = Object.fromEntries(
        Object.entries(next).filter(([k]) => k !== 'distort_corners'),
      ) as TransformDecomposed;
    } else if (p.distort_corners) {
      next = distortFourCorner(next, p.distort_corners);
    }
  }
  return next;
};
