/**
 * Selection-tools geometry types (selection-tools spec §3).
 *
 * The document-level `Selection` shape lives in `document/selection.ts`
 * (rect | lasso | mask | none) and is the single source of truth for
 * persistence and rendering. This module adds the supporting geometry
 * types and operations that the selection-tools spec requires:
 *
 * - {@link Point2D} — a plain `{ x, y }` pair used by lasso paths and
 *   magic-wand tap inputs. (The document already brands its own
 *   read-only `points` shape on `LassoSelection`; this is the wider,
 *   mutable alias for math helpers.)
 * - {@link RasterMask} — the raster representation that boolean ops,
 *   refine, invert and select-all all operate on. A single `Uint8Array`
 *   in row-major order with values in [0, 255] (0 = unselected,
 *   255 = fully selected; intermediate values represent feathered/anti-
 *   aliased coverage).
 * - {@link SelectionOp} — the boolean composition mode used by
 *   `set_selection({ op })`. Mirrors the MCP tool catalog enum.
 *
 * The spec's {@link Selection} union uses `kind: "polygon"` for the
 * lasso path. Internally we keep the existing `kind: "lasso"` from
 * canvas-fundamentals (renderers + canvas-skia depend on it); both
 * names refer to the same closed polygon. {@link polygonFromLasso} and
 * {@link lassoFromPolygon} are no-op aliases provided so external
 * callers can use either vocabulary.
 */

import type { Selection, LassoSelection } from '../document/selection';

/** Mutable 2D point used by lasso math and magic-wand tap inputs. */
export interface Point2D {
  x: number;
  y: number;
}

/** Same as {@link Point2D} but read-only — for inputs that must not mutate. */
export interface ReadonlyPoint2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Raster bitmap used by every binary selection op (boolean compose,
 * refine, invert, magic-wand). Row-major; index `(y * width + x)`
 * carries the coverage value 0..255.
 */
export interface RasterMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Boolean composition mode for `applyOp` / `set_selection({ op })`. */
export type SelectionOp = 'replace' | 'add' | 'subtract' | 'intersect';

/** Documented as a polygon in the spec; identical to the existing lasso. */
export type PolygonSelection = LassoSelection;

/** Adapter (no-op) for callers using the spec's "polygon" name. */
export const polygonFromLasso = (sel: LassoSelection): PolygonSelection => sel;
/** Adapter (no-op) — see {@link polygonFromLasso}. */
export const lassoFromPolygon = (sel: PolygonSelection): LassoSelection => sel;

/**
 * Type alias only — re-exporting `Selection` from the barrel would
 * collide with `document/selection.ts`. Internal callers import it
 * directly from `../document/selection`.
 */
export type SelectionUnion = Selection;
