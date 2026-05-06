/**
 * Selection-tools geometry barrel.
 *
 * The document-level selection state lives in `document/selection.ts`;
 * this module adds the geometry, raster ops, lasso simplification,
 * magic-wand, and refine operations that the selection-tools spec
 * requires.
 */

export type {
  Point2D,
  ReadonlyPoint2D,
  RasterMask,
  SelectionOp,
  PolygonSelection,
} from './types';
export { polygonFromLasso, lassoFromPolygon } from './types';

export {
  createMask,
  createFullMask,
  rectToMask,
  polygonToMask,
  pointInPolygon,
  maskBounds,
  isMaskEmpty,
} from './raster';

export {
  selectionToMask,
  composeMasks,
  applyOp,
  invertMask,
  selectAllMask,
} from './operations';

export {
  DEFAULT_RDP_EPSILON,
  simplifyLassoPath,
  closeLassoPath,
} from './lasso';

export {
  DEFAULT_TOLERANCE,
  sampleRgb,
  colorDistance,
  magicWandSelect,
} from './magic-wand';
export type { RgbSample } from './magic-wand';

export {
  growMask,
  shrinkMask,
  blurMask,
  featherMask,
  refineMask,
} from './refine';
export type { RefineParams } from './refine';
