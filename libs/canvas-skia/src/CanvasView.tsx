/**
 * `<CanvasView />` — React Native host for the SkiaRenderAdapter.
 *
 * Visual hierarchy (top to bottom of the visible composite):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ <Canvas>                                                     │
 *   │   <Fill color=#1a1a1a/>          ← editor backdrop            │
 *   │   <Group transform={viewport}>                                │
 *   │     <Rect ... color=white/>      ← document paper             │
 *   │     <Image image={layer1.shared}/> ← persistent paint surface │
 *   │     <Image image={layer2.shared}/>                            │
 *   │     ...                                                       │
 *   │     <Picture picture={activePicture}/> ← in-progress stroke   │
 *   │   </Group>                                                    │
 *   │ </Canvas>                                                     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * **Key invariants** (Req 2.3, 2.4, 9.5):
 *  - The underlying `<Canvas>` is mounted **once** for the editor session.
 *    A lazy `useRef` instantiates the adapter exactly once; React 18
 *    `useMemo` is not a semantic guarantee, so `useRef` is the right tool
 *    here — recreating the adapter mid-stroke would tear down the per-layer
 *    surface registry and lose the in-progress stroke.
 *  - During an active stroke, the per-layer `<Image>` chain does **not**
 *    re-render React: each `<Image>`'s `image` prop is a
 *    `SharedValue<SkImage | null>` owned by `layerSurfaces`; RN-Skia
 *    subscribes via JSI and repaints on the GPU thread without invoking
 *    React's reconciler.
 *  - The active `<Picture>` element is mounted only when the
 *    `activePicture` SharedValue is provided **and** carries a non-null
 *    value. The legacy `EMPTY_PICTURE` sentinel is gone — we conditionally
 *    mount the element instead.
 *  - Viewport pan / zoom / rotation are applied on the single `<Group>`
 *    surrounding the layer chain. Viewport changes between strokes never
 *    invalidate any committed pixel data; only the transform updates.
 *
 * Document-level export (multi-layer flatten + encode) is **not** provided
 * by this library. `client-sdk` composes layer images via
 * `adapter.layerSurfaces.readLayerImage(layerId)` plus the blob image
 * cache; the editor's tablet-side rendering path renders through this
 * component only.
 */

import type { Document, Layer, Viewport } from '@diffusecraft/canvas-core';
import {
  Canvas,
  Fill,
  Group,
  Image,
  Rect,
  type SkImage,
} from '@shopify/react-native-skia';

/**
 * Local alias for the subset of RN-Skia's `Transforms3d` that this
 * component actually emits. RN-Skia's public type lives in a deeply
 * re-exported file (`skia/types/Matrix4`) that some workspace setups do
 * not surface through the package root; declaring the shape locally
 * avoids depending on that re-export chain. The runtime contract is
 * identical — RN-Skia accepts an array of single-key transform records.
 */
type GroupTransform = Array<
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { rotate: number }
>;
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { SkiaRenderAdapter, type SkiaRenderAdapterOptions } from './adapter';

export interface CanvasViewProps {
  /** Active document. Pass null to render an empty surface. */
  document: Document | null;
  /**
   * Live viewport on the UI thread. RN-Skia subscribes to the SharedValue
   * via JSI and repaints on the GPU thread when its value changes — no
   * React re-render is involved during pan / zoom / rotate gestures.
   *
   * The transform is derived from `(layout, document, viewport.value)` via
   * `useDerivedValue`, so it also reactively re-emits on layout changes
   * (re-render) and viewport mutations (UI-thread reactive).
   */
  viewport: SharedValue<Viewport>;
  /** Resolve raw bytes for a content_blob_id. */
  loadBytes: SkiaRenderAdapterOptions['loadBytes'];
  /** Container style. */
  style?: ViewStyle;
  /** NativeWind className. */
  className?: string;
  /** Callback fired once the adapter exists. */
  onAdapterReady?: (adapter: SkiaRenderAdapter) => void;
  /**
   * Snapshot of the active stroke surface produced by `useBrushPipeline`
   * (Phase 5). Carries `null` when no stroke is in progress; carries a
   * fresh `SkImage` per touch event during a stroke. RN-Skia's `<Image>`
   * element subscribes to the SharedValue by JSI and repaints on the GPU
   * thread; React renders are not involved. Null values render nothing
   * for that frame, matching the per-layer `<Image>` chain's behaviour.
   */
  activeStrokeImage?: SharedValue<SkImage | null>;
  /**
   * Optional per-layer opacity SharedValue resolver. When provided, the
   * `<Group opacity={…}>` wrapper around each layer's image binds to the
   * returned SharedValue instead of reading the static `Layer.opacity`
   * snapshot from the document. RN-Skia subscribes via JSI, so opacity
   * changes repaint on the next vsync without waiting for the host app
   * to commit a new document through React.
   *
   * Callers that don't need real-time opacity (e.g., a renderer that
   * only displays a frozen document) can omit this prop; the default
   * path falls back to `layer.opacity`.
   */
  getLayerOpacity?: (layerId: string) => SharedValue<number>;
}

/**
 * Identity transforms3d — used when layout / document are not yet known.
 * Returning a stable empty array keeps `<Group transform>` valid and
 * paint-safe before first layout.
 */
const IDENTITY_TRANSFORM: GroupTransform = [];

/**
 * Visible paint layers ordered bottom-to-top (lowest `position` first), so
 * the JSX renders them in the order Skia composites them. Mask / control /
 * region layers are excluded from the visible composite — they are
 * consumed by their owning specs (mask-system, control-layers).
 */
function visiblePaintLayers(doc: Document): Layer[] {
  const out: Layer[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (layer.kind !== 'paint') continue;
    out.push(layer);
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  document,
  viewport,
  loadBytes,
  style,
  className,
  onAdapterReady,
  activeStrokeImage,
  getLayerOpacity,
}) => {
  // Adapter must be a single, stable instance for the entire lifetime of
  // this component. `useMemo` is not a semantic guarantee in React 18 — it
  // may recompute even with unchanged deps, which would silently invalidate
  // the per-layer surface registry mid-stroke. A lazy ref guarantees one-
  // and-only-one instance per mount.
  const loadBytesRef = useRef(loadBytes);
  loadBytesRef.current = loadBytes;
  const adapterRef = useRef<SkiaRenderAdapter | null>(null);
  if (adapterRef.current === null) {
    adapterRef.current = new SkiaRenderAdapter({
      loadBytes: (id) => loadBytesRef.current(id),
    });
  }
  const adapter = adapterRef.current;

  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);

  // Notify parent of adapter. Re-fires if `onAdapterReady` identity changes,
  // but has NO cleanup — releasing it mid-render would tear down in-progress
  // brush strokes.
  useEffect(() => {
    onAdapterReady?.(adapter);
  }, [adapter, onAdapterReady]);

  // Cleanup adapter resources only on unmount.
  useEffect(() => {
    return () => {
      adapter.disposeCache();
    };
  }, [adapter]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  const docWidth = document?.width ?? 0;
  const docHeight = document?.height ?? 0;

  // Reactive transform: re-emits on any of:
  //   - viewport.value mutations (UI-thread reactive subscription)
  //   - layout / document size changes (closure rebinds on re-render)
  // RN-Skia's `<Group transform>` subscribes to this SharedValue via JSI
  // and repaints on the GPU thread without engaging React.
  //
  // Composition (right-to-left, applied to a document-space point P):
  //   1. Translate doc center to origin:           [translate(-docCenter)]
  //   2. Apply zoom (scaleToFit baked in):         [scale(totalScale)]
  //   3. Rotate around origin:                     [rotate(theta)]
  //   4. Translate to layout center + viewport pan: [translate(layoutCenter + pan*scaleToFit)]
  //
  // This makes pinch zoom and rotation pivot around the layout center —
  // a sensible default for tablet UX. Pan is in canvas pixels (the same
  // units as the document), scaled by `scaleToFit` so pan magnitudes feel
  // consistent across documents of different sizes.
  const transform = useDerivedValue<GroupTransform>(() => {
    if (!layout || docWidth <= 0 || docHeight <= 0) {
      return IDENTITY_TRANSFORM;
    }
    const v = viewport.value;
    const scaleToFit = Math.min(layout.width / docWidth, layout.height / docHeight);
    const totalScale = scaleToFit * v.zoom;
    const layoutCenterX = layout.width / 2;
    const layoutCenterY = layout.height / 2;
    const docCenterX = docWidth / 2;
    const docCenterY = docHeight / 2;
    const tx = layoutCenterX + v.pan_x * scaleToFit;
    const ty = layoutCenterY + v.pan_y * scaleToFit;
    const theta = (v.rotation_degrees * Math.PI) / 180;
    return [
      { translateX: tx },
      { translateY: ty },
      { rotate: theta },
      { scale: totalScale },
      { translateX: -docCenterX },
      { translateY: -docCenterY },
    ];
  }, [layout?.width, layout?.height, docWidth, docHeight]);

  const hasContent = !!layout && docWidth > 0 && docHeight > 0 && !!document;

  // Memoize the visible-paint-layers list so the JSX iteration receives a
  // stable array unless `document.layers` actually changes. Each iteration
  // still subscribes to its layer's SharedValue<SkImage> via the registry,
  // so subscriptions survive identity churn on the array itself.
  const layers = useMemo(
    () => (document ? visiblePaintLayers(document) : []),
    [document],
  );

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error nativewind augments View with `className` at runtime;
    // the augmentation is configured globally in apps/mobile but not in this
    // standalone lib's tsconfig, so the intrinsic prop type does not yet
    // know about `className`. Kept identical to the pre-existing baseline.
    <View style={style} className={className} onLayout={onLayout}>
      <Canvas style={{ flex: 1 }}>
        {/* Canvas background (area outside the document paper). */}
        <Fill color="#1a1a1a" />

        {/* Document-space content: paper + per-layer image chain + the
            in-progress stroke overlay. The viewport transform is applied
            once on the surrounding <Group> via a SharedValue<Transforms3d>
            — RN-Skia subscribes via JSI and repaints on the GPU thread
            when viewport or layout changes, with no React re-render. */}
        {hasContent && document && (
          <Group
            transform={
              // SharedValue<GroupTransform> passed where RN-Skia's `SkiaProps`
              // accepts a reactive prop. Same cast pattern used below for
              // `image={... as unknown as SkImage}` — RN-Skia detects the
              // `.value` property via JSI and subscribes for repaints. The
              // structural shape matches RN-Skia's internal `Transforms3d`.
              transform as unknown as GroupTransform
            }
          >
            {/* Document paper — the white rectangle every editor renders
                beneath the layer stack. */}
            <Rect x={0} y={0} width={docWidth} height={docHeight} color="white" />

            {/* Per-layer persistent raster chain. Each <Image>'s `image`
                prop is a SharedValue<SkImage | null> owned by the layer
                surface registry; RN-Skia subscribes by JSI and repaints
                without engaging React.

                The cast is necessary because RN-Skia 2.6's `SkiaProps<T>`
                models reactive props as `T | { value: T }` — structurally
                compatible with Reanimated's SharedValue, but TypeScript
                does not infer the structural-arm assignment when the
                target is a union containing `null` (it picks the SkImage
                arm and reports the missing fields). At runtime RN-Skia
                detects the `.value` property via JSI and subscribes
                correctly; the cast is a static-only escape hatch. */}
            {layers.map((layer) => {
              // Per-layer opacity — `Layer.opacity` is a 0..1 multiplier
              // applied to every pixel before this layer composites over
              // the layers beneath it. We wrap the `<Image>` in a `<Group
              // opacity={...}>` because RN-Skia 2.6's `ImageProps` type
              // does not expose `opacity`, while `<Group>` does and
              // applies it uniformly to its descendants.
              //
              // When `getLayerOpacity` is provided, the prop binds to a
              // `SharedValue<number>` and RN-Skia subscribes via JSI —
              // slider drags repaint on the next vsync without waiting
              // for React to commit a new document state. Otherwise we
              // fall back to the static `layer.opacity` from the doc.
              const opacityProp = getLayerOpacity
                ? (getLayerOpacity(layer.id) as unknown as number)
                : layer.opacity;
              return (
                <Group key={layer.id} opacity={opacityProp}>
                  <Image
                    image={adapter.layerSurfaces.imageFor(layer.id) as unknown as SkImage}
                    x={0}
                    y={0}
                    width={docWidth}
                    height={docHeight}
                  />
                </Group>
              );
            })}

            {/* In-progress active stroke. Mounted whenever the producer
                (useBrushPipeline) provides the SharedValue. The SharedValue
                holds `null` between strokes and a fresh `SkImage` per touch
                event during a stroke. RN-Skia's `<Image>` tolerates a null
                value and renders nothing for that frame.

                The cast is necessary because RN-Skia's `SkiaProps<T>` does
                not infer the structural-arm assignment for SharedValue when
                the target type is a union containing `null` — runtime
                behaviour is correct (RN-Skia detects the `.value` property
                via JSI). */}
            {activeStrokeImage ? (
              <Image
                image={activeStrokeImage as unknown as SkImage}
                x={0}
                y={0}
                width={docWidth}
                height={docHeight}
              />
            ) : null}
          </Group>
        )}
      </Canvas>
    </View>
  );
};

CanvasView.displayName = 'CanvasView';
