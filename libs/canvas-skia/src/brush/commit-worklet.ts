/**
 * commit-worklet — single worklet entry point invoked at gesture end to
 * flatten the in-progress active stroke onto the layer's persistent
 * `SkSurface` and snapshot the result into the layer's reactive
 * `SharedValue<SkImage>`.
 *
 * Lifecycle (called from `useBrushPipeline.commitStroke` on the UI thread):
 *
 *   1. The brush pipeline calls `StampRenderer.takeImage()` to snapshot the
 *      stroke surface's pixels into an immutable `SkImage`.
 *   2. It resolves the stroke's blend mode (paint = SrcOver,
 *      erase = DstOut, mask = Plus / luminance) into the `BlendMode`
 *      constant supplied here.
 *   3. It computes the stroke's bounding box in document-space.
 *   4. It calls `commitActiveStrokeWorklet({ registry, layerId, strokeImage,
 *      blendMode, bbox })`.
 *
 * The worklet forwards to `LayerSurfaceRegistry.commitImageToLayer`, which
 * performs `drawImage(strokeImage, blendMode) + flush + makeImageSnapshot
 * + dispose-prior-layer-image + emit-event` and logs a warning when the
 * snapshot returns null.
 *
 * **Snapshot failure / async retry:** design.md §commit-worklet originally
 * specified a one-shot retry against `makeImageSnapshotAsync` if the
 * synchronous snapshot returns null. RN-Skia 2.6.x exposes
 * `makeImageSnapshotAsync` **only on the `<Canvas>` ref**, not on
 * `SkSurface`. Until RN-Skia adds that overload, the registry's handling
 * (log + leave layer unchanged) is the contract; the commit becomes a
 * no-op rather than a crash.
 *
 * Design reference: brush-canvas-rendering §commit-worklet.
 */

import type { LayerId } from '@diffusecraft/canvas-core';
import type { BlendMode, SkSurface } from '@shopify/react-native-skia';

import type { LayerSurfaceRegistry } from './LayerSurfaceRegistry';

/**
 * Arguments accepted by {@link commitActiveStrokeWorklet}.
 *
 * **Why we pass `strokeSurface` instead of `strokeImage`.** Crossing a
 * Reanimated worklet-args boundary with a transient `SkImage` JSI handle
 * caused `Exception in HostFunction: Attempted to access a disposed object`
 * at `drawImage` time — the worklet runtime tracks shareable lifetimes for
 * the args payload, and the SkImage was being disposed between
 * `takeImage()` and the subsequent `drawImage()`. Passing the `SkSurface`
 * (which the StampRenderer's internal `state.surface` retains for the
 * stroke's lifetime) and snapshotting *inside* `commitSurfaceToLayer` keeps
 * the SkImage local to a single worklet body, eliminating the cross-
 * boundary lifetime problem entirely.
 */
export interface CommitArgs {
  /** Registry that owns the per-layer surfaces. */
  readonly registry: LayerSurfaceRegistry;
  /** Layer the stroke was drawn into. */
  readonly layerId: LayerId;
  /** The stroke surface itself (NOT a snapshot). The registry calls
   *  `makeImageSnapshot()` inline so the resulting SkImage is consumed in
   *  the same worklet invocation that creates it. */
  readonly strokeSurface: SkSurface;
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
 * Flatten the active stroke surface onto the layer's persistent surface
 * and replace the layer's reactive `SkImage` with a fresh snapshot.
 *
 * Worklet-callable. Performs no JS-thread allocations.
 *
 * On a snapshot failure path, the registry logs a warning and leaves the
 * layer unchanged; this function returns without error so the caller can
 * still dispose the active stroke surface.
 */
export function commitActiveStrokeWorklet(args: CommitArgs): void {
  'worklet';
  args.registry.commitSurfaceToLayer(
    args.layerId,
    args.strokeSurface,
    args.blendMode,
    args.bbox,
  );
}
