/**
 * Snap detection (Phase B — B.1, B.2, B.3).
 *
 * Pure helpers that, given a dragged rectangle and the surrounding document
 * geometry, return the candidate snap targets within `threshold_px`. The
 * tablet UX layer renders guide lines for the closest target per axis and
 * applies the offset.
 *
 * Snap target sources (FR-12):
 *   - canvas edges (top, bottom, left, right)
 *   - canvas centre (horizontal + vertical)
 *   - other layers' edges (axis-aligned bounding-box edges)
 *   - other layers' centres
 *   - grid (toggleable, 16 px in v1)
 *
 * Rotation snap (FR-15) is handled by `nearestRotationSnap` against
 * multiples of 15°.
 */
import type { LayerRect, Rect } from './types';

/** Default grid step (FR-12, v1). */
export const GRID_STEP_PX = 16;
/** Default snap threshold in viewport pixels (FR-13). */
export const DEFAULT_SNAP_THRESHOLD_PX = 6;
/** Default rotation snap step in degrees (FR-15). */
export const ROTATION_SNAP_STEP_DEG = 15;
/** Default rotation snap window (±deg around each multiple). */
export const ROTATION_SNAP_WINDOW_DEG = 3;

export type SnapTargetKind =
  | 'canvas-edge'
  | 'canvas-center'
  | 'layer-edge'
  | 'layer-center'
  | 'grid';

export type SnapAxis = 'h' | 'v';

/**
 * A potential snap target. `value` is the canvas-space coordinate the
 * dragged feature would align to; `axis` says whether it's a horizontal
 * (Y-aligned guide) or vertical (X-aligned guide) alignment.
 */
export interface SnapTarget {
  readonly kind: SnapTargetKind;
  readonly axis: SnapAxis;
  /** Canvas-space coordinate (px) the dragged feature aligns to. */
  readonly value: number;
  /** Distance from the dragged feature to this target (always ≥ 0). */
  readonly distance: number;
  /** Originating layer id, when `kind` is `layer-*`. */
  readonly source_id?: string;
  /**
   * Which feature on the dragged rect this target is suggesting alignment
   * for: `start` (left/top edge), `mid` (centre), `end` (right/bottom
   * edge). The caller uses this to compute the translation that snaps the
   * rect into place.
   */
  readonly snap_to: 'start' | 'mid' | 'end';
}

/** Document geometry used by `findSnapTargets`. */
export interface SnapDocumentGeometry {
  readonly canvas_width: number;
  readonly canvas_height: number;
  /** Bounding boxes of the layers other than the dragged one. */
  readonly other_layers: readonly LayerRect[];
  /** When true, the v1 16-px grid is included. */
  readonly grid_enabled?: boolean;
  /** Optional override of the grid step. Defaults to `GRID_STEP_PX`. */
  readonly grid_step_px?: number;
}

/**
 * Find every snap target that the dragged `rect` could align to within
 * `threshold_px`. Returned targets include their distance so the caller
 * can sort/select per axis.
 */
export const findSnapTargets = (
  rect: Rect,
  geometry: SnapDocumentGeometry,
  threshold_px: number = DEFAULT_SNAP_THRESHOLD_PX,
): readonly SnapTarget[] => {
  const out: SnapTarget[] = [];
  const left = rect.x;
  const right = rect.x + rect.w;
  const midX = rect.x + rect.w / 2;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const midY = rect.y + rect.h / 2;

  const considerV = (kind: SnapTargetKind, value: number, source_id?: string): void => {
    pushIfClose(out, kind, 'v', value, left, 'start', threshold_px, source_id);
    pushIfClose(out, kind, 'v', value, midX, 'mid', threshold_px, source_id);
    pushIfClose(out, kind, 'v', value, right, 'end', threshold_px, source_id);
  };
  const considerH = (kind: SnapTargetKind, value: number, source_id?: string): void => {
    pushIfClose(out, kind, 'h', value, top, 'start', threshold_px, source_id);
    pushIfClose(out, kind, 'h', value, midY, 'mid', threshold_px, source_id);
    pushIfClose(out, kind, 'h', value, bottom, 'end', threshold_px, source_id);
  };

  // Canvas edges.
  considerV('canvas-edge', 0);
  considerV('canvas-edge', geometry.canvas_width);
  considerH('canvas-edge', 0);
  considerH('canvas-edge', geometry.canvas_height);
  // Canvas centre.
  considerV('canvas-center', geometry.canvas_width / 2);
  considerH('canvas-center', geometry.canvas_height / 2);

  // Other layers.
  for (const layer of geometry.other_layers) {
    considerV('layer-edge', layer.x, layer.layer_id);
    considerV('layer-edge', layer.x + layer.w, layer.layer_id);
    considerV('layer-center', layer.x + layer.w / 2, layer.layer_id);
    considerH('layer-edge', layer.y, layer.layer_id);
    considerH('layer-edge', layer.y + layer.h, layer.layer_id);
    considerH('layer-center', layer.y + layer.h / 2, layer.layer_id);
  }

  // Grid.
  if (geometry.grid_enabled) {
    const step = geometry.grid_step_px ?? GRID_STEP_PX;
    const nearestVStart = Math.round(left / step) * step;
    const nearestVMid = Math.round(midX / step) * step;
    const nearestVEnd = Math.round(right / step) * step;
    pushIfClose(out, 'grid', 'v', nearestVStart, left, 'start', threshold_px);
    pushIfClose(out, 'grid', 'v', nearestVMid, midX, 'mid', threshold_px);
    pushIfClose(out, 'grid', 'v', nearestVEnd, right, 'end', threshold_px);
    const nearestHStart = Math.round(top / step) * step;
    const nearestHMid = Math.round(midY / step) * step;
    const nearestHEnd = Math.round(bottom / step) * step;
    pushIfClose(out, 'grid', 'h', nearestHStart, top, 'start', threshold_px);
    pushIfClose(out, 'grid', 'h', nearestHMid, midY, 'mid', threshold_px);
    pushIfClose(out, 'grid', 'h', nearestHEnd, bottom, 'end', threshold_px);
  }
  return out;
};

/**
 * Pick the closest snap target on each axis. Returns `{ horizontal, vertical }`,
 * either may be `null` when no target is in range. When several targets are
 * tied, the first-found wins (canvas → layer → grid in `findSnapTargets`'s
 * order).
 */
export const pickClosestPerAxis = (
  targets: readonly SnapTarget[],
): { horizontal: SnapTarget | null; vertical: SnapTarget | null } => {
  let h: SnapTarget | null = null;
  let v: SnapTarget | null = null;
  for (const t of targets) {
    if (t.axis === 'h') {
      if (!h || t.distance < h.distance) h = t;
    } else if (!v || t.distance < v.distance) v = t;
  }
  return { horizontal: h, vertical: v };
};

/**
 * Snap a rotation in degrees to the nearest multiple of `step_deg`, but
 * only when within `window_deg` of that multiple. Returns the original
 * value otherwise.
 *
 * Defaults match FR-15: 15° step, 3° window.
 */
export const nearestRotationSnap = (
  rotation_deg: number,
  step_deg: number = ROTATION_SNAP_STEP_DEG,
  window_deg: number = ROTATION_SNAP_WINDOW_DEG,
): number => {
  // Reduce to [0, 360) for the modular comparison.
  const positive = ((rotation_deg % 360) + 360) % 360;
  const nearest = Math.round(positive / step_deg) * step_deg;
  const delta = Math.abs(nearestSignedDelta(positive, nearest));
  if (delta <= window_deg) {
    // Map the snapped value back into the same ±360 range as the input.
    return rotation_deg + (nearest - positive);
  }
  return rotation_deg;
};

/**
 * Internal helper used by both `findSnapTargets` (axis-aligned snap) and
 * the rotation-snap helper. Handles the wraparound between 0° and 360°.
 */
const nearestSignedDelta = (a: number, b: number): number => {
  let d = a - b;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
};

const pushIfClose = (
  out: SnapTarget[],
  kind: SnapTargetKind,
  axis: SnapAxis,
  value: number,
  feature_value: number,
  snap_to: 'start' | 'mid' | 'end',
  threshold_px: number,
  source_id?: string,
): void => {
  const distance = Math.abs(value - feature_value);
  if (distance > threshold_px) return;
  const target: SnapTarget = source_id !== undefined
    ? { kind, axis, value, distance, source_id, snap_to }
    : { kind, axis, value, distance, snap_to };
  out.push(target);
};
