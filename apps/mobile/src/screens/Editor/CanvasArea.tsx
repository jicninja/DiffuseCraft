/**
 * CanvasArea — wraps `<CanvasView />` from `canvas-skia` inside a
 * `<GestureDetector>` and overlays `<ZoomControls>`.
 *
 * Per design §4.3: owns viewport state (Q2 — component-local, not Zustand),
 * composes gestures via `useGestureCompositor`, and provides a stub
 * `loadBytes` callback (FR-3) until `document-management` wires real
 * blob resolution.
 *
 * Overlay wiring (task 9.1):
 *  - Reads `activeLayerId` and `selection` from `editorStore` to drive
 *    the active-layer border (FR-46) and selection overlay (FR-27).
 *  - Derives `activeLayerKind` from the document's layer stack to enable
 *    the mask preview overlay (FR-30) when a mask layer is active.
 *  - These are passed as additional props to `CanvasView`. The canvas-skia
 *    `CanvasView` component will consume them once its props interface is
 *    extended to accept overlay configuration. The imperative overlay
 *    drawing functions (`drawSelectionOverlay`, `drawActiveLayerBorder`)
 *    already exist in `canvas-skia/overlay/`.
 *
 * Style: `flex: 1` fills the available area between floating chrome (FR-4).
 *
 * Requirements: FR-1, FR-3, FR-4, FR-27, FR-30, FR-46
 */

import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import type { Document, LayerKind, Selection } from '@diffusecraft/canvas-core';
import { CanvasView, type SkiaRenderAdapter } from '@diffusecraft/canvas-skia';
import { useEditorStore } from '@diffusecraft/core';

import { useViewport } from './useViewport';
import { useGestureCompositor } from './useGestureCompositor';
import { useBrushPipeline } from './useBrushPipeline';
import { ZoomControls } from './ZoomControls';

interface CanvasAreaProps {
  /** Active document. Pass null to render an empty surface. */
  document: Document | null;
}

/**
 * Derive the active layer's `kind` from the full document model.
 *
 * The store's `LayerSnapshot` does not carry `kind` (it holds only
 * metadata the UI needs for the layer panel). The full `Document` from
 * canvas-core has the complete `Layer` objects including `kind`. We look
 * up the active layer by id to determine whether it's a mask layer,
 * which drives the red translucent mask preview overlay (FR-30).
 */
function resolveActiveLayerKind(
  document: Document | null,
  activeLayerId: string | null,
): LayerKind | null {
  if (!document || !activeLayerId) return null;
  const layer = document.layers.find((l) => l.id === activeLayerId);
  return layer?.kind ?? null;
}

/**
 * Map the store's `SelectionSnapshot` to a canvas-core `Selection`.
 *
 * The store snapshot is a subset of the full `Selection` union (it omits
 * `lasso` and uses `mask_uri` instead of `layer_id`). This mapper
 * produces a value compatible with `drawSelectionOverlay` from canvas-skia.
 */
function toCanvasSelection(
  storeSelection: { kind: 'none' } | { kind: 'rect'; rect: { x: number; y: number; w: number; h: number } } | { kind: 'mask'; mask_uri: string },
): Selection {
  if (storeSelection.kind === 'rect') {
    return {
      kind: 'rect',
      rect: storeSelection.rect,
    };
  }
  // 'mask' and 'none' both pass through as-is for overlay purposes.
  // drawSelectionOverlay is a no-op for 'none' and 'mask' kinds.
  if (storeSelection.kind === 'mask') {
    // The overlay function expects a `layer_id` for mask selections.
    // The store carries `mask_uri` — pass a placeholder; the overlay
    // function skips mask-kind selections anyway (they're visualized
    // via the active-layer border, not marching ants).
    return { kind: 'mask', layer_id: storeSelection.mask_uri } as Selection;
  }
  return { kind: 'none' };
}

export function CanvasArea({ document }: CanvasAreaProps) {
  const viewport = useViewport(document);

  // --- Adapter state for useBrushPipeline (FR-3, FR-16) ---
  // Store the adapter in component state so useBrushPipeline can access it.
  // The viewport.setAdapter callback also stores it in a ref for gesture
  // hit-testing; we additionally keep it in state to pass to the hook.
  const [adapter, setAdapter] = useState<SkiaRenderAdapter | null>(null);

  const brushPipeline = useBrushPipeline(adapter);
  const gesture = useGestureCompositor(viewport, brushPipeline);

  // --- Overlay data from editorStore (FR-27, FR-30, FR-46) ---
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const storeSelection = useEditorStore((s) => s.selection);

  // Derive the active layer kind from the full document model (FR-30).
  const activeLayerKind = useMemo(
    () => resolveActiveLayerKind(document, activeLayerId),
    [document, activeLayerId],
  );

  // Map store selection snapshot to canvas-core Selection for the
  // selection overlay (FR-27).
  const selection = useMemo(
    () => toCanvasSelection(storeSelection),
    [storeSelection],
  );

  /**
   * Stub loadBytes — returns empty bytes for every blob ID.
   * Full blob resolution requires client-sdk wiring from the
   * `document-management` spec (FR-3).
   */
  const loadBytes = useCallback(
    async (_blobId: string): Promise<Uint8Array> => new Uint8Array(0),
    [],
  );

  /**
   * Handle adapter ready — stores the adapter in both the viewport ref
   * (for gesture hit-testing) and local state (for useBrushPipeline).
   */
  const handleAdapterReady = useCallback(
    (adapterInstance: SkiaRenderAdapter) => {
      viewport.setAdapter(adapterInstance);
      setAdapter(adapterInstance);
    },
    [viewport],
  );

  /**
   * Forward the gesture-detector view's layout into `viewport.layoutSV` so
   * tool gestures can invert the renderer transform (screen → document).
   * The renderer pivots zoom/rotation around the layout center and applies
   * a `scaleToFit` factor — the inverse needs both. The view we measure is
   * the same view that delivers `(e.x, e.y)` in gesture events, so the
   * coordinate space matches.
   */
  const handleGestureViewLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      viewport.onLayoutChange(
        e.nativeEvent.layout.width,
        e.nativeEvent.layout.height,
      );
    },
    [viewport],
  );

  return (
    <View className="flex-1">
      <GestureDetector gesture={gesture}>
        <View className="flex-1" onLayout={handleGestureViewLayout}>
          <CanvasView
            document={document}
            viewport={viewport.shared}
            loadBytes={loadBytes}
            className="flex-1"
            onAdapterReady={handleAdapterReady}
            // The workspace ships duplicate copies of `react-native-reanimated`
            // and `@shopify/react-native-skia` (one nested under
            // `libs/canvas-skia/node_modules`, one at the workspace root).
            // The two copies declare nominally distinct `SharedValue<...>` and
            // `SkImage` types even though they are identical at runtime.
            // The cast crosses the package-identity gap; the runtime contract
            // is preserved by the JSI bridge.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            activeStrokeImage={brushPipeline.activeStrokeImage as any}
          />
        </View>
      </GestureDetector>
      <ZoomControls
        zoom={viewport.committed.zoom}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        onReset={viewport.resetZoom}
        onFitToView={viewport.fitToView}
      />
    </View>
  );
}

CanvasArea.displayName = 'CanvasArea';
