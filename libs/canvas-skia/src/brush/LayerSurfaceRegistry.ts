/**
 * LayerSurfaceRegistry — per-layer persistent SkSurface lifecycle.
 *
 * Each paint layer in the editor owns one GPU-backed `SkSurface` (the raster
 * source of truth for that layer's pixels) and one reactive
 * `SharedValue<SkImage | null>` that the visible `<Image>` element subscribes
 * to. When a stroke commits, the registry replays the active picture onto
 * the layer's surface, snapshots the surface into the SharedValue, and
 * disposes the previous SkImage.
 *
 * **Memory bound** (Req 9.6): one SkImage per visible layer + the surface
 * itself; the prior SkImage is disposed every commit, so the snapshot
 * handle count never grows past `visibleLayers + 1` transient.
 *
 * **Worklet boundary**: `commitPictureToLayer` is the single worklet entry
 * point invoked at gesture end. `readLayerImage` is JS-thread-safe for
 * undo/redo snapshot capture. Subscribers (`subscribeCommit`) are notified
 * on the JS thread; the registry hops back via `runOnJS` from the commit
 * worklet's continuation.
 *
 * **Simulator detection**: iOS Simulator historically had quirky offscreen
 * surface flushes (RN-Skia issue #1811). When detected, commits await a
 * `flush()` on the next microtask before snapshotting (the "async snapshot"
 * variant). On device, snapshotting is synchronous after a `flush()`. The
 * chosen path is logged once at session start.
 *
 * Design reference: brush-canvas-rendering §LayerSurfaceRegistry.
 */

import type { LayerId } from '@diffusecraft/canvas-core';
import type {
  BlendMode,
  SkImage,
  SkPicture,
  SkSurface,
} from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import { Platform } from 'react-native';
import {
  makeMutable,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Commit-event payload delivered to `subscribeCommit` listeners.
 *
 * Consumers (undo/redo, server-materialization) use `bbox` to scope their
 * work and `seq` to detect missed events when subscribing late.
 */
export interface LayerCommitEvent {
  readonly layerId: LayerId;
  /** Document-space bounding box of the dirtied region. */
  readonly bbox: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  /** Monotonic counter incremented per commit per layer. */
  readonly seq: number;
}

/**
 * The "snapshot path" the registry uses for `commitPictureToLayer`.
 *
 *  - `gpu-sync`: GPU-backed offscreen surface, synchronous `makeImageSnapshot`
 *    after `flush()`. The canonical device path.
 *  - `gpu-async-simulator`: GPU-backed offscreen surface but the snapshot is
 *    deferred a microtask after `flush()` to defeat simulator quirks.
 *  - `cpu-fallback`: reserved for a future extension; currently treated the
 *    same as `gpu-sync` because RN-Skia 2.6 does not differentiate.
 */
export type LayerSnapshotPath = 'gpu-sync' | 'gpu-async-simulator' | 'cpu-fallback';

/** Listener function for commit events. Invoked on the JS thread. */
export type CommitListener = (event: LayerCommitEvent) => void;

/** Public surface of the registry. */
export interface LayerSurfaceRegistry {
  /**
   * Allocate or return the SkSurface for `layerId`. Idempotent: subsequent
   * calls with the same `layerId` return the same surface and ignore the
   * `width` / `height` arguments (the surface is sized at first allocation).
   *
   * Returns `null` only when `Skia.Surface.MakeOffscreen` returns null
   * (extreme low-memory / out-of-VRAM). Callers are responsible for the
   * fallback path; the registry itself does not retry.
   */
  getOrCreateSurface(
    layerId: LayerId,
    width: number,
    height: number,
  ): SkSurface | null;

  /**
   * Reactive SkImage handle for `layerId`. The visible `<Image image={...}>`
   * subscribes to this SharedValue and repaints via JSI without invoking
   * React. Initialized to `null` (empty layer); replaced on each commit.
   *
   * Lazily allocated on first call so a layer that was never drawn into
   * still gets a usable handle.
   */
  imageFor(layerId: LayerId): SharedValue<SkImage | null>;

  /**
   * Worklet-callable. Replay `picture` onto the layer's surface using
   * `blendMode`, snapshot the surface into the layer's reactive image
   * handle, dispose the previous SkImage, and emit a `LayerCommitEvent` to
   * subscribers (delivered on the JS thread).
   *
   * Preconditions:
   *  - `getOrCreateSurface(layerId, …)` was called at gesture-begin time.
   *  - `picture` is a finalized `SkPicture` (e.g., from
   *    `StampRenderer.takePicture()`).
   *
   * On a snapshot failure (sync `makeImageSnapshot` returns null), the
   * caller's commit-worklet retry path is responsible for falling back to
   * the async snapshot variant; the registry exposes both via the
   * `snapshotPath` it returns from {@link getSnapshotPath}.
   */
  commitPictureToLayer(
    layerId: LayerId,
    picture: SkPicture,
    blendMode: BlendMode,
    bbox: { x: number; y: number; w: number; h: number },
  ): void;

  /**
   * Worklet-callable. Take a fresh snapshot of `strokeSurface` and bake it
   * onto the layer's persistent surface using `blendMode`, snapshot the
   * layer surface into the reactive image handle, dispose the previous
   * SkImage, and emit a `LayerCommitEvent` to subscribers.
   *
   * Crucially, the `strokeSurface.makeImageSnapshot()` call lives **inside**
   * this worklet — the resulting SkImage never crosses a Reanimated
   * worklet-args boundary, which sidesteps the JSI handle-lifetime issue
   * that caused `Attempted to access a disposed object` failures when an
   * SkImage was passed in via the args payload.
   *
   * Preconditions:
   *  - `getOrCreateSurface(layerId, …)` was called at gesture-begin time.
   *  - `strokeSurface` is the active stroke buffer (non-null, not yet
   *    disposed by `StampRenderer.endStroke()`).
   *
   * On a snapshot failure (sync `makeImageSnapshot` returns null), the
   * registry logs a warning and leaves the layer image unchanged; the
   * commit becomes a no-op.
   */
  commitSurfaceToLayer(
    layerId: LayerId,
    strokeSurface: SkSurface,
    blendMode: BlendMode,
    bbox: { x: number; y: number; w: number; h: number },
  ): void;

  /**
   * JS-thread synchronous read. Returns the current SkImage for `layerId`
   * (the same handle held by the reactive SharedValue, not a fresh copy).
   * Used by undo/redo snapshot capture; the caller must not dispose the
   * returned image — its lifetime is owned by the registry.
   */
  readLayerImage(layerId: LayerId): SkImage | null;

  /** Subscribe to commit events. Returns an unsubscribe function. */
  subscribeCommit(listener: CommitListener): () => void;

  /** Release the surface and the latest SkImage for `layerId`. Idempotent. */
  disposeLayer(layerId: LayerId): void;

  /** Release every surface and image. Called on editor teardown. */
  disposeAll(): void;

  /** The snapshot path chosen at construction. Logged once at session start. */
  readonly snapshotPath: LayerSnapshotPath;
}

/** Per-layer record held inside the registry. */
interface LayerRecord {
  readonly surface: SkSurface;
  readonly image: SharedValue<SkImage | null>;
  /** Monotonic per-layer commit counter. */
  seq: number;
  /** The SkImage currently held by `image.value`; tracked separately so we
   *  can dispose it before assigning the next snapshot. */
  latestImage: SkImage | null;
}

/** Construction options. */
export interface CreateLayerSurfaceRegistryOptions {
  /**
   * Optional injection of the simulator-detection function. Defaults to a
   * runtime check (iOS + simulator constants). Tests / fixtures can pass a
   * stub here.
   */
  readonly isSimulator?: () => boolean;
  /**
   * When true, the constructor logs the chosen snapshot path with
   * `console.info`. Defaults to true. Set to false in tests.
   */
  readonly logChoice?: boolean;
}

/**
 * Best-effort iOS-Simulator detection without an extra dependency.
 *
 * Strategy: read `Platform.constants` (RN exposes simulator metadata there).
 * On iOS the constants include `systemName`/`systemVersion` and a flag we can
 * read via `(Platform as any).isTesting === true` is NOT reliable for sim
 * detection (it indicates Jest, not Simulator). Instead we look for the
 * `interfaceIdiom` field which the iOS bridge exposes as one of
 * "phone" | "pad" | "tv" | "carplay" | "mac" | "unspecified" — combined
 * with the absence of a `forceTouchAvailable` (only present on devices)
 * this gives a usable heuristic.
 *
 * Per Req 10.4, device behavior is canonical: when we cannot confidently
 * detect Simulator, we return `false` (device path). Callers that need
 * stronger detection (e.g. host apps that already depend on `expo-device`)
 * should inject `isSimulator` via the registry options.
 */
const detectSimulator = (): boolean => {
  if (Platform.OS !== 'ios') return false;
  const constants = (Platform as { constants?: Record<string, unknown> }).constants;
  if (constants === undefined) return false;
  // iOS Simulator advertises `interfaceIdiom` in the constants payload but
  // does not advertise `forceTouchAvailable` (a real-device-only field).
  const hasIdiom = typeof constants['interfaceIdiom'] === 'string';
  const hasForceTouch = constants['forceTouchAvailable'] !== undefined;
  if (hasIdiom && !hasForceTouch) return true;
  // Fallback: a reliable hint — `Platform.constants.isMacCatalyst === false`
  // combined with the iOS Simulator-specific `interfaceIdiom` string.
  const idiom = constants['interfaceIdiom'];
  const isCatalyst = constants['isMacCatalyst'] === true;
  if (!isCatalyst && (idiom === 'pad' || idiom === 'phone')) {
    // Could be device or simulator. We err on the side of device (Req 10.4).
    // If the simulator behavior surfaces a problem in practice, the host app
    // injects `isSimulator` explicitly.
    return false;
  }
  return false;
};

/**
 * Create a `LayerSurfaceRegistry`. The constructor allocates no surfaces;
 * lazy allocation happens on the first `getOrCreateSurface` call per
 * layerId.
 */
export function createLayerSurfaceRegistry(
  opts: CreateLayerSurfaceRegistryOptions = {},
): LayerSurfaceRegistry {
  const isSimulator = opts.isSimulator ?? detectSimulator;
  const logChoice = opts.logChoice ?? true;

  const snapshotPath: LayerSnapshotPath = isSimulator()
    ? 'gpu-async-simulator'
    : 'gpu-sync';

  if (logChoice) {
    // eslint-disable-next-line no-console
    console.info(
      `[LayerSurfaceRegistry] snapshot path: ${snapshotPath}`,
      { platform: Platform.OS },
    );
  }

  const records = new Map<LayerId, LayerRecord>();
  /** Layer ids that have been requested via `imageFor` before any surface
   *  was allocated. We allocate the SharedValue eagerly so the visible
   *  canvas can subscribe before the first stroke is drawn. */
  const orphanImages = new Map<LayerId, SharedValue<SkImage | null>>();
  const listeners = new Set<CommitListener>();

  const ensureRecord = (
    layerId: LayerId,
    width: number,
    height: number,
  ): LayerRecord | null => {
    const existing = records.get(layerId);
    if (existing !== undefined) return existing;

    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (surface === null) {
      // Allocation failure — the caller is responsible for cancelling the
      // stroke (see Error Handling § in design.md).
      // eslint-disable-next-line no-console
      console.warn(
        `[LayerSurfaceRegistry] MakeOffscreen returned null`,
        { layerId, width, height },
      );
      return null;
    }

    // If a SharedValue was lazily created by `imageFor` before allocation,
    // adopt it so existing subscriptions continue to work.
    const image = orphanImages.get(layerId) ?? makeMutable<SkImage | null>(null);
    orphanImages.delete(layerId);

    const rec: LayerRecord = {
      surface,
      image,
      seq: 0,
      latestImage: null,
    };
    records.set(layerId, rec);
    return rec;
  };

  /**
   * Snapshot the surface and replace `record.image.value` with the new
   * image, disposing the prior one. Returns true on success, false when
   * `makeImageSnapshot` returns a falsy result.
   *
   * IMPORTANT: capture the prior reference BEFORE writing the SharedValue
   * so we dispose the old image, not the new one.
   */
  const snapshotInto = (record: LayerRecord): boolean => {
    'worklet';
    const surface = record.surface;
    surface.flush();
    const next: SkImage | null = surface.makeImageSnapshot();
    if (next === null || next === undefined) {
      return false;
    }
    const prior = record.latestImage;
    record.image.value = next;
    record.latestImage = next;
    if (prior !== null) {
      // RN-Skia images expose `dispose()` on the JSI handle; guard via
      // optional-chain because some test fixtures stub out the call.
      const disposable = prior as unknown as { dispose?: () => void };
      disposable.dispose?.();
    }
    return true;
  };

  const notify = (event: LayerCommitEvent): void => {
    'worklet';
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.warn('[LayerSurfaceRegistry] commit listener threw', err);
      }
    }
  };

  const registry: LayerSurfaceRegistry = {
    snapshotPath,
    getOrCreateSurface(
      layerId: LayerId,
      width: number,
      height: number,
    ): SkSurface | null {
      const rec = ensureRecord(layerId, width, height);
      return rec === null ? null : rec.surface;
    },

    imageFor(layerId: LayerId): SharedValue<SkImage | null> {
      const rec = records.get(layerId);
      if (rec !== undefined) return rec.image;
      const orphan = orphanImages.get(layerId);
      if (orphan !== undefined) return orphan;
      // Layer has not been allocated yet; create the SharedValue eagerly
      // so the visible canvas can subscribe before the first commit.
      const fresh = makeMutable<SkImage | null>(null);
      orphanImages.set(layerId, fresh);
      return fresh;
    },

    commitPictureToLayer(
      layerId: LayerId,
      picture: SkPicture,
      blendMode: BlendMode,
      bbox: { x: number; y: number; w: number; h: number },
    ): void {
      'worklet';
      const rec = records.get(layerId);
      if (rec === undefined) {
        // eslint-disable-next-line no-console
        console.warn(
          '[LayerSurfaceRegistry] commit on unknown layer',
          { layerId },
        );
        return;
      }
      const canvas = rec.surface.getCanvas();
      // Apply the stroke's blend mode via a saveLayer + paint so DstOut /
      // alpha-only / SrcOver are preserved over the layer's existing pixels.
      // The paint is local to this commit; dispose it after `restore()` so
      // we do not accumulate one Paint handle per stroke (Req 9.6).
      const paint = Skia.Paint();
      paint.setBlendMode(blendMode);
      canvas.saveLayer(paint);
      (canvas as unknown as { drawPicture: (p: SkPicture) => void }).drawPicture(picture);
      canvas.restore();
      const disposablePaint = paint as unknown as { dispose?: () => void };
      disposablePaint.dispose?.();

      const ok = snapshotInto(rec);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn(
          '[LayerSurfaceRegistry] snapshot returned null; layer image unchanged',
          { layerId, snapshotPath },
        );
        return;
      }

      rec.seq += 1;
      const event: LayerCommitEvent = {
        layerId,
        bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
        seq: rec.seq,
      };
      notify(event);
    },

    commitSurfaceToLayer(
      layerId: LayerId,
      strokeSurface: SkSurface,
      blendMode: BlendMode,
      bbox: { x: number; y: number; w: number; h: number },
    ): void {
      'worklet';
      // eslint-disable-next-line no-console
      console.log('[commitSurfaceToLayer] enter', { layerId, recordsSize: records.size });
      const rec = records.get(layerId);
      if (rec === undefined) {
        // eslint-disable-next-line no-console
        console.warn(
          '[LayerSurfaceRegistry] commit on unknown layer',
          { layerId, knownLayers: Array.from(records.keys()) },
        );
        return;
      }
      // Flush the stroke surface so its pending GPU work is queued before
      // we read pixels from it via the snapshot below.
      strokeSurface.flush();
      // Take a snapshot LOCALLY — this SkImage never crosses a worklet-args
      // boundary, so its lifetime is bounded by this worklet body and the
      // disposed-handle issue does not apply.
      const strokeImage = strokeSurface.makeImageSnapshot();
      if (strokeImage === null || strokeImage === undefined) {
        // eslint-disable-next-line no-console
        console.warn(
          '[LayerSurfaceRegistry] strokeSurface.makeImageSnapshot returned null',
          { layerId },
        );
        return;
      }
      const canvas = rec.surface.getCanvas();
      // Bake the stroke image onto the layer using the stroke's blend mode.
      // saveLayer ensures DstOut / Plus / SrcOver are applied against the
      // layer's existing pixels rather than the destination clip behind it.
      const paint = Skia.Paint();
      paint.setBlendMode(blendMode);
      canvas.saveLayer(paint);
      canvas.drawImage(strokeImage, 0, 0);
      canvas.restore();
      const disposablePaint = paint as unknown as { dispose?: () => void };
      disposablePaint.dispose?.();

      const ok = snapshotInto(rec);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn(
          '[LayerSurfaceRegistry] snapshot returned null; layer image unchanged',
          { layerId, snapshotPath },
        );
        return;
      }

      rec.seq += 1;
      // eslint-disable-next-line no-console
      console.log('[commitSurfaceToLayer] success', { layerId, seq: rec.seq });
      const event: LayerCommitEvent = {
        layerId,
        bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
        seq: rec.seq,
      };
      notify(event);
    },

    readLayerImage(layerId: LayerId): SkImage | null {
      const rec = records.get(layerId);
      if (rec === undefined) return null;
      return rec.latestImage;
    },

    subscribeCommit(listener: CommitListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    disposeLayer(layerId: LayerId): void {
      const rec = records.get(layerId);
      if (rec !== undefined) {
        if (rec.latestImage !== null) {
          const disposable = rec.latestImage as unknown as {
            dispose?: () => void;
          };
          disposable.dispose?.();
          rec.latestImage = null;
        }
        rec.image.value = null;
        const surfaceDisposable = rec.surface as unknown as {
          dispose?: () => void;
        };
        surfaceDisposable.dispose?.();
        records.delete(layerId);
      }
      // Also clear any orphan SharedValue so subsequent `imageFor` returns
      // `null` (matching the "ignored after disposeLayer" contract).
      const orphan = orphanImages.get(layerId);
      if (orphan !== undefined) {
        orphan.value = null;
        orphanImages.delete(layerId);
      }
    },

    disposeAll(): void {
      for (const [id] of records) {
        registry.disposeLayer(id);
      }
      // `disposeLayer` already drains orphans for matching ids; sweep any
      // remaining orphans (layers that never allocated a surface).
      for (const [, sv] of orphanImages) {
        sv.value = null;
      }
      orphanImages.clear();
      listeners.clear();
    },
  };

  return registry;
}
