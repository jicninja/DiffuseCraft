/**
 * useViewport — manages viewport state for the Editor canvas.
 *
 * Per design §4.4 (Q2): viewport lives in component-local state, NOT in
 * Zustand, because it changes at gesture frequency (60 Hz). A `useRef`
 * holds the live value mutated during gestures (no re-render), and a
 * `useState` holds the committed value that triggers React re-renders
 * when a gesture ends or a button is pressed.
 *
 * All viewport mutations use pure helpers from `@diffusecraft/canvas-core`
 * (`zoomBy`, `panBy`, `rotateBy`, `identityViewport`).
 *
 * Requirements: FR-19, FR-20, FR-21, FR-39, FR-40, FR-41, FR-42
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  identityViewport,
  zoomBy,
  type Viewport,
  type Document,
} from '@diffusecraft/canvas-core';
import type { SkiaRenderAdapter } from '@diffusecraft/canvas-skia';

/** Fixed zoom step for button controls (FR-39, FR-40). */
const ZOOM_STEP = 1.25;

/** Padding in viewport pixels when fitting document to view (FR-42). */
const FIT_PADDING = 32;

export function useViewport(document: Document | null) {
  const ref = useRef<Viewport>(identityViewport());
  const [committed, setCommitted] = useState<Viewport>(identityViewport);
  const adapterRef = useRef<SkiaRenderAdapter | null>(null);

  /**
   * Called at gesture frequency (60 Hz) — mutates the ref only, no
   * React re-render. The gesture compositor feeds viewport deltas here
   * so the Skia adapter can read `ref.current` for smooth rendering.
   */
  const updateDuringGesture = useCallback(
    (updater: (v: Viewport) => Viewport) => {
      ref.current = updater(ref.current);
    },
    [],
  );

  /**
   * Called on gesture end — copies the ref value into React state,
   * triggering a re-render so `<CanvasView>` receives the final viewport.
   */
  const commit = useCallback(() => {
    setCommitted({ ...ref.current });
  }, []);

  /** FR-39: Zoom in by ×1.25. */
  const zoomIn = useCallback(() => {
    ref.current = zoomBy(ref.current, ZOOM_STEP);
    commit();
  }, [commit]);

  /** FR-40: Zoom out by ÷1.25. */
  const zoomOut = useCallback(() => {
    ref.current = zoomBy(ref.current, 1 / ZOOM_STEP);
    commit();
  }, [commit]);

  /** FR-41: Reset viewport to identity (100%, no pan, no rotation). */
  const resetZoom = useCallback(() => {
    ref.current = identityViewport();
    commit();
  }, [commit]);

  /**
   * FR-42: Fit the document within the available container area with
   * padding. Without a measured container size we use the document
   * dimensions to compute a scale that keeps the full document visible.
   * A real container measurement can be wired later via `onLayout`.
   */
  const fitToView = useCallback(
    (containerWidth?: number, containerHeight?: number) => {
      if (!document) return;

      // When container dimensions are not provided, reset to identity as a
      // safe fallback — the document fills the viewport at 1:1.
      if (
        containerWidth === undefined ||
        containerHeight === undefined ||
        containerWidth <= 0 ||
        containerHeight <= 0
      ) {
        ref.current = identityViewport();
        commit();
        return;
      }

      const availableW = containerWidth - FIT_PADDING * 2;
      const availableH = containerHeight - FIT_PADDING * 2;

      const scaleX = availableW / document.width;
      const scaleY = availableH / document.height;
      const zoom = Math.min(scaleX, scaleY);

      // Center the document in the container.
      const panX = (containerWidth - document.width * zoom) / 2;
      const panY = (containerHeight - document.height * zoom) / 2;

      ref.current = {
        zoom,
        pan_x: panX,
        pan_y: panY,
        rotation_degrees: 0,
      };
      commit();
    },
    [document, commit],
  );

  /** Store the SkiaRenderAdapter ref for hit-testing from gesture handlers. */
  const setAdapter = useCallback((adapter: SkiaRenderAdapter) => {
    adapterRef.current = adapter;
  }, []);

  // Memoize the return object so consumers (gesture compositor, effects)
  // see a stable identity. Without this, every render of the Editor would
  // produce a fresh `viewport` object, causing downstream callbacks and
  // gestures to be rebuilt at gesture frequency (60 Hz) — and triggering
  // `useEffect` cleanups in CanvasView that tear down the offscreen surface
  // mid-stroke.
  return useMemo(
    () => ({
      ref,
      committed,
      adapterRef,
      updateDuringGesture,
      commit,
      zoomIn,
      zoomOut,
      resetZoom,
      fitToView,
      setAdapter,
    }),
    [
      committed,
      updateDuringGesture,
      commit,
      zoomIn,
      zoomOut,
      resetZoom,
      fitToView,
      setAdapter,
    ],
  );
}
