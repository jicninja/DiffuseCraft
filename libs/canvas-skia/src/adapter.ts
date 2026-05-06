/**
 * SkiaRenderAdapter — slim host for the per-layer surface registry, the
 * blob-id image cache, and hit-testing.
 *
 * **What this adapter owns**
 *  - `layerSurfaces`: the `LayerSurfaceRegistry` (per-layer persistent
 *    `SkSurface` + reactive `SharedValue<SkImage>`). Brush strokes land
 *    here; this is the canonical pixel store for paint layers.
 *  - `cache`: the `LayerImageCache` keyed by `content_blob_id`. Used by
 *    control layers and generation history (read-only images served from
 *    the paired server). Strokes never touch this cache.
 *  - Hit testing pass-through (`hitTest`, `hitTestStack`) and per-layer
 *    rasterization for thumbnails (`rasterizeLayer`).
 *
 * **What this adapter does NOT own (removed in brush-canvas-rendering Phase 4)**
 *  - The legacy `SkPicture[]`-based retention model: `committedPictures`,
 *    `committedPictureCache`, `setActiveStrokeBuffer`, `commitActiveStroke`,
 *    `clearActiveStrokeBuffer`, `rebuildCommittedCache`,
 *    `getCommittedPicture`, `getActiveStrokePicture` — all gone. The
 *    persistent layer surfaces in `layerSurfaces` are the source of truth
 *    for committed pixels; the active stroke is a transient `SkPicture`
 *    owned by `useBrushPipeline` and disposed at gesture end.
 *  - `drawDocument`: the visible composite is now a tree of RN-Skia
 *    components inside `<CanvasView>` (`<Rect>` paper + per-layer `<Image>`
 *    chain + active `<Picture>` overlay), not an imperative draw routine.
 *  - `attachSurface` / `surface`: there is no longer a single `SkSurface`
 *    that the adapter draws into; each layer owns its own surface inside
 *    `layerSurfaces`.
 *  - `rasterizeDocument`: **not provided by this library.** Document-level
 *    export (multi-layer flatten + encode) is owned by `client-sdk`. The
 *    adapter exposes per-layer pixel reads via `layerSurfaces.readLayerImage`
 *    and per-blob reads via `cache`; `client-sdk` composes them.
 *
 * Real GPU work happens in native; this file is the orchestration layer.
 */

import {
  hitTestModel,
  hitTestStackModel,
  type Document,
  type Layer,
  type LayerId,
  type RasterDimensions,
  type Viewport,
} from '@diffusecraft/canvas-core';
import { Skia } from '@shopify/react-native-skia';

import {
  createLayerSurfaceRegistry,
  type LayerSurfaceRegistry,
} from './brush/LayerSurfaceRegistry';
import { LayerImageCache, type BytesLoader } from './image-cache';

export interface SkiaRenderAdapterOptions {
  /**
   * Resolve raw bytes for a given `content_blob_id`. Apps inject this with
   * a function that fetches from the paired server (or local cache). The
   * adapter never goes to the network on its own.
   */
  loadBytes: BytesLoader;
  /** Optional cache capacity override. */
  imageCacheCapacity?: number;
  /**
   * Optional simulator-detection injection forwarded to
   * `createLayerSurfaceRegistry`. When omitted, the registry's default
   * runtime check applies. Apps that already depend on `expo-device` or
   * similar can pass a stronger predicate here.
   */
  isSimulator?: () => boolean;
}

let __adapterInstanceCounter = 0;

/**
 * Slim render-side adapter.
 *
 * Note: this class deliberately does NOT implement
 * `@diffusecraft/canvas-core`'s `CanvasRenderAdapter` any more. That
 * interface required `drawDocument` / `rasterizeDocument`, both of which
 * the new architecture removes (see header comment). A future refactor of
 * `canvas-core` will narrow `CanvasRenderAdapter` to the fields that
 * survived (`hitTest`, `hitTestStack`, `rasterizeLayer`); until then, the
 * adapter exposes the surviving methods directly without the `implements`
 * declaration.
 */
export class SkiaRenderAdapter {
  private readonly cache: LayerImageCache;

  /** Per-layer persistent surface + reactive `SkImage` registry. */
  readonly layerSurfaces: LayerSurfaceRegistry;

  /** Diagnostic id — unique per constructed adapter instance. */
  readonly instanceId: number;

  constructor(opts: SkiaRenderAdapterOptions) {
    this.instanceId = ++__adapterInstanceCounter;
    // eslint-disable-next-line no-console
    console.log('[SkiaRenderAdapter] constructed', { id: this.instanceId });
    this.cache = new LayerImageCache({
      capacity: opts.imageCacheCapacity,
      loader: opts.loadBytes,
      factory: (bytes) => Skia.Image.MakeImageFromEncoded(bytes),
    });
    this.layerSurfaces = createLayerSurfaceRegistry({
      isSimulator: opts.isSimulator,
    });
  }

  /** Pre-warm the cache for layers visible in the next frame. */
  async warmCache(layerIds: ReadonlyArray<string>): Promise<void> {
    await Promise.all(layerIds.map((id) => this.cache.get(id)));
  }

  /**
   * Drop every cached image and dispose native handles. Called from
   * `<CanvasView>`'s unmount cleanup.
   */
  disposeCache(): void {
    this.cache.clear();
    this.layerSurfaces.disposeAll();
  }

  // ---- Surviving CanvasRenderAdapter members ----

  hitTest(x: number, y: number, document: Document, viewport: Viewport): LayerId | null {
    return hitTestModel(document, viewport, { x, y });
  }

  hitTestStack(
    x: number,
    y: number,
    document: Document,
    viewport: Viewport,
  ): ReadonlyArray<LayerId> {
    return hitTestStackModel(document, viewport, { x, y });
  }

  async rasterizeLayer(layer: Layer, _dims: RasterDimensions): Promise<Uint8Array> {
    void _dims;
    if (!layer.content_blob_id) return new Uint8Array(0);
    const image = await this.cache.get(layer.content_blob_id);
    if (!image) return new Uint8Array(0);
    return image.encodeToBytes();
  }
}
