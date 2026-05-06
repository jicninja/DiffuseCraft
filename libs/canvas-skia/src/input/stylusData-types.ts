/**
 * Type subset of the `react-native-gesture-handler` ≥ 2.20 stylus payload
 * delivered on `Gesture.Pan` callbacks (`onBegin` / `onUpdate` / `onEnd`).
 *
 * We do not import these from `react-native-gesture-handler` directly so that:
 *  1. `canvas-skia` keeps zero runtime dependency on RNGH (the gesture
 *     binding lives in `apps/mobile`); and
 *  2. the stylus adapter can be exercised from a pure-TS test environment
 *     without the gesture handler runtime present.
 *
 * The shape mirrors the RNGH 2.30 type declarations:
 *  - `event.stylusData` is `undefined` for finger / mouse input.
 *  - `event.stylusData.pressure` is the normalized pressure 0..1 (Apple
 *    Pencil `force`, S-Pen `pressure`).
 *  - `tiltX` / `tiltY` (radians) are reported by some Android stylus
 *    drivers; iOS reports `azimuthAngle` + `altitudeAngle` instead. Our
 *    adapter handles both.
 *  - `pointerType` lets callers detect finger vs stylus when `stylusData`
 *    is present but pressure is sentinel (e.g., S-Pen hover).
 */

/**
 * The relevant subset of RNGH's `StylusData`. All fields are optional so
 * a partial event from finger input or unsupported devices does not crash.
 */
export interface RNGHStylusData {
  /** Apple Pencil force / S-Pen pressure, normalized to [0, 1]. */
  readonly pressure?: number;
  /** Tilt around the X axis in radians (Android-only on some drivers). */
  readonly tiltX?: number;
  /** Tilt around the Y axis in radians. */
  readonly tiltY?: number;
  /** Azimuth angle in radians (iOS Apple Pencil semantics). */
  readonly azimuthAngle?: number;
  /** Altitude angle in radians [0, π/2] (iOS Apple Pencil semantics). */
  readonly altitudeAngle?: number;
}

/** RNGH `pointerType` discriminator. Mirrors `PointerType` in 2.30+. */
export type RNGHPointerType = 'TOUCH' | 'STYLUS' | 'MOUSE' | 'KEY' | 'OTHER';

/**
 * The fields the brush gesture's worklet body reads from each gesture event.
 * Anything else on the RNGH event payload is ignored by the stamp pipeline.
 */
export interface RNGHStylusEvent {
  /** Document-space (or screen-space; caller decides) X coordinate. */
  readonly x: number;
  /** Y coordinate. */
  readonly y: number;
  /** Stylus data when the input device is a stylus; `undefined` otherwise. */
  readonly stylusData?: RNGHStylusData;
  /** Optional pointer-type hint. Not all RNGH versions populate this. */
  readonly pointerType?: RNGHPointerType;
}
