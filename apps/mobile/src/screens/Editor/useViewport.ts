/**
 * useViewport — manages viewport state for the Editor canvas.
 *
 * Per design §4.4 (Q2): viewport changes at gesture frequency (60 Hz) and
 * MUST NOT trip a React re-render or a Zustand mutation per frame.
 *
 * Two storage tiers:
 *   - `shared`    : `SharedValue<Viewport>` — the live value mutated during
 *                   gestures and read by `<Group transform>` via JSI on the
 *                   UI thread, so RN-Skia repaints on the GPU thread without
 *                   engaging React.
 *   - `committed` : React state — only updated on gesture release or button
 *                   press. Drives `<ZoomControls>` (the "100%" indicator)
 *                   and any other consumer that needs a stable identity.
 *
 * Per `feedback_skia_api_versions`: every gesture in this folder runs with
 * `.runOnJS(true)`, so the gesture callbacks mutate `shared.value` from the
 * JS thread; RN-Skia subscribes via JSI and repaints regardless of which
 * thread wrote the value.
 *
 * `ref` is a compat getter shim for code that still reads `viewport.ref.current`
 * (notably `useToolGestures` for hit-testing). Reading `ref.current` returns
 * the current `shared.value`.
 *
 * Requirements: FR-19, FR-20, FR-21, FR-39, FR-40, FR-41, FR-42
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
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
  const shared = useSharedValue<Viewport>(identityViewport());
  // Live layout dimensions of the gesture-detector view. Tool gestures
  // need this to invert the renderer transform (screen → document) — the
  // renderer pivots around `layoutCenter` and applies a `scaleToFit` factor
  // derived from layout vs document size, so the inverse must know layout.
  // Worklet-readable so the brush hot path can use it without crossing
  // threads.
  const layoutSV = useSharedValue<{ width: number; height: number } | null>(null);
  const [committed, setCommitted] = useState<Viewport>(identityViewport);
  const adapterRef = useRef<SkiaRenderAdapter | null>(null);

  // Compat shim for hit-testing call sites that read `viewport.ref.current`.
  // Returns the live SharedValue — same semantics as the previous useRef.
  const ref = useMemo(
    () => ({
      get current(): Viewport {
        return shared.value;
      },
    }),
    [shared],
  );

  /**
   * Called at gesture frequency (60 Hz) — mutates the SharedValue only.
   * RN-Skia's `<Group>` repaints via its JSI subscription; React is not
   * notified.
   */
  const updateDuringGesture = useCallback(
    (updater: (v: Viewport) => Viewport) => {
      shared.value = updater(shared.value);
    },
    [shared],
  );

  /**
   * Called on gesture end — copies the live viewport into React state so
   * consumers like `<ZoomControls>` reflect the final value.
   */
  const commit = useCallback(() => {
    setCommitted({ ...shared.value });
  }, [shared]);

  /** FR-39: Zoom in by ×1.25. */
  const zoomIn = useCallback(() => {
    const next = zoomBy(shared.value, ZOOM_STEP);
    shared.value = next;
    setCommitted({ ...next });
  }, [shared]);

  /** FR-40: Zoom out by ÷1.25. */
  const zoomOut = useCallback(() => {
    const next = zoomBy(shared.value, 1 / ZOOM_STEP);
    shared.value = next;
    setCommitted({ ...next });
  }, [shared]);

  /** FR-41: Reset viewport to identity (100%, no pan, no rotation). */
  const resetZoom = useCallback(() => {
    const next = identityViewport();
    shared.value = next;
    setCommitted(next);
  }, [shared]);

  /**
   * FR-42: Fit the document within the available container area with
   * padding. Without measured dimensions, falls back to identity so the
   * document fills the viewport at 1:1.
   */
  const fitToView = useCallback(
    (containerWidth?: number, containerHeight?: number) => {
      if (!document) return;

      if (
        containerWidth === undefined ||
        containerHeight === undefined ||
        containerWidth <= 0 ||
        containerHeight <= 0
      ) {
        const next = identityViewport();
        shared.value = next;
        setCommitted(next);
        return;
      }

      const availableW = containerWidth - FIT_PADDING * 2;
      const availableH = containerHeight - FIT_PADDING * 2;

      const scaleX = availableW / document.width;
      const scaleY = availableH / document.height;
      const zoom = Math.min(scaleX, scaleY);

      const panX = (containerWidth - document.width * zoom) / 2;
      const panY = (containerHeight - document.height * zoom) / 2;

      const next: Viewport = {
        zoom,
        pan_x: panX,
        pan_y: panY,
        rotation_degrees: 0,
      };
      shared.value = next;
      setCommitted(next);
    },
    [document, shared],
  );

  /** Store the SkiaRenderAdapter ref for hit-testing from gesture handlers. */
  const setAdapter = useCallback((adapter: SkiaRenderAdapter) => {
    adapterRef.current = adapter;
  }, []);

  /**
   * Push the latest layout of the gesture-detector view into `layoutSV`.
   * Called from CanvasArea's outer `<View onLayout>` so the value matches
   * the coordinate space of gesture event `(e.x, e.y)` deliveries.
   */
  const onLayoutChange = useCallback(
    (width: number, height: number) => {
      layoutSV.value = { width, height };
    },
    [layoutSV],
  );

  return useMemo(
    () => ({
      shared,
      layoutSV,
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
      onLayoutChange,
    }),
    [
      shared,
      layoutSV,
      ref,
      committed,
      updateDuringGesture,
      commit,
      zoomIn,
      zoomOut,
      resetZoom,
      fitToView,
      setAdapter,
      onLayoutChange,
    ],
  );
}
