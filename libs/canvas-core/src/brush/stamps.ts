/**
 * Stroke → stamp expansion (brush-system Phase B).
 *
 * Given a `Stroke` (sequence of pressure-aware points) and a `BrushPreset`,
 * `expandStrokeToStamps` produces a list of `Stamp` records — one per stamp
 * the renderer should draw along the stroke. Spacing, pressure-curve scaling,
 * and a moving-average smoothing filter are applied here so both the Skia
 * runtime renderer and the server-side `paint_strokes` materializer share
 * the same geometry.
 *
 * This module is pure-TS: no Skia, no DOM, no Node. It only depends on the
 * preset shape and stroke-point types declared in `presets.ts` / `stroke.ts`.
 */

import type { BrushPreset } from './presets';
import type { StrokePoint } from './stroke';
import { samplePressureCurve } from './stroke';

/**
 * Pre-resolved stamp ready for the renderer. Position is in document pixels.
 * `size` is the diameter at this stamp (already scaled by pressure curve);
 * `opacity` is the per-stamp alpha (0..1) before any per-stamp accumulation.
 */
export interface Stamp {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
  readonly hardness: number;
  /** Whether this stamp erases (alpha-out) instead of painting. */
  readonly erase: boolean;
}

/** Default smoothing factor when none is supplied on the stroke. */
export const DEFAULT_STROKE_SMOOTHING = 0.3;

/** Minimum spacing in document pixels — guards against zero-spacing runaway loops. */
export const MIN_SPACING_PX = 0.5;

/**
 * Apply a moving-average smoothing filter to a stroke's points. `factor`
 * blends the previous-smoothed point with the raw point: `0` is no smoothing,
 * `1` is fully held (renderer would never advance). Values are clamped to
 * `[0, 0.95]` so strokes always make forward progress.
 */
export const smoothStrokePoints = (
  points: ReadonlyArray<StrokePoint>,
  factor: number,
): StrokePoint[] => {
  if (points.length === 0) return [];
  const f = Math.max(0, Math.min(0.95, factor));
  if (f === 0) return points.map((p) => ({ ...p }));
  const out: StrokePoint[] = [];
  let prevX = points[0]!.x;
  let prevY = points[0]!.y;
  let prevPressure = points[0]!.pressure ?? 1;
  for (const p of points) {
    const px = p.pressure ?? 1;
    const x = prevX * f + p.x * (1 - f);
    const y = prevY * f + p.y * (1 - f);
    const pressure = prevPressure * f + px * (1 - f);
    out.push({
      ...p,
      x,
      y,
      pressure,
    });
    prevX = x;
    prevY = y;
    prevPressure = pressure;
  }
  return out;
};

/** Resolve effective per-stamp size + opacity from preset and pressure. */
const resolveStampDynamics = (
  preset: BrushPreset,
  point: StrokePoint,
): { size: number; opacity: number } => {
  const pressure = typeof point.pressure === 'number' ? point.pressure : 1;
  const scale = samplePressureCurve(preset.pressureCurve, pressure);
  return {
    size: Math.max(0.5, preset.size * scale),
    opacity: Math.max(0, Math.min(1, preset.opacity * scale)),
  };
};

const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export interface ExpandStrokeOptions {
  /** Override the preset spacing fraction (0..1). */
  readonly spacing?: number;
  /** Override the smoothing factor (0..1). */
  readonly smoothing?: number;
  /** Override the per-stamp size in pixels (skips pressure scaling). */
  readonly sizeOverride?: number;
  /** Override the per-stamp opacity (skips pressure scaling). */
  readonly opacityOverride?: number;
}

/**
 * Walk the stroke and emit stamps spaced by `preset.spacing * size`.
 *
 * - The first point always emits a stamp.
 * - Between consecutive raw points whose Euclidean distance ≥ spacing, we
 *   linearly interpolate stamp positions so a fast input segment still gets
 *   the right stamp count (avoids visual gaps on quick strokes).
 * - Pressure / size / opacity are sampled at each interpolated stamp using
 *   the segment's lerp parameter.
 */
export const expandStrokeToStamps = (
  preset: BrushPreset,
  points: ReadonlyArray<StrokePoint>,
  options: ExpandStrokeOptions = {},
): Stamp[] => {
  if (points.length === 0) return [];
  const smoothing = options.smoothing ?? DEFAULT_STROKE_SMOOTHING;
  const smoothed = smoothStrokePoints(points, smoothing);
  const stamps: Stamp[] = [];

  const stampAt = (
    x: number,
    y: number,
    size: number,
    opacity: number,
  ): Stamp => ({
    x,
    y,
    size,
    opacity,
    hardness: preset.hardness,
    erase: preset.erase,
  });

  // First stamp.
  const first = smoothed[0]!;
  const firstDyn = resolveStampDynamics(preset, first);
  const firstSize = options.sizeOverride ?? firstDyn.size;
  const firstOpacity = options.opacityOverride ?? firstDyn.opacity;
  stamps.push(stampAt(first.x, first.y, firstSize, firstOpacity));

  let lastX = first.x;
  let lastY = first.y;

  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i - 1]!;
    const curr = smoothed[i]!;
    const segLen = Math.sqrt(dist2(prev.x, prev.y, curr.x, curr.y));
    if (segLen === 0) continue;

    // Sample dynamics along the segment based on midpoint so spacing uses a
    // representative size (otherwise short fast segments produce too many
    // stamps when the stroke decelerates).
    const midPressure = ((prev.pressure ?? 1) + (curr.pressure ?? 1)) * 0.5;
    const midDyn = resolveStampDynamics(preset, {
      x: 0,
      y: 0,
      pressure: midPressure,
    });
    const refSize = options.sizeOverride ?? midDyn.size;
    const spacingPx = Math.max(
      MIN_SPACING_PX,
      refSize * (options.spacing ?? preset.spacing),
    );

    // Walk the segment from last stamp to `curr` in spacing-sized steps.
    let traveled = Math.sqrt(dist2(lastX, lastY, prev.x, prev.y));
    let cursor = traveled; // distance along [prev → curr] we have already covered.
    // The "remaining gap" until the next stamp is `spacingPx - dist(lastStamp, prev)`.
    let gap = spacingPx - traveled;
    while (gap <= segLen - cursor + 1e-9) {
      cursor += gap;
      const t = cursor / segLen;
      const x = prev.x + (curr.x - prev.x) * t;
      const y = prev.y + (curr.y - prev.y) * t;
      const pressure =
        (prev.pressure ?? 1) + ((curr.pressure ?? 1) - (prev.pressure ?? 1)) * t;
      const dyn = resolveStampDynamics(preset, { x, y, pressure });
      const size = options.sizeOverride ?? dyn.size;
      const opacity = options.opacityOverride ?? dyn.opacity;
      stamps.push(stampAt(x, y, size, opacity));
      lastX = x;
      lastY = y;
      gap = spacingPx;
    }
    // Reference variables to satisfy the linter's no-unused-vars in case the
    // loop never advances (gap > segLen) on a short segment.
    void traveled;
  }
  return stamps;
};

/**
 * Axis-aligned bounding box of a stamp list, padded by half-size on each
 * side so the stamp's full footprint is included. Returns `null` for an
 * empty stamp list. Coordinates are floored / ceiled to integer pixels.
 */
export const stampsBoundingBox = (
  stamps: ReadonlyArray<Stamp>,
): { x: number; y: number; w: number; h: number } | null => {
  if (stamps.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of stamps) {
    const half = s.size * 0.5;
    if (s.x - half < minX) minX = s.x - half;
    if (s.y - half < minY) minY = s.y - half;
    if (s.x + half > maxX) maxX = s.x + half;
    if (s.y + half > maxY) maxY = s.y + half;
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  const w = Math.ceil(maxX) - x;
  const h = Math.ceil(maxY) - y;
  return { x, y, w, h };
};
