/**
 * Selection-as-clip primitive (selection-tools §3.8 / FR-34..FR-39).
 *
 * `SelectionClip` is the frozen snapshot of an active selection rasterized
 * to a per-pixel alpha mask. Captured at the *start* of any raster-write
 * operation (brush stroke, fill, transform commit, paste, AI composition)
 * and held immutable until the operation commits. Subsequent selection
 * mutations do not affect the in-flight op — that race-free behavior falls
 * out of the snapshot model rather than per-handler locking (FR-39).
 *
 * Empty masks collapse to `kind: "none"` so `select_all` and the no-selection
 * state are observationally equivalent for write scoping (FR-36).
 *
 * Soft edges (feathered, anti-aliased lasso, AI-derived sub-pixel alpha)
 * sample as 0..1 floats; consumers multiply per-pixel coverage by the sample
 * so halos and hard cutoffs at sub-pixel boundaries are forbidden (FR-37).
 *
 * This module is intentionally dependency-free beyond canvas-core types
 * (per selection-tools design §0 — the clip helper has zero deps so writers
 * can consume it without inheriting a selection-tools transitive deps).
 */

import type { Selection } from '../document/selection';
import type { MaskDims } from '../mask/selection-mask';
import { selectionToMaskBytes } from '../mask/selection-mask';
import type { LayerId } from '../shared/ids';

/**
 * Frozen snapshot of the active selection rasterized to a clip mask.
 *
 * `kind: "none"` means no clipping is in effect — every pixel passes
 * (sampleClipAt returns 1.0). `kind: "mask"` carries the rasterized bytes
 * sized to `dims`; sampleClipAt indexes them per-pixel.
 */
export type SelectionClip =
  | { readonly kind: 'none'; readonly bytes: null; readonly dims: MaskDims }
  | { readonly kind: 'mask'; readonly bytes: Uint8Array; readonly dims: MaskDims };

/**
 * Capture the active selection into an immutable clip snapshot.
 *
 * Empty rasters (all-zero bytes) collapse to `kind: "none"` so callers can
 * treat "no selection" and "selection that happens to cover nothing" as a
 * single fast path (FR-36).
 *
 * For `kind: "mask"` selections, the caller supplies a `resolveMask` that
 * returns the mask layer's bytes; the clip helper itself never touches the
 * mask asset store (boundary: keep this module dependency-light).
 */
export function captureSelectionClip(
  selection: Selection,
  dims: MaskDims,
  resolveMask?: (id: LayerId) => Uint8Array | undefined,
): SelectionClip {
  if (selection.kind === 'none') {
    return { kind: 'none', bytes: null, dims };
  }
  const bytes = selectionToMaskBytes(selection, dims, resolveMask);
  if (!hasAnyNonZero(bytes)) {
    return { kind: 'none', bytes: null, dims };
  }
  return { kind: 'mask', bytes, dims };
}

/**
 * Sample the clip alpha at integer pixel `(px, py)` as a 0..1 float.
 *
 * - `kind: "none"` → 1 (full pass, every pixel writes).
 * - Out-of-bounds → 0 (clipped).
 * - In-bounds → `bytes[py * width + px] / 255`.
 *
 * Hot path: called inside per-pixel inner loops of the brush compositor;
 * keep branch-free arithmetic where possible.
 */
export function sampleClipAt(
  clip: SelectionClip,
  px: number,
  py: number,
): number {
  if (clip.kind === 'none') return 1;
  const { bytes, dims } = clip;
  if (px < 0 || py < 0 || px >= dims.width || py >= dims.height) return 0;
  return bytes[py * dims.width + px]! / 255;
}

const hasAnyNonZero = (bytes: Uint8Array): boolean => {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return true;
  }
  return false;
};
