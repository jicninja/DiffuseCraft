/**
 * IncrementalStampExpander — worklet-shareable, stateful, per-stroke stamp emitter.
 *
 * Mirrors the math in `expandStrokeToStamps` (kept untouched in `stamps.ts`
 * for server-side `paint_strokes` parity), but restructured to emit only the
 * new stamps produced by the latest input segment instead of re-walking the
 * entire stroke on every call.
 *
 * Cost model:
 *  - `pushPoint`: O(new stamps) on the segment from the previous point to
 *    the new point. Never re-walks consumed segments.
 *  - Per-stroke memory: small fixed scalars (last consumed index, last
 *    emitted stamp position, in-segment travelled distance, prior smoothed
 *    sample). No arrays of points are retained.
 *
 * Worklet-callability:
 *  - The factory returns a plain object whose state is held in primitive
 *    fields. Methods are marked `'worklet'` so they can be invoked from a
 *    Reanimated worklet runtime (`runOnUI`).
 *  - The object captures its `config` snapshot and a small set of pure
 *    helpers. No closures over JS-only references; numbers and primitive
 *    arrays only.
 *
 * Validation parity:
 *  - For any prefix-shared input sequence pushed through `pushPoint`, the
 *    union of stamps emitted equals the result of `expandStrokeToStamps`
 *    over that same sequence. The math (smoothing factor, pressure curve
 *    sampling, segment-walk spacing) is reproduced verbatim.
 *
 * Design reference: brush-canvas-rendering §IncrementalStampExpander.
 */

import type { BrushPreset } from './presets';
import {
  DEFAULT_STROKE_SMOOTHING,
  MIN_SPACING_PX,
  type Stamp,
} from './stamps';
import type { StrokePoint } from './stroke';
import { samplePressureCurve } from './stroke';

/** Configuration captured at expander construction. Immutable for the stroke. */
export interface IncrementalStampExpanderConfig {
  readonly preset: BrushPreset;
  /** Smoothing factor [0, 0.95]. Defaults to {@link DEFAULT_STROKE_SMOOTHING}. */
  readonly smoothing?: number;
  /** Override the per-stamp size (skips pressure scaling). */
  readonly sizeOverride?: number;
  /** Override the per-stamp opacity (skips pressure scaling). */
  readonly opacityOverride?: number;
  /** Override the spacing fraction (defaults to `preset.spacing`). */
  readonly spacingOverride?: number;
}

/**
 * Worklet-callable, stateful stamp emitter for a single stroke.
 *
 * The shape is a plain object whose methods carry the `'worklet'` directive
 * so Reanimated can pass it across the JS↔UI boundary via `runOnUI`. State
 * is held in mutable primitive fields on the object.
 */
export interface IncrementalStampExpander {
  /**
   * Push the next captured input point and return the new stamps emitted on
   * the segment from the previous point to this one. Returns `[]` when no
   * new stamps fall on the segment (sub-spacing movement). Worklet-callable.
   */
  pushPoint(point: StrokePoint): Stamp[];
  /**
   * Total stamps emitted since construction. Exposed as a method (not a
   * getter) so the Reanimated Worklets babel plugin can workletize the
   * containing object — getters on object literals trip the plugin's
   * function-wrap pass.
   */
  getEmittedCount(): number;
  /** Release per-stroke state. Idempotent. */
  dispose(): void;
}

/**
 * Internal: the same hardness-coverage math as `composeStrokeIntoRaster`,
 * but inlined here as a per-stamp scalar so the per-stroke pool can compute
 * the resolved stamp size + opacity without rebuilding closures.
 *
 * Kept private so the public surface stays minimal and the file remains
 * worklet-friendly (no module-level mutable state).
 */
const dist = (ax: number, ay: number, bx: number, by: number): number => {
  'worklet';
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

const clamp01 = (v: number): number => {
  'worklet';
  return Math.max(0, Math.min(1, v));
};

const resolveDynamics = (
  preset: BrushPreset,
  pressure: number,
): { size: number; opacity: number } => {
  'worklet';
  const scale = samplePressureCurve(preset.pressureCurve, pressure);
  return {
    size: Math.max(0.5, preset.size * scale),
    opacity: clamp01(preset.opacity * scale),
  };
};

/**
 * Construct a worklet-callable incremental stamp expander.
 *
 * Lifecycle:
 *  1. Caller invokes the factory with a `BrushPreset`-bearing config at
 *     gesture-begin time.
 *  2. Caller pushes each captured input point through `pushPoint` (typically
 *     from inside a `useDerivedValue` watching `SharedValue<StrokePoint[]>`).
 *  3. Caller calls `dispose()` at gesture end / cancel to release per-stroke
 *     state.
 *
 * @example
 * ```ts
 * const expander = createIncrementalStampExpander({ preset: BRUSH_PRESETS.pen });
 * for (const p of points) {
 *   const newStamps = expander.pushPoint(p);
 *   for (const s of newStamps) renderer.drawStamps([s]);
 * }
 * expander.dispose();
 * ```
 */
export function createIncrementalStampExpander(
  config: IncrementalStampExpanderConfig,
): IncrementalStampExpander {
  // Snapshot config primitives onto the shared state. Capturing the preset
  // by reference is fine — `BrushPreset` is a frozen plain object.
  const preset = config.preset;
  const smoothing = Math.max(
    0,
    Math.min(0.95, config.smoothing ?? DEFAULT_STROKE_SMOOTHING),
  );
  const sizeOverrideRaw = config.sizeOverride;
  const opacityOverrideRaw = config.opacityOverride;
  const spacingFraction = config.spacingOverride ?? preset.spacing;

  // Encode "no override" as a sentinel so worklet code can compare against a
  // primitive without `?? undefined` allocations on the hot path.
  const sizeOverride = sizeOverrideRaw ?? -1;
  const opacityOverride = opacityOverrideRaw ?? -1;

  const state = {
    /** Whether at least one point has been pushed. */
    started: false,
    /** Last smoothed sample's coordinates. */
    smoothedX: 0,
    smoothedY: 0,
    smoothedPressure: 1,
    /** Position of the last emitted stamp. */
    lastStampX: 0,
    lastStampY: 0,
    /** Total stamps emitted across the stroke's lifetime. */
    emittedCount: 0,
    /** Dispose flag — idempotent. */
    disposed: false,
  };

  const stampAt = (
    x: number,
    y: number,
    size: number,
    opacity: number,
  ): Stamp => {
    'worklet';
    return {
      x,
      y,
      size,
      opacity,
      hardness: preset.hardness,
      erase: preset.erase,
    };
  };

  const expander: IncrementalStampExpander = {
    pushPoint(point: StrokePoint): Stamp[] {
      'worklet';
      if (state.disposed) return [];

      // Smoothing: same incremental moving-average filter as
      // `smoothStrokePoints`. The first point seeds the smoother (factor
      // does not apply to the seed sample).
      const px = typeof point.pressure === 'number' ? point.pressure : 1;

      if (!state.started) {
        state.smoothedX = point.x;
        state.smoothedY = point.y;
        state.smoothedPressure = px;
        state.started = true;

        // Emit the first stamp at the seed point.
        const dyn = resolveDynamics(preset, state.smoothedPressure);
        const size = sizeOverride >= 0 ? sizeOverride : dyn.size;
        const opacity = opacityOverride >= 0 ? opacityOverride : dyn.opacity;
        const out: Stamp[] = [
          stampAt(state.smoothedX, state.smoothedY, size, opacity),
        ];
        state.lastStampX = state.smoothedX;
        state.lastStampY = state.smoothedY;
        state.emittedCount += 1;
        return out;
      }

      const prevX = state.smoothedX;
      const prevY = state.smoothedY;
      const prevP = state.smoothedPressure;

      // Apply moving-average smoothing to the new sample.
      const newX = prevX * smoothing + point.x * (1 - smoothing);
      const newY = prevY * smoothing + point.y * (1 - smoothing);
      const newP = prevP * smoothing + px * (1 - smoothing);

      state.smoothedX = newX;
      state.smoothedY = newY;
      state.smoothedPressure = newP;

      const segLen = dist(prevX, prevY, newX, newY);
      if (segLen === 0) return [];

      // Same midpoint-reference dynamics as `expandStrokeToStamps`: we use
      // the segment's midpoint pressure to derive a representative stamp
      // size for spacing, so a fast deceleration does not over-stamp.
      const midPressure = (prevP + newP) * 0.5;
      const midDyn = resolveDynamics(preset, midPressure);
      const refSize = sizeOverride >= 0 ? sizeOverride : midDyn.size;
      const spacingPx = Math.max(MIN_SPACING_PX, refSize * spacingFraction);

      // Distance from last-emitted-stamp to the start of this segment
      // (`prev`). The "next gap" is `spacingPx - thatDistance`.
      const traveled = dist(state.lastStampX, state.lastStampY, prevX, prevY);
      let cursor = traveled;
      let gap = spacingPx - traveled;

      const out: Stamp[] = [];
      while (gap <= segLen - cursor + 1e-9) {
        cursor += gap;
        const t = cursor / segLen;
        const x = prevX + (newX - prevX) * t;
        const y = prevY + (newY - prevY) * t;
        const p = prevP + (newP - prevP) * t;
        const dyn = resolveDynamics(preset, p);
        const size = sizeOverride >= 0 ? sizeOverride : dyn.size;
        const opacity = opacityOverride >= 0 ? opacityOverride : dyn.opacity;
        out.push(stampAt(x, y, size, opacity));
        state.lastStampX = x;
        state.lastStampY = y;
        gap = spacingPx;
      }

      state.emittedCount += out.length;
      return out;
    },
    getEmittedCount(): number {
      'worklet';
      return state.emittedCount;
    },
    dispose(): void {
      'worklet';
      // Idempotent: subsequent pushes after dispose return [] silently.
      state.disposed = true;
      state.started = false;
      state.emittedCount = 0;
    },
  };

  return expander;
}
