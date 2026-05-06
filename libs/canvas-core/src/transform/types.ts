/**
 * Transform types (transform-tools FR-1, design §3).
 *
 * A layer's transform is representable as a 3×3 affine matrix at render time
 * but is stored in decomposed form for round-trip clarity. Distort uses an
 * optional 4-corner override (projective).
 *
 * Pure types — no runtime behaviour. All math lives in the sibling files.
 */
import type { LayerId } from '../shared/ids';

/** Convenience point. Canvas pixels unless noted. */
export interface TransformPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Decomposed affine transform applied to a layer's local coordinate frame.
 * The anchor is in the layer's local 0..1 space (0,0 = top-left, 1,1 =
 * bottom-right) so it stays centred when the layer is resized at the
 * source level.
 */
export interface TransformDecomposed {
  /** Translate X (canvas px). */
  readonly tx: number;
  /** Translate Y (canvas px). */
  readonly ty: number;
  /** Scale X (1.0 = original size). */
  readonly sx: number;
  /** Scale Y (1.0 = original size). */
  readonly sy: number;
  /** Rotation in degrees, normalised to (-180, 180]. */
  readonly rotation_deg: number;
  /** Skew on the X axis, in degrees. */
  readonly skew_x_deg: number;
  /** Skew on the Y axis, in degrees. */
  readonly skew_y_deg: number;
  /** Flip horizontally (mirror across the local Y axis). */
  readonly flip_h: boolean;
  /** Flip vertically (mirror across the local X axis). */
  readonly flip_v: boolean;
  /** Anchor in layer-local 0..1 coords. Default: { x: 0.5, y: 0.5 } (centre). */
  readonly anchor: TransformPoint;
  /**
   * 4-corner projective override (Distort sub-mode). When present, the
   * affine fields above are ignored at render time and the four corners
   * map directly. Order: TL, TR, BR, BL — canvas-space px.
   */
  readonly distort_corners?: readonly [TransformPoint, TransformPoint, TransformPoint, TransformPoint];
}

/**
 * Row-major 3×3 transform matrix. The third row is `[0, 0, 1]` for affines
 * and arbitrary for projective transforms (Distort mode).
 *
 * Elements: `[a, b, tx, c, d, ty, p, q, w]`, mapping
 * `x' = (a·x + b·y + tx) / (p·x + q·y + w)`.
 */
export type TransformMatrix = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** Axis-aligned rectangle in canvas-space px. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A rectangle that knows which layer it belongs to (snap input). */
export interface LayerRect extends Rect {
  readonly layer_id: LayerId;
}

/**
 * Default identity transform. Anchor at the centre of the layer.
 */
export const IDENTITY_TRANSFORM: TransformDecomposed = {
  tx: 0,
  ty: 0,
  sx: 1,
  sy: 1,
  rotation_deg: 0,
  skew_x_deg: 0,
  skew_y_deg: 0,
  flip_h: false,
  flip_v: false,
  anchor: { x: 0.5, y: 0.5 },
};
