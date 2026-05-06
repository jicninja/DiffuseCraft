/**
 * Render adapter contract (D.1, FR-19).
 *
 * Implementations bridge the document model to a concrete rendering
 * backend (Skia, CanvasKit, headless server-side, etc.). `canvas-core`
 * never imports Skia or any rendering library — it only consumes this
 * interface.
 */

import type { LayerId } from '../shared/ids';
import type { Layer } from '../layers/types';
import type { Document } from '../document/document';
import type { Viewport } from './viewport';

/** Optional incremental hint for `drawDocument`. */
export interface DrawOptions {
  readonly incremental?: {
    readonly changedLayerIds?: ReadonlyArray<LayerId>;
  };
}

/** Pixel buffer descriptor. */
export interface RasterDimensions {
  readonly w: number;
  readonly h: number;
}

/**
 * Adapter contract. Implementations may extend this with their own helpers
 * (e.g., `setSurface`, `attachGesture`) but must satisfy this surface.
 */
export interface CanvasRenderAdapter {
  /** Draw the document onto the underlying surface. */
  drawDocument(document: Document, viewport: Viewport, opts?: DrawOptions): void;

  /**
   * Hit-test in viewport coordinates. Returns the topmost visible layer id,
   * or null when no layer covers the point.
   */
  hitTest(
    x: number,
    y: number,
    document: Document,
    viewport: Viewport,
  ): LayerId | null;

  /**
   * Cycle through Z-stack of visible layers at point. Returns ids ordered
   * top → bottom (Q6 long-press cycle).
   */
  hitTestStack(
    x: number,
    y: number,
    document: Document,
    viewport: Viewport,
  ): ReadonlyArray<LayerId>;

  /**
   * Rasterize a single layer to bytes. Used for thumbnails and
   * server-mediated exports.
   */
  rasterizeLayer(layer: Layer, dims: RasterDimensions): Promise<Uint8Array>;

  /** Rasterize the full composited document to bytes. */
  rasterizeDocument(document: Document, dims: RasterDimensions): Promise<Uint8Array>;
}
