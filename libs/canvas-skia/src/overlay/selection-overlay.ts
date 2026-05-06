/**
 * Selection overlay (F.8).
 *
 * Draws the current `Selection` on top of the document composite. Rect
 * selections become a dashed marching-ants rectangle; lasso selections
 * walk the polygon as a closed path; mask selections are visualized only
 * by the active-layer border (the mask itself is not drawn here).
 *
 * Marching-ants animation is the consumer's responsibility — pass an
 * incrementing `phase` between frames.
 */

import type { SkCanvas } from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import type { Selection } from '@diffusecraft/canvas-core';

export interface SelectionOverlayStyle {
  /** Marching-ants color (Skia color int, 0xAARRGGBB). */
  readonly color: number;
  readonly strokeWidth: number;
  /** Phase offset for the dashed pattern. */
  readonly phase: number;
}

const DEFAULT_STYLE: SelectionOverlayStyle = {
  color: 0xFF_00_AA_FF,
  strokeWidth: 1.5,
  phase: 0,
};

/** Draw the selection overlay. No-op when selection is `none`. */
export const drawSelectionOverlay = (
  canvas: SkCanvas,
  selection: Selection,
  style: SelectionOverlayStyle = DEFAULT_STYLE,
): void => {
  if (selection.kind === 'none' || selection.kind === 'mask') return;
  const paint = Skia.Paint();
  paint.setColor(style.color);
  paint.setStrokeWidth(style.strokeWidth);
  paint.setAntiAlias(true);
  if (selection.kind === 'rect') {
    const r = selection.rect;
    canvas.drawRect(Skia.XYWHRect(r.x, r.y, r.w, r.h), paint);
    return;
  }
  // Lasso — closed polygon path.
  if (selection.points.length < 2) return;
  const path = Skia.Path.Make();
  const first = selection.points[0]!;
  path.moveTo(first.x, first.y);
  for (let i = 1; i < selection.points.length; i++) {
    const p = selection.points[i]!;
    path.lineTo(p.x, p.y);
  }
  path.close();
  canvas.drawPath(path, paint);
};
