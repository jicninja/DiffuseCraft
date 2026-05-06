/**
 * Stroke model — sequence of pressure-aware sample points.
 *
 * The Skia adapter consumes a `Stroke` to draw stamps at each point with
 * size + opacity scaled by the pressure curve from the active preset. This
 * file defines the data shape; rasterization lives in canvas-skia.
 */

import type { BrushPresetId } from './presets';

/**
 * One sample along a stroke. `pressure` defaults to 1 when absent (mouse
 * input). `tilt_x`/`tilt_y` are optional Apple Pencil / S-Pen tilt vectors
 * exposed by `react-native-skia` (FR-24); we keep them optional so non-
 * stylus inputs still produce well-formed strokes.
 */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  /** Stylus pressure 0..1; 1 when not provided. */
  readonly pressure?: number;
  /** Tilt-x in degrees (-90..90). */
  readonly tilt_x?: number;
  /** Tilt-y in degrees (-90..90). */
  readonly tilt_y?: number;
  /** Timestamp in ms since epoch — used by smoothing/predictive strokes. */
  readonly t?: number;
}

export interface Stroke {
  readonly preset: BrushPresetId;
  readonly points: ReadonlyArray<StrokePoint>;
}

/** Sample a piecewise-linear pressure curve at `input` (0..1). */
export const samplePressureCurve = (
  curve: ReadonlyArray<readonly [number, number]>,
  input: number,
): number => {
  'worklet';
  if (curve.length === 0) return input;
  const x = Math.max(0, Math.min(1, input));
  // Find the segment containing `x`.
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i]!;
    const [x1, y1] = curve[i + 1]!;
    if (x >= x0 && x <= x1) {
      if (x1 === x0) return y0;
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  // Out-of-range: clamp to last point's y.
  const last = curve[curve.length - 1]!;
  return last[1];
};

/**
 * Resolve effective size + opacity for a stroke point given a preset.
 *
 * @example
 * ```ts
 * const eff = resolveStamp(BRUSH_PRESETS.pen, { x: 0, y: 0, pressure: 0.5 });
 * // eff.size and eff.opacity are scaled by the linear pressure curve.
 * ```
 */
export const resolveStamp = (
  preset: { size: number; opacity: number; pressureCurve: ReadonlyArray<readonly [number, number]> },
  point: StrokePoint,
): { size: number; opacity: number } => {
  const pressure = typeof point.pressure === 'number' ? point.pressure : 1;
  const scale = samplePressureCurve(preset.pressureCurve, pressure);
  return {
    size: preset.size * scale,
    opacity: preset.opacity * scale,
  };
};
