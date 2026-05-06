# Implementation Plan: Editor Canvas Integration

## Overview

Wire existing, tested library implementations (`canvas-core`, `canvas-skia`, `@diffusecraft/core` stores, `brush-system`, `selection-tools`, `transform-tools`, `mask-system`, `undo-redo-system`) into the `apps/mobile` Editor screen. No new library code — only integration wiring in `apps/mobile/`. Six new files, five modified files, replacing `CanvasPlaceholder` with a live canvas.

## Tasks

- [x] 1. Mount StoresProvider at app root and create useDocumentBootstrap hook
  - [x] 1.1 Wrap Slot with StoresProvider in app/_layout.tsx
    - Import `StoresProvider` from `@diffusecraft/core`
    - Wrap `<Slot />` (and siblings PortalHost, ToastProvider, StatusBar) with `<StoresProvider client={null}>`
    - `registerUndoToastAdapter` call already exists — no change needed there
    - _Requirements: FR-5, FR-6, FR-7_
  - [x] 1.2 Create `src/screens/Editor/useDocumentBootstrap.ts`
    - Implement the hook per design §4.2: call `loadDocument(documentId)`, detect sentinel (width=0, height=0), create bootstrap document via `createDocument({ preset: 'square', name: 'Untitled' })` from `canvas-core`
    - Add initial paint layer via `addLayer(doc, { kind: 'paint', name: 'Layer 1' })` from `canvas-core`
    - Populate `editorStore` with document metadata (`setDocument`), layers (`setLayers`), and active layer (`setActiveLayer`)
    - Return the full `Document` object (pixel data stays out of Zustand per NFR-6)
    - Use cancellation flag in the effect cleanup to prevent stale updates
    - _Requirements: FR-2, FR-43, FR-44, FR-45_

- [x] 2. Create useViewport hook and ZoomControls component
  - [x] 2.1 Create `src/screens/Editor/useViewport.ts`
    - Implement per design §4.4: `useRef<Viewport>` for gesture-frequency updates (60Hz, no re-render), `useState<Viewport>` for committed value
    - Initialize with `identityViewport()` from `canvas-core`
    - Expose `updateDuringGesture(updater)` — mutates ref only
    - Expose `commit()` — copies ref to state, triggers re-render
    - Expose `zoomIn` (×1.25), `zoomOut` (÷1.25), `resetZoom` (identity), `fitToView` (fit document in container with padding)
    - Use `zoomBy`, `panBy`, `rotateBy` from `canvas-core` for all viewport mutations
    - Store a `SkiaRenderAdapter` ref via `setAdapter` callback
    - _Requirements: FR-19, FR-20, FR-21, FR-39, FR-40, FR-41, FR-42_
  - [x] 2.2 Create `src/screens/Editor/ZoomControls.tsx`
    - Extract the floating zoom controls Card from `CanvasPlaceholder.tsx` into a standalone component
    - Accept props: `zoom`, `onZoomIn`, `onZoomOut`, `onReset`, `onFitToView`
    - Display current zoom percentage from the `zoom` prop
    - Wire buttons to the corresponding viewport callbacks
    - Keep the same styling (absolute top-right, ghost buttons, `bg-elevated/90`)
    - _Requirements: FR-39, FR-40, FR-41, FR-42_

- [x] 3. Checkpoint — Ensure TypeScript compiles
  - Run `nx typecheck mobile` to verify no type errors from the new hooks and components. Ask the user if questions arise.

- [x] 4. Create CanvasArea, gesture compositor, and tool gesture hooks
  - [x] 4.1 Create `src/screens/Editor/useToolGestures.ts`
    - Implement per design §4.6: return a `forTool(activeTool)` function that builds the appropriate `Gesture.Pan` / `Gesture.Tap` for each tool
    - Brush/eraser: single-finger Pan capturing position + pressure (`e.force` or default 0.5 per FR-17), feeding points to `composeStroke` from `canvas-core`, committing stroke on end (FR-18)
    - Lasso/rect-select: single-finger Pan capturing selection path, updating `editorStore.selectionSlice` on end (FR-26, FR-27)
    - Transform: single-finger Pan for translate/scale with snap targets from `transform-tools` (FR-22, FR-23, FR-24)
    - Eyedropper: Tap to sample color via `SkiaRenderAdapter.hitTest`, update `editorStore` brush color (FR-47)
    - Mask: route brush strokes to mask painting pipeline when active layer is mask kind (FR-29)
    - Default/unknown: disabled Pan (pass-through to navigation)
    - Use `viewportToDocument` from `canvas-core` to convert screen coordinates to document space
    - _Requirements: FR-16, FR-17, FR-18, FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29, FR-47_
  - [x] 4.2 Create `src/screens/Editor/useGestureCompositor.ts`
    - Implement per design §4.5: build `Gesture.Exclusive` tree with precedence: tool > navigation > undo/redo > eyedropper long-press
    - Navigation: `Gesture.Simultaneous(pinchZoom, twoPan, twoRotate)` — pinch calls `zoomBy`, pan calls `panBy`, rotate calls `rotateBy` on the viewport ref, all commit on gesture end
    - Undo/redo: `Gesture.Race(twoFingerTap, threeFingerTap)` — two-finger tap invokes `undo()`, three-finger tap invokes `redo()` from `useUndoRedo` (FR-31, FR-32)
    - Eyedropper long-press: 500ms `Gesture.LongPress` for temporary eyedropper (FR-48)
    - Read `activeTool` from `useEditorStore` to select the correct tool gesture
    - Memoize the composed gesture, recompute when `activeTool` changes
    - _Requirements: FR-31, FR-32, FR-34, FR-35, FR-48_
  - [x] 4.3 Create `src/screens/Editor/CanvasArea.tsx`
    - Implement per design §4.3: wrap `<CanvasView />` from `canvas-skia` inside `<GestureDetector>`
    - Accept `document: Document | null` prop
    - Use `useViewport(document)` for viewport state
    - Use `useGestureCompositor(viewport)` for the composed gesture
    - Provide stub `loadBytes` callback returning empty `Uint8Array` (FR-3)
    - Pass `viewport.committed` to `<CanvasView />` as the viewport prop
    - Pass `viewport.setAdapter` to `onAdapterReady`
    - Render `<ZoomControls>` overlay with viewport callbacks
    - Style: `flex: 1` to fill available area between floating chrome (FR-4)
    - _Requirements: FR-1, FR-3, FR-4_

- [x] 5. Checkpoint — Ensure TypeScript compiles
  - Run `nx typecheck mobile` to verify the gesture and canvas components compile. Ask the user if questions arise.

- [x] 6. Wire Editor screen: replace CanvasPlaceholder and integrate bootstrap
  - [x] 6.1 Update `src/screens/Editor/index.tsx` — replace CanvasPlaceholder with CanvasArea
    - Remove `CanvasPlaceholder` import, add `CanvasArea` import
    - Call `useDocumentBootstrap(documentId)` to get the `Document` object
    - Replace `<CanvasPlaceholder ... />` with `<CanvasArea document={doc} />`
    - Remove the `showSelection` prop logic (selection is now driven by store state)
    - _Requirements: FR-1, FR-2, FR-43_
  - [x] 6.2 Update `src/screens/Editor/useEditorState.ts` — remove activeTool (moved to store)
    - Remove `activeTool` and `setActiveTool` from `EditorLocalState` and the hook
    - Keep `workspace`, `rightPanelTab`, `inpaintMode`, `chatOpen` as local state (these are UI-only, not canvas state)
    - Update the `EditorLocalState` interface and return type accordingly
    - _Requirements: FR-36_
  - [x] 6.3 Update `src/screens/Editor/index.tsx` — rewire LeftToolRail to editorStore
    - Remove `state.activeTool` and `state.setActiveTool` references
    - The LeftToolRail will read `activeTool` from the store directly (see task 7.1)
    - Pass only `onToggleLayers` to LeftToolRail (undo/redo already wired via `useUndoRedo` hook internally)
    - Remove the wrapping `<View>` around LeftToolRail if it conflicts with the rail's own absolute positioning
    - _Requirements: FR-36, FR-37, FR-38_

- [x] 7. Rewire LeftToolRail and Layer panel to editorStore
  - [x] 7.1 Update `src/screens/Editor/LeftToolRail.tsx` — read activeTool from store
    - Import `useEditorStore` from `@diffusecraft/core`
    - Read `activeTool` from `useEditorStore((s) => s.activeTool)` instead of the `activeTool` prop
    - Create `TOOL_MAP` mapping rail IDs to `{ tool, preset? }` per design §4.8
    - Replace `onToolChange` prop with internal handler that calls `editorStore.setActiveTool(tool)` and `editorStore.setBrush(preset)` when applicable (FR-15)
    - Import `getBrushPreset` (or equivalent) from `canvas-core` to look up preset settings
    - Keep `onToggleLayers` prop for the layers toggle button
    - Simplify the props interface: remove `activeTool`, `onToolChange`, `onUndo`, `onRedo`
    - _Requirements: FR-15, FR-36, FR-37, FR-38_
  - [x] 7.2 Update `src/screens/Editor/RightPanel/Layers.tsx` — replace MOCK_LAYERS with store
    - Import `useEditorStore` from `@diffusecraft/core`
    - Replace `MOCK_LAYERS` local state with `useEditorStore((s) => s.layers)` for the layer list (FR-8)
    - Read `activeLayerId` from `useEditorStore((s) => s.activeLayerId)` — replace hardcoded `rows[0]?.id`
    - Wire tap-to-select: call `editorStore.setActiveLayer(layerId)` on row press (FR-9)
    - Wire visibility toggle: call `editorStore.patchLayer(layerId, { visible })` (FR-10)
    - Wire opacity slider: call `editorStore.patchLayer(layerId, { opacity })` (FR-11)
    - Wire "+ Add layer": use `addLayer` from `canvas-core` to create a new paint layer, update store layers and set as active (FR-12)
    - Wire swipe-to-delete: use `removeLayer` from `canvas-core`, update store (FR-13)
    - Wire drag-to-reorder: use `reorderLayer` from `canvas-core`, update store (FR-14)
    - Make each layer row a `Pressable` to support tap-to-select
    - _Requirements: FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14_

- [x] 8. Checkpoint — Ensure TypeScript compiles and manual verification
  - Run `nx typecheck mobile` to verify all wiring compiles cleanly. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Final wiring: mask overlay, selection overlay, active layer border, and cleanup
  - [x] 9.1 Wire mask painting overlay and selection overlay in CanvasArea
    - Ensure `CanvasView` receives the active layer kind so it renders the mask preview overlay (red translucent) when a mask layer is active (FR-30)
    - Ensure `CanvasView` renders selection overlay (marching ants) via `drawSelectionOverlay` from `canvas-skia`, driven by `editorStore.selectionSlice` (FR-27)
    - Ensure `CanvasView` renders active layer border via `drawActiveLayerBorder` from `canvas-skia`, driven by `activeLayerId` from store (FR-46)
    - _Requirements: FR-27, FR-30, FR-46_
  - [x] 9.2 Clean up removed placeholder and unused imports
    - Delete `CanvasPlaceholder.tsx` (fully replaced by `CanvasArea`)
    - Remove `MOCK_LAYERS` import from Layers.tsx (no longer needed)
    - Remove any unused imports across modified files
    - Verify no remaining references to `CanvasPlaceholder` in the codebase
    - _Requirements: Acceptance criteria §8 item 2_

- [x] 10. Final checkpoint — Ensure TypeScript compiles and all wiring is complete
  - Run `nx typecheck mobile`. Verify no type errors remain. All nine user stories (§3) should be exercisable via manual run on iPad simulator. Ask the user if questions arise.

## Notes

- **No tests** — deferred per `.kiro/steering/testing.md`. Verification is TypeScript type-check + manual run + visual inspection.
- **No new library code** — all changes are in `apps/mobile/`. Libraries (`canvas-core`, `canvas-skia`, `@diffusecraft/core`, etc.) are consumed as-is.
- **`client={null}`** — all store actions that require a server connection degrade gracefully (no-op or local-only). Full client SDK wiring is a separate spec.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation via `nx typecheck mobile`.
