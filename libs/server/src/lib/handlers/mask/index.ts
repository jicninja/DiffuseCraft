/**
 * Mask-system handler barrel (mask-system Phase B).
 *
 * Each `create*Handler` returns a `ToolHandler` ready for
 * `dispatcher.register(...)`. Shared deps (`db`, `assets`,
 * `selectionStore`) are injected at construction time so handler bodies
 * stay pure functions of `(input, ctx)`.
 */

export {
  createRefineMaskHandler,
  type RefineMaskHandlerDeps,
} from './refine-mask.js';
export {
  createInvertMaskHandler,
  type InvertMaskHandlerDeps,
} from './invert-mask.js';
export {
  createClearMaskHandler,
  type ClearMaskHandlerDeps,
} from './clear-mask.js';
export {
  createFillMaskHandler,
  type FillMaskHandlerDeps,
} from './fill-mask.js';
export {
  createSelectionToMaskHandler,
  type SelectionToMaskHandlerDeps,
} from './selection-to-mask.js';
export {
  createMaskToSelectionHandler,
  type MaskToSelectionHandlerDeps,
} from './mask-to-selection.js';
export {
  createBakeMaskHandler,
  type BakeMaskHandlerDeps,
} from './bake-mask.js';
export {
  type MaskAssetStore,
  RAW_ALPHA_MIME,
  encodeMaskBlob,
  decodeMaskBlob,
  parseMaskData,
  serializeMaskData,
} from './shared.js';
