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
 *
 * Undo/redo is `Gesture.Race(twoFingerTap, threeFingerTap)` — whichever
 * fires first wins.
 *
 * The composed gesture is memoized and recomputed when `activeTool` changes.
 *
 * Requirements: FR-31, FR-32, FR-34, FR-35, FR-48
 */

import { useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { ComposedGesture } from 'react-native-gesture-handler';
import { useEditorStore, useUndoRedo } from '@diffusecraft/core';
import {
  zoomBy,
  panBy,
  rotateBy,
} from '@diffusecraft/canvas-core';

import { useToolGestures } from './useToolGestures';
import { type BrushPipelineHandle } from './useBrushPipeline';
import type { useViewport } from './useViewport';

/**
 * Viewport handle — the subset of `useViewport` return value that the
 * gesture compositor needs. Kept structural so the hook doesn't depend
 * on the full viewport object identity.
 */
type ViewportHandle = Pick<
  ReturnType<typeof useViewport>,
  'ref' | 'adapterRef' | 'updateDuringGesture' | 'commit'
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

  // Track previous pan translation to compute per-frame deltas.
  // `translationX`/`translationY` are cumulative from gesture start;
  // we need the delta between consecutive onUpdate calls for `panBy`.
  const prevPanRef = useRef({ x: 0, y: 0 });

  return useMemo(() => {
    // ---- 1. Tool gesture (single-finger, active tool dependent) ----
    // Highest priority — painting, selection drawing, transform drag, etc.
    const toolGesture = toolGestures.forTool(activeTool);

    // ---- 2. Navigation gestures (two-finger) ----
    // FR-19: Pinch zoom — calls zoomBy on the viewport ref.
    const pinchZoom = Gesture.Pinch()
      .runOnJS(true)
      .onUpdate((e) => {
        const scale = Number(e.scale);
        if (!Number.isFinite(scale) || scale <= 0) return;
        viewport.updateDuringGesture((v) => zoomBy(v, scale));
      })
      .onEnd(() => {
        viewport.commit();
      });

    // FR-20: Two-finger pan — calls panBy on the viewport ref.
    // Pan events report cumulative translation, so we compute deltas
    // between consecutive updates.
    const twoPan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .onBegin(() => {
        prevPanRef.current = { x: 0, y: 0 };
      })
      .onUpdate((e) => {
        const tx = Number(e.translationX);
        const ty = Number(e.translationY);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        const dx = tx - prevPanRef.current.x;
        const dy = ty - prevPanRef.current.y;
        prevPanRef.current = { x: tx, y: ty };
        viewport.updateDuringGesture((v) => panBy(v, dx, dy));
      })
      .onEnd(() => {
        viewport.commit();
      });

    // FR-21: Two-finger rotate — calls rotateBy on the viewport ref.
    const twoRotate = Gesture.Rotation()
      .runOnJS(true)
      .onUpdate((e) => {
        const rot = Number(e.rotation);
        if (!Number.isFinite(rot)) return;
        viewport.updateDuringGesture((v) =>
          rotateBy(v, (rot * 180) / Math.PI),
        );
      })
      .onEnd(() => {
        viewport.commit();
      });

    // Navigation = simultaneous pinch + pan + rotate (standard multi-touch).
    const navigation = Gesture.Simultaneous(pinchZoom, twoPan, twoRotate);

    // ---- 3. Undo/redo taps ----
    // FR-31: Two-finger tap invokes undo().
    const undoTap = Gesture.Tap()
      .runOnJS(true)
      .minPointers(2)
      .maxDuration(UNDO_REDO_TAP_MAX_DURATION)
      .onEnd(() => {
        void undo();
      });

    // FR-32: Three-finger tap invokes redo().
    const redoTap = Gesture.Tap()
      .runOnJS(true)
      .minPointers(3)
      .maxDuration(UNDO_REDO_TAP_MAX_DURATION)
      .onEnd(() => {
        void redo();
      });

    // Race: whichever tap fires first wins.
    const undoRedoGestures = Gesture.Race(undoTap, redoTap);

    // ---- 4. Eyedropper long-press (FR-48) ----
    const eyedropperLongPress = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(EYEDROPPER_LONG_PRESS_MS)
      .onEnd((_e, success) => {
        if (!success) return;
        // TODO(canvas-skia): implement color sampling on long-press
      });

    // ---- Compose with Gesture.Exclusive ----
    return Gesture.Exclusive(
      toolGesture,
      navigation,
      undoRedoGestures,
      eyedropperLongPress,
    );
  }, [activeTool, viewport, undo, redo, toolGestures]);
}
