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
 *   4. It calls `commitActiveStrokeWorklet({ layerSurface, layerImage,
 *      strokeSurface, blendMode, bbox })`.
 *
 * **Why we pass `layerSurface` + `layerImage` directly, not a registry**.
 * `LayerSurfaceRegistry` keeps its per-layer records inside a JS-thread
 * `Map`. When the registry is shipped across the Reanimated worklet
 * boundary (e.g., via `runOnUI(...)` args), Reanimated serializes the Map
 * once and the worklet sees a frozen snapshot — JS-thread `records.set()`
 * after that point is invisible from worklets. The bug surfaces the second
 * a user adds a new layer mid-session and tries to draw on it: the
 * worklet's `records.get(newLayerId)` returns undefined, the commit logs
 * "commit on unknown layer", and the stroke disappears on release. By
 * looking up the layer's `SkSurface` + reactive `SharedValue<SkImage>` on
 * the JS thread at `beginStroke` time and passing them as arguments, we
 * avoid the stale-Map trap entirely. The `SkSurface` is a JSI handle
 * (already shareable); the SharedValue is explicitly cross-thread reactive.
 *
 * **Snapshot failure / async retry:** design.md §commit-worklet originally
 * specified a one-shot retry against `makeImageSnapshotAsync` if the
 * synchronous snapshot returns null. RN-Skia 2.6.x exposes
 * `makeImageSnapshotAsync` **only on the `<Canvas>` ref**, not on
 * `SkSurface`. Until RN-Skia adds that overload, the handler logs and
 * leaves the layer image unchanged; the commit becomes a no-op rather
 * than a crash.
 *
 * Design reference: brush-canvas-rendering §commit-worklet.
 */

import {
  Skia,
  type BlendMode,
  type SkImage,
  type SkSurface,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

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
 * stroke's lifetime) and snapshotting *inside* the commit body keeps the
 * SkImage local to a single worklet body, eliminating the cross-boundary
 * lifetime problem entirely.
 *
 * **Why `layerSurface` + `layerImage` instead of `registry` + `layerId`.**
 * See the file-level comment above.
 */
export interface CommitArgs {
  /** Persistent per-layer raster surface that this stroke commits onto. */
  readonly layerSurface: SkSurface;
  /**
   * Reactive image handle the visible `<Image>` element subscribes to.
   * The commit replaces `.value` with a fresh snapshot of `layerSurface`
   * and disposes the prior SkImage.
   */
  readonly layerImage: SharedValue<SkImage | null>;
  /** The active-stroke surface itself (NOT a snapshot). Snapshotting is
   *  performed inside this worklet so the resulting SkImage is consumed
   *  in the same invocation that creates it. */
  readonly strokeSurface: SkSurface;
  /**
   * Stroke blend mode. The pipeline resolves this from the per-stroke
   * config:
   *   - paint stroke on a paint layer    → `BlendMode.SrcOver`
   *   - erase stroke on a paint layer    → `BlendMode.DstOut`
   *   - any stroke on a mask layer       → `BlendMode.Plus` (alpha-only)
   */
  readonly blendMode: BlendMode;
  /** Document-space bounding box of the dirtied region.
   *  Currently unused by the commit body itself (the layer surface is
   *  flushed as a whole) but reserved for future partial-snapshot paths
   *  and undo/redo capture. */
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
 * On a snapshot failure path (sync `makeImageSnapshot` returns null), this
 * function logs and leaves the layer image unchanged so the caller can
 * still dispose the active stroke surface without crashing.
 */
export function commitActiveStrokeWorklet(args: CommitArgs): void {
  'worklet';
  const { layerSurface, layerImage, strokeSurface, blendMode } = args;

  // Flush the stroke surface so its pending GPU work is queued before we
  // read pixels from it via the snapshot below.
  strokeSurface.flush();
  const strokeImage = strokeSurface.makeImageSnapshot();
  if (strokeImage === null || strokeImage === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      '[commitActiveStrokeWorklet] strokeSurface.makeImageSnapshot returned null',
    );
    return;
  }

  const canvas = layerSurface.getCanvas();
  // Bake the stroke image onto the layer using the stroke's blend mode.
  // The paint's blendMode is applied directly to `drawImage` — we
  // deliberately avoid `saveLayer/restore` here. On iOS Simulator GPU
  // surfaces, an offscreen save layer did not always composite back before
  // the subsequent `makeImageSnapshot`, producing the user-visible
  // "stroke disappears on release" symptom.
  const paint = Skia.Paint();
  paint.setBlendMode(blendMode);
  canvas.drawImage(strokeImage, 0, 0, paint);
  const disposablePaint = paint as unknown as { dispose?: () => void };
  disposablePaint.dispose?.();

  layerSurface.flush();
  const next = layerSurface.makeImageSnapshot();
  if (next === null || next === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      '[commitActiveStrokeWorklet] layerSurface.makeImageSnapshot returned null',
    );
    return;
  }

  // Capture the prior reference BEFORE writing so we dispose the old
  // image, not the new one.
  const prior = layerImage.value;
  layerImage.value = next;
  if (prior !== null) {
    const disposable = prior as unknown as { dispose?: () => void };
    disposable.dispose?.();
  }
}
