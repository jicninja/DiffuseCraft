/**
 * commit-worklet — single worklet entry point invoked at gesture end to
 * flatten the in-progress active stroke onto the layer's persistent
 * `SkSurface` and snapshot the result into the layer's reactive
 * `SharedValue<SkImage>`.
 *
 * Lifecycle (called from `useBrushPipeline.commitStroke` on the UI thread):
 *
 *   1. The brush pipeline calls `StampRenderer.takePicture()` to finalize
 *      the active stroke into an immutable `SkPicture`.
 *   2. It resolves the stroke's blend mode (paint = SrcOver,
 *      erase = DstOut, mask = Plus / luminance) into the `BlendMode`
 *      constant supplied here.
 *   3. It computes the stroke's running bounding box in document-space.
 *   4. It calls `commitActiveStrokeWorklet({ registry, layerId, picture,
 *      blendMode, bbox })`.
 *
 * The worklet itself simply forwards to `LayerSurfaceRegistry.
 * commitPictureToLayer`, which already performs the `saveLayer + drawPicture
 * + flush + makeImageSnapshot + dispose-prior-image + emit-event` sequence
 * and logs a warning when the snapshot returns null.
 *
 * **Snapshot failure / async retry:** design.md §commit-worklet specifies a
 * one-shot retry against `makeImageSnapshotAsync` if the synchronous
 * snapshot returns null. RN-Skia 2.6.x exposes `makeImageSnapshotAsync`
 * **only on the `<Canvas>` ref**, not on `SkSurface`. There is no
 * `surface.makeImageSnapshotAsync` to fall back to from a worklet today.
 * Until RN-Skia adds that overload, this commit worklet relies on the
 * registry's existing handling: the registry already logs the failure and
 * leaves the layer unchanged when `makeImageSnapshot` returns null, so the
 * commit becomes a no-op rather than a crash. The future async retry path
 * can be added inside `LayerSurfaceRegistry.snapshotInto` once RN-Skia
 * exposes the API at the surface level.
 *
 * Design reference: brush-canvas-rendering §commit-worklet.
 */

import type { LayerId } from '@diffusecraft/canvas-core';
import type { BlendMode, SkPicture } from '@shopify/react-native-skia';

import type { LayerSurfaceRegistry } from './LayerSurfaceRegistry';

/**
 * Arguments accepted by {@link commitActiveStrokeWorklet}.
 *
 * Every field is captured from the gesture-begin snapshot and the active
 * stroke renderer; the worklet performs no JS-thread reads.
 */
export interface CommitArgs {
  /** Registry that owns the per-layer surfaces. */
  readonly registry: LayerSurfaceRegistry;
  /** Layer the stroke was drawn into. */
  readonly layerId: LayerId;
  /** Finalized picture from `StampRenderer.takePicture()`. */
  readonly picture: SkPicture;
  /**
   * Stroke blend mode. The pipeline resolves this from the per-stroke
   * config:
   *   - paint stroke on a paint layer    → `BlendMode.SrcOver`
   *   - erase stroke on a paint layer    → `BlendMode.DstOut`
   *   - any stroke on a mask layer       → `BlendMode.Plus` (alpha-only)
   */
  readonly blendMode: BlendMode;
  /** Document-space bounding box of the dirtied region. */
  readonly bbox: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/**
 * Flatten the active stroke's picture onto the layer's persistent surface
 * and replace the layer's reactive `SkImage` with a fresh snapshot.
 *
 * Worklet-callable. Performs no JS-thread allocations.
 *
 * On a snapshot failure path, the registry logs a warning and leaves the
 * layer unchanged; this function returns without error so the caller can
 * still dispose the active picture.
 */
export function commitActiveStrokeWorklet(args: CommitArgs): void {
  'worklet';
  args.registry.commitPictureToLayer(
    args.layerId,
    args.picture,
    args.blendMode,
    args.bbox,
  );
}
