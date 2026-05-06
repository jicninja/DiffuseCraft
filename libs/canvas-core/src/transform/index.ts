/**
 * Transform module — pure geometry for transform-tools (Phases A + B).
 *
 * Render-agnostic: types, matrix math, distort projective math, decompose
 * round-trip, pure operations, partial-input merging, and snap-target
 * detection. The Skia adapter consumes `composeMatrix(t, w, h)` to drive
 * `SkMatrix`; the server consumes `mergeTransform` for partial writes.
 */
export * from './types';
export * from './matrix';
export * from './decompose';
export * from './distort';
export * from './operations';
export * from './merge';
export * from './snap';
