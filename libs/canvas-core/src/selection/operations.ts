/**
 * Boolean composition + invert + select-all for selections (FR-10/FR-13/FR-14).
 *
 * Selections compose by rasterizing both sides into a {@link RasterMask}
 * and combining pixel-wise:
 *
 * | op         | formula                                    |
 * |------------|--------------------------------------------|
 * | replace    | b                                          |
 * | add        | max(a, b)                                  |
 * | subtract   | max(0, a - b)                              |
 * | intersect  | min(a, b)                                  |
 *
 * Anti-aliased / feathered values (0 < v < 255) are preserved by all four
 * formulas — `add` keeps the brightest source, `intersect` keeps the
 * darkest, etc. This matches Photoshop's documented behavior.
 */

import type { Selection } from '../document/selection';
import type { RasterMask, SelectionOp } from './types';
import {
  createFullMask,
  createMask,
  polygonToMask,
  rectToMask,
} from './raster';

/**
 * Rasterize an arbitrary {@link Selection} for compositing. The `mask`
 * variant is fed in by the caller because canvas-core stays renderer-
 * agnostic (the actual bytes for `kind: "mask"` selections live on the
 * server as a blob keyed by `layer_id`).
 */
export const selectionToMask = (
  sel: Selection,
  width: number,
  height: number,
  resolveMask?: (layerId: string) => RasterMask | null,
): RasterMask => {
  switch (sel.kind) {
    case 'none':
      return createMask(width, height);
    case 'rect':
      return rectToMask(sel.rect, width, height);
    case 'lasso':
      return polygonToMask(sel.points, width, height);
    case 'mask': {
      if (!resolveMask) {
        throw new Error(
          'selectionToMask: mask selections require a resolveMask callback',
        );
      }
      const resolved = resolveMask(sel.layer_id as unknown as string);
      if (!resolved) {
        return createMask(width, height);
      }
      if (resolved.width !== width || resolved.height !== height) {
        throw new Error(
          `selectionToMask: mask dims ${resolved.width}x${resolved.height} ` +
            `don't match document ${width}x${height}`,
        );
      }
      return resolved;
    }
    default: {
      const _exhaustive: never = sel;
      void _exhaustive;
      return createMask(width, height);
    }
  }
};

/** Apply a boolean op to two masks. Both must share the same dimensions. */
export const composeMasks = (
  a: RasterMask,
  b: RasterMask,
  op: SelectionOp,
): RasterMask => {
  if (op === 'replace') return b;
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `composeMasks: dim mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`,
    );
  }
  const out = new Uint8Array(a.data.length);
  switch (op) {
    case 'add':
      for (let i = 0; i < a.data.length; i++) {
        const av = a.data[i]!;
        const bv = b.data[i]!;
        out[i] = av > bv ? av : bv;
      }
      break;
    case 'subtract':
      for (let i = 0; i < a.data.length; i++) {
        const av = a.data[i]!;
        const bv = b.data[i]!;
        const r = av - bv;
        out[i] = r < 0 ? 0 : r;
      }
      break;
    case 'intersect':
      for (let i = 0; i < a.data.length; i++) {
        const av = a.data[i]!;
        const bv = b.data[i]!;
        out[i] = av < bv ? av : bv;
      }
      break;
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
    }
  }
  return { width: a.width, height: a.height, data: out };
};

/**
 * Apply a boolean op against the existing selection. Caller supplies
 * canvas dims and (when the existing or incoming selection is a mask)
 * a resolver that hands back the raster bytes.
 *
 * Returns a `kind: "mask"`-equivalent {@link RasterMask}; callers wrap
 * the result back into a Selection (handler / store) once they have a
 * blob id to attach.
 */
export const applyOp = (
  current: Selection,
  incoming: Selection,
  op: SelectionOp,
  width: number,
  height: number,
  resolveMask?: (layerId: string) => RasterMask | null,
): RasterMask => {
  const incomingMask = selectionToMask(incoming, width, height, resolveMask);
  if (op === 'replace') return incomingMask;
  const currentMask = selectionToMask(current, width, height, resolveMask);
  return composeMasks(currentMask, incomingMask, op);
};

/**
 * Invert the selection (FR-13). `none` becomes "everything"; an existing
 * mask becomes its bitwise complement (255 - v at every pixel).
 */
export const invertMask = (mask: RasterMask): RasterMask => {
  const out = new Uint8Array(mask.data.length);
  for (let i = 0; i < mask.data.length; i++) {
    out[i] = 255 - mask.data[i]!;
  }
  return { width: mask.width, height: mask.height, data: out };
};

/**
 * Select-all (FR-14). Returns a fully-opaque mask covering the document.
 * Pure helper — handlers wrap this back into a `Selection`.
 */
export const selectAllMask = (width: number, height: number): RasterMask =>
  createFullMask(width, height);
