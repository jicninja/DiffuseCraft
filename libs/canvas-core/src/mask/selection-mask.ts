/**
 * Selection ↔ mask conversion (mask-system A.3, FR-12 / FR-13 / FR-14).
 *
 * The canvas-core `Selection` is a tagged union (`rect | lasso | mask |
 * none`); a mask layer's persisted bytes are a flat single-channel
 * `Uint8Array`. These helpers rasterize the selection's geometry to alpha
 * and round-trip back. The roundtrip is lossless when:
 *
 *   - the input mask uses pure 0 / 255 values, AND
 *   - `maskBytesToSelection` is invoked with `threshold = 128`.
 *
 * Selection-tools' `selection/operations.ts` already exposes a
 * `selectionToMask` that returns a `RasterMask` (in-memory selection
 * bitmap); these helpers complement that by producing the raw byte form
 * the mask-system handlers persist on disk.
 */
import type { Selection } from '../document/selection';
import type { LayerId } from '../shared/ids';

export interface MaskDims {
  readonly width: number;
  readonly height: number;
}

/**
 * Rasterize a selection to a fresh `Uint8Array` (FR-12).
 *
 * `MaskSelection` is a reference-by-id; the caller provides a resolver
 * that returns the source layer's mask bytes.
 */
export function selectionToMaskBytes(
  selection: Selection,
  dims: MaskDims,
  resolver?: (layer_id: LayerId) => Uint8Array | undefined,
): Uint8Array {
  const { width, height } = dims;
  const mask = new Uint8Array(width * height);
  switch (selection.kind) {
    case 'rect': {
      fillRect(mask, dims, selection.rect);
      return mask;
    }
    case 'lasso': {
      if (selection.points.length < 3) return mask;
      fillPolygon(
        mask,
        dims,
        selection.points.map((p) => [p.x, p.y] as const),
      );
      return mask;
    }
    case 'mask': {
      if (!resolver) {
        throw new Error(
          'selectionToMaskBytes: MaskSelection requires a resolver — caller must supply mask bytes for the referenced layer.',
        );
      }
      const bytes = resolver(selection.layer_id);
      if (!bytes) return mask;
      if (bytes.length !== width * height) {
        throw new Error(
          `selectionToMaskBytes: resolved mask has ${bytes.length} bytes; expected ${width * height} for ${width}×${height}.`,
        );
      }
      return bytes.slice();
    }
    case 'none':
    default:
      return mask;
  }
}

/**
 * Build a `MaskSelection` from `Uint8Array` bytes (FR-13).
 *
 * The canvas-core `Selection` schema models a mask selection as a layer
 * reference; it does not carry the alpha bytes inline. The caller is
 * therefore expected to persist the binarized mask as a mask layer
 * first, then plug its `LayerId` here. We provide a helper that does the
 * thresholding so the caller writes pre-binarized bytes to the layer
 * store.
 */
export interface MaskBytesToSelectionResult {
  /** The binarized alpha (`>= threshold` → 255). Caller persists this. */
  readonly binary: Uint8Array;
  /** Wraps the persisted layer id back into a `Selection`. */
  buildSelection(layer_id: LayerId): Selection;
}

export function maskBytesToSelection(
  mask: Uint8Array,
  threshold = 128,
): MaskBytesToSelectionResult {
  const t = Math.max(0, Math.min(255, Math.round(threshold)));
  const binary = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) binary[i] = mask[i]! >= t ? 255 : 0;
  return {
    binary,
    buildSelection: (layer_id) => ({ kind: 'mask', layer_id }),
  };
}

// ---- private helpers ----

function fillRect(
  mask: Uint8Array,
  dims: MaskDims,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(dims.width, Math.floor(rect.x + rect.w));
  const y1 = Math.min(dims.height, Math.floor(rect.y + rect.h));
  for (let y = y0; y < y1; y++) {
    const row = y * dims.width;
    for (let x = x0; x < x1; x++) mask[row + x] = 255;
  }
}

/**
 * Even-odd scanline polygon fill. Points are document-coordinate floats;
 * pixels whose centers fall inside the polygon are set to 255. Adequate
 * for v1 lasso → mask conversion; anti-aliasing is post-v1.
 */
function fillPolygon(
  mask: Uint8Array,
  dims: MaskDims,
  points: ReadonlyArray<readonly [number, number]>,
): void {
  const n = points.length;
  const ys = points.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const yMax = Math.min(dims.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = yMin; y <= yMax; y++) {
    const cy = y + 0.5;
    const xCrossings: number[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[(i + 1) % n]!;
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const t = (cy - ay) / (by - ay);
        xCrossings.push(ax + t * (bx - ax));
      }
    }
    xCrossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xCrossings.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xCrossings[k]! - 0.5));
      const x1 = Math.min(dims.width - 1, Math.floor(xCrossings[k + 1]! - 0.5));
      const row = y * dims.width;
      for (let x = x0; x <= x1; x++) mask[row + x] = 255;
    }
  }
}
