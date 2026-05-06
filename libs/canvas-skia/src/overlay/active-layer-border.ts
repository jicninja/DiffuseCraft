/**
 * Active-layer border overlay (F.8).
 *
 * Draws a subtle 1-pixel rectangle around the document bounds when an
 * active layer is set. Apps may compose this on top of the main canvas
 * frame; the renderer never owns persistent UI state.
 */

import type { SkCanvas } from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import type { Document } from '@diffusecraft/canvas-core';

/** Color id passed by the caller (resolved from theme tokens). */
export interface ActiveLayerBorderStyle {
  /** Skia color int (0xAARRGGBB). The caller resolves the theme token. */
  readonly color: number;
  /** Stroke width in document pixels. */
  readonly strokeWidth: number;
}

const DEFAULT_STYLE: ActiveLayerBorderStyle = {
  color: 0x60_00_AA_FF,
  strokeWidth: 2,
};

/**
 * Draw a border around the active layer's bounding rectangle. v1 uses the
 * full document bounds since per-layer bboxes are not yet stored on the
 * model; the transform-tools spec adds them.
 */
export const drawActiveLayerBorder = (
  canvas: SkCanvas,
  document: Document,
  style: ActiveLayerBorderStyle = DEFAULT_STYLE,
): void => {
  if (!document.active_layer_id) return;
  const paint = Skia.Paint();
  paint.setColor(style.color);
  paint.setStrokeWidth(style.strokeWidth);
  paint.setAntiAlias(true);
  canvas.drawRect(Skia.XYWHRect(0, 0, document.width, document.height), paint);
};
