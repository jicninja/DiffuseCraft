/**
 * Skia matrix helpers for viewport transforms (G.1).
 *
 * Applies pan/zoom/rotation to an SkCanvas in the canonical order — the
 * inverse of `viewportToDocument` in canvas-core. Rotation pivots around
 * the document center so two-finger rotate feels natural to the user.
 */

import type { SkCanvas } from '@shopify/react-native-skia';
import type { Viewport } from '@diffusecraft/canvas-core';

export interface ViewportTarget {
  /** Document logical width / height. */
  readonly width: number;
  readonly height: number;
}

/**
 * Apply the viewport transform to a Skia canvas. Caller must `save()` the
 * canvas before invoking this and `restore()` after drawing the frame.
 */
export const applyViewport = (
  canvas: SkCanvas,
  viewport: Viewport,
  target: ViewportTarget,
): void => {
  const cx = target.width / 2;
  const cy = target.height / 2;

  // Defensive coercion — gesture handlers in RNGH 2 + Reanimated 4 occasionally
  // deliver non-primitive event values when cross-thread bridging hiccups; we
  // coerce to plain numbers here so Skia's native bindings never receive an
  // object. Invalid values fall back to identity components.
  const panX = Number(viewport.pan_x);
  const panY = Number(viewport.pan_y);
  const rot = Number(viewport.rotation_degrees);
  const zoom = Number(viewport.zoom);
  const safePanX = Number.isFinite(panX) ? panX : 0;
  const safePanY = Number.isFinite(panY) ? panY : 0;
  const safeRot = Number.isFinite(rot) ? rot : 0;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  if (
    safePanX !== panX ||
    safePanY !== panY ||
    safeRot !== rot ||
    safeZoom !== zoom
  ) {
    // eslint-disable-next-line no-console
    console.warn('[applyViewport] non-numeric viewport components', {
      pan_x: viewport.pan_x,
      pan_y: viewport.pan_y,
      rotation_degrees: viewport.rotation_degrees,
      zoom: viewport.zoom,
    });
  }

  // Translate-rotate-scale around document center, then pan in screen-space.
  canvas.translate(safePanX, safePanY);
  canvas.translate(cx, cy);
  if (safeRot !== 0) {
    // RN-Skia 2.x JSI binding: canvas.rotate(degrees, px, py) — all three
    // arguments are required even when rotating around the current origin.
    canvas.rotate(safeRot, 0, 0);
  }
  canvas.scale(safeZoom, safeZoom);
  canvas.translate(-cx, -cy);
};
