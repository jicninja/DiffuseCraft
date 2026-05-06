/**
 * useGestureCompositor — builds the composed gesture tree for the Editor canvas.
 *
 * Per design §4.5: builds a `Gesture.Exclusive` tree with precedence:
 *   1. Tool gestures (painting, selection, transform) — highest priority
 *   2. Navigation gestures (pinch zoom, two-finger pan, two-finger rotate)
 *   3. Undo/redo taps (two-finger tap, three-finger tap)
 *   4. Eyedropper long-press (500 ms) — lowest priority
 *
 * Q4 (resolved): once a gesture is recognized, it owns the touch sequence
 * until all fingers lift (Procreate behavior).
 *
 * Navigation is `Gesture.Simultaneous(pinchZoom, twoPan, twoRotate)` so
 * the user can pinch-zoom, pan, and rotate in a single multi-touch gesture.
 * Each handler owns one viewport field (zoom / pan / rotation) and writes
 * an absolute value derived from a snapshot taken at `onBegin`. This
 * eliminates per-frame drift and prevents the cumulative-as-delta blow-up
 * that the previous implementation suffered from.
 *
 * Per `feedback_skia_api_versions`: every gesture in `apps/mobile/src/screens/Editor/use*.ts`
 * uses `.runOnJS(true)` because callbacks may touch Zustand or React state.
 * Mutating `viewport.shared.value` from the JS thread is safe — RN-Skia
 * still subscribes via JSI and repaints on the GPU thread.
 *
 * Per project rule: store mutations (Zustand) and React state changes happen
 * on gesture release only, never per-frame. `commit()` is the release sync.
 *
 * Requirements: FR-19, FR-20, FR-21, FR-31, FR-32, FR-34, FR-35, FR-48
 */

import { useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { ComposedGesture } from 'react-native-gesture-handler';
import { useEditorStore, useUndoRedo } from '@diffusecraft/core';
import { setRotation, setZoom } from '@diffusecraft/canvas-core';

import { useToolGestures } from './useToolGestures';
import { type BrushPipelineHandle } from './useBrushPipeline';
import type { useViewport } from './useViewport';

/**
 * Viewport handle — the subset of `useViewport` return value that the
 * gesture compositor needs. `shared` is the live SharedValue updated at
 * gesture frequency; `commit` syncs the React state on release.
 */
type ViewportHandle = Pick<
  ReturnType<typeof useViewport>,
  'shared' | 'ref' | 'adapterRef' | 'layoutSV' | 'updateDuringGesture' | 'commit'
>;

/** Maximum tap duration for undo/redo recognition (ms). */
const UNDO_REDO_TAP_MAX_DURATION = 300;

/** Long-press duration for temporary eyedropper (FR-48). */
const EYEDROPPER_LONG_PRESS_MS = 500;

export function useGestureCompositor(
  viewport: ViewportHandle,
  brushPipeline: BrushPipelineHandle,
): ComposedGesture {
  const activeTool = useEditorStore((s) => s.activeTool);
  const { undo, redo } = useUndoRedo();
  const toolGestures = useToolGestures(viewport, brushPipeline);

  // Per-gesture initial-state snapshots. Captured on `onBegin`, read on
  // every `onUpdate` so the absolute viewport value is recomputed instead
  // of compounded. `e.scale` and `e.rotation` are cumulative from the start
  // of the gesture, and `e.translationX/Y` is cumulative from the first
  // touch — applying any of them as a delta would either drift (rounding
  // errors) or blow up (multiplying cumulative values frame-on-frame).
  const initialZoomRef = useRef(1);
  const initialRotationRef = useRef(0);
  const initialPanRef = useRef({ x: 0, y: 0 });

  return useMemo(() => {
    // ---- 1. Tool gesture (single-finger, active tool dependent) ----
    const toolGesture = toolGestures.forTool(activeTool);

    // ---- 2. Navigation gestures (two-finger) ----

    // FR-19: Pinch zoom. Snapshots the zoom at gesture start and writes
    // `initialZoom * e.scale` on every update — the absolute new zoom.
    const pinchZoom = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        initialZoomRef.current = viewport.shared.value.zoom;
      })
      .onUpdate((e) => {
        const scale = Number(e.scale);
        if (!Number.isFinite(scale) || scale <= 0) return;
        const target = initialZoomRef.current * scale;
        viewport.updateDuringGesture((v) => setZoom(v, target));
      })
      .onEnd(() => {
        viewport.commit();
      });

    // FR-20: Two-finger pan. Snapshots pan at gesture start and writes
    // `initialPan + cumulativeTranslation` on every update.
    const twoPan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .onBegin(() => {
        const v = viewport.shared.value;
        initialPanRef.current = { x: v.pan_x, y: v.pan_y };
      })
      .onUpdate((e) => {
        const tx = Number(e.translationX);
        const ty = Number(e.translationY);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        const targetX = initialPanRef.current.x + tx;
        const targetY = initialPanRef.current.y + ty;
        viewport.updateDuringGesture((v) => ({
          ...v,
          pan_x: targetX,
          pan_y: targetY,
        }));
      })
      .onEnd(() => {
        viewport.commit();
      });

    // FR-21: Two-finger rotate. Snapshots rotation at gesture start and
    // writes `initialRotation + e.rotation` (radians → degrees) on every
    // update. `setRotation` normalizes to (-180, 180].
    const twoRotate = Gesture.Rotation()
      .runOnJS(true)
      .onBegin(() => {
        initialRotationRef.current = viewport.shared.value.rotation_degrees;
      })
      .onUpdate((e) => {
        const rot = Number(e.rotation);
        if (!Number.isFinite(rot)) return;
        const deltaDeg = (rot * 180) / Math.PI;
        const target = initialRotationRef.current + deltaDeg;
        viewport.updateDuringGesture((v) => setRotation(v, target));
      })
      .onEnd(() => {
        viewport.commit();
      });

    const navigation = Gesture.Simultaneous(pinchZoom, twoPan, twoRotate);

    // ---- 3. Undo/redo taps ----
    const undoTap = Gesture.Tap()
      .runOnJS(true)
      .minPointers(2)
      .maxDuration(UNDO_REDO_TAP_MAX_DURATION)
      .onEnd(() => {
        void undo();
      });

    const redoTap = Gesture.Tap()
      .runOnJS(true)
      .minPointers(3)
      .maxDuration(UNDO_REDO_TAP_MAX_DURATION)
      .onEnd(() => {
        void redo();
      });

    const undoRedoGestures = Gesture.Race(undoTap, redoTap);

    // ---- 4. Eyedropper long-press (FR-48) ----
    const eyedropperLongPress = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(EYEDROPPER_LONG_PRESS_MS)
      .onEnd((_e, success) => {
        if (!success) return;
        // TODO(canvas-skia): implement color sampling on long-press
      });

    return Gesture.Exclusive(
      toolGesture,
      navigation,
      undoRedoGestures,
      eyedropperLongPress,
    );
  }, [activeTool, viewport, undo, redo, toolGestures]);
}
