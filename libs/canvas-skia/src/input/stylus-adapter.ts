/**
 * Stylus adapter — pure-function mapping from RNGH (`react-native-gesture-
 * handler`) 2.20+ stylus payloads to `StrokePoint` records consumed by the
 * brush pipeline.
 *
 * **Worklet-callable**: every exported function carries the `'worklet'`
 * directive. The intended consumer is the brush gesture's `onBegin` /
 * `onUpdate` worklet body, which reads `event.stylusData` directly and
 * forwards the result to `useBrushPipeline.pushPoint`.
 *
 * Allocations: `mapStylusEvent` produces at most one `StrokePoint` object
 * per call. No closures, no module-level state.
 *
 * Cross-device behavior:
 *  - **Apple Pencil** delivers `pressure`, `azimuthAngle`, `altitudeAngle`.
 *    The first event of a stroke sometimes reports `pressure = 0` before
 *    the sensor stabilizes; we discard it (FR-13 guard).
 *  - **S-Pen** delivers `pressure` and may deliver `tiltX` / `tiltY`.
 *  - **Finger / mouse** has no `stylusData`; we substitute `DEFAULT_PRESSURE`
 *    and emit no tilt fields.
 *
 * @module
 */

import type { StrokePoint } from '@diffusecraft/canvas-core';

import type { RNGHStylusData, RNGHStylusEvent } from './stylusData-types';

/** Default pressure for finger touches (no stylus data). */
export const DEFAULT_PRESSURE = 0.5;

/**
 * Backwards-compatible alias: pre-RNGH-2.20 callers expected a flat
 * `RawStylusEvent` shape (`force` + `pressure` siblings on the event
 * itself). The new adapter is fed `RNGHStylusEvent` directly; we keep this
 * alias only so existing apps/mobile imports don't immediately break during
 * the cutover. It is structurally compatible with `RNGHStylusEvent`.
 *
 * @deprecated prefer `RNGHStylusEvent` from `./stylusData-types`.
 */
export type RawStylusEvent = RNGHStylusEvent;

/**
 * Worklet-side clamp: returns `fallback` when the value is non-finite,
 * otherwise clamps to `[min, max]`.
 */
const safeClamp = (
  value: number,
  min: number,
  max: number,
  fallback: number,
): number => {
  'worklet';
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

/**
 * Map raw stylus pressure to `[0, 1]` with clamping.
 *
 * Returns `DEFAULT_PRESSURE` when the input is undefined or non-finite —
 * the finger-fallback path. Worklet-callable.
 */
export function mapPressure(rawValue: number | undefined): number {
  'worklet';
  if (rawValue === undefined) return DEFAULT_PRESSURE;
  return safeClamp(rawValue, 0, 1, DEFAULT_PRESSURE);
}

/**
 * Convert iOS Apple Pencil azimuth (radians, 0..2π) and altitude (radians,
 * 0..π/2) to `tilt_x` / `tilt_y` in degrees clamped to `[-90, 90]`.
 *
 *   tilt_x = cos(azimuth) · (90 − altitude_degrees)
 *   tilt_y = sin(azimuth) · (90 − altitude_degrees)
 *
 * Worklet-callable.
 */
export function convertTilt(
  azimuthAngle: number,
  altitudeAngle: number,
): { tilt_x: number; tilt_y: number } {
  'worklet';
  const safeAzimuth = Number.isFinite(azimuthAngle) ? azimuthAngle : 0;
  const safeAltitude = Number.isFinite(altitudeAngle)
    ? altitudeAngle
    : Math.PI / 2;

  const altitudeDegrees = safeClamp(
    (safeAltitude * 180) / Math.PI,
    0,
    90,
    90,
  );
  const tiltMagnitude = 90 - altitudeDegrees;
  const tiltX = Math.cos(safeAzimuth) * tiltMagnitude;
  const tiltY = Math.sin(safeAzimuth) * tiltMagnitude;
  return {
    tilt_x: safeClamp(tiltX, -90, 90, 0),
    tilt_y: safeClamp(tiltY, -90, 90, 0),
  };
}

/**
 * Map an RNGH gesture event to a `StrokePoint`.
 *
 * Worklet-callable. Allocations: at most one `StrokePoint` object per call.
 *
 * - When `event.stylusData` is **present**:
 *   - `pressure` is read from `stylusData.pressure` (Apple Pencil `force`,
 *     S-Pen `pressure`).
 *   - When `stylusData.azimuthAngle` and `stylusData.altitudeAngle` are
 *     both present, tilt is derived via {@link convertTilt}.
 *   - Otherwise, when `stylusData.tiltX` / `tiltY` (radians) are present,
 *     they are converted to degrees and clamped to `[-90, 90]`.
 *   - **First-event guard (FR-13)**: when `isFirstEvent === true` and the
 *     reported pressure is exactly `0`, the function returns `null` so the
 *     caller can discard this event and treat the next one as the stroke's
 *     starting point.
 *
 * - When `event.stylusData` is **absent** (finger / mouse):
 *   - `pressure` is set to {@link DEFAULT_PRESSURE} (0.5).
 *   - No `tilt_x` / `tilt_y` fields are added to the result.
 */
export function mapStylusEvent(
  event: RNGHStylusEvent,
  isFirstEvent: boolean,
): StrokePoint | null {
  'worklet';
  const stylus: RNGHStylusData | undefined = event.stylusData;

  // Resolve coordinates with NaN/Infinity fallback to 0.
  const x = Number.isFinite(event.x) ? event.x : 0;
  const y = Number.isFinite(event.y) ? event.y : 0;

  if (stylus === undefined) {
    // Finger / mouse path — no tilt, default mid-pressure.
    return { x, y, pressure: DEFAULT_PRESSURE };
  }

  const rawPressure = stylus.pressure;

  // FR-13 guard: discard the very first stylus event when its reported
  // pressure is exactly 0 (Apple Pencil sensor not yet ready).
  if (isFirstEvent && rawPressure === 0) {
    return null;
  }

  const pressure = mapPressure(rawPressure);

  // iOS-style tilt: azimuth + altitude in radians.
  if (
    stylus.azimuthAngle !== undefined &&
    stylus.altitudeAngle !== undefined
  ) {
    const t = convertTilt(stylus.azimuthAngle, stylus.altitudeAngle);
    return { x, y, pressure, tilt_x: t.tilt_x, tilt_y: t.tilt_y };
  }

  // Android-style tilt: tiltX / tiltY in radians. Convert to degrees and
  // clamp to the same [-90, 90] range the rest of the pipeline expects.
  if (stylus.tiltX !== undefined || stylus.tiltY !== undefined) {
    const tiltXDeg = stylus.tiltX !== undefined
      ? safeClamp((stylus.tiltX * 180) / Math.PI, -90, 90, 0)
      : 0;
    const tiltYDeg = stylus.tiltY !== undefined
      ? safeClamp((stylus.tiltY * 180) / Math.PI, -90, 90, 0)
      : 0;
    return { x, y, pressure, tilt_x: tiltXDeg, tilt_y: tiltYDeg };
  }

  // Stylus present but no tilt data — emit pressure only.
  return { x, y, pressure };
}
