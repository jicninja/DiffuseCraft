# Implementation Plan

> **Architecture floor.** Persistent `SkSurface` per layer + transient `SkPicture` per active stroke + UI-thread worklet hot path + `event.stylusData` from RNGH 2.20+. Wholesale cutover from the legacy `SkPicture[]` model — no parallel paths in main (P25).

## Implementation Notes

**Phase 5 cutover deviation from design (deferred follow-up):**
- The active stroke's coordinates use the viewport snapshotted at gesture-begin; mid-stroke pan/zoom is not reflected in document coords for the active stroke. This is because `viewportToDocument` in `canvas-core` is pure-TS but lacks a `'worklet'` directive, and adding it falls outside the Phase-5 boundary. Follow-up: mark `viewportToDocument` worklet-callable (one-line change in canvas-core) so the gesture can re-read viewport per event without reconverting on the JS thread. Until then, the freeze-at-begin behavior matches Procreate (which also resists viewport changes mid-stroke).

**Workspace package-identity gap (pre-existing, not introduced here):**
- `react-native-reanimated` and `@shopify/react-native-skia` are installed in both the workspace root and individual `libs/*` `node_modules` due to PNPM hoisting. This causes nominal-type mismatches across package boundaries (a `SharedValue<SkPicture | null>` from `apps/mobile` is structurally identical to one from `libs/canvas-skia` but TS sees them as different types). The `<CanvasView activePicture={...}>` prop site bridges with a single typed cast. A clean fix is at the workspace level (force a single peer copy via PNPM `peerDependencies` or `shamefully-hoist`); out of scope for this spec.

**Async snapshot retry (deferred):**
- Design.md §commit-worklet specifies an async retry on null `makeImageSnapshot`. RN-Skia 2.6.x exposes `makeImageSnapshotAsync` only on the `<Canvas>` component ref, not on `SkSurface` directly. The commit-worklet falls back to the registry's null-snapshot warning path (logged + layer image unchanged). When RN-Skia adds `SkSurface.makeImageSnapshotAsync` (open RFC at the time of writing), the retry path is a small follow-up.

**Simulator detection heuristic (best-effort):**
- `LayerSurfaceRegistry.detectSimulator` is a best-effort heuristic against `Platform.constants` (no `expo-device` dependency to keep the lib standalone). It defaults to "device path" when inconclusive (Req 10.4). Host apps that need stronger detection inject the `isSimulator` predicate via `createLayerSurfaceRegistry({ isSimulator })`.

**Reanimated Worklets babel plugin does NOT support object-literal getters (verified 2026-05-06):**
- A `get foo() { 'worklet'; ... }` declaration on an object literal returned by a worklet-shareable factory makes the plugin emit `(function get foo() {...})`, which is not valid JS/TS and crashes Metro bundling at parse time with `WorkletsBabelPluginError: Unexpected token, expected "(" (1:14)`.
- **Use methods, not getters**, for any state-readback hook on a worklet-shareable object: `getEmittedCount(): number` instead of `get emittedCount(): number`. JSDoc on both `IncrementalStampExpander.getEmittedCount` and `StampRenderer.isActive` records this constraint inline.
- This caught us during the first run of `npm run ios` after Phase 5 landed — Metro bundling failed at module 1078/4012. Fix: convert getters to methods. No consumer code needed updating because no external consumer of these properties existed yet.

---

## 1. Foundation: dependency baseline and lint guard

- [x] 1.1 Confirm runtime dependency baseline for the worklet hot path
  - Verify `react-native-gesture-handler` is at version 2.20 or higher (the project is on 2.30, which exposes `event.stylusData` on `Gesture.Pan` callbacks).
  - Verify `react-native-reanimated` is at version 3 or higher (the project is on 4.2.1).
  - Verify `@shopify/react-native-skia` is at 2.6 or higher (the project is on 2.6.2).
  - Record the verified versions in the spec's `research.md` so future maintainers can confirm the baseline.
  - Observable: research.md contains a "Verified baseline (yyyy-mm-dd)" entry naming the three packages and their installed versions; a `package.json` query (`pnpm why react-native-gesture-handler`) returns a version ≥ 2.20.
  - _Requirements: 6.1, 11.5_

- [x] 1.2 Add a repository lint rule banning `.runOnJS(true)` on the brush gesture
  - Introduce a lint rule that flags any `Gesture.Pan().runOnJS(true)` chain (and equivalent on related gesture builders) inside the editor screen module.
  - Configure the rule so the brush and eraser gesture builders cannot regress to the JS-thread hand-off pattern that the prior implementation used.
  - Observable: a CI lint run flags an injected `.runOnJS(true)` call inside a brush gesture and passes when removed.
  - _Requirements: 2.2, 11.5_

## 2. Core: incremental stamp expansion (canvas-core)

- [x] 2.1 (P) Implement the worklet-shareable incremental stamp expander factory
  - Build a stateful expander that accepts a brush preset at construction and exposes a single `pushPoint` operation returning only the new stamps emitted on the segment from the previous point to this one.
  - Maintain per-stroke state for the last consumed input index, the last emitted stamp position, the in-segment travelled distance, and the prior smoothed point.
  - Reuse the spacing math, pressure curve sampling, and moving-average smoothing already present in canvas-core; do not duplicate or reinterpret the math, only restructure it for incremental emission.
  - Make the returned object worklet-shareable: plain primitive state, no closures over JS-only references.
  - Provide an idempotent `dispose` that releases per-stroke state so memory does not grow across sequential strokes.
  - Observable: calling `pushPoint` with each point of a 100-point synthetic stroke emits the same total stamp set, in the same order, as the existing pure `expandStrokeToStamps` over the full point list (validated by a one-off dev script run before tests are re-enabled).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.4_
  - _Boundary: IncrementalStampExpander_

## 3. Core: canvas-skia primitives

- [x] 3.1 (P) Adapt the stylus adapter to the RNGH `stylusData` shape
  - Update the existing pure-function stylus mapping to consume the gesture event's `stylusData` field (pressure, tiltX, tiltY, azimuthAngle, altitudeAngle) instead of the legacy bespoke event shape.
  - Preserve the first-event-pressure-zero guard that discards the very first Apple Pencil event when its reported pressure is zero.
  - Preserve the finger-fallback pressure of 0.5 and the no-tilt behaviour when no stylus data is present.
  - Mark the mapping function as worklet-callable and confirm it has no allocations beyond the returned stroke point object.
  - Observable: a synthetic event with `stylusData.pressure = 0.7` and `azimuthAngle / altitudeAngle` produces a stroke point with `pressure ≈ 0.7` and finite `tilt_x`/`tilt_y` in `[-90, 90]`; a synthetic event with no `stylusData` returns `pressure = 0.5` and no tilt fields.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: StylusAdapter_

- [x] 3.2 (P) Implement the per-layer surface registry
  - Build the registry that lazily allocates one GPU-backed offscreen surface per paint layer, sized to the layer's document-space bounds.
  - Expose a per-layer reactive image handle that the visible canvas subscribes to without invoking React renders.
  - Expose a worklet-callable commit operation that replays a finalized active picture onto the layer surface using the stroke's blend mode, snapshots the surface into the reactive image handle, and disposes the prior image.
  - Expose a JS-thread-safe synchronous read API that returns the current image handle for a layer (used later by undo/redo snapshot capture).
  - Expose a commit-event subscription that delivers per-layer commit notifications (with the dirtied bounding box and a monotonic per-layer sequence) to JS-thread consumers.
  - Implement disposal of every surface and image handle on layer removal and on editor teardown so native memory does not leak across sessions.
  - Implement the simulator detection branch so iOS Simulator commits use the async snapshot variant and device commits use the sync variant; log the chosen path once at session start.
  - Observable: a commit on an empty layer makes the layer's reactive image handle non-null; the next commit replaces the image and disposes the previous one (verified via dev counter); calling `disposeLayer` clears both surface and image and ignores subsequent reads.
  - _Requirements: 1.1, 1.4, 1.7, 9.3, 9.4, 9.6, 10.1, 10.2, 10.3, 10.5, 12.1, 12.2, 12.3, 12.4_
  - _Boundary: LayerSurfaceRegistry_

- [x] 3.3 (P) Rewrite the stamp renderer with a single picture recorder and a per-stroke paint/shader pool
  - Replace the existing chunked-picture implementation with one that opens a single picture recorder at stroke begin and records every stamp into it.
  - Allocate exactly one paint and one shader at stroke begin, parameterized by the stroke's color, hardness, and erase flag (which are immutable for the stroke); reuse them for every stamp.
  - Implement the round soft alpha-disc rendering using the existing radial-gradient hardness shader (kept untouched) for paint, erase (DstOut), and mask-only (alpha-as-luminance-of-color) modes.
  - Expose a `takePicture` operation that finalizes the recorder, returns the resulting picture, and immediately reopens a fresh recorder so subsequent stamps continue to accumulate without losing in-flight work.
  - Implement idempotent disposal that releases paint, shader, and any open recorder on stroke end or cancel.
  - Observable: drawing 200 stamps and calling `takePicture` returns a non-null picture whose replay produces visible disc footprints; allocation counters during the 200-stamp run show exactly one paint and at most one shader created.
  - _Requirements: 1.2, 1.3, 1.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: StampRenderer_

## 4. Integration: canvas-skia composition

- [x] 4.1 Implement the commit worklet that flattens the active picture onto the layer surface
  - Wire the registry's commit operation into a single worklet entry point that the stroke pipeline calls at gesture end.
  - Resolve the appropriate blend mode (paint, erase, mask alpha-only) from the stroke configuration before invoking commit.
  - Use the simulator branch in the registry to switch between sync and async snapshot at the worklet level.
  - Emit the commit event with the dirtied bounding box so undo/redo and server-materialization consumers can scope their work.
  - Implement the failure path: if the snapshot returns null, retry once with the async variant; if it fails again, drop the active picture, leave the layer surface unchanged, and log the failure.
  - Observable: at gesture end on a paint layer, the layer image handle changes value within one frame and the commit event fires exactly once with the matching bounding box; an injected snapshot failure leaves the layer image unchanged and emits a warning.
  - _Requirements: 1.4, 1.7, 9.6, 10.2, 12.1_
  - _Depends: 3.2, 3.3_

- [x] 4.2 Slim the Skia render adapter and remove the legacy retention paths
  - Remove the entire `SkPicture[]`-based retention model from the adapter: the committed-pictures array, the cache and rebuild routines, and the get/set/commit/clear methods that mediated the legacy active stroke buffer.
  - Remove the dead `drawDocument` orchestration that the visible canvas never invoked.
  - Replace the placeholder `rasterizeDocument` with a deletion plus a clear comment in the adapter declaring that document-level export is owned by `client-sdk` and not by this library.
  - Host the new layer surface registry as a property of the adapter so the canvas view and the brush pipeline can reach it through a single owner.
  - Keep the existing image cache (used by control layers and generation history), the hit-testing pass-through, and the overlay handling untouched.
  - Observable: a TypeScript build of `canvas-skia` succeeds with no exports referring to `committedPictures`, `committedPictureCache`, `getCommittedPicture`, `getActiveStrokePicture`, `setActiveStrokeBuffer`, `commitActiveStroke`, `clearActiveStrokeBuffer`, `drawDocument`, or `rasterizeDocument`; the new registry is exported in their place.
  - _Requirements: 1.6, 11.1, 11.2, 11.3, 11.4_
  - _Depends: 3.2_

- [x] 4.3 Rewrite the canvas view as a per-layer image chain plus an active-stroke picture overlay
  - Mount the underlying drawing surface exactly once for the editor session and never tear it down on prop changes.
  - Render the document paper, then one image element per visible paint layer subscribing to that layer's reactive image handle, then one optional picture element that renders the active in-progress stroke when present.
  - Apply the document-to-screen transform (translate, scale, rotation) on a single group surrounding the layer chain so viewport changes do not invalidate any committed pixel data.
  - Accept the active-stroke picture handle as an optional prop (`SharedValue<SkPicture | null>`); when not provided or when its value is null, the overlay is unmounted. The producer side lands in Task 5.1; this task can be implemented and visually verified against an empty-document state without 5.1 in place.
  - Remove the legacy `SharedValue<SkPicture>` plumbing for `activePicture` and `committedPicture` from the view's props and internal state.
  - Observable: scrolling, zooming, and rotating the viewport between strokes does not change the per-layer image handles' identities or trigger any commit events; entering and leaving a stroke mounts and unmounts the active picture element without re-rendering the layer chain.
  - _Requirements: 1.3, 1.7, 2.3, 2.4, 8.1, 8.2, 9.5_
  - _Depends: 3.2, 4.2_

## 5. Integration: apps/mobile brush pipeline

- [x] 5.1 Implement the brush pipeline hook orchestrating expander, renderer, and commit
  - Expose worklet-callable operations for stroke begin, push-point, commit, and cancel.
  - At stroke begin, snapshot the editor store on the JS thread (active layer, preset, color, brush size/opacity/hardness, erase/mask flags, viewport) and pass an immutable per-stroke configuration into a single `runOnUI` call that allocates the expander, opens the stamp renderer, and registers the active picture handle.
  - At stroke begin, compute the stroke buffer's working dimensions from the active layer's bounds: when the layer is ≤ 4096×4096 use the layer dimensions; when the layer exceeds 4096×4096, cap the buffer at 4096×4096 (or, if implementing the full bbox-padding approach, track the running stroke bounding box and pad by the stamp radius). Either path satisfies the bounded-memory requirement; pick one and document it in code.
  - On the UI thread, drive a derived value over the shared stroke-points value: for each new point, push it through the expander, draw the resulting stamps via the renderer, and update the active picture handle with the renderer's latest finalized picture.
  - On stroke end, invoke the commit worklet against the layer surface registry, then dispose the expander, renderer, and active picture.
  - On stroke cancel, dispose expander, renderer, and active picture without touching the layer surface.
  - Wrap the per-event derived-value body in a worklet-side try/catch: on a worklet runtime error, schedule a one-time JS-thread log via `runOnJS` for the next frame, then call the cancel path so the active picture is disposed and no native handle leaks.
  - Provide a dev-mode worklet-side timer that records mean and p99 per-event handling time so the latency budget can be inspected during the device spike.
  - Observable: a 500-point synthetic stroke pushed through the hook produces a non-null active picture during the stroke and a non-null layer image after commit; cancelling a stroke leaves the layer image unchanged and clears the active picture; an injected worklet error during a stroke logs once on the JS thread and leaves the layer image unchanged.
  - _Requirements: 2.1, 2.5, 2.6, 3.3, 7.1, 7.2, 7.3, 9.4_
  - _Depends: 2.1, 3.2, 3.3, 4.1_
  - _Boundary: useBrushPipeline_

- [x] 5.2 Rewrite the brush and eraser gestures without the JS-thread hand-off
  - Remove the `.runOnJS(true)` chain from the brush and eraser gesture builders.
  - Inside the gesture's `onBegin` worklet, capture the first stylus event, map it via the adapted stylus mapping, and call the pipeline's begin operation with the gesture-begin configuration snapshot.
  - Inside `onUpdate`, map each event through the stylus mapping and call the pipeline's push-point operation.
  - Inside `onEnd`, call the pipeline's commit operation.
  - Inside `onFinalize`, call the pipeline's cancel operation when the gesture was interrupted.
  - Consume the existing screen-to-document mapper that `editor-canvas-integration` provides (the `viewportToDocument` helper already used in `useToolGestures.ts`); do not reimplement viewport math here. The viewport-state ownership stays with `editor-canvas-integration`.
  - Observable: drawing on a paint layer with a paired stylus produces strokes whose width/opacity respond to pressure (verified by switching between low-pressure and high-pressure runs on the same gesture); a finger touch produces strokes at fixed mid-pressure.
  - _Requirements: 2.1, 2.2, 2.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.3, 8.4_
  - _Depends: 3.1, 5.1_
  - _Boundary: useToolGestures_

- [x] 5.3 Replace the legacy brush hook and wire the editor screen to the new pipeline
  - Delete the legacy `useBrushRenderer` hook in its entirety, including the empty-picture sentinel and the JS-thread orchestration.
  - Update the editor screen's canvas area to instantiate the new brush pipeline hook and to pass the active picture handle and the new layer surface registry into the canvas view.
  - Verify by scanning that no editor-side import resolves to the deleted hook and that no consumer reads the removed `SharedValue<SkPicture>` props on the canvas view.
  - Observable: a TypeScript build of `apps/mobile` succeeds with no references to `useBrushRenderer`, `EMPTY_PICTURE`, or the deleted adapter methods; the editor screen mounts and an empty document renders the paper without errors.
  - _Requirements: 11.5, 11.6_
  - _Depends: 4.3, 5.1, 5.2_

## 6. Validation: device, simulator, and performance smoke

> Per `.kiro/steering/testing.md`, automated tests are disabled until end of v1. Validation is manual smoke on real devices plus iOS Simulator confirmation. Capture results in the spec's research.md "Risks & Mitigations" follow-up section.
>
> **PENDING USER EXECUTION**: Phases 1–5 (code) are implemented and typecheck clean as of 2026-05-06. The four sub-tasks below require physical hardware (iPad + Apple Pencil, Galaxy Tab + S-Pen, iOS Simulator instance) and were not run by the implementing agent. Run them in a session where the editor app can be paired with a real device and report findings back into research.md.

- [ ] 6.1 Smoke-test the full pipeline on a physical iPad with Apple Pencil
  - Pair an iPad Pro with the editor and draw multi-stroke compositions on a paint layer.
  - Confirm pressure changes produce visible width/opacity changes; confirm tilt is captured (verified via dev-mode logging of tilt fields, since tilt-driven stamp rotation is out of scope).
  - Confirm the canvas does not re-render React during a stroke (use the React DevTools profiler or a render counter on the editor screen).
  - Confirm zooming after drawing reveals crisp stamp edges (no screen-space pixelation).
  - Observable: a session-log capture shows the stylus values flowing through the gesture worklet and the React render counter for the editor screen stays at 1 for the duration of a 30-second drawing session.
  - _Requirements: 2.3, 2.4, 6.2, 6.3, 8.1, 8.2_

- [ ]* 6.2 Smoke-test the simulator fallback branch on iOS Simulator
  - Run the editor on iOS Simulator (iPad Pro image) and draw with the simulated finger input.
  - Confirm the registry log line at session start indicates the simulator-async snapshot path; confirm strokes commit without visual artefacts.
  - Inject a forced-null sync snapshot (via a dev-only flag) and confirm the async retry path logs the recovery and produces a correct layer image.
  - Observable: the editor session log shows exactly one line declaring the chosen snapshot path on session start; an injected sync-null path fires the async retry exactly once and the resulting layer image visibly contains the stroke.
  - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [ ]* 6.3 Smoke-test S-Pen capture on a physical Android tablet
  - Pair a Galaxy Tab (or equivalent S-Pen device) with the editor and draw multi-stroke compositions.
  - Confirm `event.stylusData.pressure` flows through the worklet and produces the expected width/opacity response.
  - Confirm the finger-fallback path still works on the same device when drawing with a finger.
  - Observable: stylus and finger sessions on the same tablet produce visibly different pressure-driven stroke characteristics; dev logs show the stylus path emitting non-default pressure values.
  - _Requirements: 6.1, 6.4, 6.5_

- [ ] 6.4 Validate the latency, throughput, and memory budget on iPad Pro M-class
  - Measure touch-event-to-pixel latency by recording the OS pointer event timestamp and the frame-presentation timestamp (use the canvas's frame inspector or a dev-only wraparound timer in the brush pipeline).
  - Sustain a 2000-stamp continuous stroke and confirm Skia's frame-time inspector shows no frame drops below the 60 fps budget.
  - Confirm native memory growth across 1000 sequential committed strokes stays bounded by one image per visible layer (verified via a memory-handle counter in `LayerSurfaceRegistry`).
  - Observable: the dev-mode latency report shows mean and p99 ≤ 30 ms over a 30-second session; frame-time histogram shows no buckets above 16.7 ms; image-handle count returns to its baseline +1 per layer after each commit.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - _Depends: 6.1_
