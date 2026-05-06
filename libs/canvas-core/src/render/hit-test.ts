/**
 * Render-agnostic hit-test helpers (B.5, FR-19, Q6).
 *
 * Coarse hit-testing on the document model alone — no pixel sampling.
 * For paint/control layers we treat the layer as covering the full
 * document bounds (since the model does not yet carry per-layer
 * bounding boxes). The Skia adapter refines this by sampling the
 * rendered alpha per pixel; that lives in `canvas-skia`.
 */

import type { LayerId } from '../shared/ids';
import type { Layer } from '../layers/types';
import type { Document } from '../document/document';
import { byPosition } from '../document/operations';
import type { Viewport } from './viewport';
import { viewportToDocument } from './viewport';

/** Predicate: is this layer eligible for hit-testing at all? */
const isHittable = (layer: Layer): boolean => {
  if (!layer.visible) return false;
  if (layer.locked) return false;
  // Region/control/mask layers do not produce visible pixels in the canvas
  // composite (per design.md §7), so they should not hit when tapping.
  if (layer.kind === 'control' || layer.kind === 'region' || layer.kind === 'mask') {
    return false;
  }
  return true;
};

/** True when the document-space point lies inside the canvas bounds. */
const inDocumentBounds = (doc: Document, p: { x: number; y: number }): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < doc.width && p.y < doc.height;

/**
 * Topmost-visible-layer hit-test in viewport space (Q6).
 *
 * This is the model-only path. Adapters that can sample alpha may refine
 * the result by skipping fully-transparent points.
 */
export const hitTestModel = (
  doc: Document,
  viewport: Viewport,
  point: { x: number; y: number },
): LayerId | null => {
  const docPoint = viewportToDocument(viewport, point);
  if (!inDocumentBounds(doc, docPoint)) return null;
  // Top-of-stack first (descending position).
  const stack = [...doc.layers].sort(byPosition).reverse();
  for (const layer of stack) {
    if (isHittable(layer)) return layer.id;
  }
  return null;
};

/**
 * Z-stack hit-test (long-press cycle): every visible hittable layer at the
 * point, ordered top → bottom.
 */
export const hitTestStackModel = (
  doc: Document,
  viewport: Viewport,
  point: { x: number; y: number },
): ReadonlyArray<LayerId> => {
  const docPoint = viewportToDocument(viewport, point);
  if (!inDocumentBounds(doc, docPoint)) return [];
  const stack = [...doc.layers].sort(byPosition).reverse();
  const ids: LayerId[] = [];
  for (const layer of stack) {
    if (isHittable(layer)) ids.push(layer.id);
  }
  return ids;
};
