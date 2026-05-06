# canvas-fundamentals — Requirements

> **Status:** Draft v0.1.
> **Philosophy:** AI-accelerated illustration via heavy collage + light sketch. **Inspired by Procreate's UI/tools/gestures, NOT its brush engine depth.** Center of gravity: layer + transform + mask. Brushes deferred to a deliberately simple `brush-system` spec.
> **Depends on:** `mcp-tool-catalog` (layer + canvas tools), `client-state-architecture` (`editorStore`), `undo-redo-system` (P27, all mutations reversible), `generation-history` (apply_history_item creates layers).
> **References:** P10 (control-layers-as-layers), P11 (regions-as-areas), P22 (tablet reference form factor), P27.

## 1. Purpose

Define the **document and layer model** of DiffuseCraft's canvas plus the **canonical interactions** that turn it into a collage workspace. This spec produces:

- The render-agnostic core (`canvas-core`) that owns the document model, layer operations, blend logic, and history-of-operations registration.
- The Skia adapter (`canvas-skia`) that renders the model on tablet via `react-native-skia`.
- The tablet UX patterns: layer panel, layer thumbnails, gestures for layer manipulation, drag-and-drop image import, paste from clipboard.

This spec **does NOT** cover: selection details (`selection-tools`), masks (`mask-system`), brushes (`brush-system`), transforms (`transform-tools` — though we touch the layer-position aspect), control-layer details (`control-layers`), regions (`regions`).

## 2. Stakeholders & user stories

### S1 — Illustrator building a collage as AI context
> **Story 1.** As an illustrator, I drag three reference images from my photos app onto the canvas. Each becomes a separate layer. I scale and position them, set blend modes (multiply, screen) on a couple, group them as "References", and lower the group's opacity to 30%. I generate using these as composition control — the AI sees the composited result and uses it as a strong starting point.

### S2 — Illustrator building a layered illustration
> **Story 2.** As an illustrator, I generate a base sky layer, apply a preview from history. Generate a city silhouette with strength=70 (refine), apply on top. Add a paint layer on top of that and sketch some lights. Add a mask layer above the paint to constrain the lights' region. Group the city + lights + mask as "Foreground". The layer panel shows a clean tree.

### S3 — Illustrator iterating quickly
> **Story 3.** As an illustrator with 30 generations done in the session, I have ~20 layers in the document. I toggle visibility of layers to compare, drag layers up/down to reorder, double-tap a layer thumbnail to enlarge it, two-finger tap to undo, three-finger tap to redo. Smooth, no waiting.

### S4 — Agent populating a document
> **Story 4.** As an agent setting up a scene, I `add_layer({ kind: "paint", content: <ref> })` for a reference image, `add_layer({ kind: "paint", content: <ref>, opacity: 0.5, blend_mode: "multiply" })` for an overlay, `update_layer({ id, position: 0 })` to put a layer at the bottom of the stack. I see the document take shape via `document.changed` events.

### S5 — Tablet user paste-and-go
> **Story 5.** As an illustrator, I copy an image from a browser. I switch to the DiffuseCraft app, two-finger tap to paste. The image becomes a new paint layer on top, ready to transform.

## 3. Functional requirements (EARS)

### 3.1 Document model

**FR-1 (Ubiquitous).** A `Document` SHALL have: `id` (ULID), `name`, `width`, `height`, `color_mode` (v1: `srgb` only), `layers` (ordered array), `groups` (tree of group nodes referring to layers), `selection`, `regions`, `control_layers`, `created_at`, `modified_at`. The active workspace is per-session, not per-document.

**FR-2 (Ubiquitous).** Documents are persisted on the **server** (per `server-architecture` FR-29). The tablet `editorStore` mirrors the active document.

**FR-3 (Ubiquitous).** v1 SHALL support **one active document per session**. Multi-document tabs are post-v1.

**FR-4 (Ubiquitous).** Document creation accepts standard tablet aspect ratios as quick presets: `1024×1024` (square), `1024×1536` (portrait 2:3), `1536×1024` (landscape 3:2), `1080×1920` (mobile portrait), `1920×1080` (landscape), plus a `Custom` option that specifies arbitrary multiples-of-8 dims up to `4096×4096`.

### 3.2 Layer types

**FR-5 (Ubiquitous).** v1 SHALL support four layer types:

| Kind | Renders | Owns | Affects |
|---|---|---|---|
| `paint` | Yes (raster image content) | RGBA pixels | Composition (visible) |
| `mask` | No (visible only as overlay) | Alpha-only image | Constrains generation regions / clips |
| `control` | No (preview-only mode) | RGBA pixels + control type metadata | AI control (Reference / Style / Composition / Face / Scribble / Line Art / etc.) |
| `region` | No (visible as outline only) | Reference to a `paint` layer + per-region prompt | AI per-area conditioning |

**FR-6 (Ubiquitous).** Every layer has: `id`, `document_id`, `kind`, `name`, `position` (z-index), `opacity` (0–1), `visible` (bool), `blend_mode`, `locked` (bool, prevents accidental edits), `clip_mask` (optional reference to a layer-content-derived mask), `created_at`.

**FR-7 (Ubiquitous).** Layer position is a continuous integer (no fractional positions); `update_layer({ id, position })` reorders by inserting at the requested index. Conflicts (two layers at same position after a multi-client write) resolve via "secondary tiebreaker by `created_at`".

### 3.3 Layer groups

**FR-8 (Ubiquitous).** Layers MAY be grouped. A group is a node with `id`, `name`, `position`, `opacity`, `visible`, `blend_mode`, `collapsed` (bool, controls UI only), and an ordered list of children (layers or sub-groups).

**FR-9 (Ubiquitous).** Group operations:
- `create_group({ name, member_layer_ids[], position })` — creates a group containing existing layers.
- `update_group({ id, ... })` — same shape as `update_layer`.
- `ungroup({ id })` — flattens children to siblings of the group's old position.
- `move_layers_into_group({ group_id, layer_ids[] })` — adds existing layers to a group.

**FR-10 (Ubiquitous).** Groups affect rendering: children render into an isolated buffer, then the buffer is composited onto the parent group / document with the group's opacity + blend_mode. This matches Procreate / Photoshop group behavior.

**FR-11 (Ubiquitous).** Group nesting depth SHALL be capped at 5 levels in v1 (avoid pathological trees on tablet).

### 3.4 Blend modes

**FR-12 (Ubiquitous).** v1 SHALL support the following blend modes (rich enough for collage; not exhaustive):

`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color_dodge`, `color_burn`, `hard_light`, `soft_light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`, `linear_burn`, `linear_dodge`, `linear_light`, `pin_light`.

**FR-13 (Ubiquitous).** Blend mode formulas SHALL match Photoshop / Procreate conventions for the standard set; a reference document with formulas lives in `libs/canvas-core/src/lib/blend/formulas.md`.

### 3.5 Layer operations (collage workflow)

**FR-14 (Ubiquitous).** Layer operations covered by this spec (deeper transform details in `transform-tools`):
- Add (with optional initial content via `ImageEnvelope`).
- Remove.
- Update name / opacity / visibility / blend_mode / locked / position.
- Duplicate (creates a new layer with the same content).
- Merge down (combines layer with the one below into one paint layer).
- Flatten visible (combines all visible layers into one paint layer; destructive — registered as reversible op).
- Set as current target (active layer for paint/mask operations).

**FR-15 (Ubiquitous).** All layer operations SHALL register reversible Commands per P27.

### 3.6 Image import paths

**FR-16 (Ubiquitous).** Images enter the document via:
- `add_layer({ kind: "paint", content: <ImageEnvelope> })` — programmatic / agent.
- Drag-and-drop from OS (iPad multitasking, Android Files) onto the canvas.
- Paste from clipboard (two-finger tap on canvas → "Paste").
- Camera capture (Expo Camera adapter, optional v1).
- Apply preview from history strip (per `generation-history` FR-4).

**FR-17 (Ubiquitous).** Imported images SHALL preserve original dimensions until transformed; the layer's logical dimensions match the import. The user (or agent) transforms via `transform-tools` to fit the canvas / collage.

### 3.7 Render-agnostic core (`canvas-core`)

**FR-18 (Ubiquitous).** `@diffusecraft/canvas-core` SHALL be **pure logic**: document model, layer operations, blend formulas, hit-testing, group composition. It SHALL NOT import any rendering library (no Skia, no React Native).

**FR-19 (Ubiquitous).** `canvas-core` SHALL expose a **render-adapter interface**:

```typescript
export interface CanvasRenderAdapter {
  drawDocument(document: Document, viewport: Viewport): void;
  hitTest(x: number, y: number, document: Document): LayerId | null;
  rasterizeLayer(layer: Layer, dims: { w: number; h: number }): Promise<Uint8Array>;
}
```

`canvas-skia` implements this against `react-native-skia`. Future hosts (e.g., MeshCraft if it ever needs canvas rendering) implement their own adapter without touching core.

**FR-20 (Ubiquitous).** `canvas-core` SHALL expose **operations** as pure functions returning new state (no in-place mutation):

```typescript
export const addLayer = (doc: Document, input: AddLayerInput): { doc: Document; layer: Layer };
export const removeLayer = (doc: Document, layer_id: LayerId): { doc: Document };
export const updateLayer = (doc: Document, layer_id: LayerId, patch: LayerPatch): { doc: Document };
// ... etc
```

These compose into Commands for the undo system.

### 3.8 Skia adapter (`canvas-skia`)

**FR-21 (Ubiquitous).** `@diffusecraft/canvas-skia` SHALL implement `CanvasRenderAdapter` using `react-native-skia` native bindings.

**FR-22 (Ubiquitous).** Rendering SHALL respect:
- Layer visibility, opacity, blend mode.
- Group composition (isolated buffer + parent blend).
- Clip masks.
- Selection overlay (semi-transparent fill or marching-ants, drawn on top of the document).
- Active layer indicator (subtle border or panel highlight).
- Region outlines (when active workspace is `Generate` and regions exist).

**FR-23 (Ubiquitous).** Rendering SHALL be **incremental** where possible: changes to a single layer's properties only re-render that layer's contribution; large viewport changes re-render fully.

**FR-24 (Ubiquitous).** Apple Pencil and S-Pen pressure events SHALL be exposed at the adapter level for use by `brush-system` later.

### 3.9 Tablet UX: layer panel

**FR-25 (Ubiquitous).** A right-side **layer panel** SHALL show:
- Stack of layer thumbnails (top of panel = top of stack).
- Per-row: thumbnail, name, opacity slider (mini), visibility toggle, lock toggle, blend mode badge.
- Group rows show expand/collapse triangle, member count.
- Active layer highlighted.
- Plus button to create a layer (paint / mask / control / region pick).

**FR-26 (Ubiquitous).** Layer panel gestures:
- Tap layer → select as active.
- Long-press layer → context menu (Duplicate, Merge down, Delete, Convert to mask, Convert to control, Group, Rename, Lock).
- Drag layer → reorder; drop on another layer + hold → option to merge or group.
- Swipe layer left → quick-delete with undo toast.
- Swipe layer right → toggle visibility.
- Pinch two layers in panel → group them.

**FR-27 (Ubiquitous).** Thumbnails SHALL update reactively when layer content changes; throttled to ≤60Hz to avoid thrash on rapid edits.

### 3.10 Tablet UX: canvas gestures

**FR-28 (Ubiquitous).** Canvas-level gestures (Procreate-inspired):
- One-finger drag (with active brush tool) → paint stroke.
- Two-finger pinch → zoom.
- Two-finger pan → pan viewport.
- Two-finger rotate → rotate viewport (toggleable per user pref; default on).
- Two-finger tap → undo.
- Three-finger tap → redo.
- Three-finger swipe down → menu.
- Four-finger tap → toggle UI chrome (full-canvas mode).
- Long-press on canvas → eyedropper (at the press point, pick color from rendered composite).
- Two-finger tap-and-hold → paste from clipboard.

**FR-29 (Ubiquitous).** Gesture conflicts SHALL be resolved by precedence: tool gestures (painting) > navigation gestures (pinch/pan) > undo/redo (only with no other gesture in progress).

### 3.11 Multi-client coordination

**FR-30 (Ubiquitous).** When another client modifies the document, the local renderer SHALL update via `document.changed` event handling (per `mcp-tool-catalog` FR-13). Optimistic local edits reconcile with server truth on event arrival.

**FR-31 (Ubiquitous).** Conflict markers (per FR-23 of `mcp-tool-catalog`) SHALL be visible in the layer panel as a small "edited remotely" indicator next to the affected layer for ~3 s.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Rendering SHALL maintain ≥ 60 FPS at 100 layers on iPad Pro M-class hardware for typical interactions (pinch, pan, layer toggle). Verified via in-test FPS counter.

**NFR-2 (Ubiquitous).** Layer panel rendering with 200 layers SHALL not drop below 60 FPS on the same hardware (virtualized list).

**NFR-3 (Ubiquitous).** Document load time (from `loadDocument(id)` to first frame rendered) SHALL be ≤ 1.5 s for a 50-layer document on local LAN connection.

**NFR-4 (Ubiquitous).** `canvas-core` SHALL be tree-shakeable and exclude any RN/Skia code. Bundle size for `canvas-core` ≤ 60 KB minified+gzipped.

**NFR-5 (Ubiquitous).** Memory: a 4K canvas with 50 layers SHALL stay below 1.5 GB RAM on typical iPad. For larger documents, the renderer paginates / tiles.

## 5. Out of scope

- **Selection tools** — `selection-tools` spec.
- **Mask painting and refinement** — `mask-system` spec.
- **Brushes** — `brush-system` spec (deliberately minimal in v1).
- **Transform tools** — `transform-tools` spec.
- **Control-layer specifics** — `control-layers` spec.
- **Regions** — `regions` spec.
- **Custom workflows / Custom Graph** — post-v1.
- **Animation timeline** — post-v1.
- **Vector layers** — post-v1.
- **Photo-grade filters (curves, levels, color balance)** — post-v1; not aligned with editor philosophy.
- **Multi-document tabs** — post-v1.

## 6. Open questions

### Q1 — Where is the document persisted (server-side schema vs file format)?
The server already has `documents`, `layers` tables. But should a document also be exportable as a single file (`.dcft` or similar)?

**Recommendation:** **server-side persistence in v1** (already specced); export-to-file is post-v1. v1 documents live on the server you paired with; a "save as file and open later" flow is a separate feature.

### Q2 — Color management beyond sRGB?
Photographers want P3 / Display-P3.

**Recommendation:** **sRGB only in v1.** P3 + ICC profiles are post-v1; not aligned with the AI-illustration scope.

### Q3 — Layer thumbnail generation cost
Re-rendering thumbnails on every change is expensive.

**Recommendation:** server generates thumbnails on layer content change (debounced) and serves via blob ref; tablet caches per layer id. Stale thumbnails for ~1 s after a change are acceptable.

### Q4 — Should groups support visibility/opacity/blend toggles in the panel directly, or via long-press menu only?
Direct toggles save taps; long-press is cleaner.

**Recommendation:** **direct toggles for visibility + opacity slider on group rows; blend mode via long-press.** Matches Procreate's approach.

### Q5 — Rotated viewport: should it persist per document?
Some illustrators rotate the canvas to match their drawing posture.

**Recommendation:** **per-document, ephemeral** (not persisted across sessions). Rotation is an interaction state, not a document attribute.

### Q6 — Hit testing for collage (tap on a stack of overlapping layers)
Which layer should tap select?

**Recommendation:** **topmost visible layer at the tap point.** Long-press cycles through Z-stack of visible layers under the point.

### Q7 — Layer naming on creation
Default names: "Layer 1", "Layer 2", etc., or content-aware?

**Recommendation:** default `Layer N` for empty, `Generated: <prompt>` for AI-applied (per `generation-history` FR-4), `Image (filename)` for imports. Renamable always.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized by the data model + operations + UX.
2. `canvas-core` is render-agnostic (no Skia/RN imports).
3. `canvas-skia` implements the adapter interface end-to-end.
4. Layer panel + canvas gestures match the Procreate-inspired UX.
5. Blend mode set is rich enough for v1 collage workflow.
6. Performance targets (NFR-1..5) are achievable.
7. Open questions have acceptable recommendations.
