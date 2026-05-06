# brush-canvas-rendering — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `brush-system` (Phase A+B: types, presets, stroke expansion), `editor-canvas-integration` (gesture capture, CanvasView, useToolGestures), `canvas-fundamentals` (layer model, viewport).
> **References:** `brush-system` Phase C (Skia stamp renderer — deferred), Phase D (stylus input adapter — deferred), Procreate (real-time ink feel), P22 (tablet reference).

## 1. Purpose

Wire the Skia-side rendering of brush strokes so that when the user draws with a stylus or finger on the tablet, stamps appear as pixels on the Skia canvas in real-time. This spec bridges the gap between:

- **canvas-core** (pure logic: `expandStrokeToStamps`, `smoothStrokePoints`, pressure mapping) — already implemented.
- **useToolGestures** (gesture capture: touch/stylus input → `StrokePoint[]`) — already implemented.
- **canvas-skia CanvasView** (Skia surface rendering) — already implemented for layer compositing.

What is **missing** is the rendering pipeline that takes accumulated `StrokePoint[]` during a gesture, expands them to `Stamp[]` via `expandStrokeToStamps`, and draws those stamps onto the Skia surface in real-time (every frame during the gesture), then commits the final stroke to the layer's pixel data on gesture end.

Additionally, this spec covers enhanced stylus input (Apple Pencil pressure/tilt, S-Pen pressure) so that the `StrokePoint` data fed to the renderer carries accurate hardware values.

## 2. Glossary

- **Stamp_Renderer**: The Skia-based component in `canvas-skia` that draws individual `Stamp` records onto a Skia surface using radial alpha-disc shaders with hardness falloff.
- **Stroke_Buffer**: A transient Skia surface (same dimensions as the active layer) that accumulates stamps during an in-progress stroke before committing to the layer.
- **Incremental_Rendering**: Drawing only the new stamps since the last frame, rather than re-drawing the entire stroke each frame.
- **Stylus_Adapter**: The module that reads Apple Pencil / S-Pen hardware events and maps them to `StrokePoint` fields (pressure, tilt_x, tilt_y).
- **Commit**: The act of flattening the Stroke_Buffer into the active layer's pixel data at gesture end.

## 3. Stakeholders & user stories

### S1 — Illustrator sketching with Apple Pencil
> As an illustrator with Apple Pencil, I draw on the canvas and see ink appear immediately under my stylus tip. Pressure modulates stroke width and opacity. The stroke feels responsive (no visible lag between stylus movement and ink).

### S2 — Illustrator painting a mask
> As an illustrator, I select a mask layer and paint with the Marker brush. I see a red translucent overlay appear in real-time as I paint, showing the mask coverage. Eraser subtracts from the mask in real-time.

### S3 — Illustrator using finger (no stylus)
> As an illustrator without a stylus, I draw with my finger. Strokes render at a fixed mid-pressure (0.5). The rendering is smooth and responsive.

### S4 — Illustrator erasing
> As an illustrator, I switch to eraser mode and draw over existing paint. I see pixels disappear in real-time as I stroke, with the eraser's hardness falloff visible at the edges.

### S5 — Illustrator with multiple strokes
> As an illustrator, I draw multiple strokes on the same layer. Each committed stroke persists and subsequent strokes composite correctly on top of previous ones.

## 4. Functional requirements (EARS)

### 4.1 Real-time stroke rendering

**FR-1 (Event-driven).** WHEN the user begins a Pan gesture on the canvas with the brush or eraser tool active, THE Stamp_Renderer SHALL create a Stroke_Buffer (offscreen Skia surface) matching the active layer dimensions.

**FR-2 (Event-driven).** WHEN new StrokePoints are captured during an active brush gesture, THE Stamp_Renderer SHALL expand the accumulated points to Stamp records via `expandStrokeToStamps` and draw any new stamps (since the last frame) onto the Stroke_Buffer.

**FR-3 (Event-driven).** WHEN the Stroke_Buffer is updated with new stamps, THE CanvasView SHALL composite the Stroke_Buffer on top of the active layer during the next frame draw, so the user sees the in-progress stroke in real-time.

**FR-4 (Event-driven).** WHEN the Pan gesture ends (finger/stylus lifts), THE Stamp_Renderer SHALL commit the Stroke_Buffer contents into the active layer's pixel data and dispose the Stroke_Buffer.

**FR-5 (Ubiquitous).** THE Stamp_Renderer SHALL use incremental rendering: only stamps not yet drawn are rendered each frame, avoiding re-drawing the entire stroke on every update.

### 4.2 Stamp drawing

**FR-6 (Ubiquitous).** THE Stamp_Renderer SHALL draw each Stamp as a circular alpha disc with linear hardness falloff matching the behavior of `composeStrokeIntoRaster` in canvas-core: `hardness=1` produces a solid disc, `hardness=0` produces a fully soft gradient.

**FR-7 (Ubiquitous).** THE Stamp_Renderer SHALL apply the stamp color (from the active brush color in editorStore) with per-stamp opacity equal to `stamp.opacity` using Skia's SrcOver blend mode for paint stamps.

**FR-8 (Ubiquitous).** THE Stamp_Renderer SHALL apply DstOut blend mode for erase stamps, removing alpha from the destination proportional to stamp coverage.

**FR-9 (State-driven).** WHILE the active layer is a mask layer, THE Stamp_Renderer SHALL render stamps as alpha-only (greyscale luminance of brush color multiplied by stamp coverage), matching `composeStrokeIntoRaster`'s maskOnly behavior.

### 4.3 Stylus input enhancement

**FR-10 (Event-driven).** WHEN an Apple Pencil event is received during a brush gesture, THE Stylus_Adapter SHALL read the `force` property (0.0–1.0) and map it to the StrokePoint `pressure` field.

**FR-11 (Event-driven).** WHEN an Apple Pencil event reports tilt (azimuth/altitude), THE Stylus_Adapter SHALL convert the tilt to `tilt_x` and `tilt_y` fields on the StrokePoint in degrees (-90..90).

**FR-12 (Event-driven).** WHEN an S-Pen event is received during a brush gesture, THE Stylus_Adapter SHALL read the pressure value and map it to the StrokePoint `pressure` field (0.0–1.0).

**FR-13 (Unwanted).** IF a stylus reports pressure=0 on the first event of a stroke (known Apple Pencil bug), THEN THE Stylus_Adapter SHALL discard that event and use the second event as the stroke start.

**FR-14 (Unwanted).** IF no pressure data is available (finger touch), THEN THE Stylus_Adapter SHALL use a default pressure of 0.5 for all points in the stroke.

### 4.4 Stroke commit and layer integration

**FR-15 (Event-driven).** WHEN a stroke is committed (gesture end), THE Stamp_Renderer SHALL flatten the Stroke_Buffer onto the active layer's backing surface using the appropriate blend mode (SrcOver for paint, DstOut for erase, alpha-only for mask).

**FR-16 (Event-driven).** WHEN a stroke is committed, THE CanvasView SHALL update the layer's cached image so subsequent frames render the committed stroke as part of the layer composite.

**FR-17 (Ubiquitous).** THE Stamp_Renderer SHALL support multiple sequential strokes on the same layer: each committed stroke becomes part of the layer's persistent pixel data before the next stroke begins.

### 4.5 Brush preset integration

**FR-18 (Ubiquitous).** THE Stamp_Renderer SHALL read the active brush preset from editorStore (preset ID, size, hardness, opacity, spacing, pressureCurve, erase flag) and pass these to `expandStrokeToStamps` for stamp generation.

**FR-19 (Event-driven).** WHEN the user changes the active brush preset mid-session (between strokes), THE Stamp_Renderer SHALL use the new preset for the next stroke without requiring a canvas reset.

### 4.6 Viewport integration

**FR-20 (Ubiquitous).** THE Stamp_Renderer SHALL render stamps in document-space coordinates. The CanvasView viewport transform (zoom, pan, rotation) SHALL be applied during final compositing so strokes appear at the correct screen position regardless of viewport state.

**FR-21 (State-driven).** WHILE the viewport is zoomed in, THE Stamp_Renderer SHALL render stamps at full document resolution (not screen resolution), so zooming in after drawing reveals crisp stamp edges.

## 5. Non-functional requirements

**NFR-1 (Ubiquitous).** Stroke rendering latency (stylus event → pixel on screen) SHALL be ≤ 30 ms on iPad Pro M-class devices. This is the critical "ink feel" threshold.

**NFR-2 (Ubiquitous).** THE Stamp_Renderer SHALL use Skia GPU-accelerated drawing primitives (drawCircle with radial gradient shader or drawImage with pre-computed alpha disc) rather than per-pixel JavaScript calculation.

**NFR-3 (Ubiquitous).** THE Stroke_Buffer SHALL be allocated once per stroke (not per frame) and reused across all frames of the gesture to avoid allocation pressure.

**NFR-4 (Ubiquitous).** THE Stamp_Renderer SHALL handle strokes of up to 2000 points (approximately 30 seconds of continuous drawing at 60Hz input) without frame drops below 60 fps.

**NFR-5 (Ubiquitous).** Memory usage for the Stroke_Buffer SHALL be bounded by one RGBA surface at document dimensions (e.g., 2048×2048 = 16 MB). For documents larger than 4096×4096, the Stroke_Buffer MAY be clipped to the stroke's bounding box plus padding.

## 6. Out of scope

- **Custom tip shapes / tip atlas** — v1 uses radial alpha discs only. Custom PNG tips are post-v1 (brush-system Phase C.1).
- **Smudge brush rendering** — push-pull pixel sampling is post-v1 (brush-system Phase C.4).
- **Tilt-to-angle stamp rotation** — tilt data is captured but stamp rotation rendering is post-v1 (brush-system Phase B.4).
- **Velocity-to-opacity modulation** — velocity data is captured but modulation rendering is post-v1 (brush-system Phase B.5).
- **Server-side stroke commit** — this spec renders locally only. Server persistence via `paint_strokes` MCP tool is a separate concern (client-sdk wiring).
- **Undo/redo integration** — local undo of committed strokes requires snapshot management that rides the client-sdk spec.
- **Pencil-only mode toggle** — UI for blocking finger paint is deferred to brush-system Phase D.4.

## 7. Acceptance criteria

This spec is APPROVED when:

1. Drawing with Apple Pencil on a paint layer produces visible, pressure-modulated strokes in real-time.
2. Drawing with finger produces visible strokes at fixed mid-pressure.
3. Eraser mode removes pixels in real-time with visible hardness falloff.
4. Mask layer painting renders alpha-only stamps (visible via mask overlay).
5. Multiple sequential strokes on the same layer composite correctly.
6. Stroke rendering latency ≤ 30 ms on iPad Pro M-class.
7. All five brush presets (pen, pencil, marker, eraser, smooth) render with their distinct characteristics (size, hardness, opacity, spacing).
8. Zooming in after drawing reveals crisp stamp edges (document-resolution rendering confirmed).
