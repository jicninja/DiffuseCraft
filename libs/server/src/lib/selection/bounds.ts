/**
 * Helpers for computing bounding boxes from a {@link PersistedSelection}
 * without rasterizing it (Tier 1 fast path).
 */

import { maskBounds } from '@diffusecraft/canvas-core';
import type { RasterMask } from '@diffusecraft/canvas-core';
import type { PersistedSelection } from './store.js';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Cheap structural bounding box derivation. For:
 *   - `none`: returns `null`.
 *   - `rect`: returns the rect verbatim.
 *   - `polygon`: tight-fits the vertex bbox.
 *   - `mask`: returns the cached `width`/`height` envelope; the precise
 *     pixel bbox requires reading the blob and is left to the caller.
 */
export const selectionBBox = (sel: PersistedSelection): BBox | null => {
  switch (sel.kind) {
    case 'none':
      return null;
    case 'rect':
      return { ...sel.rect };
    case 'polygon': {
      if (sel.points.length === 0) return null;
      let minX = sel.points[0]!.x;
      let minY = sel.points[0]!.y;
      let maxX = minX;
      let maxY = minY;
      for (let i = 1; i < sel.points.length; i++) {
        const p = sel.points[i]!;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return {
        x: Math.floor(minX),
        y: Math.floor(minY),
        w: Math.max(1, Math.ceil(maxX - minX)),
        h: Math.max(1, Math.ceil(maxY - minY)),
      };
    }
    case 'mask':
      if (sel.width <= 0 || sel.height <= 0) return null;
      return { x: 0, y: 0, w: sel.width, h: sel.height };
    default: {
      const _exhaustive: never = sel;
      void _exhaustive;
      return null;
    }
  }
};

/** Compute the precise pixel bbox from a {@link RasterMask}. */
export const maskRasterBBox = (mask: RasterMask): BBox | null => maskBounds(mask);
