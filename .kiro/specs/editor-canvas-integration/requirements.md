# editor-canvas-integration — Requirements

> **Status:** Draft v0.1.
> **Type:** INTEGRATION spec — wires existing, tested implementations together. Does NOT reimplement any library logic.
> **Depends on (all implemented):** `canvas-fundamentals` (canvas-core + canvas-skia), `client-state-architecture` (editorStore + StoresProvider), `selection-tools` (rect/lasso/magic-wand), `transform-tools` (matrix decomp, snap, grid), `mask-system` (two-mask split, handlers), `brush-system` (5 presets, stroke geometry), `undo-redo-system` (useUndoRedo hook, LeftToolRail wiring), `screens-implementation` (Editor screen chrome).
> **References:** P1 (agent-first), P2 (human UX built on agent API), P22 (tablet reference), P27 (universal undo/redo).

## 1. Purpose

The Editor screen in `apps/mobile` currently shows a `CanvasPlaceholder` — a dotted rectangle with "Replaced by canvas-fundamentals spec" text. All the real logic lives in implemented, tested libraries:

- `@diffusecraft/canvas-core` — document model, layer ops, selection, transform, blend, brush presets (51 tests)
- `@diffusecraft/canvas-skia` — `SkiaRenderAdapter`, `<CanvasView />` component
- `@diffusecraft/core` — `editorStore` (6 slices), `StoresProvider`, `useUndoRedo` hook, per-slice selector hooks
- `libs/selection-tools` — rect/lasso/magic-wand geometry + 5 server handlers (39+25 tests)
- `libs/transform-tools` — matrix decomp, snap targets, 16px grid, 15° rotation snap (22+11 tests)
- `libs/mask-system` — krita-style two-mask split, 7 reversible handlers (23+13 tests)
- `libs/brush-system` — 5 fixed presets, pure-TS stroke geometry, injectable PixelCodec (17+13 tests)
- `undo-redo-system` — Command pattern, per-client stacks, `useUndoRedo` hook, `LeftToolRail` wiring (Phases A–H+J)

None of this is connected to the app. This spec defines the **integration layer** that wires them together so the Editor screen becomes a functional canvas editor.

This spec produces:
- Replacement of `CanvasPlaceholder` with `<CanvasView />` from `canvas-skia`.
- Real layer panel driven by `editorStore.layersSlice`.
- Brush tool picker connected to `canvas-skia` drawing + Apple Pencil/S-Pen pressure.
- Transform gestures (pinch zoom/rotate/pan) connected to viewport state.
- Selection tool picker connected to canvas touch input.
- Mask painting connected to `mask-system`.
- Undo/redo gestures (two-finger tap / three-finger tap) connected to `useUndoRedo`.
- Zustand stores properly mounted via `StoresProvider`.
- Tool rail with real tool switching.
- In-memory document bootstrap on Editor mount.

This spec does **NOT** produce:
- New library code in `canvas-core`, `canvas-skia`, or any `libs/` package.
- Server-side handlers (already implemented).
- Full document management (create/open/save/delete — separate `document-management` spec).
- Tests (deferred per `.kiro/steering/testing.md`).

## 2. Glossary

- **Editor_Screen**: The `apps/mobile/src/screens/Editor/` component tree that assembles the canvas viewport and floating UI chrome.
- **Canvas_View**: The `<CanvasView />` React component from `@diffusecraft/canvas-skia` that renders a `Document` onto a Skia surface.
- **Editor_Store**: The Zustand store from `@diffusecraft/core` composed of 6 slices (canvas, layers, selection, activeTool, brush, transform).
- **Stores_Provider**: The `<StoresProvider />` component from `@diffusecraft/core` that instantiates and provides all 6 stores via React context.
- **Viewport_State**: The `Viewport` record (zoom, pan_x, pan_y, rotation_degrees) from `canvas-core` that controls the camera.
- **Tool_Rail**: The `LeftToolRail` component providing tool switching (brush presets, selection, transform, mask, eyedropper, undo/redo).
- **Layer_Panel**: The `RightPanel/Layers` component showing the layer stack with visibility, opacity, and reorder controls.
- **Bootstrap_Document**: An in-memory `Document` created via `createDocument()` from `canvas-core` when the Editor mounts, providing an initial canvas to draw on.
- **Gesture_Compositor**: The composed gesture handler that resolves conflicts between tool gestures (painting), navigation gestures (pinch/pan/rotate), and undo/redo gestures per `canvas-fundamentals` FR-29.

## 3. Stakeholders & user stories

### S1 — Illustrator opening the Editor for the first time
> **Story 1.** As an illustrator, I navigate to the Editor screen. A blank 1024×1024 canvas appears (not a placeholder). I see the tool rail on the left, the layer panel on the right showing one empty paint layer. I can immediately start drawing with the Pen brush.

### S2 — Illustrator drawing with Apple Pencil
> **Story 2.** As an illustrator with Apple Pencil, I select the Pen brush from the tool rail. I draw on the canvas — strokes appear in real time with pressure sensitivity (light = thin, firm = thick). I switch to Marker, draw again — different feel. I switch to Eraser, erase part of my stroke.

### S3 — Illustrator navigating the canvas
> **Story 3.** As an illustrator, I pinch to zoom in on a detail. I two-finger pan to move around. I two-finger rotate to tilt the canvas. The viewport responds smoothly. I tap the zoom controls to reset to 100%.

### S4 — Illustrator managing layers
> **Story 4.** As an illustrator, I tap "+ Add layer" in the layer panel. A new paint layer appears. I draw on it. I tap the first layer to select it — it becomes active. I toggle visibility on the second layer — it hides. I drag to reorder. I adjust opacity with the slider.

### S5 — Illustrator using selection tools
> **Story 5.** As an illustrator, I tap the Selection tool in the tool rail. I draw a lasso around a region on the canvas. Marching ants appear. I switch to the rectangle selection sub-tool and draw a rectangle. The selection updates.

### S6 — Illustrator transforming a layer
> **Story 6.** As an illustrator, I tap the Transform tool. Handles appear around the active layer. I drag to move, pinch to scale, two-finger rotate. The layer transforms in real time. I tap elsewhere to commit.

### S7 — Illustrator painting a mask
> **Story 7.** As an illustrator, I add a mask layer. I select the Mask tool from the tool rail. I paint on the canvas — white adds to the mask, the red overlay shows where the mask is active. I switch to eraser to subtract from the mask.

### S8 — Illustrator using undo/redo
> **Story 8.** As an illustrator, I draw a stroke, then two-finger tap on the canvas. The stroke disappears (undo). I three-finger tap — the stroke reappears (redo). A brief toast confirms each action. The undo/redo buttons in the tool rail work identically.

### S9 — Illustrator switching tools rapidly
> **Story 9.** As an illustrator, I tap Pen → draw → tap Selection → lasso a region → tap Transform → move the selection → tap Pen → draw inside the selection. Tool switching is instant; the canvas responds to the correct tool at each moment.

## 4. Functional requirements (EARS)

### 4.1 Canvas mounting (replacing CanvasPlaceholder)

**FR-1 (Event-driven).** WHEN the Editor_Screen mounts with a `documentId`, THE Editor_Screen SHALL replace the `CanvasPlaceholder` component with a `Canvas_View` component from `@diffusecraft/canvas-skia`, passing the active `Document` from Editor_Store and the current Viewport_State.

**FR-2 (Event-driven).** WHEN the Editor_Screen mounts and no server-side document exists yet (pre-`document-management` spec), THE Editor_Screen SHALL create a Bootstrap_Document in memory using `createDocument({ preset: 'square', name: 'Untitled' })` from `canvas-core` and populate the Editor_Store with it, including one initial empty paint layer.

**FR-3 (Ubiquitous).** THE Canvas_View SHALL receive a `loadBytes` callback that resolves `content_blob_id` references to pixel data, using a stub implementation that returns empty bytes for v1 (full blob resolution requires `client-sdk` wiring from `document-management`).

**FR-4 (Ubiquitous).** THE Canvas_View SHALL fill the entire available area between the floating UI chrome (tool rail, top bar, right panel, bottom prompt bar), using `style={{ flex: 1 }}`.

### 4.2 Stores Provider mounting

**FR-5 (Ubiquitous).** THE `apps/mobile` app shell (`app/_layout.tsx` or the Editor route) SHALL mount `<StoresProvider client={null}>` wrapping the Editor_Screen so that all store hooks (`useEditorStore`, `useSelection`, `useActiveLayer`, `useBrushSettings`, `useTransform`, `useActiveTool`, `useUndoRedo`) resolve correctly.

**FR-6 (Ubiquitous).** THE Stores_Provider SHALL be mounted with `client={null}` in this integration phase. Full client SDK wiring is deferred to the `client-sdk` / `document-management` specs. Store actions that require a client SHALL degrade gracefully (no-op or local-only behavior).

**FR-7 (Ubiquitous).** THE `registerUndoToastAdapter` from `@diffusecraft/core` SHALL be called once at app startup, wiring it to the `toast.info` function from `@diffusecraft/ui`, so that undo/redo toasts display per FR-31 of `undo-redo-system`.

### 4.3 Layer panel wiring

**FR-8 (Ubiquitous).** THE Layer_Panel (`RightPanel/Layers`) SHALL read its layer list from `useEditorStore((s) => s.layers)` instead of the current `MOCK_LAYERS` fixture.

**FR-9 (Event-driven).** WHEN the user taps a layer row, THE Layer_Panel SHALL call `editorStore.setActiveLayer(layerId)` to update the active layer in the store.

**FR-10 (Event-driven).** WHEN the user toggles a layer's visibility switch, THE Layer_Panel SHALL call `editorStore.patchLayer(layerId, { visible })` to update the layer in the store.

**FR-11 (Event-driven).** WHEN the user adjusts a layer's opacity slider, THE Layer_Panel SHALL call `editorStore.patchLayer(layerId, { opacity })` to update the layer in the store.

**FR-12 (Event-driven).** WHEN the user taps "+ Add layer", THE Layer_Panel SHALL create a new paint layer using `addLayer` from `canvas-core`, update the Editor_Store's layers array, and set the new layer as active.

**FR-13 (Event-driven).** WHEN the user swipes left on a layer row, THE Layer_Panel SHALL remove the layer using `removeLayer` from `canvas-core` and update the Editor_Store.

**FR-14 (Event-driven).** WHEN the user drags a layer row to reorder, THE Layer_Panel SHALL update the layer positions using `updateLayer` from `canvas-core` and update the Editor_Store.

### 4.4 Brush tool wiring

**FR-15 (Event-driven).** WHEN the user selects a brush preset from the Tool_Rail (pen, pencil, marker, eraser, smooth), THE Editor_Store SHALL update `activeTool` to `'brush'` (or `'eraser'` for the eraser preset) and `brush` settings to match the selected preset from `BRUSH_PRESETS` in `canvas-core`.

**FR-16 (Event-driven).** WHEN the active tool is a brush and the user touches the canvas with a finger or stylus, THE Gesture_Compositor SHALL capture touch/stylus events (position, pressure, tilt) and feed them to the stroke geometry engine from `brush-system` (`composeStroke` from `canvas-core`).

**FR-17 (Ubiquitous).** THE stroke rendering pipeline SHALL use Apple Pencil pressure events (0.0–1.0) when available, modulated by the active preset's `pressureCurve`. Finger touches SHALL default to a mid-pressure value of 0.5.

**FR-18 (Event-driven).** WHEN a stroke completes (touch/stylus lifts), THE Editor_Screen SHALL commit the stroke to the active layer's content and register the operation with the undo system (via the server's `paint_strokes` tool when a client is wired, or locally when `client` is null).

### 4.5 Transform gesture wiring

**FR-19 (Event-driven).** WHEN the user performs a two-finger pinch on the canvas, THE Gesture_Compositor SHALL update the Viewport_State's `zoom` using `zoomBy` from `canvas-core`.

**FR-20 (Event-driven).** WHEN the user performs a two-finger pan on the canvas, THE Gesture_Compositor SHALL update the Viewport_State's `pan_x` and `pan_y` using `panBy` from `canvas-core`.

**FR-21 (Event-driven).** WHEN the user performs a two-finger rotation on the canvas, THE Gesture_Compositor SHALL update the Viewport_State's `rotation_degrees` using `rotateBy` from `canvas-core`.

**FR-22 (Event-driven).** WHEN the user taps the Transform tool and taps a layer, THE Editor_Screen SHALL enter transform mode: display bounding-box handles around the active layer and route drag/pinch/rotate gestures to the transform engine from `transform-tools` (translate, scale, rotate with snap targets).

**FR-23 (Ubiquitous).** THE transform engine SHALL apply snap targets from `transform-tools`: canvas edges, canvas center, other layer edges, and 16px grid (when enabled), with a 6-viewport-pixel threshold.

**FR-24 (Ubiquitous).** THE transform engine SHALL apply rotation snap to multiples of 15° within 3° of the snap angle, per `transform-tools` FR-15.

### 4.6 Selection tool wiring

**FR-25 (Event-driven).** WHEN the user selects the Selection tool from the Tool_Rail, THE Editor_Store SHALL update `activeTool` to `'lasso'` (default selection sub-tool).

**FR-26 (Event-driven).** WHEN the active tool is a selection tool and the user draws on the canvas, THE Gesture_Compositor SHALL capture the touch path and create a selection using the appropriate geometry from `selection-tools` (lasso path, rectangle bounds, or magic-wand tap point).

**FR-27 (Event-driven).** WHEN a selection is created or modified, THE Editor_Store's `selectionSlice` SHALL be updated with the new selection state, and the Canvas_View SHALL render the selection overlay (marching ants) via `drawSelectionOverlay` from `canvas-skia`.

**FR-28 (Ubiquitous).** THE selection tool SHALL support boolean operations (replace, add, subtract, intersect) driven by the `selectionMode` in the Editor_Store's `selectionSlice`.

### 4.7 Mask painting wiring

**FR-29 (Event-driven).** WHEN the user selects the Mask tool from the Tool_Rail and the active layer is a mask layer, THE Gesture_Compositor SHALL route brush strokes to the mask painting pipeline: white brush adds to mask alpha, black brush (or eraser) subtracts, per `mask-system` FR-7.

**FR-30 (Event-driven).** WHEN a mask layer is active and being edited, THE Canvas_View SHALL render the mask preview overlay (red translucent) via the overlay system from `canvas-skia`, per `mask-system` FR-4/FR-5.

### 4.8 Undo/redo gesture wiring

**FR-31 (Event-driven).** WHEN the user performs a two-finger tap on the canvas (with no other gesture in progress), THE Gesture_Compositor SHALL invoke `undo()` from the `useUndoRedo` hook, per `canvas-fundamentals` FR-28 and `undo-redo-system` FR-30.

**FR-32 (Event-driven).** WHEN the user performs a three-finger tap on the canvas (with no other gesture in progress), THE Gesture_Compositor SHALL invoke `redo()` from the `useUndoRedo` hook, per `canvas-fundamentals` FR-28 and `undo-redo-system` FR-30.

**FR-33 (Ubiquitous).** THE undo/redo buttons in the Tool_Rail SHALL continue to work via the existing `useUndoRedo` hook wiring from `undo-redo-system` Phase H.

### 4.9 Gesture conflict resolution

**FR-34 (Ubiquitous).** THE Gesture_Compositor SHALL resolve gesture conflicts using the precedence defined in `canvas-fundamentals` FR-29: tool gestures (painting, selection drawing) take priority over navigation gestures (pinch/pan/rotate), which take priority over undo/redo (only when no other gesture is in progress).

**FR-35 (Ubiquitous).** THE Gesture_Compositor SHALL use `react-native-gesture-handler`'s `Gesture.Exclusive` and `Gesture.Race` combinators to implement the precedence hierarchy, per the pattern in `canvas-fundamentals` design §8.2.

### 4.10 Tool rail wiring

**FR-36 (Event-driven).** WHEN the user taps a tool in the Tool_Rail, THE Tool_Rail SHALL update the Editor_Store's `activeTool` via `setActiveTool()`, and the Gesture_Compositor SHALL reconfigure to route touch events to the newly active tool's handler.

**FR-37 (Ubiquitous).** THE Tool_Rail SHALL display the following tools in order, matching the existing `LeftToolRail` layout: brush presets (pen, pencil, marker, eraser, smooth), separator, selection, transform, mask, eyedropper, separator, layers toggle, undo, redo.

**FR-38 (Ubiquitous).** THE active tool in the Tool_Rail SHALL be visually indicated with the `bg-accent-default` treatment, matching the existing `LeftToolRail` styling.

### 4.11 Viewport controls

**FR-39 (Event-driven).** WHEN the user taps the zoom-in button in the floating zoom controls, THE Editor_Screen SHALL increase the Viewport_State's zoom by a fixed step (1.25×).

**FR-40 (Event-driven).** WHEN the user taps the zoom-out button, THE Editor_Screen SHALL decrease the Viewport_State's zoom by a fixed step (÷1.25).

**FR-41 (Event-driven).** WHEN the user taps the "100%" button, THE Editor_Screen SHALL reset the Viewport_State to `identityViewport()` from `canvas-core`.

**FR-42 (Event-driven).** WHEN the user taps the fit-to-view button, THE Editor_Screen SHALL compute a zoom level that fits the document within the available canvas area with padding, and update the Viewport_State accordingly.

### 4.12 Document bootstrap

**FR-43 (Event-driven).** WHEN the Editor_Screen mounts, THE Editor_Screen SHALL call `editorStore.loadDocument(documentId)`. IF the store's `loadDocument` returns a sentinel (width=0, height=0 — indicating no server connection), THE Editor_Screen SHALL create a Bootstrap_Document locally and populate the store.

**FR-44 (Ubiquitous).** THE Bootstrap_Document SHALL be created with `createDocument({ preset: 'square', name: 'Untitled' })` and SHALL include one initial paint layer named "Layer 1" created via `addLayer(doc, { kind: 'paint', name: 'Layer 1' })` from `canvas-core`.

**FR-45 (Ubiquitous).** THE Bootstrap_Document SHALL be stored in the Editor_Store's `canvasSlice` (as `document`) and `layersSlice` (as `layers`), with the initial paint layer set as `activeLayerId`.

### 4.13 Active layer indicator

**FR-46 (Ubiquitous).** THE Canvas_View SHALL render a subtle border around the active layer using `drawActiveLayerBorder` from `canvas-skia`, driven by the `activeLayerId` from the Editor_Store.

### 4.14 Eyedropper tool

**FR-47 (Event-driven).** WHEN the user selects the Eyedropper tool from the Tool_Rail and taps on the canvas, THE Editor_Screen SHALL use the `SkiaRenderAdapter.hitTest` to identify the tap point, sample the composited color at that point, and update the Editor_Store's `brush.color` with the sampled color.

**FR-48 (Event-driven).** WHEN the user long-presses on the canvas (with any tool active), THE Gesture_Compositor SHALL temporarily activate the eyedropper behavior per `canvas-fundamentals` FR-28, sample the color, and return to the previous tool on release.

## 5. Non-functional requirements

**NFR-1 (Ubiquitous).** THE Canvas_View SHALL maintain 60 FPS during pinch/pan/rotate gestures on iPad Pro M-class hardware with up to 10 layers.

**NFR-2 (Ubiquitous).** THE brush stroke rendering latency (stylus event to screen update) SHALL be 30 ms or less on iPad Pro M-class, matching `brush-system` FR-30.

**NFR-3 (Ubiquitous).** THE Editor_Screen mount time (from navigation to first canvas frame) SHALL be 500 ms or less on iPad Pro M-class, including Bootstrap_Document creation and store population.

**NFR-4 (Ubiquitous).** THE Layer_Panel SHALL use a virtualized list (`FlatList` with `windowSize`) to maintain 60 FPS with up to 50 layers, per `canvas-fundamentals` NFR-2.

**NFR-5 (Ubiquitous).** THE Gesture_Compositor SHALL resolve gesture conflicts within one frame (16 ms) to avoid perceptible input lag.

**NFR-6 (Ubiquitous).** Image bytes SHALL NOT enter any Zustand store, per `client-state-architecture` FR-25. The Canvas_View holds pixel data in Skia surface refs; stores hold metadata and URIs only.

## 6. Out of scope

- **New library code** — this spec wires existing implementations; it does not add features to `canvas-core`, `canvas-skia`, `selection-tools`, `transform-tools`, `mask-system`, or `brush-system`.
- **Server communication** — full client SDK wiring is deferred to `client-sdk` / `document-management`. This spec works with `client={null}` and local-only operations.
- **Document persistence** — create/open/save/delete lifecycle is the `document-management` spec.
- **Drag-and-drop image import** — requires OS integration beyond this wiring spec.
- **Clipboard paste** — requires OS clipboard API integration.
- **Camera capture** — requires Expo Camera adapter.
- **Multi-client coordination** — requires a connected client SDK.
- **Control layers and regions UI** — wired in their own integration specs.
- **Generation workflow UI** — wired in `generation-workflow` integration.
- **Chat panel wiring** — wired in `chat-panel` spec.
- **Tests** — deferred per `.kiro/steering/testing.md`.
- **Custom brush import (ABR)** — deferred to post-v1.
- **Color picker UI** — the brush color disc is a separate UI component; this spec wires the brush preset picker and the eyedropper, not the full color picker.

## 7. Open questions

### Q1 — Should the Bootstrap Document be created client-side or should we stub a server response?
The `loadDocument` action in `editorStore` currently returns a sentinel (width=0) when no client is attached.

**Recommendation:** **client-side bootstrap.** Create the document using `createDocument()` from `canvas-core` directly in the Editor screen's mount effect. This avoids any server dependency and gives the user an immediate canvas. When `document-management` lands, the bootstrap is replaced by a real `loadDocument` call.

### Q2 — Where should the Viewport state live — in the Editor Store or in component-local state?
Viewport (zoom/pan/rotate) is ephemeral per-session and changes at 60Hz during gestures.

**Recommendation:** **component-local state** (React `useRef` + `useState` for the committed value). Viewport changes at gesture frequency (60Hz) and should not trigger Zustand subscriptions on every frame. The committed viewport is passed to `<CanvasView />` as a prop. This matches `canvas-fundamentals` Q5 (ephemeral, not persisted).

### Q3 — Should the StoresProvider be mounted at the app root or at the Editor route level?
The provider needs to wrap the Editor screen but could also wrap the entire app for future screens that need store access.

**Recommendation:** **app root** (`app/_layout.tsx`). Other screens (Documents, Settings) will eventually need `connectionStore` and `modelsStore`. Mounting at the root avoids remounting stores on navigation. The `client` prop starts as `null` and is updated when pairing completes.

### Q4 — How should the gesture compositor handle the transition between tool gestures and navigation gestures mid-touch?
A user might start a pinch (navigation) and then lift one finger to continue as a single-finger drag (painting).

**Recommendation:** **once a gesture is recognized, it owns the touch sequence until all fingers lift.** A pinch that loses a finger becomes a pan (still navigation), not a paint stroke. This matches Procreate's behavior and avoids accidental strokes during navigation.

### Q5 — Should brush strokes be committed locally (optimistic) or wait for server confirmation?
With `client={null}`, strokes can only be local. When a client is wired, should we commit optimistically?

**Recommendation:** **local-only in this spec** (no client). When `client-sdk` wiring lands, strokes commit optimistically per `client-state-architecture` Q5 (fast, reversible mutations are optimistic). The undo system captures the stroke as a Command regardless.

## 8. Acceptance criteria

This spec is APPROVED when:

1. The nine user stories (§3) are realized by the integration wiring.
2. `CanvasPlaceholder` is fully replaced by `<CanvasView />` rendering a real `Document`.
3. The layer panel reads from and writes to `editorStore` (no mock data).
4. All five brush presets are selectable and produce visible strokes with pressure sensitivity.
5. Pinch/pan/rotate gestures control the viewport smoothly.
6. Selection tools produce visible selections (marching ants) on the canvas.
7. Transform mode shows handles and applies transforms to the active layer.
8. Two-finger tap = undo, three-finger tap = redo, with toast confirmation.
9. The `StoresProvider` is mounted and all store hooks resolve correctly.
10. The Editor screen boots to a usable canvas in under 500 ms.
11. No new library code is added to `libs/` packages — only wiring in `apps/mobile`.
