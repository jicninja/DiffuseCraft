/**
 * Map `canvas-core` `BlendMode` values to `@shopify/react-native-skia`
 * `SkBlendMode` strings (E.2 / F.4).
 *
 * Skia's enum names are PascalCase; ours are snake_case. The mapping table
 * below pins each canvas-core mode to the closest Skia equivalent. Modes
 * Skia lacks return `null` so the adapter falls back to a custom shader
 * (Phase F.4 — left as a TODO for the brush-system follow-up).
 */

import type { BlendMode } from '@diffusecraft/canvas-core';
import type { SkBlendMode } from '@shopify/react-native-skia';

const TABLE: Readonly<Record<BlendMode, SkBlendMode | null>> = {
  normal: 'SrcOver',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  color_dodge: 'ColorDodge',
  color_burn: 'ColorBurn',
  hard_light: 'HardLight',
  soft_light: 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
  // Skia lacks linear_burn / linear_dodge / linear_light / pin_light as
  // first-class enums. They need a custom shader (F.4); fall back to the
  // closest practical equivalent for v1 so collages still render reasonably.
  linear_burn: null,
  linear_dodge: 'Plus',
  linear_light: null,
  pin_light: null,
};

/**
 * Resolve a Skia blend mode for a given canvas-core mode. Returns null if
 * Skia has no native equivalent (caller falls back to a custom shader).
 */
export const toSkBlendMode = (mode: BlendMode): SkBlendMode | null => TABLE[mode];

/** True when the mode is renderable natively without a custom shader. */
export const isNativeBlendMode = (mode: BlendMode): boolean => TABLE[mode] !== null;
