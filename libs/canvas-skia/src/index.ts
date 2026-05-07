/**
 * @diffusecraft/canvas-skia — react-native-skia render adapter.
 *
 * Implements the per-layer raster pipeline against
 * `@shopify/react-native-skia`. Native-only in v1; future hosts that need
 * canvas rendering elsewhere (e.g., MeshCraft on Electron) write their
 * own adapter against `@diffusecraft/canvas-core` rather than reusing
 * this package.
 */

export { SkiaRenderAdapter } from './adapter';
export type { SkiaRenderAdapterOptions } from './adapter';
export { LayerImageCache } from './image-cache';
export type {
  BytesLoader,
  ImageFactory,
  ImageCacheOptions,
} from './image-cache';
export { applyViewport } from './viewport-canvas';
export type { ViewportTarget } from './viewport-canvas';
export { toSkBlendMode, isNativeBlendMode } from './blend';
export { drawActiveLayerBorder } from './overlay/active-layer-border';
export type { ActiveLayerBorderStyle } from './overlay/active-layer-border';
export { drawSelectionOverlay } from './overlay/selection-overlay';
export type { SelectionOverlayStyle } from './overlay/selection-overlay';
export { SelectionOverlay } from './overlay/SelectionOverlay';
export type { SelectionOverlayProps } from './overlay/SelectionOverlay';
export { CanvasView } from './CanvasView';
export type { CanvasViewProps } from './CanvasView';

// ---- Image I/O platform adapter (image-io spec) ----
export * from './io/adapter';

// ---- Brush rendering pipeline ----

// Stamp renderer (per-stroke PictureRecorder + Paint/Shader pool).
export { createStampRenderer } from './brush/StampRenderer';
export type { StampRenderer, StampRendererConfig } from './brush/StampRenderer';

// Per-layer persistent surface registry.
export { createLayerSurfaceRegistry } from './brush/LayerSurfaceRegistry';
export type {
  LayerSurfaceRegistry,
  LayerCommitEvent,
  CommitListener,
  LayerSnapshotPath,
  CreateLayerSurfaceRegistryOptions,
} from './brush/LayerSurfaceRegistry';

// Commit worklet — single entry point invoked at gesture end to flatten
// the active stroke onto the layer surface.
export { commitActiveStrokeWorklet } from './brush/commit-worklet';
export type { CommitArgs } from './brush/commit-worklet';

// Hardness shader (kept; built once per stroke by the renderer).
export { buildHardnessShader } from './brush/hardness-shader';

// ---- Stylus input adapter ----

export {
  mapStylusEvent,
  convertTilt,
  mapPressure,
  DEFAULT_PRESSURE,
} from './input/stylus-adapter';
export type { RawStylusEvent } from './input/stylus-adapter';
export type {
  RNGHStylusData,
  RNGHStylusEvent,
  RNGHPointerType,
} from './input/stylusData-types';
