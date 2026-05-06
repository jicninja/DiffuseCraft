# transform-tools — Design

> **Companion to:** `requirements.md`. **References:** `canvas-fundamentals`, `undo-redo-system`, `mcp-tool-catalog`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Corner handles preserve aspect by default.** Shift to free. Configurable via user pref. |
| Q2 | **Multi-selected layers transform as a single composite.** |
| Q3 | **Anchor at bounding-box center; draggable; resets on commit.** |
| Q4 | **Distort is a sub-mode toggle** (Transform / Distort / Skew) on the floating ring. |
| Q5 | **Axis-aligned snap targets only** in v1; rotated-edge snap post-v1. |
| Q6 | **Bilinear during gesture, full Skia on commit.** |
| Q7 | **Partial inputs accepted on `transform_layer`.** Each provided field updates; missing fields preserve. |

## 2. Module layout

```
libs/canvas-core/src/transform/
├── index.ts
├── types.ts                     # TransformDecomposed, TransformMatrix, etc.
├── matrix.ts                    # 3x3 affine + projective math
├── decompose.ts                 # decompose-recompose for round-trip
├── snap.ts                      # snap-target detection (canvas/layer/grid)
├── distort.ts                   # 4-point projective utilities
└── operations.ts                # pure functions for translate/scale/rotate/flip/skew/distort

libs/ui/src/transform/
├── TransformController.tsx      # bounding box + handles + gestures
├── handles/
│   ├── CornerHandle.tsx
│   ├── EdgeHandle.tsx
│   ├── RotationHandle.tsx
│   ├── AnchorHandle.tsx
│   └── DistortCornerHandle.tsx
├── ModifierRing.tsx             # floating ring for tablet-no-keyboard modifiers
├── TransformPanel.tsx           # numeric inputs + sub-mode picker
├── snap-overlay.tsx             # render snap guide lines
├── gestures/
│   ├── pinch-to-scale.ts
│   ├── two-finger-rotate.ts
│   ├── drag-to-translate.ts
│   ├── handle-drag.ts            # mouse + finger
│   └── modifier-state.ts         # tracks Shift/Option/Cmd from kbd or ring
└── index.tsx
```

## 3. Transform representation

```typescript
// libs/canvas-core/src/transform/types.ts
export interface TransformDecomposed {
  tx: number;         // translate X (canvas px)
  ty: number;         // translate Y
  sx: number;         // scale X (1.0 = original)
  sy: number;         // scale Y
  rotation_deg: number;
  skew_x_deg: number;
  skew_y_deg: number;
  flip_h: boolean;
  flip_v: boolean;
  anchor: { x: number; y: number };  // anchor in layer-local coords; default = center
  /** Optional 4-corner override (for Distort mode). When set, sx/sy/rotation/skew are ignored at render time and corners apply directly. */
  distort_corners?: [Point, Point, Point, Point];   // TL, TR, BR, BL
}

export type TransformMatrix = [
  number, number, number,
  number, number, number,
  number, number, number,
];   // row-major 3x3
```

## 4. Pure operations

```typescript
// libs/canvas-core/src/transform/operations.ts
export const translate = (t: TransformDecomposed, dx: number, dy: number): TransformDecomposed =>
  ({ ...t, tx: t.tx + dx, ty: t.ty + dy });

export const scale = (
  t: TransformDecomposed,
  sx: number, sy: number,
  opts?: { from_center?: boolean; preserve_aspect?: boolean }
): TransformDecomposed => {
  const finalSx = opts?.preserve_aspect ? sx : sx;
  const finalSy = opts?.preserve_aspect ? sx : sy;
  // anchor adjustment: scale "from center" means anchor stays at center; otherwise anchor stays at corner
  return { ...t, sx: t.sx * finalSx, sy: t.sy * finalSy };
};

export const rotate = (t: TransformDecomposed, deg: number): TransformDecomposed =>
  ({ ...t, rotation_deg: (t.rotation_deg + deg) % 360 });

export const flip = (t: TransformDecomposed, axis: "h" | "v"): TransformDecomposed =>
  axis === "h" ? { ...t, flip_h: !t.flip_h } : { ...t, flip_v: !t.flip_v };

export const skew = (t: TransformDecomposed, dx: number, dy: number): TransformDecomposed =>
  ({ ...t, skew_x_deg: t.skew_x_deg + dx, skew_y_deg: t.skew_y_deg + dy });

export const distortFourCorner = (t: TransformDecomposed, corners: [Point, Point, Point, Point]): TransformDecomposed =>
  ({ ...t, distort_corners: corners });

export const reset = (): TransformDecomposed =>
  ({ tx: 0, ty: 0, sx: 1, sy: 1, rotation_deg: 0, skew_x_deg: 0, skew_y_deg: 0, flip_h: false, flip_v: false, anchor: { x: 0.5, y: 0.5 } });
```

All operations return new `TransformDecomposed` (immutable). Composition into ComfyUI graphs happens via `decompose.ts` → matrix → render-time application.

## 5. The handler with reversible Command

```typescript
// libs/server/src/lib/handlers/transform-layer.ts
export const transformLayerHandler: Handler<typeof transformLayer> = async (input, ctx) => {
  const document_id = input.document_id ?? ctx.activeDocumentId;
  const layer = await ctx.layers.get(document_id, input.layer_id);
  const previousTransform = layer.transform;
  const newTransform = mergeTransform(previousTransform, input.transform);   // partial-input support (Q7)

  const command = buildCommand({
    tool_name: "transform_layer",
    document_id,
    args_summary: `Transform: ${summarizeTransform(input.transform)}`,
    weight: "small",
    apply: async () => {
      await ctx.layers.update(document_id, input.layer_id, { transform: newTransform });
      return { layer_id: input.layer_id, transform: newTransform };
    },
    revert: async () => {
      await ctx.layers.update(document_id, input.layer_id, { transform: previousTransform });
    },
  });

  return ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, document_id, command);
};
```

Group transform handler captures pre-state of all child layers in one Command (revert restores all).

## 6. Tablet TransformController component

```typescript
// libs/ui/src/transform/TransformController.tsx
export const TransformController: React.FC = () => {
  const activeLayer = useActiveLayer();
  const subMode = useTransformStore((s) => s.subMode);   // "transform" | "distort" | "skew"
  const modifiers = useModifierState();                   // from keyboard OR ring
  const snapEnabled = useTransformStore((s) => s.snapEnabled);

  if (!activeLayer || activeLayer.locked) return null;

  return (
    <>
      <BoundingBox layer={activeLayer} />
      {subMode === "distort" ? (
        <>
          <DistortCornerHandle index={0} layer={activeLayer} />
          <DistortCornerHandle index={1} layer={activeLayer} />
          <DistortCornerHandle index={2} layer={activeLayer} />
          <DistortCornerHandle index={3} layer={activeLayer} />
        </>
      ) : (
        <>
          {[...corners].map((c) => <CornerHandle position={c} layer={activeLayer} modifiers={modifiers} snapEnabled={snapEnabled} />)}
          {[...edges].map((e) => <EdgeHandle position={e} layer={activeLayer} modifiers={modifiers} snapEnabled={snapEnabled} />)}
          <RotationHandle layer={activeLayer} snapEnabled={snapEnabled} />
          <AnchorHandle layer={activeLayer} />
        </>
      )}
      <SnapOverlay activeLayer={activeLayer} snapEnabled={snapEnabled} />
      {!hasPhysicalKeyboard && <ModifierRing />}
    </>
  );
};
```

## 7. Gesture composition (touch + mouse parity)

```typescript
// libs/ui/src/transform/gestures/handle-drag.ts
export const useHandleDrag = (
  layer: Layer,
  handle: HandleType,
  modifiers: ModifierState,
  snapEnabled: boolean
) => {
  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      const delta = computeTransformDelta(handle, e.translationX, e.translationY, modifiers, layer);
      const snapped = snapEnabled ? applySnap(delta, layer) : delta;
      // optimistic local update for responsiveness; server confirms on commit
      editorStore.previewTransform(layer.id, snapped);
    })
    .onEnd(() => {
      const final = editorStore.getPreviewTransform(layer.id);
      client.tools.transformLayer({ layer_id: layer.id, transform: final });
      editorStore.clearPreview(layer.id);
    });

  // Mouse cursor binding (where iPadOS or future desktop)
  const cursorGesture = Gesture.Tap()    // simplified; actual mouse support uses pointer events
    .onTouchesMove(/* ... */);

  return Gesture.Race(gesture, cursorGesture);
};
```

For mouse/trackpad, `react-native-gesture-handler` exposes pointer events that work uniformly with touch on iPadOS and (eventually) Electron.

## 8. Snap detection

```typescript
// libs/canvas-core/src/transform/snap.ts
export interface SnapTarget {
  kind: "canvas-edge" | "canvas-center" | "layer-edge" | "layer-center" | "grid";
  axis: "h" | "v";
  value: number;        // canvas-space coordinate
  source_id?: string;   // for layer-edge / layer-center
}

export function findSnapTargets(
  draggedRect: Rect,
  document: Document,
  threshold_px: number
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  // canvas edges + center
  // ...
  // other layers
  for (const layer of document.layers.filter((l) => l.id !== draggedRect.layer_id && l.visible)) {
    const rect = layerBoundingBox(layer);
    targets.push(/* edges and center of rect */);
  }
  // grid (if enabled)
  // ...
  return targets.filter((t) => Math.abs(t.value - corresponding(draggedRect)) <= threshold_px);
}
```

The dragged rect's nearest snap target wins; UI renders a guide line at the snap value.

## 9. Modifier ring (tablet without keyboard)

```typescript
// libs/ui/src/transform/ModifierRing.tsx
export const ModifierRing: React.FC = () => {
  const { modifiers, toggle } = useModifierState();
  return (
    <FloatingRing>
      <ModBtn label="⇧" active={modifiers.shift} onPress={() => toggle("shift")} />
      <ModBtn label="⌥" active={modifiers.option} onPress={() => toggle("option")} />
      <ModBtn label="⌘" active={modifiers.cmd} onPress={() => toggle("cmd")} />
      <ModBtn label="🔗" active={!useTransformStore.getState().snapEnabled} onPress={toggleSnap} />
    </FloatingRing>
  );
};
```

Modifiers from the ring are merged with physical-keyboard modifiers (logical OR); whichever the user uses is fine.

## 10. Numeric panel

Standard form rendering `TransformDecomposed` fields. Arithmetic expression evaluator (FR NFR-3) accepts inputs like `512 / 2`, `3 * 60 + 45`. On Enter or focus-loss, calls `transform_layer` with the absolute new state.

## 11. Performance notes

- Transform during gesture: render the layer with `BlendMode.Src` (no compositing), bilinear sampling, low-priority Skia frame budget.
- On commit: re-render with full pipeline (proper blend modes, group composition, snapping).
- Group transforms with 5 layers: compute composite bounding box once; transform each layer's local matrix lazily.

## 12. Acceptance criteria

1. Touch-only path covers every operation listed in §3.1.
2. Mouse + keyboard reach functional parity for users who have those inputs.
3. Group transforms produce a single Command.
4. Snap targets render guides correctly; threshold and disable mechanism work.
5. `transform_layer` tool is added to v1 catalog (modifying `mcp-tool-catalog` accordingly).
6. Performance ≥60 FPS for typical sizes.
