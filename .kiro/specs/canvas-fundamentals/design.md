# canvas-fundamentals — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `client-state-architecture`, `generation-history`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Server-side persistence v1.** File export is post-v1. |
| Q2 | **sRGB only in v1.** No ICC profile / P3. |
| Q3 | **Server-generated thumbnails**, debounced on content change; tablet caches; ~1 s staleness acceptable. |
| Q4 | **Direct visibility + opacity toggles on group rows; blend mode via long-press.** |
| Q5 | **Rotated viewport per-document, ephemeral** (not persisted). |
| Q6 | **Topmost visible layer hits.** Long-press cycles Z-stack under the tap point. |
| Q7 | **`Layer N`** default; `Generated: <prompt>` for AI; `Image (filename)` for imports. Always renamable. |

## 2. Module layout

```
libs/canvas-core/src/
├── index.ts                    # public exports
├── document/
│   ├── document.ts             # Document type + factories
│   ├── operations.ts           # addLayer/removeLayer/updateLayer/etc — pure functions
│   ├── groups.ts               # group operations
│   └── invariants.ts           # invariants checked after each op (positions consistent, no orphan refs)
├── layers/
│   ├── types.ts                # Layer, PaintLayer, MaskLayer, ControlLayer, RegionLayer
│   ├── blend-modes.ts          # BlendMode enum
│   └── group.ts                # GroupNode
├── blend/
│   ├── formulas.ts             # blend-mode math (per Photoshop conventions)
│   ├── compose.ts              # composite layer onto background with blend
│   └── formulas.md             # human-readable reference doc
├── render/
│   ├── adapter.ts              # CanvasRenderAdapter interface
│   ├── viewport.ts             # zoom, pan, rotation
│   └── hit-test.ts             # adapter-agnostic hit-test helper
├── shared/
│   └── ids.ts                  # re-exports from mcp-tools
└── __tests__/

libs/canvas-skia/src/
├── index.ts                    # exports SkiaRenderAdapter
├── adapter.ts                  # implements CanvasRenderAdapter using react-native-skia
├── compose-skia.ts             # Skia-specific blend-mode invocation
├── thumbnail.ts                # rasterize a layer to a Uint8Array for thumbnails
├── viewport-canvas.ts          # zoom/pan/rotate using Skia's matrix ops
├── overlay/
│   ├── selection-overlay.ts    # render selection (rect/mask/marching-ants)
│   ├── region-outlines.ts
│   └── active-layer-border.ts
└── __tests__/
```

## 3. Document model

```typescript
// libs/canvas-core/src/document/document.ts
export interface Document {
  readonly id: DocumentId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly color_mode: "srgb";
  readonly layers: ReadonlyArray<Layer>;        // ordered: index = position
  readonly groups: ReadonlyArray<GroupNode>;    // tree
  readonly selection: Selection;
  readonly active_layer_id: LayerId | null;
  readonly created_at: string;
  readonly modified_at: string;
}

export interface Layer {
  readonly id: LayerId;
  readonly document_id: DocumentId;
  readonly kind: "paint" | "mask" | "control" | "region";
  readonly name: string;
  readonly position: number;                     // index in stacking order (0=bottom)
  readonly opacity: number;                       // 0–1
  readonly visible: boolean;
  readonly locked: boolean;
  readonly blend_mode: BlendMode;
  readonly clip_mask?: { source_layer_id: LayerId };
  readonly group_id?: string;                     // membership; null = root
  readonly content_blob_id?: string;              // for paint/mask/control
  readonly control_type?: ControlType;            // for control layers
  readonly region_data?: { paint_layer_id: LayerId; prompt: string };
  readonly created_at: string;
}

export interface GroupNode {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly opacity: number;
  readonly visible: boolean;
  readonly blend_mode: BlendMode;
  readonly collapsed: boolean;
  readonly child_layer_ids: ReadonlyArray<LayerId>;
  readonly child_group_ids: ReadonlyArray<string>;
}
```

## 4. Operations (pure functions)

```typescript
// libs/canvas-core/src/document/operations.ts
export function addLayer(doc: Document, input: AddLayerInput): { doc: Document; layer: Layer } {
  const layer: Layer = {
    id: ulid() as LayerId,
    document_id: doc.id,
    kind: input.kind,
    name: input.name ?? defaultName(input.kind, doc),
    position: input.position ?? doc.layers.length,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    locked: false,
    blend_mode: input.blend_mode ?? "normal",
    clip_mask: input.clip_mask,
    content_blob_id: input.content_blob_id,
    control_type: input.control_type,
    region_data: input.region_data,
    created_at: new Date().toISOString(),
  };
  // shift layers above the insert point upward
  const shifted = doc.layers.map((l) => l.position >= layer.position ? { ...l, position: l.position + 1 } : l);
  return {
    doc: { ...doc, layers: [...shifted, layer].sort(byPosition), modified_at: new Date().toISOString() },
    layer,
  };
}

export function removeLayer(doc: Document, layer_id: LayerId): { doc: Document } { /* ... */ }
export function updateLayer(doc: Document, layer_id: LayerId, patch: LayerPatch): { doc: Document } { /* ... */ }
export function duplicateLayer(doc: Document, layer_id: LayerId): { doc: Document; layer: Layer } { /* ... */ }
export function mergeDown(doc: Document, layer_id: LayerId, blob_blender: BlobBlender): Promise<{ doc: Document; merged_layer: Layer }> { /* ... */ }
export function flattenVisible(doc: Document, blob_blender: BlobBlender): Promise<{ doc: Document; flattened_layer: Layer }> { /* ... */ }
```

`mergeDown` and `flattenVisible` need pixel composition; the function takes a `BlobBlender` injected by the caller (server uses Sharp; tablet uses Skia for in-app preview before committing the merge through the server). Pure-function shape preserved by passing the blender.

## 5. Group operations

```typescript
// libs/canvas-core/src/document/groups.ts
export function createGroup(doc: Document, input: CreateGroupInput): { doc: Document; group: GroupNode } {
  // member_layer_ids must all exist; assign group_id; create node; place at requested position
}
export function ungroup(doc: Document, group_id: string): { doc: Document } {
  // promote children to siblings of the group's old position
}
export function moveLayersIntoGroup(doc: Document, group_id: string, layer_ids: LayerId[]): { doc: Document } { /* ... */ }
```

Composition with groups:
```
renderGroup(group, ctx):
  buffer = empty buffer of doc dims
  for child in group.child_layers ordered by position:
    if !child.visible: continue
    apply child onto buffer with child.blend_mode and child.opacity
  for child_group in group.child_groups ordered by position:
    childBuffer = renderGroup(child_group, ctx)
    apply childBuffer onto buffer with child_group.blend_mode and child_group.opacity
  return buffer

renderDocument(doc, ctx):
  baseBuffer = empty buffer
  // root-level layers and groups, ordered by position
  for entity in topLevelEntities(doc):
    if entity is layer: apply entity onto baseBuffer
    if entity is group: apply renderGroup(entity, ctx) onto baseBuffer with group's blend
  return baseBuffer
```

## 6. Render adapter interface

```typescript
// libs/canvas-core/src/render/adapter.ts
export interface CanvasRenderAdapter {
  /** Draw the document onto the underlying surface, given the current viewport. */
  drawDocument(document: Document, viewport: Viewport, opts?: { incremental?: { changedLayerIds?: LayerId[] } }): void;

  /** Hit-test at viewport-space (x,y); returns the topmost visible layer id, or null. */
  hitTest(x: number, y: number, document: Document, viewport: Viewport): LayerId | null;

  /** Cycle through Z-stack of visible layers at point. Returns array sorted top→bottom. */
  hitTestStack(x: number, y: number, document: Document, viewport: Viewport): LayerId[];

  /** Rasterize a single layer to bytes (used for thumbnails, exports). */
  rasterizeLayer(layer: Layer, dims: { w: number; h: number }): Promise<Uint8Array>;

  /** Rasterize the full composited document to bytes. */
  rasterizeDocument(document: Document, dims: { w: number; h: number }): Promise<Uint8Array>;
}

export interface Viewport {
  zoom: number;        // 1.0 = 100%
  pan_x: number;       // canvas-space offset
  pan_y: number;
  rotation_degrees: number;   // ephemeral; per-document not persisted
}
```

## 7. Skia adapter

```typescript
// libs/canvas-skia/src/adapter.ts
import { Skia, useCanvasRef } from "@shopify/react-native-skia";

export class SkiaRenderAdapter implements CanvasRenderAdapter {
  private surfaceRef: SkSurface;
  // cache of rasterized layer content keyed by content_blob_id
  private layerCache = new Map<string, SkImage>();

  drawDocument(document, viewport, opts) {
    const canvas = this.surfaceRef.getCanvas();
    canvas.save();
    canvas.translate(viewport.pan_x, viewport.pan_y);
    canvas.rotate(viewport.rotation_degrees);
    canvas.scale(viewport.zoom, viewport.zoom);

    // render top-level entities ordered by position
    for (const entity of topLevelEntities(document)) {
      if (entity.kind === "layer") this.drawLayer(canvas, entity);
      else this.drawGroup(canvas, entity, document);
    }
    canvas.restore();
  }

  private drawLayer(canvas: SkCanvas, layer: Layer) {
    if (!layer.visible) return;
    if (layer.kind === "control" || layer.kind === "region" || layer.kind === "mask") return;   // not rendered in normal compose
    const img = this.getCachedImage(layer.content_blob_id);
    if (!img) return;
    const paint = Skia.Paint();
    paint.setAlphaf(layer.opacity);
    paint.setBlendMode(toSkBlendMode(layer.blend_mode));
    canvas.drawImage(img, 0, 0, paint);
  }

  // ... drawGroup with isolated buffer; hitTest with reverse iteration; etc.
}
```

The Skia adapter is the single point that touches `react-native-skia`. `canvas-core` consumes only the interface.

## 8. Tablet UX components

### 8.1 Layer panel

```typescript
// libs/ui/src/components/LayerPanel.tsx
export const LayerPanel: React.FC = () => {
  const layers = useEditorStore((s) => s.layers);
  const groups = useEditorStore((s) => s.groups);
  const activeId = useEditorStore((s) => s.active_layer_id);
  const tree = useMemo(() => buildLayerTree(layers, groups), [layers, groups]);

  return (
    <FlatList
      data={tree}                                  // virtualized
      renderItem={({ item }) => (
        <LayerRow
          item={item}
          active={item.id === activeId}
          onTap={() => editorStore.setActiveLayer(item.id)}
          onLongPress={() => openContextMenu(item)}
          onDrag={(toIndex) => editorStore.reorderLayer(item.id, toIndex)}
          onSwipeLeft={() => editorStore.removeLayer(item.id)}
          onSwipeRight={() => editorStore.toggleVisibility(item.id)}
        />
      )}
      windowSize={5}
    />
  );
};
```

### 8.2 Canvas gestures

```typescript
// libs/ui/src/canvas/CanvasGestures.tsx
const panZoomRotate = Gesture.Race(
  Gesture.Pinch().onUpdate(updateZoom),
  Gesture.Pan().minPointers(2).onUpdate(updatePan),
  Gesture.Rotation().onUpdate(updateRotation),
);

const undoRedo = Gesture.Race(
  Gesture.Tap().numberOfTaps(1).numberOfPointers(2).onEnd(() => client.tools.undo()),
  Gesture.Tap().numberOfTaps(1).numberOfPointers(3).onEnd(() => client.tools.redo()),
);

const paste = Gesture.LongPress().numberOfPointers(2).onEnd(handlePaste);

const eyedropper = Gesture.LongPress().numberOfPointers(1).onEnd(handleEyedropper);

const composedGesture = Gesture.Exclusive(panZoomRotate, undoRedo, paste, eyedropper);
```

(Brush gestures with stylus/finger are managed in `brush-system` and have higher precedence when an active brush tool is selected.)

### 8.3 Drag-and-drop / paste

```typescript
// On iPad, react-native-drop-target listens to multitasking drops
const dropHandler = useDrop({
  onDrop: async (uri: string) => {
    const bytes = await readAsBytes(uri);
    const blobRef = await client.image.upload(bytes, "png");
    await client.tools.addLayer({
      kind: "paint",
      content: blobRef,
      name: `Image (${getFilenameFromUri(uri)})`,
    });
  },
});
```

## 9. Blend-mode reference (subset table)

```
normal:        result = src * src.a + dst * (1 - src.a)
multiply:      blend = src * dst                       ; result composited onto dst
screen:        blend = 1 - (1 - src) * (1 - dst)
overlay:       blend = (dst < 0.5 ? 2*src*dst : 1 - 2*(1-src)*(1-dst))
darken:        blend = min(src, dst)
lighten:       blend = max(src, dst)
soft_light:    blend = (1-2*src) * dst^2 + 2*src*dst             // Photoshop variant
hard_light:    inverse(overlay) — switch src and dst roles
linear_burn:   blend = src + dst - 1
linear_dodge:  blend = src + dst
... (full table in formulas.md)
```

Skia natively supports most of these via `BlendMode.Multiply` / `BlendMode.Overlay` etc. For variants Skia lacks, the adapter implements them as a custom shader.

## 10. Acceptance criteria for `design.md`

1. `canvas-core` is render-agnostic and tree-shakeable.
2. The render-adapter interface is implementable by `canvas-skia` end-to-end.
3. Group composition matches Procreate / Photoshop semantics.
4. Blend mode set is documented with formulas.
5. Layer panel + gestures cover the user stories without conflicting.
6. Image import paths (drag, paste, agent) all converge on `add_layer({ content })`.
