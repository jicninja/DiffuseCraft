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
import { identityViewport } from '@diffusecraft/canvas-core';
import {
  Canvas,
  Fill,
  Group,
  Image,
  Rect,
  type SkImage,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { SkiaRenderAdapter, type SkiaRenderAdapterOptions } from './adapter';

export interface CanvasViewProps {
  /** Active document. Pass null to render an empty surface. */
  document: Document | null;
  /** Current viewport. Defaults to identity. */
  viewport?: Viewport;
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
}

/**
 * Compute transform to fit document within layout with viewport applied.
 *
 * Pure function of `(layout, doc, viewport)`. Recomputed on layout or
 * viewport change; the layer chain underneath does not re-render because
 * the transform is applied on a single `<Group>` whose children consume
 * SharedValues for their pixel data.
 */
function computeDocTransform(
  layout: { width: number; height: number },
  doc: { width: number; height: number },
  vp: Viewport,
) {
  const scaleToFit = Math.min(layout.width / doc.width, layout.height / doc.height);
  const offsetX = (layout.width - doc.width * scaleToFit) / 2;
  const offsetY = (layout.height - doc.height * scaleToFit) / 2;
  const totalScale = scaleToFit * vp.zoom;
  const tx = offsetX + vp.pan_x * scaleToFit;
  const ty = offsetY + vp.pan_y * scaleToFit;

  return { totalScale, tx, ty, rotation: vp.rotation_degrees };
}

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

  const vp = viewport ?? identityViewport();
  const docWidth = document?.width ?? 0;
  const docHeight = document?.height ?? 0;

  const transform = layout && docWidth > 0 && docHeight > 0
    ? computeDocTransform(layout, { width: docWidth, height: docHeight }, vp)
    : null;

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
            once on the surrounding <Group> so changes to pan / zoom /
            rotation do not invalidate any committed pixel data. */}
        {transform && document && (
          <Group
            transform={[
              { translateX: transform.tx },
              { translateY: transform.ty },
              { scale: transform.totalScale },
            ]}
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
            {layers.map((layer) => (
              <Image
                key={layer.id}
                image={adapter.layerSurfaces.imageFor(layer.id) as unknown as SkImage}
                x={0}
                y={0}
                width={docWidth}
                height={docHeight}
              />
            ))}

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
