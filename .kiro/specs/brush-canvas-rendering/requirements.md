# Requirements Document

## Introduction

This spec defines a **Procreate-grade brush rendering architecture** for the DiffuseCraft tablet client. It replaces the abandoned Draft v0.1 of `brush-canvas-rendering` and supersedes the current `SkPicture[]`-based implementation in `libs/canvas-skia` and `apps/mobile/src/screens/Editor/`.

Three architectural pillars are non-negotiable:

1. **Persistent raster per layer**: each layer owns a GPU-backed `SkSurface` that is the source of truth for its pixels. A stroke's stamps are composited onto a transient stroke-buffer surface and, on gesture end, flattened into the layer surface. `SkPicture` is forbidden as a mechanism for inter-stroke persistence.
2. **UI-thread / worklet hot path**: the chain "hardware touch event → stamp emission → pixel write" runs entirely in the UI thread (Reanimated worklet) without crossing the JS bridge. React's render cycle is never engaged during an active stroke.
3. **Real stylus input**: Apple Pencil `force` / azimuth / altitude and S-Pen `pressure` reach the stamp pipeline through a native pointer-event capture path that bypasses RNGH `Gesture.Pan` (which does not expose those fields).

This is the **architectural floor** that future brush features (tip textures, scatter, dual-brush, smudge, predictive smoothing) will sit on top of. The brush engine itself remains minimal in v1 (round soft alpha disc with linear hardness falloff + basic pressure→size/opacity mapping).

References: P22 (tablet-first), P26 (no client inference), P27 (universal undo/redo — consumer of this spec, not produced here), P25 (no half-finished — old `SkPicture[]` path is removed wholesale).

## Boundary Context

- **In scope**:
  - The end-to-end real-time stroke rendering pipeline from raw pointer event to committed layer pixels.
  - Per-layer persistent raster surface model.
  - Per-gesture transient stroke buffer surface.
  - Stateful incremental stamp emission compatible with the worklet runtime.
  - Native Apple Pencil / S-Pen / finger pointer-event capture.
  - Round soft alpha-disc stamp with linear hardness falloff, paint/erase/mask blend modes.
  - Simulator-vs-device fallback policy for offscreen GPU surfaces.
  - Replacement and removal of the current `SkPicture[]`-based implementation, including dead `SkiaRenderAdapter.drawDocument`, stub `rasterizeDocument`, and `committedPictures` retention.

- **Out of scope**:
  - Tip textures / tip atlas (post-v1, future `brush-engine-procreate` spec).
  - Tilt-to-stamp rotation rendering (post-v1).
  - Scatter, dual-brush, smudge brushes (post-v1).
  - Predictive or spline-based smoothing (Catmull-Rom, cardinal). Existing moving-average smoothing is preserved as-is.
  - Server-side stroke materialization (handled by `client-sdk`).
  - Undo/redo wiring (consumed by `undo-redo-system`; this spec only provides the snapshot/dirty-rect surface that undo/redo needs to capture).
  - Full document-level export pipeline (separate concern; this spec only defines per-layer surface state).

- **Adjacent expectations**:
  - From `canvas-fundamentals`: layer model (id, visible, opacity, blend mode, kind, bounds) and viewport state (zoom, pan, rotation).
  - From `brush-system` (Phase A+B, already implemented): brush presets, `StrokePoint` and `Stamp` types, `samplePressureCurve`, the existing `expandStrokeToStamps` pure-TS implementation that this spec replaces with an incremental stateful version.
  - From `editor-canvas-integration`: the gesture surface that hosts the canvas and the active-tool state in `editorStore`.
  - To `undo-redo-system`: this spec exposes a per-stroke commit hook so undo/redo can snapshot the affected layer region.
  - To `client-sdk`: this spec exposes the stroke point sequence and final layer image so server-side `paint_strokes` materialization stays consistent.

## Requirements

### Requirement 1: Persistent layer pixel model and stroke lifecycle

**Objective:** As an illustrator, I want each stroke I draw to land in the layer's pixel data so that subsequent strokes composite correctly on top of previous ones and the canvas behaves like a real raster painting surface.

#### Acceptance Criteria

1. The Canvas Rendering Pipeline shall maintain one GPU-backed `SkSurface` per paint layer, sized to the layer's bounds, as the canonical source of truth for the layer's pixel data.
2. When the user begins a brush or eraser gesture on a paint layer, the Canvas Rendering Pipeline shall allocate a transient stroke buffer (SkSurface or SkPicture, at the design's discretion) sized to the active layer's bounds, or to the stroke's bounding box plus padding when the layer exceeds 4096×4096; the buffer shall live for the gesture only.
3. While a brush gesture is active, the Canvas Rendering Pipeline shall draw new stamps into the transient stroke buffer only, leaving the layer surface untouched.
4. When the brush gesture ends successfully, the Canvas Rendering Pipeline shall flatten the transient stroke buffer onto the active layer's surface using the stroke's blend mode (SrcOver for paint, DstOut for erase, alpha-only luminance for mask layers) — via `drawImage` when the buffer is an SkSurface or `drawPicture` when the buffer is an SkPicture — and shall dispose the transient buffer.
5. When the brush gesture is canceled (interruption, multi-touch, tool switch mid-stroke), the Canvas Rendering Pipeline shall dispose the transient stroke buffer without modifying the layer surface.
6. The Canvas Rendering Pipeline shall not use `SkPicture`, `SkPicture[]`, `PictureRecorder` output, or any equivalent retained-mode command list as the mechanism for storing committed strokes between gestures. Intra-stroke use of an `SkPicture` as the transient stroke buffer is allowed and does not violate this constraint.
7. While multiple sequential strokes are drawn on the same layer, the Canvas Rendering Pipeline shall ensure each committed stroke is part of the layer's pixel data before the next stroke begins, so subsequent strokes composite against the committed result.

### Requirement 2: UI-thread hot path with no JS bridge crossings

**Objective:** As an illustrator using Apple Pencil at 120 Hz, I want strokes to follow my stylus tip without perceptible lag, so that drawing feels like ink, not like a remote-controlled cursor.

#### Acceptance Criteria

1. While a brush gesture is active, the Stroke Input Pipeline shall execute touch-event handling, stamp expansion, and stamp draw submission in the UI thread (Reanimated worklet runtime) without crossing the JS bridge in the steady-state per-event path.
2. The Stroke Input Pipeline shall not use `Gesture.Pan().runOnJS(true)` (or any equivalent JS-thread hand-off) for the brush or eraser tool's per-event handlers.
3. While a brush gesture is active, the Stroke Input Pipeline shall not trigger React render cycles on `<Canvas>`, `<CanvasView>`, or any ancestor component owned by the editor screen.
4. When `<CanvasView>` mounts, the Canvas Rendering Pipeline shall mount the underlying `<Canvas>` exactly once for the lifetime of the editor session (excluding navigation away from the editor) so that gesture state is not torn down by React re-renders.
5. The Stroke Input Pipeline shall not allocate JavaScript objects on the JS thread in response to per-stamp or per-touch-event work during an active stroke; per-event allocations shall occur on the UI thread runtime only.
6. If a worklet-side error occurs during stroke handling, the Stroke Input Pipeline shall log the error to the JS thread on the next frame (out-of-band) and shall finalize or cancel the stroke gracefully without leaking the stroke-buffer surface.

### Requirement 3: Stateful incremental stamp emission

**Objective:** As an illustrator drawing long strokes (multi-thousand-stamp arcs), I want stroke responsiveness to remain constant from the first stamp to the last, so that the engine does not slow down as the stroke grows.

#### Acceptance Criteria

1. The Stamp Expansion Engine shall maintain per-stroke state including the index of the last consumed input point, the position of the last emitted stamp, and the distance traveled inside the current segment.
2. When a new input point is appended to an active stroke, the Stamp Expansion Engine shall emit only the stamps that fall on the segment from the last emitted stamp to the new point, without re-walking input points already consumed in earlier emissions.
3. The Stamp Expansion Engine shall expose its API in a form callable from a Reanimated worklet (no closures over non-shareable JS objects, no module-level mutable state shared across strokes).
4. While processing a single input point, the Stamp Expansion Engine shall complete its work in time bounded by the number of new stamps emitted on that segment, not by the total length of the stroke so far.
5. When a stroke ends, the Stamp Expansion Engine shall release its per-stroke state so memory does not grow across sequential strokes.

### Requirement 4: Resource pooling discipline in the stroke hot path

**Objective:** As an illustrator drawing at 120 Hz, I want the engine to avoid garbage-collection pauses mid-stroke, so that strokes stay smooth and frame pacing is predictable.

#### Acceptance Criteria

1. When a brush gesture begins, the Stamp Renderer shall allocate exactly one `SkPaint` and at most one `SkShader` for the lifetime of the stroke, sized for the stroke's color, hardness, and erase flag (which are immutable for the stroke).
2. While a brush gesture is active, the Stamp Renderer shall reuse the per-stroke `SkPaint` and `SkShader` for every stamp; per-stamp Skia object allocation shall not occur in the hot path.
3. When a brush gesture ends or is canceled, the Stamp Renderer shall release the per-stroke `SkPaint` and `SkShader` so they do not retain native memory beyond the stroke.
4. The Stamp Renderer shall apply per-stamp position, scale, and opacity through canvas transform and per-call alpha modulation rather than by re-creating shaders or paints.

### Requirement 5: Round soft alpha-disc stamp rendering

**Objective:** As an illustrator using v1 brushes, I want a single high-quality round soft brush whose hardness controls the edge falloff, so that v1 ships with a usable pen/pencil/marker/eraser/smooth set without committing to a textured-tip engine yet.

#### Acceptance Criteria

1. The Stamp Renderer shall draw each stamp as a circular alpha disc centered on the stamp's document-space coordinates, with diameter equal to `stamp.size`.
2. Where the active brush's hardness equals 1, the Stamp Renderer shall produce a solid-edged disc whose alpha is uniformly `stamp.opacity` inside the disc.
3. Where the active brush's hardness equals 0, the Stamp Renderer shall produce a fully soft disc whose alpha falls off linearly from `stamp.opacity` at the center to 0 at the edge.
4. While the active brush has hardness between 0 and 1, the Stamp Renderer shall hold alpha at `stamp.opacity` from the center out to `hardness × radius` and shall fall linearly to 0 from there to the edge.
5. While the active stroke is a paint stroke on a non-mask paint layer, the Stamp Renderer shall composite stamps using SrcOver blend mode with the active brush color.
6. While the active stroke is an erase stroke on a non-mask paint layer, the Stamp Renderer shall composite stamps using DstOut blend mode so coverage subtracts from the destination's alpha.
7. While the active layer is a mask layer, the Stamp Renderer shall render stamps as alpha-only contributions whose intensity equals `stamp.opacity × luminance(brush_color)`, regardless of the brush's RGB channels.

### Requirement 6: Real stylus input on the UI thread

**Objective:** As an illustrator with Apple Pencil or S-Pen, I want the engine to read real pressure (and tilt where available) from my stylus on the UI thread, so that brush size and opacity respond to the way I actually press without JS-thread round-trips.

> **Discovery note (2026-05-05):** `react-native-gesture-handler` 2.20+ (the project has 2.30.0) added cross-platform `event.stylusData` (`pressure`, `tiltX`, `tiltY`, `altitudeAngle`, `azimuthAngle`) on `Gesture.Pan` and other gesture types, delivered inside the worklet body of `onBegin` / `onUpdate`. Under the hood this wraps iOS `UITouch.force` / `azimuthAngle` / `altitudeAngle` and Android `MotionEvent.AXIS_PRESSURE` / `AXIS_TILT`. The original "bypass RNGH" sub-clause was based on the assumption that those fields were not exposed; that assumption no longer holds. The high-level goal (real stylus data on the UI thread) is met without a custom native module. A custom native module remains an option only if Apple Pencil Pro fields (rollAngle, perpendicularForce) are needed in the future, which is out of scope for v1.

#### Acceptance Criteria

1. The Stylus Input Pipeline shall capture stylus pressure and tilt fields through `react-native-gesture-handler` 2.20+'s `event.stylusData` API on `Gesture.Pan` (or equivalent gesture), or through a custom native pointer-event channel when the RNGH API is insufficient for a required field. The choice shall be documented in `design.md`.
2. When a stylus event reports a `stylusData.pressure` value (Apple Pencil `force` or S-Pen `pressure`), the Stylus Input Pipeline shall map it to the `StrokePoint.pressure` field clamped to [0, 1].
3. When a stylus event reports `stylusData.azimuthAngle` and `stylusData.altitudeAngle`, the Stylus Input Pipeline shall convert them to `StrokePoint.tilt_x` and `StrokePoint.tilt_y` in degrees clamped to [-90, 90], using the formulas defined in `stylus-adapter.ts`.
4. If the first event of a stroke from an Apple Pencil reports `pressure=0`, then the Stylus Input Pipeline shall discard that event and treat the second event as the stroke's starting point.
5. If a captured event has no `stylusData` (finger touch, mouse), then the Stylus Input Pipeline shall use a default pressure of 0.5 for that event and shall not populate tilt fields.
6. The Stylus Input Pipeline shall expose stylus values inside the worklet runtime that the rest of the stroke pipeline runs in (Requirement 2), without a JS-thread round-trip in the steady-state per-event path.

### Requirement 7: Brush preset integration

**Objective:** As an illustrator, I want my preset selection (pen / pencil / marker / eraser / smooth) and adjustments (size / opacity / hardness) to drive the rendered stroke, so that switching presets changes the stroke characteristics immediately.

#### Acceptance Criteria

1. When a brush gesture begins, the Stamp Renderer shall read the active preset (size, hardness, opacity, spacing, pressure curve, erase flag) from the editor state at gesture-begin time and shall hold those values for the gesture's lifetime.
2. While a brush gesture is active, the Stamp Renderer shall ignore any change to preset, size, hardness, or opacity that happens mid-stroke; changes apply to the next stroke.
3. When the user changes the active preset between strokes, the Stamp Renderer shall use the new preset for the next stroke without requiring a canvas reset, layer rebuild, or gesture system re-mount.
4. The Stamp Renderer shall pass the resolved preset to the Stamp Expansion Engine so spacing and pressure-curve scaling produce consistent stamp counts and sizes between the runtime renderer and the server-side `paint_strokes` materializer.

### Requirement 8: Viewport integration

**Objective:** As an illustrator, I want strokes to draw at full document resolution regardless of zoom, so that zooming in after drawing reveals crisp stamp edges, not pixelated screen-space artifacts.

#### Acceptance Criteria

1. The Canvas Rendering Pipeline shall render stamps in document-space coordinates (not screen-space coordinates).
2. While the viewport is zoomed in, the Canvas Rendering Pipeline shall keep the layer surface at the layer's full document resolution and shall apply the viewport transform (zoom, pan, rotation) only at the final composite step.
3. When the viewport changes (zoom, pan, rotation) between strokes, the Canvas Rendering Pipeline shall not re-rasterize or invalidate any committed layer pixels.
4. While a brush gesture is active, the Stroke Input Pipeline shall convert raw pointer-event screen coordinates to document coordinates before feeding them to the Stamp Expansion Engine, using the current viewport state.

### Requirement 9: Latency, throughput, and memory bounds

**Objective:** As an illustrator on iPad Pro M-class, I want sub-30-ms input-to-pixel latency, sustained 60 fps on long strokes, and memory that does not grow unbounded with stroke length, so that the engine matches what a serious raster painting app feels like.

#### Acceptance Criteria

1. The Canvas Rendering Pipeline shall produce a visible pixel within ≤ 30 ms of the originating hardware touch event on iPad Pro M-class devices, measured from the OS pointer event timestamp to the frame in which the corresponding pixel is on screen.
2. While a stroke contains up to 2000 stamps, the Canvas Rendering Pipeline shall render and composite the stroke without dropping below 60 fps on iPad Pro M-class devices.
3. The Canvas Rendering Pipeline shall bound the memory footprint of an active stroke to one RGBA stroke-buffer surface at the active layer's dimensions (≈ 16 MB at 2048×2048).
4. While the active layer's dimensions exceed 4096×4096, the Canvas Rendering Pipeline shall clip the stroke-buffer surface to the stroke's running bounding box plus a stamp-radius padding margin so memory does not scale with empty layer area.
5. While 1000+ strokes are committed on a single layer, the Canvas Rendering Pipeline shall keep frame composite cost within the 60 fps budget by drawing a single layer image per frame, regardless of how many historical strokes contributed to that image.
6. When a stroke is committed or canceled, the Canvas Rendering Pipeline shall release every native handle (paint, shader, stroke-buffer surface) it allocated for the stroke so native memory does not grow across sequential strokes.

### Requirement 10: Simulator-vs-device fallback strategy

**Objective:** As a developer running the editor in iOS Simulator, I want a documented degraded fallback when GPU offscreen surfaces misbehave, so that a simulator-specific quirk never forces an architectural compromise on device.

#### Acceptance Criteria

1. The Canvas Rendering Pipeline shall use a GPU-backed offscreen `SkSurface` for the stroke buffer and per-layer surfaces on physical iOS / Android devices.
2. If the runtime detects iOS Simulator and `Skia.Surface.MakeOffscreen` produces a surface that fails to render through `<Image>` / `<Picture>` for the per-layer flatten path, then the Canvas Rendering Pipeline shall fall back to a CPU-backed offscreen surface or a re-encoded `SkImage` route limited to the simulator runtime.
3. The Canvas Rendering Pipeline shall log the chosen path (GPU, CPU-fallback, simulator-fallback) once at session start so developers can confirm which path is active.
4. The Canvas Rendering Pipeline shall not use simulator-only behavior (or simulator-only failures) as the basis for architectural choices that affect the device path; device behavior is canonical.
5. The Canvas Rendering Pipeline shall document the fallback policy in a code comment at the surface-allocation site so future maintainers do not repeat the previous pivot to `SkPicture[]`.

### Requirement 11: Replacement of the legacy `SkPicture[]` implementation

**Objective:** As a maintainer of the canvas-skia and editor codebases, I want the abandoned implementation removed wholesale, so that no half-finished path remains in the main branch (per principle P25).

#### Acceptance Criteria

1. The Canvas Rendering Pipeline shall replace the existing `StampRenderer` chunked-`SkPicture` implementation in `libs/canvas-skia/src/brush/StampRenderer.ts` with the persistent-surface implementation defined by this spec.
2. The Canvas Rendering Pipeline shall remove the `committedPictures: SkPicture[]`, `committedPictureCache`, `getCommittedPicture`, `getActiveStrokePicture`, `setActiveStrokeBuffer`, `commitActiveStroke`, and `clearActiveStrokeBuffer` paths from `SkiaRenderAdapter` (`libs/canvas-skia/src/adapter.ts`).
3. The Canvas Rendering Pipeline shall remove or rewrite `SkiaRenderAdapter.drawDocument` so that no dead code path remains; the visible rendering path shall be a single, named pipeline.
4. The Canvas Rendering Pipeline shall remove the placeholder `rasterizeDocument` that returns the last cached blob, and shall replace it with either a faithful per-layer snapshot pipeline or a deletion accompanied by an explicit "not provided here" note in the spec's downstream consumers.
5. The Canvas Rendering Pipeline shall remove `Gesture.Pan().runOnJS(true)` and the associated JS-thread orchestration in `apps/mobile/src/screens/Editor/useToolGestures.ts` and `apps/mobile/src/screens/Editor/useBrushRenderer.ts`, replacing them with the worklet-driven path required by Requirement 2.
6. The Canvas Rendering Pipeline shall not preserve the legacy `SharedValue<SkPicture>` plumbing (`activePicture`, `committedPicture`, `EMPTY_PICTURE` sentinel) in `CanvasView.tsx` once the persistent-surface path is in place.

### Requirement 12: Snapshot surface for undo/redo and server materialization consumers

**Objective:** As the `undo-redo-system` and `client-sdk` specs that depend on this spec, I want a deterministic way to read a layer's current pixel state and the bounding box dirtied by the last stroke, so that snapshotting and server replication stay correct without reaching into the rendering internals.

#### Acceptance Criteria

1. When a stroke is committed, the Canvas Rendering Pipeline shall expose the bounding box of the dirtied region in document-space coordinates so that consumers can scope snapshots and server-side replication to the affected pixels.
2. The Canvas Rendering Pipeline shall provide a synchronous read API that returns the active layer's current pixel data as an `SkImage` reference (no encoded copy required) for use by undo/redo snapshot capture.
3. The Canvas Rendering Pipeline shall not couple commit semantics to undo-stack push, server-side materialization, or any other downstream side effect; consumers subscribe to the commit event and are responsible for their own work.
4. While no stroke is active, the read API for layer pixel state shall be safe to call from the JS thread without contending with worklet runtime work.
