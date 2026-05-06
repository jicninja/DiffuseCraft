/**
 * useBrushPipeline — UI-thread brush stroke orchestrator.
 *
 * Replaces the legacy `useBrushRenderer` hook. The entire stroke hot path
 * runs on the UI thread (Reanimated worklet runtime); the only JS-thread
 * work during a gesture is the one-time editor-store snapshot at
 * gesture-begin.
 *
 * Wiring:
 *  - `beginStroke(config, firstPoint)` — JS-thread entry point. The gesture's
 *    `onBegin` worklet calls `runOnJS(snapshotStoreAndStartStroke)` which
 *    reads the Zustand store, builds an immutable `BeginStrokeConfig`, and
 *    invokes this method. We allocate the incremental expander, the stamp
 *    renderer, the layer surface, then push the first point on the UI
 *    thread via `runOnUI`.
 *  - `pushPoint(point)` — worklet-callable. Called from the gesture's
 *    `onUpdate` worklet body for each captured stylus event.
 *  - `commitStroke()` — worklet-callable. Called from `onEnd`.
 *  - `cancelStroke()` — worklet-callable. Called from `onFinalize` when the
 *    gesture is interrupted (multi-touch, navigation away, tool switch).
 *
 * The active picture is exposed as a `SharedValue<SkPicture | null>`. The
 * caller (CanvasArea) threads it into `<CanvasView activePicture={...}>`;
 * RN-Skia subscribes via JSI and replays the picture on the GPU thread
 * without engaging React's reconciler.
 *
 * Memory bound (Req 9.4): the stroke buffer dimensions are capped at
 * 4096×4096 to bound an active stroke's working memory regardless of layer
 * size. Larger layers still keep their full-resolution persistent surface;
 * only the transient stamp recorder is clipped to the cap.
 *
 * Worklet-side error path (Req 2.6): every worklet body that mutates state
 * is wrapped in a try/catch. On error we schedule a one-shot JS-thread log
 * via `runOnJS` and run the cancel path so the active picture is dropped
 * and no native handle leaks.
 *
 * Dev-mode latency (tasks.md 5.1): when `__DEV__` is true the per-event
 * worklet body samples `performance.now()` deltas into a small ring buffer
 * exposed for inspection. Mean / p99 are computed lazily on read so the hot
 * path does no extra work beyond two timestamp reads + one array write.
 *
 * Design reference: brush-canvas-rendering §useBrushPipeline.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  createIncrementalStampExpander,
  type BrushPreset,
  type IncrementalStampExpander,
  type LayerId,
  type StrokePoint,
} from '@diffusecraft/canvas-core';
import {
  commitActiveStrokeWorklet,
  createStampRenderer,
  type LayerSurfaceRegistry,
  type SkiaRenderAdapter,
  type StampRenderer,
} from '@diffusecraft/canvas-skia';
import { BlendMode, Skia, type SkPicture } from '@shopify/react-native-skia';
import {
  makeMutable,
  runOnJS,
  runOnUI,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * 1×1 empty `SkPicture` sentinel. RN-Skia's `<Picture>` element does NOT
 * tolerate a `null` SharedValue — it falls through to its default
 * `SkTextBlob` interpretation and crashes with
 * `Invalid prop value for SkTextBlob received`. Mounting `<Picture>`
 * always with a non-null value avoids that. The empty picture replays as
 * a no-op on the GPU thread, so there is no rendering cost between strokes.
 *
 * Allocated lazily once per session at module load.
 */
const EMPTY_PICTURE: SkPicture = (() => {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording({ x: 0, y: 0, width: 1, height: 1 });
  return recorder.finishRecordingAsPicture();
})();

/** v1 active-stroke buffer dimension cap (Req 9.4). */
const MAX_BUFFER_DIMENSION = 4096;

/** Per-stroke configuration captured at gesture-begin. Immutable for the
 *  stroke's lifetime — Req 7.2. */
export interface BeginStrokeConfig {
  readonly layerId: string;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly preset: BrushPreset;
  readonly color: { r: number; g: number; b: number };
  readonly erase: boolean;
  readonly maskOnly: boolean;
}

/**
 * Worklet-callable handle returned by `useBrushPipeline`.
 *
 * `activePicture` is the live link into `<CanvasView>`. Updating it on the
 * UI thread does not trigger a React render — RN-Skia subscribes by JSI and
 * repaints the canvas imperatively.
 */
export interface BrushPipelineHandle {
  /**
   * SharedValue holding the active stroke's latest picture. Carries
   * `EMPTY_PICTURE` (a 1×1 no-op picture) when no stroke is in progress —
   * a non-null sentinel is required because RN-Skia's `<Picture>` element
   * crashes when its SharedValue value is `null`.
   */
  readonly activePicture: SharedValue<SkPicture>;
  /**
   * JS-thread entry point. Reads the editor-store snapshot once, then hops
   * to the UI thread to allocate the expander/renderer and push the first
   * point. Subsequent events stay on the UI thread.
   */
  beginStroke(config: BeginStrokeConfig, firstPoint: StrokePoint): void;
  /** Worklet-callable. Push a captured event. */
  pushPoint(point: StrokePoint): void;
  /** Worklet-callable. Finalize the stroke onto the layer surface. */
  commitStroke(): void;
  /** Worklet-callable. Drop the stroke without touching the layer surface. */
  cancelStroke(): void;
}

/**
 * Per-stroke runtime state held on the UI thread. The whole record lives in
 * a `SharedValue` so worklets can mutate it without crossing the bridge.
 *
 * `null` fields express the "no active stroke" state. Constructing the
 * record once and mutating its fields lets us avoid an allocation per
 * gesture (the SharedValue itself is the only reference Reanimated tracks).
 */
interface StrokeRuntimeState {
  expander: IncrementalStampExpander | null;
  renderer: StampRenderer | null;
  /**
   * Layer surface registry. Stored at `_workletBegin` time so subsequent
   * worklets (`pushPoint`, `commitStroke`, `cancelStroke`) do NOT need to
   * read from a JS-thread ref — capturing the adapter ref inside a worklet
   * closure freezes it under Reanimated's serialization model and breaks
   * subsequent JS-thread mutations.
   */
  registry: LayerSurfaceRegistry | null;
  /**
   * Active layer id. Stored as the canvas-core branded `LayerId` so it
   * threads through `commitActiveStrokeWorklet` without an inline cast at
   * each commit. The brand is structural (a string at runtime) so the
   * worklet sees a primitive on the UI thread.
   */
  layerId: LayerId | null;
  width: number;
  height: number;
  blendMode: BlendMode;
  /** Document-space bounding box; v1 uses the working buffer's full area. */
  bbox: { x: number; y: number; w: number; h: number };
  /** True between successful `_workletBegin` and any of commit/cancel. */
  active: boolean;
}

/**
 * Pure-data view of a stroke runtime, used to seed the SharedValue's initial
 * value. We avoid `null` here so the worklet body can read the same field
 * shape on every call (no shape-change deopts inside the runtime).
 */
function createInitialStrokeState(): StrokeRuntimeState {
  'worklet';
  return {
    expander: null,
    renderer: null,
    registry: null,
    layerId: null,
    width: 0,
    height: 0,
    blendMode: BlendMode.SrcOver,
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    active: false,
  };
}

/**
 * Worklet-side log helper. Reanimated's `runOnJS` requires the callback to
 * be defined on the JS thread; we keep one stable function reference.
 */
const jsWarn = (message: string, payload?: unknown): void => {
  // eslint-disable-next-line no-console
  console.warn(`[useBrushPipeline] ${message}`, payload);
};

export function useBrushPipeline(
  adapter: SkiaRenderAdapter | null,
): BrushPipelineHandle {
  // The active picture is the live link into <CanvasView>. We keep a stable
  // ref via `useMemo` (not `useSharedValue`) so the SharedValue is created
  // exactly once across renders — `useSharedValue` would re-init the value
  // on every fast-refresh, which is the right semantic for component state
  // but not for our gesture-spanning handle.
  const activePictureRef = useRef<SharedValue<SkPicture> | null>(null);
  if (activePictureRef.current === null) {
    activePictureRef.current = makeMutable<SkPicture>(EMPTY_PICTURE);
  }
  const activePicture = activePictureRef.current;

  // Per-stroke runtime. One `SharedValue` reused across all strokes; fields
  // mutated inside worklets via `state.value.X = ...`. Reanimated holds the
  // object's identity stable; we only read/write its primitive members.
  const strokeStateRef = useRef<SharedValue<StrokeRuntimeState> | null>(null);
  if (strokeStateRef.current === null) {
    strokeStateRef.current = makeMutable<StrokeRuntimeState>(
      createInitialStrokeState(),
    );
  }
  const strokeState = strokeStateRef.current;

  // Dev-mode latency ring buffer. Captures per-event handling time in
  // milliseconds. Read on the JS thread via `getLatencySamples()` (returned
  // through the handle for future device-spike tooling). Capped to 256
  // samples so the array does not grow unbounded across long sessions.
  const latencySamplesRef = useRef<SharedValue<number[]> | null>(null);
  if (latencySamplesRef.current === null) {
    latencySamplesRef.current = makeMutable<number[]>([]);
  }
  const latencySamples = latencySamplesRef.current;

  // ---- Worklet bodies ----

  /**
   * UI-thread tail of `beginStroke`. Runs after the JS-thread snapshot has
   * been resolved and the layer surface allocated.
   *
   * Note we receive plain primitives + the registry handle so the worklet
   * does not capture any non-shareable JS-thread reference.
   */
  const _workletBegin = (
    expander: IncrementalStampExpander,
    renderer: StampRenderer,
    registry: LayerSurfaceRegistry,
    layerId: LayerId,
    width: number,
    height: number,
    color: { r: number; g: number; b: number },
    hardness: number,
    erase: boolean,
    maskOnly: boolean,
    firstPoint: StrokePoint,
  ): void => {
    'worklet';
    try {
      renderer.beginStroke({
        width,
        height,
        color,
        hardness,
        erase,
        maskOnly,
      });

      const stamps = expander.pushPoint(firstPoint);
      renderer.drawStamps(stamps);
      const pic = renderer.takePicture();
      activePicture.value = pic !== null ? pic : EMPTY_PICTURE;

      // Resolve blend mode for the eventual commit. Mask layers always
      // route through SrcOver because the renderer already burns the
      // luminance contribution into the picture's alpha; erase uses
      // DstOut. Paint uses SrcOver.
      const blend = erase ? BlendMode.DstOut : BlendMode.SrcOver;

      strokeState.value = {
        expander,
        renderer,
        registry,
        layerId,
        width,
        height,
        blendMode: blend,
        bbox: { x: 0, y: 0, w: width, h: height },
        active: true,
      };
    } catch (err: unknown) {
      runOnJS(jsWarn)('beginStroke worklet error', String(err));
      // Best-effort cleanup. If renderer construction failed mid-way, the
      // calls below are idempotent.
      try {
        renderer.endStroke();
      } catch (_inner: unknown) {
        // swallow — secondary failure during cleanup
      }
      try {
        expander.dispose();
      } catch (_inner: unknown) {
        // swallow
      }
      activePicture.value = EMPTY_PICTURE;
      strokeState.value = createInitialStrokeState();
    }
  };

  /** Worklet body for `pushPoint`. */
  const _workletPushPoint = (point: StrokePoint): void => {
    'worklet';
    const s = strokeState.value;
    if (!s.active || s.expander === null || s.renderer === null) return;

    // Dev latency timer — two timestamps + one array push when __DEV__.
    const t0 = (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
    try {
      const stamps = s.expander.pushPoint(point);
      s.renderer.drawStamps(stamps);
      const pic = s.renderer.takePicture();
      activePicture.value = pic !== null ? pic : EMPTY_PICTURE;
    } catch (err: unknown) {
      runOnJS(jsWarn)('pushPoint worklet error', String(err));
      // Cancel the stroke on the UI thread; we cannot safely call back into
      // the renderer once it is in an inconsistent state.
      try {
        s.renderer.endStroke();
      } catch (_inner: unknown) {
        // swallow
      }
      try {
        s.expander.dispose();
      } catch (_inner: unknown) {
        // swallow
      }
      activePicture.value = EMPTY_PICTURE;
      strokeState.value = createInitialStrokeState();
      return;
    }
    if (__DEV__) {
      const t1 =
        (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
      const samples = latencySamples.value;
      // Cap to 256 entries; the oldest sample is dropped when full so the
      // working set covers the most recent activity.
      if (samples.length >= 256) samples.shift();
      samples.push(t1 - t0);
    }
  };

  /**
   * Worklet body for `commitStroke`. Reads the registry from
   * `strokeState.value` (stored at `_workletBegin`) — never from a JS-thread
   * ref, because capturing such a ref in a worklet closure freezes it under
   * Reanimated's serialization model and breaks subsequent JS-thread
   * mutations of that ref.
   */
  const _workletCommit = (): void => {
    'worklet';
    const s = strokeState.value;
    if (!s.active || s.renderer === null || s.expander === null) return;

    try {
      const picture = s.renderer.takePicture();
      if (picture !== null && s.registry !== null && s.layerId !== null) {
        commitActiveStrokeWorklet({
          registry: s.registry,
          layerId: s.layerId,
          picture,
          blendMode: s.blendMode,
          bbox: s.bbox,
        });
      } else if (picture === null) {
        runOnJS(jsWarn)('commitStroke: takePicture returned null', null);
      }
    } catch (err: unknown) {
      runOnJS(jsWarn)('commitStroke worklet error', String(err));
    } finally {
      try {
        s.renderer.endStroke();
      } catch (_inner: unknown) {
        // swallow
      }
      try {
        s.expander.dispose();
      } catch (_inner: unknown) {
        // swallow
      }
      activePicture.value = EMPTY_PICTURE;
      strokeState.value = createInitialStrokeState();
    }
  };

  /** Worklet body for `cancelStroke`. */
  const _workletCancel = (): void => {
    'worklet';
    const s = strokeState.value;
    if (!s.active) {
      // Idempotent: no-op when no stroke is in flight.
      activePicture.value = EMPTY_PICTURE;
      return;
    }
    try {
      if (s.renderer !== null) s.renderer.endStroke();
    } catch (_inner: unknown) {
      // swallow
    }
    try {
      if (s.expander !== null) s.expander.dispose();
    } catch (_inner: unknown) {
      // swallow
    }
    activePicture.value = EMPTY_PICTURE;
    strokeState.value = createInitialStrokeState();
  };

  // ---- Public API ----

  // Hold the latest adapter in a ref so worklet trampolines see the current
  // value without re-binding the worklet bodies (which would re-allocate
  // their captured environment on every render).
  const adapterRef = useRef<SkiaRenderAdapter | null>(adapter);
  adapterRef.current = adapter;

  const handle = useMemo<BrushPipelineHandle>(() => {
    return {
      activePicture,
      beginStroke(
        config: BeginStrokeConfig,
        firstPoint: StrokePoint,
      ): void {
        // JS-thread entry. Snapshot the adapter, allocate the layer surface
        // (allocation is JS-thread-safe; the surface object itself is then
        // shared with the UI thread for writes), construct the expander +
        // renderer (RN-Skia handles are JSI-shareable), then hop to the UI
        // thread to begin recording.
        const a = adapterRef.current;
        if (a === null) {
          jsWarn('beginStroke called before adapter is ready', null);
          return;
        }
        if (config.layerWidth <= 0 || config.layerHeight <= 0) {
          jsWarn('beginStroke: invalid layer dimensions', {
            w: config.layerWidth,
            h: config.layerHeight,
          });
          return;
        }
        const width = Math.min(config.layerWidth, MAX_BUFFER_DIMENSION);
        const height = Math.min(config.layerHeight, MAX_BUFFER_DIMENSION);

        // Ensure the layer surface exists. Allocation failure leaves the
        // registry with no record for `layerId`; in that case we skip the
        // begin entirely so the commit path does not try to write into a
        // null surface.
        //
        // The store's `activeLayerId` is a plain `string`; canvas-core uses a
        // branded `LayerId` for type-level safety. The cast is structural —
        // at runtime the brand is a TypeScript-only marker.
        const layerId = config.layerId as LayerId;
        const surface = a.layerSurfaces.getOrCreateSurface(
          layerId,
          width,
          height,
        );
        if (surface === null) {
          jsWarn('beginStroke: layer surface allocation failed', {
            layerId: config.layerId,
            width,
            height,
          });
          return;
        }

        const expander = createIncrementalStampExpander({
          preset: config.preset,
        });
        const renderer = createStampRenderer();

        runOnUI(_workletBegin)(
          expander,
          renderer,
          a.layerSurfaces,
          layerId,
          width,
          height,
          config.color,
          config.preset.hardness,
          config.erase,
          config.maskOnly,
          firstPoint,
        );
      },
      pushPoint(point: StrokePoint): void {
        'worklet';
        _workletPushPoint(point);
      },
      commitStroke(): void {
        'worklet';
        // The registry was stored in strokeState at `_workletBegin` time —
        // we deliberately do NOT capture any JS-thread ref in this worklet
        // closure (capturing `adapterRef.current` here would freeze the ref
        // under Reanimated's serialization model and break subsequent JS
        // re-renders that mutate `adapterRef.current = adapter`).
        _workletCommit();
      },
      cancelStroke(): void {
        'worklet';
        _workletCancel();
      },
    };
    // The worklet bodies and SharedValues are stable across renders; the
    // only varying input is `adapter`, which we read through `adapterRef`
    // so the handle identity itself stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePicture]);

  // Cancel any in-flight stroke if the hook unmounts mid-gesture (e.g. a
  // navigation tear-down). This is JS-thread; the worklet body is
  // idempotent so it is safe to call without coordinating with the UI
  // thread.
  useEffect(() => {
    return () => {
      runOnUI(_workletCancel)();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return handle;
}
