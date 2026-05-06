/**
 * Selection geometry primitives.
 *
 * Selection is a tagged union (`rect | lasso | mask | none`). Detailed
 * selection-tool semantics (feathering, expand/contract, refinement)
 * live in the `selection-tools` spec; canvas-fundamentals only owns the
 * shape stored on the document.
 */

import type { LayerId } from '../shared/ids';

export interface RectSelection {
  readonly kind: 'rect';
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface LassoSelection {
  readonly kind: 'lasso';
  /** Closed polygon in document coordinates. */
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface MaskSelection {
  readonly kind: 'mask';
  /** Reference to a mask-layer whose alpha drives the selection. */
  readonly layer_id: LayerId;
}

export interface NoSelection {
  readonly kind: 'none';
}

export type Selection = RectSelection | LassoSelection | MaskSelection | NoSelection;

/** Shorthand factory for the empty selection. */
export const emptySelection = (): NoSelection => ({ kind: 'none' });
