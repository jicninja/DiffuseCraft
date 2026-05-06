/**
 * Raster helpers used internally by selection ops.
 *
 * Selection-tools rasterizes every kind into a {@link RasterMask} before
 * compositing (FR-2: "the renderer + handlers convert all selection kinds
 * to a unified mask representation when needed"). The functions here are
 * intentionally tiny and dependency-free so they can run identically on
 * the server (Node) and on the tablet (React Native + Hermes).
 */

import type { RasterMask, Point2D, ReadonlyPoint2D } from './types';

/** Allocate a fully-unselected mask of `(width, height)`. */
export const createMask = (width: number, height: number): RasterMask => ({
  width,
  height,
  data: new Uint8Array(width * height),
});

/** Allocate a fully-selected mask (every pixel = 255). Used by select-all. */
export const createFullMask = (width: number, height: number): RasterMask => {
  const data = new Uint8Array(width * height);
  data.fill(255);
  return { width, height, data };
};

/** Rasterize a rect selection. Coordinates are clamped to mask bounds. */
export const rectToMask = (
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): RasterMask => {
  const mask = createMask(width, height);
  const x0 = Math.max(0, Math.min(width, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(height, Math.floor(rect.y)));
  const x1 = Math.max(0, Math.min(width, Math.floor(rect.x + rect.w)));
  const y1 = Math.max(0, Math.min(height, Math.floor(rect.y + rect.h)));
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      mask.data[row + x] = 255;
    }
  }
  return mask;
};

/**
 * Rasterize a closed polygon (lasso) using even-odd fill, scanning rows
 * top-to-bottom and computing crossings per row. O(rows * vertices).
 *
 * The polygon is interpreted as closed — the segment from the last
 * vertex back to the first is implicit. Self-intersecting polygons are
 * rendered with even-odd parity (no winding).
 */
export const polygonToMask = (
  points: ReadonlyArray<ReadonlyPoint2D>,
  width: number,
  height: number,
): RasterMask => {
  const mask = createMask(width, height);
  if (points.length < 3) return mask;

  for (let y = 0; y < height; y++) {
    const yc = y + 0.5; // sample at pixel center to avoid edge artefacts
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      // Skip strictly-horizontal segments — they contribute no crossing.
      if (a.y === b.y) continue;
      const ay = a.y;
      const by = b.y;
      const yMin = Math.min(ay, by);
      const yMax = Math.max(ay, by);
      if (yc < yMin || yc >= yMax) continue;
      // Linear interpolation for the x at the given scan-line y.
      const t = (yc - ay) / (by - ay);
      xs.push(a.x + t * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = Math.max(0, Math.ceil(xs[i]!));
      const right = Math.min(width, Math.ceil(xs[i + 1]!));
      const row = y * width;
      for (let x = left; x < right; x++) {
        mask.data[row + x] = 255;
      }
    }
  }

  return mask;
};

/** Test if a point lies inside a closed polygon (even-odd rule). */
export const pointInPolygon = (
  pt: Point2D,
  points: ReadonlyArray<ReadonlyPoint2D>,
): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const intersect =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
};

/** Compute the tight integer bounding box of a non-empty mask. */
export const maskBounds = (
  mask: RasterMask,
): { x: number; y: number; w: number; h: number } | null => {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[row + x]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/** True iff the mask has at least one non-zero pixel. */
export const isMaskEmpty = (mask: RasterMask): boolean => {
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]! > 0) return false;
  }
  return true;
};
