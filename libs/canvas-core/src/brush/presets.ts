/**
 * Five fixed brush presets.
 *
 * Per the editor philosophy: brushes are intentionally minimal in v1 — five
 * presets covering pen, pencil, marker, eraser, and smooth. The full brush
 * engine (custom tips, dynamics, dual brush, etc.) is owned by the
 * `brush-system` spec.
 *
 * Each preset is a pure data record: pixel size, hardness, opacity, blend
 * mode, and a pressure curve sampled as 0..1 → 0..1 control points. The
 * Skia adapter consumes these values to draw stroke segments.
 */

import type { BlendMode } from '../layers/blend-modes';

export type BrushPresetId = 'pen' | 'pencil' | 'marker' | 'eraser' | 'smooth';

export interface BrushPreset {
  readonly id: BrushPresetId;
  readonly label: string;
  /** Diameter in document pixels. */
  readonly size: number;
  /** Edge hardness 0..1 (1 = hard, 0 = soft falloff). */
  readonly hardness: number;
  /** Stroke opacity 0..1. */
  readonly opacity: number;
  /** Spacing between stamps along the stroke, fraction of `size`. */
  readonly spacing: number;
  /** Blend mode applied per-stamp. Eraser uses destination-out via opacity. */
  readonly blend_mode: BlendMode;
  /** Whether the brush erases (alpha-only) instead of painting RGB. */
  readonly erase: boolean;
  /**
   * Pressure curve. Each entry maps stylus-pressure 0..1 (input) to a
   * scale factor 0..1 (output) applied to size + opacity.
   */
  readonly pressureCurve: ReadonlyArray<readonly [number, number]>;
}

const linear = [
  [0, 0],
  [1, 1],
] as const satisfies ReadonlyArray<readonly [number, number]>;

const slowStart = [
  [0, 0],
  [0.3, 0.1],
  [1, 1],
] as const satisfies ReadonlyArray<readonly [number, number]>;

/** Default preset set (FR brush-system v1 minimum). */
export const BRUSH_PRESETS: Readonly<Record<BrushPresetId, BrushPreset>> = {
  pen: {
    id: 'pen',
    label: 'Pen',
    size: 6,
    hardness: 0.95,
    opacity: 1,
    spacing: 0.05,
    blend_mode: 'normal',
    erase: false,
    pressureCurve: linear,
  },
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    size: 4,
    hardness: 0.5,
    opacity: 0.85,
    spacing: 0.08,
    blend_mode: 'normal',
    erase: false,
    pressureCurve: slowStart,
  },
  marker: {
    id: 'marker',
    label: 'Marker',
    size: 32,
    hardness: 0.6,
    opacity: 0.6,
    spacing: 0.15,
    blend_mode: 'multiply',
    erase: false,
    pressureCurve: linear,
  },
  eraser: {
    id: 'eraser',
    label: 'Eraser',
    size: 24,
    hardness: 0.85,
    opacity: 1,
    spacing: 0.1,
    blend_mode: 'normal',
    erase: true,
    pressureCurve: linear,
  },
  smooth: {
    id: 'smooth',
    label: 'Smooth',
    size: 48,
    hardness: 0.1,
    opacity: 0.4,
    spacing: 0.2,
    blend_mode: 'normal',
    erase: false,
    pressureCurve: slowStart,
  },
};

/** Ordered preset list for picker UIs. */
export const BRUSH_PRESET_ORDER: ReadonlyArray<BrushPresetId> = [
  'pen',
  'pencil',
  'marker',
  'eraser',
  'smooth',
];

/** Lookup helper. */
export const getBrushPreset = (id: BrushPresetId): BrushPreset => BRUSH_PRESETS[id];
