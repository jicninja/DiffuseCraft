/**
 * Viewport state + transform helpers (D.2, G.1).
 *
 * Viewport is zoom + pan + rotation in canvas coordinates. Helpers compose
 * the transform matrix and project points between document and viewport
 * space — adapter-agnostic. The Skia adapter applies these as `SkMatrix`
 * operations in `viewport-canvas.ts`.
 */

export interface Viewport {
  /** 1.0 = 100%. */
  readonly zoom: number;
  /** Pan offset in canvas pixels. */
  readonly pan_x: number;
  readonly pan_y: number;
  /** Ephemeral viewport rotation in degrees (Q5). */
  readonly rotation_degrees: number;
}

/** Identity viewport. */
export const identityViewport = (): Viewport => ({
  zoom: 1,
  pan_x: 0,
  pan_y: 0,
  rotation_degrees: 0,
});

/** Clamp zoom to a safe range and return a new viewport. */
export const setZoom = (
  viewport: Viewport,
  zoom: number,
  bounds: { min: number; max: number } = { min: 0.05, max: 32 },
): Viewport => ({
  ...viewport,
  zoom: Math.max(bounds.min, Math.min(bounds.max, zoom)),
});

/** Apply an additive zoom multiplier (e.g., pinch deltas). */
export const zoomBy = (
  viewport: Viewport,
  factor: number,
  bounds?: { min: number; max: number },
): Viewport => setZoom(viewport, viewport.zoom * factor, bounds);

/** Translate the viewport by `dx`/`dy` in canvas pixels. */
export const panBy = (viewport: Viewport, dx: number, dy: number): Viewport => ({
  ...viewport,
  pan_x: viewport.pan_x + dx,
  pan_y: viewport.pan_y + dy,
});

/** Set rotation, normalized to (-180, 180]. */
export const setRotation = (viewport: Viewport, degrees: number): Viewport => {
  let r = degrees % 360;
  if (r > 180) r -= 360;
  else if (r <= -180) r += 360;
  return { ...viewport, rotation_degrees: r };
};

/** Add `delta` degrees to the rotation. */
export const rotateBy = (viewport: Viewport, delta: number): Viewport =>
  setRotation(viewport, viewport.rotation_degrees + delta);

/**
 * Project a viewport-space point (e.g., a touch coordinate) to document
 * coordinates. The inverse of the `view * canvas` matrix used by
 * `viewport-canvas.ts`.
 */
export const viewportToDocument = (
  viewport: Viewport,
  point: { x: number; y: number },
): { x: number; y: number } => {
  const { zoom, pan_x, pan_y, rotation_degrees } = viewport;
  // Undo translation, then rotation, then scale.
  const tx = point.x - pan_x;
  const ty = point.y - pan_y;
  const theta = (-rotation_degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = tx * cos - ty * sin;
  const ry = tx * sin + ty * cos;
  return { x: rx / zoom, y: ry / zoom };
};

/** Project a document-space point to viewport coordinates. */
export const documentToViewport = (
  viewport: Viewport,
  point: { x: number; y: number },
): { x: number; y: number } => {
  const { zoom, pan_x, pan_y, rotation_degrees } = viewport;
  const sx = point.x * zoom;
  const sy = point.y * zoom;
  const theta = (rotation_degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;
  return { x: rx + pan_x, y: ry + pan_y };
};
