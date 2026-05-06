/**
 * `mask-system` public surface (canvas-core side).
 *
 * Pure types + ops only. Server-side handlers (refine_mask, invert_mask,
 * etc.) live in `@diffusecraft/server`; tablet preview overlays live in
 * `@diffusecraft/canvas-skia`. Both consume this module as their single
 * source of truth for mask behaviour.
 */
export * from './types';
export * from './operations';
export * from './selection-mask';
export * from './from-layer';
export * from './two-mask-split';
