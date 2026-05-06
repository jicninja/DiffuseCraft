# Implementation Plan: Brush Canvas Rendering

## Overview

Wire the Skia-side real-time brush stroke rendering pipeline. This connects the existing gesture capture (`useToolGestures`) and stroke expansion logic (`expandStrokeToStamps` in canvas-core) to a new GPU-accelerated stamp renderer in canvas-skia, producing visible ink on the canvas during stylus/finger drawing. The implementation proceeds bottom-up: shader utilities → renderer class → adapter/view integration → hook → gesture wiring.

## Tasks

- [x] 1. Implement hardness shader utility
  - [x] 1.1 Create `libs/canvas-skia/src/brush/hardness-shader.ts`
    - Export `buildHardnessShader(hardness, color, opacity)` returning an `SkShader`
    - Use `Skia.Shader.MakeRadialGradient` with two color stops: solid core at `hardness * radius` and transparent at outer edge
    - Color stops: inner = `rgba(color.r, color.g, color.b, opacity)`, outer = `rgba(color.r, color.g, color.b, 0)`
    - Shader centered at (0,0) with radius 0.5 (callers scale via canvas transform)
    - Clamp hardness to [0, 1]; hardness=1 produces a solid disc (inner stop at radius), hardness=0 produces full gradient from center
    - _Requirements: FR-6_

- [x] 2. Implement StampRenderer class
  - [x] 2.1 Create `libs/canvas-skia/src/brush/StampRenderer.ts`
    - Implement the `StampRenderer` class per design §4.1
    - `createBuffer(width, height, config)`: allocate offscreen `SkSurface` via `Skia.Surface.MakeOffscreen`; store config and reset stamp cursor to 0
    - `drawStampsIncremental(stamps, cursor)`: iterate from cursor to end of stamps array; for each stamp, save canvas state, translate to stamp position, scale to stamp size, apply hardness shader via `buildHardnessShader`, draw circle with appropriate blend mode (SrcOver for paint, DstOut for erase), restore canvas state; return new cursor
    - `getBufferSnapshot()`: return `buffer.makeImageSnapshot()` or null if no buffer
    - `commit(targetSurface)`: draw buffer snapshot onto target surface with SrcOver blend mode, then dispose buffer
    - `dispose()`: release buffer surface reference, reset state
    - `get isActive()`: return whether buffer is non-null
    - Handle mask-only mode: when `config.maskOnly` is true, render stamps as alpha-only (greyscale luminance)
    - Guard against null buffer from GPU memory exhaustion (log warning, no-op)
    - _Requirements: FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-15, FR-17_

- [x] 3. Implement stylus adapter
  - [x] 3.1 Create `libs/canvas-skia/src/input/stylus-adapter.ts`
    - Export `DEFAULT_PRESSURE = 0.5`
    - Export `RawStylusEvent` interface with fields: `x`, `y`, `force?`, `azimuthAngle?`, `altitudeAngle?`, `pressure?`
    - Export `mapStylusEvent(event, isFirstEvent)`: returns `StrokePoint | null`
      - Apple Pencil: read `force` → pressure; if `force` is 0 and `isFirstEvent` is true, return null (FR-13)
      - S-Pen: read `pressure` directly
      - Finger (no force/pressure): use `DEFAULT_PRESSURE`
      - Include tilt conversion when azimuth/altitude are present
      - Clamp all numeric values; NaN/Infinity fall back to defaults
    - Export `convertTilt(azimuthAngle, altitudeAngle)`: convert radians to `{ tilt_x, tilt_y }` in degrees [-90, 90]
      - `tilt_x = cos(azimuth) * (90 - altitude_degrees)`
      - `tilt_y = sin(azimuth) * (90 - altitude_degrees)`
      - Clamp output to [-90, 90]
    - Export `mapPressure(rawValue)`: clamp to [0, 1], undefined → DEFAULT_PRESSURE
    - _Requirements: FR-10, FR-11, FR-12, FR-13, FR-14_

- [x] 4. Checkpoint
  - Run `nx typecheck canvas-skia` to verify the new modules compile correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate stroke buffer into SkiaRenderAdapter and CanvasView
  - [x] 5.1 Modify `libs/canvas-skia/src/adapter.ts` to support active stroke buffer
    - Add `activeStrokeBuffer: { getBufferSnapshot(): SkImage | null } | null` field to `SkiaRenderAdapter`
    - Add `setActiveStrokeBuffer(buffer)` and `clearActiveStrokeBuffer()` methods
    - In `drawDocument()`, after drawing all layers (after the sorted layer loop), check if `activeStrokeBuffer` is set; if so, get snapshot and draw it on top of the active layer position using SrcOver blend mode
    - _Requirements: FR-3, FR-16, FR-20_

  - [x] 5.2 Modify `libs/canvas-skia/src/CanvasView.tsx` to accept stroke buffer invalidation
    - Add optional `strokeBufferVersion?: number` prop to `CanvasViewProps`
    - Include `strokeBufferVersion` in the `useEffect` dependency array that triggers `drawDocument` + `setSnapshot`, so the view re-renders when the buffer updates
    - _Requirements: FR-3_

- [x] 6. Export new modules from canvas-skia barrel
  - [x] 6.1 Modify `libs/canvas-skia/src/index.ts`
    - Export `StampRenderer` and `StampRendererConfig` from `./brush/StampRenderer`
    - Export `buildHardnessShader` from `./brush/hardness-shader`
    - Export `mapStylusEvent`, `convertTilt`, `mapPressure`, `DEFAULT_PRESSURE`, and `RawStylusEvent` from `./input/stylus-adapter`
    - _Requirements: FR-18 (makes renderer accessible to app layer)_

- [x] 7. Checkpoint
  - Run `nx typecheck canvas-skia` to verify adapter/view modifications and exports compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement useBrushRenderer hook
  - [x] 8.1 Create `apps/mobile/src/screens/Editor/useBrushRenderer.ts`
    - Instantiate `StampRenderer` in a ref (stable across renders)
    - Accept `adapter: SkiaRenderAdapter | null` parameter
    - Implement `beginStroke(config)`:
      - Guard: if adapter is null or document dimensions are 0, no-op
      - Apply NFR-5 buffer clipping: if dimensions > 4096×4096, defer to stroke bounding box (for v1, use full dimensions up to 4096)
      - Call `renderer.createBuffer(width, height, config)`
      - Set `adapter.setActiveStrokeBuffer(renderer)` so CanvasView composites the buffer
      - Initialize internal `ActiveStrokeState` ref (points array, preset, stampCursor=0)
    - Implement `addPoint(point)`:
      - Push point to accumulated points array
      - Call `expandStrokeToStamps(preset, allPoints)` from canvas-core
      - Call `renderer.drawStampsIncremental(stamps, cursor)` and update cursor
      - Increment a `bufferVersion` state counter to trigger CanvasView re-render
    - Implement `commitStroke()`:
      - Get the adapter's attached surface (active layer surface)
      - Call `renderer.commit(targetSurface)`
      - Call `adapter.clearActiveStrokeBuffer()`
      - Increment `bufferVersion` to trigger final re-render showing committed layer
      - Reset internal state
    - Implement `cancelStroke()`:
      - Call `renderer.dispose()`
      - Call `adapter.clearActiveStrokeBuffer()`
      - Reset internal state
    - Expose `isActive`, `renderer`, and `bufferVersion` on the returned handle
    - _Requirements: FR-1, FR-2, FR-3, FR-4, FR-5, FR-15, FR-16, FR-17, FR-18, FR-19, FR-21_

- [x] 9. Wire useBrushRenderer into CanvasArea
  - [x] 9.1 Modify `apps/mobile/src/screens/Editor/CanvasArea.tsx`
    - Import and call `useBrushRenderer(adapter)` where `adapter` comes from the existing `onAdapterReady` callback (store in a ref/state)
    - Pass `brushRenderer.bufferVersion` as the `strokeBufferVersion` prop to `<CanvasView>`
    - Pass the `brushRenderer` handle down to `useToolGestures` (or make it available via context/prop)
    - _Requirements: FR-3, FR-16_

- [x] 10. Wire brush gesture to useBrushRenderer via useToolGestures
  - [x] 10.1 Modify `apps/mobile/src/screens/Editor/useToolGestures.ts`
    - Accept `brushRenderer: BrushRendererHandle` as a parameter (or import from context)
    - Import `mapStylusEvent` and `RawStylusEvent` from `@diffusecraft/canvas-skia`
    - Add helper `extractRawStylusEvent(gestureEvent)` that maps gesture handler event fields to `RawStylusEvent`
    - Modify `buildBrushGesture()`:
      - `.onBegin`: extract raw event → `mapStylusEvent(raw, true)` → if null, set a skip flag (FR-13); otherwise call `brushRenderer.beginStroke(...)` with layer dimensions, resolved preset (from editorStore brush state), color, erase flag, maskOnly flag; then `brushRenderer.addPoint(point)`
      - `.onUpdate`: extract raw event → `mapStylusEvent(raw, false)` → if null, skip; otherwise `brushRenderer.addPoint(point)`
      - `.onEnd`: call `brushRenderer.commitStroke()`
      - `.onFinalize`: if stroke still active, call `brushRenderer.cancelStroke()`
    - Remove the old placeholder stroke logic (the `expandStrokeToStamps` + `void _stamps` block)
    - Read active brush preset from editorStore: preset ID, size, hardness, opacity, spacing, erase flag
    - Determine `maskOnly` from active layer kind === 'mask' (FR-9)
    - _Requirements: FR-1, FR-2, FR-4, FR-9, FR-10, FR-13, FR-14, FR-18, FR-19, FR-20_

- [x] 11. Final checkpoint
  - Run `nx typecheck canvas-skia` and `nx typecheck mobile` to verify full compilation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Testing is deferred per `.kiro/steering/testing.md`. Verification is typecheck + manual run on iPad simulator.
- Property-based tests for correctness properties (§6 of design) will be implemented when testing resumes at end of v1.
- Each task builds incrementally: shader → renderer → adapter integration → hook → gesture wiring. No orphaned code — each layer is consumed by the next.
- The design's NFR-5 (buffer clipping for >4096×4096 documents) is handled as a guard in `useBrushRenderer.beginStroke`; full bounding-box clipping is a follow-up optimization.
