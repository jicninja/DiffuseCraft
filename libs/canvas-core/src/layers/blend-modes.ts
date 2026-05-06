/**
 * Blend mode enumeration (FR-12).
 *
 * Twenty modes covering the rich-enough subset for v1 collage workflows.
 * Formulas live in `../blend/formulas.ts` and a human reference in
 * `../blend/formulas.md`. Skia natively supports most of these; modes Skia
 * lacks are emulated via custom shaders in `canvas-skia` (Phase F.4).
 */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color_dodge',
  'color_burn',
  'hard_light',
  'soft_light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear_burn',
  'linear_dodge',
  'linear_light',
  'pin_light',
] as const;

/** Discriminated union of every supported blend mode. */
export type BlendMode = (typeof BLEND_MODES)[number];

/** Type guard. */
export const isBlendMode = (value: string): value is BlendMode =>
  (BLEND_MODES as readonly string[]).includes(value);
