/**
 * Hardness shader — builds a radial gradient for stamp hardness falloff.
 *
 * The shader implements the same coverage curve as `composeStrokeIntoRaster`'s
 * `stampCoverage` function in canvas-core, but GPU-accelerated via Skia's
 * radial gradient primitive.
 */

import type { SkShader } from '@shopify/react-native-skia';
import { Skia, TileMode } from '@shopify/react-native-skia';

/** Normalized radius used by the shader. Callers scale via canvas transform. */
const RADIUS = 0.5;

/**
 * Build a radial gradient shader for a stamp with given hardness.
 *
 * - hardness=1: solid disc (alpha=opacity everywhere inside radius)
 * - hardness=0: fully soft gradient (alpha=opacity at center, 0 at edge)
 * - hardness=0.5: solid core at 50% radius, linear falloff to edge
 *
 * The shader is centered at (0,0) with radius 0.5 (normalized).
 * Callers scale via canvas transform to match stamp.size.
 *
 * @param hardness - Brush hardness in [0, 1]. Clamped internally.
 * @param color - Brush color with r, g, b channels in [0, 1].
 * @param opacity - Stamp opacity in [0, 1].
 */
export function buildHardnessShader(
  hardness: number,
  color: { r: number; g: number; b: number },
  opacity: number,
): SkShader {
  'worklet';
  // Clamp hardness to [0, 1].
  const h = Math.max(0, Math.min(1, hardness));

  // Inner color: fully opaque at the given opacity.
  const inner = new Float32Array([color.r, color.g, color.b, opacity]);
  // Outer color: same RGB, fully transparent.
  const outer = new Float32Array([color.r, color.g, color.b, 0]);

  // Position of the inner stop: hardness * radius normalized to [0, 1].
  // At hardness=1 the inner stop sits at position 1.0 (solid disc).
  // At hardness=0 the inner stop sits at position 0.0 (full gradient from center).
  const innerPos = h;

  return Skia.Shader.MakeRadialGradient(
    { x: 0, y: 0 },
    RADIUS,
    [inner, outer],
    [innerPos, 1.0],
    TileMode.Clamp,
  );
}
