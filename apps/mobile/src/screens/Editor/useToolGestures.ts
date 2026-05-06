/**
 * useToolGestures — per-tool gesture handlers for the Editor canvas.
 *
 * Per design §4.6: returns a `forTool(activeTool)` function that builds the
 * appropriate `Gesture.Pan` / `Gesture.Tap` for each tool. The gesture
 * compositor calls `forTool` with the current `activeTool` from the store
 * and inserts the result into the `Gesture.Exclusive` precedence tree.
 *
 * Tool → gesture mapping:
 *   - brush / eraser  → single-finger Pan (stroke capture + pressure)
 *   - lasso           → single-finger Pan (selection path)
 *   - rect-select     → single-finger Pan (selection rectangle)
 *   - transform       → single-finger Pan (translate / scale with snap)
 *   - eyedropper      → Tap (color sample)
 *   - pan / unknown   → disabled Pan (pass-through to navigation)
 *
 * Mask painting (FR-29): when the active layer is a mask layer, brush
 * strokes are routed to the mask painting pipeline (maskOnly flag on
 * composeStroke).
 *
 * Coordinates are converted from screen (viewport) space to document space
 * via `viewportToDocument` from `canvas-core`.
 *
 * Requirements: FR-1, FR-2, FR-4, FR-9, FR-10, FR-13, FR-14, FR-16, FR-17,
 *               FR-18, FR-19, FR-20, FR-22, FR-23, FR-24, FR-25, FR-26,
 *               FR-27, FR-28, FR-29, FR-47
 */

import { useCallback, useContext, useMemo, useRef } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import {
  makeMutable,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import {
  EditorStoreContext,
  type EditorTool,
  type EditorStore,
} from '@diffusecraft/core';
import {
  viewportToDocument,
  BRUSH_PRESETS,
  closeLassoPath,
  findSnapTargets,
  pickClosestPerAxis,
  parseBrushColor,
  type Viewport,
  type StrokePoint,
  type BrushPresetId,
  type BrushPreset,
  type Point2D,
} from '@diffusecraft/canvas-core';
import { mapStylusEvent } from '@diffusecraft/canvas-skia';

import type { useViewport } from './useViewport';
import type { BrushPipelineHandle, BeginStrokeConfig } from './useBrushPipeline';

/**
 * Viewport handle — the subset of `useViewport` return value that tool
 * gestures need. Kept structural so the hook doesn't depend on the full
 * viewport object identity.
 */
type ViewportHandle = Pick<
  ReturnType<typeof useViewport>,
  'ref' | 'adapterRef'
>;

export function useToolGestures(
  viewport: ViewportHandle,
  brushPipeline: BrushPipelineHandle,
) {
  // Raw store handle for imperative getState() inside gesture callbacks.
  // Gesture callbacks run outside React's render cycle, so we cannot use
  // the selector-based `useEditorStore` hook there.
  const editorStore = useContext(EditorStoreContext) as EditorStore;

  // Mutable refs for accumulating in-progress gesture data without
  // triggering React re-renders at 60 Hz.
  const selectionPathRef = useRef<Point2D[]>([]);
  const transformStartRef = useRef<{ x: number; y: number } | null>(null);

  // ---- Brush-gesture worklet-shared state ----
  //
  // The brush gesture body runs on the UI thread (no `.runOnJS(true)`).
  // Anything the worklet needs to read across `onBegin` / `onUpdate` /
  // `onEnd` must live in a SharedValue. We hold:
  //   - `viewportSV`: the viewport snapshot captured at gesture begin so
  //     `onUpdate` can convert screen coords to document coords without a
  //     bridge crossing. v1 limitation — the viewport is FROZEN at gesture
  //     begin; mid-stroke pinch-zoom is unsupported (rare in practice).
  //   - `strokeActiveSV`: true once `runOnJS(beginBrushStroke)` has scheduled
  //     the JS-thread snapshot so subsequent `onUpdate` events know the
  //     pipeline accepted the stroke and not the FR-13 first-event-pressure-0
  //     guard.
  //   - `skipStrokeSV`: FR-13 guard — if `mapStylusEvent(..., true)` returned
  //     null (Apple Pencil first event with force=0) we skip the stroke
  //     entirely. The very next `onUpdate` will arrive with a non-zero
  //     pressure, but for v1 we discard the whole gesture rather than try
  //     to start mid-stream.
  const viewportSVRef = useRef<SharedValue<Viewport | null> | null>(null);
  if (viewportSVRef.current === null) {
    viewportSVRef.current = makeMutable<Viewport | null>(null);
  }
  const viewportSV = viewportSVRef.current;

  const strokeActiveSVRef = useRef<SharedValue<boolean> | null>(null);
  if (strokeActiveSVRef.current === null) {
    strokeActiveSVRef.current = makeMutable<boolean>(false);
  }
  const strokeActiveSV = strokeActiveSVRef.current;

  const skipStrokeSVRef = useRef<SharedValue<boolean> | null>(null);
  if (skipStrokeSVRef.current === null) {
    skipStrokeSVRef.current = makeMutable<boolean>(false);
  }
  const skipStrokeSV = skipStrokeSVRef.current;

  // ---- Helpers ----

  /** Convert a screen-space gesture point to document space (JS thread). */
  const toDoc = (vp: Viewport, x: number, y: number) =>
    viewportToDocument(vp, { x, y });

  /**
   * JS-thread brush-stroke kickoff. Called once at `onBegin` via `runOnJS`.
   *
   * Reads the editor store + viewport ref once, builds an immutable
   * `BeginStrokeConfig`, and calls `brushPipeline.beginStroke` (which
   * internally hops to the UI thread to allocate the expander/renderer and
   * push the first point).
   *
   * The viewport snapshot also lands in `viewportSV` so subsequent
   * `onUpdate` worklet bodies can convert screen coords to document coords
   * inline (see `viewportToDocumentWorklet` below).
   */
  const beginBrushStroke = useCallback(
    (firstPoint: StrokePoint) => {
      const state = editorStore?.getState();
      if (!state) return;

      const doc = state.document;
      if (!doc || doc.width <= 0 || doc.height <= 0) return;

      const layer = state.layers.find((l) => l.id === state.activeLayerId);
      const layerId = state.activeLayerId;
      if (!layerId) return;

      const presetId: BrushPresetId =
        state.activeTool === 'eraser' ? 'eraser' : 'pen';
      const basePreset = BRUSH_PRESETS[presetId];

      let color: { r: number; g: number; b: number };
      try {
        const parsed = parseBrushColor(state.brush.color);
        color = parsed.color;
      } catch {
        color = { r: 0, g: 0, b: 0 };
      }

      const maskOnly =
        (layer as { kind?: string } | undefined)?.kind === 'mask';

      const preset: BrushPreset = {
        ...basePreset,
        size: state.brush.size ?? basePreset.size,
        opacity: state.brush.opacity ?? basePreset.opacity,
        hardness: state.brush.hardness ?? basePreset.hardness,
      };

      // Freeze the viewport for the entire stroke (v1 simplification — see
      // the SharedValue's comment block above).
      const vp = viewport.ref.current;
      viewportSV.value = vp;

      const docFirst = toDoc(vp, firstPoint.x, firstPoint.y);
      const firstDocPoint: StrokePoint = {
        ...firstPoint,
        x: docFirst.x,
        y: docFirst.y,
      };

      const config: BeginStrokeConfig = {
        layerId,
        layerWidth: doc.width,
        layerHeight: doc.height,
        preset,
        color,
        erase: state.activeTool === 'eraser' || preset.erase,
        maskOnly,
      };

      strokeActiveSV.value = true;
      brushPipeline.beginStroke(config, firstDocPoint);
    },
    [editorStore, viewport, brushPipeline, viewportSV, strokeActiveSV],
  );

  // ---- Per-tool gesture builders ----

  const buildBrushGesture = useCallback((): GestureType => {
    // The brush gesture is the project's only worklet-driven gesture: the
    // entire hot path runs on the UI thread. The lint guard at
    // `tools/check-no-brush-runonjs.ts` enforces that the JS-thread
    // hand-off chain is absent here.
    //
    // **Closure-capture discipline.** The gesture worklets ONLY capture the
    // individual worklet methods (`pushPoint`, `commitStroke`,
    // `cancelStroke`) and the SharedValues, never the full `brushPipeline`
    // object. Reanimated's babel plugin serializes every captured object
    // reference; capturing the whole handle would drag in the JS-thread
    // `beginStroke` method, whose closure holds the adapter ref — once
    // that ref is serialized to the UI thread, subsequent JS-thread
    // re-renders that mutate `adapterRef.current = adapter` fire the
    // `Tried to modify key 'current' of an object passed to a worklet`
    // warning. Destructuring the methods into local consts keeps each
    // worklet's capture set down to the single function it needs.
    const pushPointWorklet = brushPipeline.pushPoint;
    const commitStrokeWorklet = brushPipeline.commitStroke;
    const cancelStrokeWorklet = brushPipeline.cancelStroke;
    return Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .onBegin((e) => {
        'worklet';
        // Reset per-stroke state.
        strokeActiveSV.value = false;
        skipStrokeSV.value = false;

        const point = mapStylusEvent(
          { x: e.x, y: e.y, stylusData: e.stylusData },
          true,
        );
        if (point === null) {
          // FR-13: first Apple Pencil event with pressure=0. Drop the
          // entire gesture; the OS will deliver a fresh `onBegin` for the
          // next stylus contact.
          skipStrokeSV.value = true;
          return;
        }

        // Hop to the JS thread once to snapshot the editor store + viewport.
        // From here on, every event lives on the UI thread.
        runOnJS(beginBrushStroke)(point);
      })
      .onUpdate((e) => {
        'worklet';
        if (skipStrokeSV.value) return;
        if (!strokeActiveSV.value) return;

        const point = mapStylusEvent(
          { x: e.x, y: e.y, stylusData: e.stylusData },
          false,
        );
        if (point === null) return;

        // Convert screen → document coords using the gesture-begin viewport
        // snapshot. Inlined math; `viewportToDocument` from canvas-core is
        // not yet 'worklet'-marked. The math is identical (see
        // libs/canvas-core/src/render/viewport.ts).
        const vp = viewportSV.value;
        let docX = point.x;
        let docY = point.y;
        if (vp !== null) {
          const tx = point.x - vp.pan_x;
          const ty = point.y - vp.pan_y;
          const theta = (-vp.rotation_degrees * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const rx = tx * cos - ty * sin;
          const ry = tx * sin + ty * cos;
          docX = rx / vp.zoom;
          docY = ry / vp.zoom;
        }

        pushPointWorklet({ ...point, x: docX, y: docY });
      })
      .onEnd(() => {
        'worklet';
        if (skipStrokeSV.value) return;
        if (!strokeActiveSV.value) return;
        commitStrokeWorklet();
        strokeActiveSV.value = false;
      })
      .onFinalize(() => {
        'worklet';
        // `onFinalize` fires after every gesture (success or interrupt). If
        // we still consider the stroke active here (i.e., `onEnd` did not
        // run because the gesture was cancelled), drop it.
        if (strokeActiveSV.value) {
          cancelStrokeWorklet();
          strokeActiveSV.value = false;
        }
        skipStrokeSV.value = false;
        viewportSV.value = null;
      });
  }, [
    brushPipeline,
    beginBrushStroke,
    viewportSV,
    strokeActiveSV,
    skipStrokeSV,
  ]);

  const buildLassoGesture = useCallback((): GestureType => {
    return Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        selectionPathRef.current = [{ x: docPt.x, y: docPt.y }];
      })
      .onUpdate((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        selectionPathRef.current.push({ x: docPt.x, y: docPt.y });
      })
      .onEnd(() => {
        const path = selectionPathRef.current;
        if (path.length < 3) {
          selectionPathRef.current = [];
          return;
        }

        // Close the lasso path using canvas-core's simplification.
        const closed = closeLassoPath(path);

        // FR-27: Update editorStore.selectionSlice with the new selection.
        // The selection is stored as a mask URI — in the local-only phase
        // we store a placeholder. Full mask rasterization requires the
        // server-side selection pipeline.
        void closed;
        // TODO(client-sdk): convert closed path to selection mask and
        // call state.setSelection({ kind: 'mask', mask_uri: '...' })

        selectionPathRef.current = [];
      })
      .onFinalize(() => {
        selectionPathRef.current = [];
      });
  }, [viewport]);

  const buildRectSelectGesture = useCallback((): GestureType => {
    return Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        selectionPathRef.current = [{ x: docPt.x, y: docPt.y }];
      })
      .onUpdate((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        // For rect-select we only need the start and current point.
        if (selectionPathRef.current.length > 0) {
          selectionPathRef.current[1] = { x: docPt.x, y: docPt.y };
        }
      })
      .onEnd(() => {
        const path = selectionPathRef.current;
        if (path.length < 2) {
          selectionPathRef.current = [];
          return;
        }

        const start = path[0]!;
        const end = path[1]!;
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);

        if (w > 0 && h > 0) {
          // FR-26, FR-27: Update selection with the rectangle.
          const state = editorStore.getState();
          state.setSelection({ kind: 'rect', rect: { x, y, w, h } });
        }

        selectionPathRef.current = [];
      })
      .onFinalize(() => {
        selectionPathRef.current = [];
      });
  }, [viewport, editorStore]);

  const buildTransformGesture = useCallback((): GestureType => {
    return Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .onBegin((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        transformStartRef.current = { x: docPt.x, y: docPt.y };

        // FR-22: Begin transform on the active layer.
        const state = editorStore.getState();
        state.beginTransform({ x: docPt.x, y: docPt.y });
      })
      .onUpdate((e) => {
        const docPt = toDoc(viewport.ref.current, e.x, e.y);
        const start = transformStartRef.current;
        if (!start) return;

        // Compute translation delta.
        let dx = docPt.x - start.x;
        let dy = docPt.y - start.y;

        // FR-23: Apply snap targets from transform-tools.
        const state = editorStore.getState();
        const doc = state.document;
        if (doc && doc.width > 0 && doc.height > 0) {
          const currentTransform = state.transform;
          const rect = {
            x: currentTransform.translate.x + dx,
            y: currentTransform.translate.y + dy,
            w: doc.width, // Simplified — real impl uses layer bounds
            h: doc.height,
          };
          const targets = findSnapTargets(rect, {
            canvas_width: doc.width,
            canvas_height: doc.height,
            other_layers: [],
          });
          const closest = pickClosestPerAxis(targets);
          if (closest.vertical) {
            const snapDelta =
              closest.vertical.value -
              (closest.vertical.snap_to === 'start'
                ? rect.x
                : closest.vertical.snap_to === 'mid'
                  ? rect.x + rect.w / 2
                  : rect.x + rect.w);
            dx += snapDelta;
          }
          if (closest.horizontal) {
            const snapDelta =
              closest.horizontal.value -
              (closest.horizontal.snap_to === 'start'
                ? rect.y
                : closest.horizontal.snap_to === 'mid'
                  ? rect.y + rect.h / 2
                  : rect.y + rect.h);
            dy += snapDelta;
          }
        }

        // FR-24: Rotation snap is applied when rotation gestures are
        // active (handled by the navigation gesture compositor for
        // two-finger rotate). Single-finger transform is translate only.
        state.patchTransform({
          translate: {
            x: state.transform.translate.x + dx,
            y: state.transform.translate.y + dy,
          },
        });

        // Update start point for next delta.
        transformStartRef.current = { x: docPt.x, y: docPt.y };
      })
      .onEnd(() => {
        // Commit transform.
        const state = editorStore.getState();
        state.endTransform();
        transformStartRef.current = null;
      })
      .onFinalize(() => {
        transformStartRef.current = null;
      });
  }, [viewport, editorStore]);

  const buildEyedropperGesture = useCallback((): GestureType => {
    return Gesture.Tap().runOnJS(true).onEnd((e) => {
      // FR-47: Sample color at tap point via SkiaRenderAdapter.hitTest.
      // In the local-only phase, hitTest identifies the layer at the tap
      // point. Full color sampling requires reading pixel data from the
      // Skia surface — deferred to canvas-skia adapter enhancement.
      const adapter = viewport.adapterRef.current;
      if (!adapter) return;

      const state = editorStore.getState();
      const doc = state.document;
      if (!doc) return;

      // Convert tap to document space for hit-testing.
      const _docPt = toDoc(viewport.ref.current, e.x, e.y);

      // TODO(canvas-skia): sample composited color at docPt from the
      // Skia surface and update brush color:
      // const color = adapter.sampleColor(docPt.x, docPt.y);
      // state.setBrush({ color });
      void _docPt;
    });
  }, [viewport, editorStore]);

  const buildDisabledGesture = useCallback((): GestureType => {
    // Default / pan / unknown tool: disabled gesture passes through to
    // the navigation layer in the Gesture.Exclusive tree.
    return Gesture.Pan().enabled(false);
  }, []);

  // ---- Public API ----

  const forTool = useCallback(
    (tool: EditorTool): GestureType => {
      switch (tool) {
        case 'brush':
        case 'eraser':
          return buildBrushGesture();
        case 'lasso':
          return buildLassoGesture();
        case 'rect-select':
          return buildRectSelectGesture();
        case 'transform':
          return buildTransformGesture();
        case 'eyedropper':
          return buildEyedropperGesture();
        case 'pan':
        default:
          return buildDisabledGesture();
      }
    },
    [
      buildBrushGesture,
      buildLassoGesture,
      buildRectSelectGesture,
      buildTransformGesture,
      buildEyedropperGesture,
      buildDisabledGesture,
    ],
  );

  return useMemo(() => ({ forTool }), [forTool]);
}
