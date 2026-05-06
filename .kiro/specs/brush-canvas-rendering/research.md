# Research & Design Decisions

## Summary

- **Feature**: `brush-canvas-rendering`
- **Discovery Scope**: Complex Integration — replaces the existing `SkPicture[]`-based brush pipeline in `libs/canvas-skia` and `apps/mobile/src/screens/Editor/`, locks the Procreate-grade architectural floor (persistent raster + UI thread + real Pencil pressure), and rewrites the load-bearing modules wholesale.
- **Key Findings**:
  - `react-native-gesture-handler` 2.30.0 (installed) exposes `event.stylusData` (`pressure`, `tiltX`, `tiltY`, `altitudeAngle`, `azimuthAngle`) directly inside worklet callbacks on `Gesture.Pan`. No custom native module needed for v1 stylus capture; `Apple Pencil Pro`-only fields (rollAngle, perpendicularForce) remain out of scope.
  - RN-Skia 2.6.2 supports `Skia.Surface.MakeOffscreen` and `surface.makeImageSnapshot` calls from inside worklets, and `<Image image={sharedValue}>` reactive rendering without triggering React reconciliation. The simulator-side issue that caused the previous pivot to `SkPicture[]` is largely resolved in 2.x; remaining flakiness is mitigated by `makeImageSnapshotAsync` and is simulator-only.
  - The right architecture for this app is a **hybrid**: per-layer persistent `SkSurface` (raster source of truth, mutated only at commit) + per-active-stroke transient `SkPicture` (re-recorded each frame inside `useDerivedValue` from `SharedValue<StrokePoint[]>`). This keeps committed pixels in fast-replay raster form and the in-progress stroke in cheap transient command form. It satisfies Requirement 1.6 ("`SkPicture` forbidden as inter-stroke persistence") because pictures only live for the duration of a single stroke.

## Research Log

### Topic A — Apple Pencil / S-Pen pressure capture in RN 0.74+

- **Context**: Requirement 6 originally specified bypassing RNGH `Gesture.Pan` because the prior implementation read finger-only fields and `force`/`pressure` were unavailable through that API. We needed to confirm whether a custom native module is still the canonical path in 2025-2026.
- **Sources Consulted**:
  - RNGH 2.20.0 release notes (Oct 2024) — stylus support shipped iOS/Android/Web simultaneously (PRs #3107, #3111, #3113).
  - RNGH Pan gesture docs — event payload includes `stylusData` (`pressure`, `tiltX`, `tiltY`, `altitudeAngle`, `azimuthAngle`) and `pointerType` (`TOUCH | STYLUS | MOUSE | KEY | OTHER`).
  - Apple developer doc "Illustrating force, altitude, azimuth properties".
  - Facebook RN issue #31779 (the gap RNGH 2.20 fills).
- **Findings**:
  - RNGH `Gesture.Pan().onUpdate(...)` callbacks are auto-workletized when Reanimated is installed; the body runs on the UI thread by default.
  - `event.stylusData` is `undefined` for finger touches; must guard with `?.`.
  - Apple Pencil Pro–only fields (`rollAngle`, `perpendicularForce`) are not exposed by RNGH stylusData; would still require a thin native module if needed (out of v1 scope).
  - Project has RNGH `~2.30.0` and Reanimated `4.2.1` installed (verified via `apps/mobile/package.json`); both are above the minimum required.
- **Implications**:
  - Requirement 6 was updated to use `event.stylusData` rather than mandate a custom native pointer-event channel. The original "bypass RNGH" sub-clause was based on outdated information.
  - The existing `libs/canvas-skia/src/input/stylus-adapter.ts` (pure functions mapping raw fields to `StrokePoint`) stays useful — it now adapts `stylusData` shape rather than custom native event shape.

### Topic B — RN-Skia 2.6.2 worklet-callable surface APIs

- **Context**: Requirements 1 and 2 demand a persistent layer `SkSurface` mutated from the UI thread. We needed to verify that the installed RN-Skia version supports surface allocation, drawing, and snapshotting from inside a worklet, and to confirm whether the previous pivot to `SkPicture[]` was avoidable.
- **Sources Consulted**:
  - RN-Skia "Textures" doc — `Skia.Surface.MakeOffscreen` + worklet pattern shown explicitly.
  - RN-Skia "Pictures" doc — `Skia.PictureRecorder` + `useDerivedValue` pattern for variable-command-count drawing.
  - RN-Skia issue #2636 (iOS simulator + new arch) — closed via PR #2793 before 2.x.
  - RN-Skia issue #1811 (`makeImageSnapshot` iOS bugs) — closed without explicit fix note; recommend `makeImageSnapshotAsync` defensively.
  - RN-Skia issue #3390 (`usePictureAsTexture` GC crash) — avoid Picture-as-texture conversion path.
  - RN-Skia issue #3112 (iOS 18 Simulator scroll freeze) — simulator-only, doesn't affect device.
  - RN-Skia discussion #2859 — `useTouchHandler` deprecated since 1.5 (do not adopt).
  - Local inspection of `libs/canvas-skia/node_modules/@shopify/react-native-skia/lib/typescript/src/skia/types/Surface/Surface.d.ts` confirmed `getCanvas()`, `makeImageSnapshot(bounds?, outputImage?)`, `flush()`, `width()`, `height()`, `getNativeTextureUnstable()` available in 2.6.2.
- **Findings**:
  - `Skia.Surface.MakeOffscreen(w, h)` is callable from a worklet (verified via Textures doc).
  - `<Image image={sharedValue}>` subscribes to a `SharedValue<SkImage>` and repaints via JSI without triggering React reconciliation.
  - Hybrid drawing pattern is the documented best practice: committed strokes as `SkImage` (one `MakeOffscreen` blit when `onEnd` fires), in-progress stroke as a `Picture` re-recorded each frame.
  - `usePictureAsTexture` has a known GC crash in 2.x (#3390); avoid it. Plain `<Picture picture={sharedPic}>` and `<Image image={sharedImg}>` are stable.
- **Implications**:
  - The previous pivot to `SkPicture[]` (caused by simulator behavior in an older RN-Skia version) was unnecessary on 2.6.2. Device path is canonical; simulator fallback only invoked if `MakeOffscreen` rendering misbehaves.
  - `useTouchHandler` is removed from consideration — RNGH `Gesture.Pan` is the migration target.

### Topic C — Hybrid renderer architecture

- **Context**: Requirements 1 and 4 (persistent layer surface + per-stroke pool) plus Requirement 9 (latency, throughput, memory) shape the renderer's data flow. We needed to choose between three patterns:
  1. **Pure-surface**: every stamp writes to the stroke-buffer surface immediately, surface flattens to layer at commit.
  2. **Pure-picture**: every stamp records into a Picture; pictures replay each frame; commit replays onto a per-layer surface to flatten.
  3. **Hybrid**: in-progress stroke as a Picture (re-recorded each frame from `SharedValue<StrokePoint[]>`); commit replays the picture onto the layer's persistent `SkSurface`, snapshots the surface to a `SharedValue<SkImage>`, disposes the picture.
- **Sources Consulted**: RN-Skia Pictures + Textures docs; `doublelam/react-native-free-canvas` reference (architecturally close, no Pencil pressure).
- **Findings**:
  - Pure-surface approach forces a `MakeOffscreen` allocation per stroke (already required) but also requires per-stamp surface mutation from the worklet — supported, but every stamp incurs a `flush` cost if visible immediately.
  - Pure-picture approach needs to keep all committed strokes as pictures forever — the failure mode of the current implementation. Forbidden by Requirement 1.6.
  - Hybrid approach is the canonical path: pictures are cheap (just command lists, no raster) and disposed at commit; surfaces hold the heavyweight raster only for committed work. The active picture re-records inside `useDerivedValue` from a `SharedValue<StrokePoint[]>` — RNGH writes points, derived value reads + emits new stamps + records, `<Picture>` displays.
- **Implications**:
  - Architecture: per-layer `SkSurface` (committed) + per-active-stroke `Picture` (transient) + `SkImage` snapshot per layer for display.
  - The active stroke buffer Picture is allowed by Requirement 1.6 (which forbids inter-stroke `SkPicture` persistence) — pictures here live for one stroke and are disposed at commit.

### Topic D — Worklet-callable stamp expansion

- **Context**: Requirement 3 mandates stateful incremental stamp expansion callable from a worklet. The current `expandStrokeToStamps` (in `libs/canvas-core/src/brush/stamps.ts`) is a pure function that re-walks the entire point array each call, producing O(N²) work over a stroke and is not reachable from worklets without serialization.
- **Sources Consulted**: Reanimated worklet semantics (worklets cannot close over non-shareable JS objects; module-level state is per-runtime).
- **Findings**:
  - The stateful expansion can live as a plain object (cursor + buffers) constructed at stroke-begin, with worklet-safe methods. Reanimated 3.x supports passing such objects to worklets via `runOnUI` once at gesture begin; the worklet then mutates them in place.
  - Smoothing (moving-average) state must be incremental too — the current implementation re-smooths the entire array each call.
  - The pure-TS `expandStrokeToStamps` and `samplePressureCurve` already in `canvas-core` can be reused, but their interface needs an incremental variant alongside them. The current pure variant stays for the server-side `paint_strokes` materializer (which receives the full stroke at once).
- **Implications**:
  - New module `libs/canvas-core/src/brush/incremental-stroke.ts` exposes a `createIncrementalStampExpander(preset)` factory that returns a `{ pushPoint(point) → Stamp[] }` worklet-callable object. The implementation reuses spacing math + pressure curve from existing code.
  - The smoothing factor is applied incrementally inside the expander.

### Topic E — Display path: `<Image>` per layer + `<Picture>` for active

- **Context**: Requirement 8 demands document-space rendering at full resolution regardless of zoom. We needed a display path that does not invoke React renders during a stroke and supports per-layer composition.
- **Sources Consulted**: RN-Skia `<Canvas>`, `<Image>`, `<Picture>`, `<Group>` docs.
- **Findings**:
  - `<Canvas>` is mounted once and persists. `<Group>` applies the document→screen transform (`translate` + `scale` + `rotate`) reactively from a `SharedValue<Viewport>`.
  - One `<Image image={layerImageShared}>` per visible layer renders the layer's snapshot with no React re-render when the snapshot updates.
  - One `<Picture picture={activePicShared}>` overlays the in-progress stroke during a gesture; outside a gesture it displays a 1×1 empty picture sentinel.
- **Implications**:
  - `CanvasView` becomes a thin host that mounts `<Canvas>`, the document-transform `<Group>`, the per-layer `<Image>` chain, and the active-stroke `<Picture>` overlay. No imperative `drawDocument` orchestration in the adapter.
  - The current `SkiaRenderAdapter.drawDocument` is dead code and is removed (Requirement 11.3).

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Pure-surface | Stamps write directly into a per-stroke `SkSurface`; layer surface flattens at commit. | Single rendering primitive (surfaces only). | Per-stamp `surface.flush()` cost; harder to drop frames cleanly. Larger memory ceiling during gesture (two surfaces alive). | Rejected. |
| Pure-picture | All committed strokes retained as `SkPicture`; the failure mode of the current code. | Easy to undo by popping a picture. | Linear-in-strokes replay cost; unbounded memory; forbidden by Req 1.6. | Rejected. |
| Hybrid (chosen) | Active stroke as transient `Picture` re-recorded from `SharedValue<StrokePoint[]>`; commit replays onto persistent layer `SkSurface` and updates `SharedValue<SkImage>`. | Bounded memory (one image per layer); cheap active-stroke updates; satisfies Req 1.6 (pictures intra-stroke only); single `<Image>` draw per layer per frame. | Two display primitives to coordinate (`<Image>` + `<Picture>`); commit step is non-trivial. | Selected. |

## Design Decisions

### Decision: Hybrid renderer (committed `SkSurface` + transient active `SkPicture`)

- **Context**: The architecture must satisfy Requirements 1, 2, 4, 9.
- **Alternatives Considered**:
  1. Pure-surface (per-stroke surface + commit).
  2. Pure-picture (forbidden by Req 1.6).
  3. Hybrid (selected).
- **Selected Approach**: Each paint layer owns a `SharedValue<SkImage | null>` and a `SkSurface` retained on the UI runtime. During a stroke, a `useDerivedValue<SkPicture>` re-records the active stroke from `SharedValue<StrokePoint[]>` and an attached incremental expander. On `onEnd`, a worklet replays the picture onto the layer surface, takes a fresh snapshot into the layer's `SharedValue<SkImage>`, and disposes the picture.
- **Rationale**: Active stroke as picture is the cheapest way to express "variable command count per frame on the UI thread". Committed pixels as `SkImage` (driven by a SkSurface) match Procreate's mental model and bound memory at one image per layer.
- **Trade-offs**: Two display primitives; commit is the only non-trivial worklet operation.
- **Follow-up**: Verify on physical iPad + Apple Pencil and Galaxy Tab + S-Pen that `surface.getCanvas().drawPicture(...)` followed by `makeImageSnapshot()` inside a worklet behaves correctly under sustained 120 Hz input.

### Decision: RNGH `event.stylusData` for stylus capture (not custom native module)

- **Context**: Requirement 6 originally mandated bypassing RNGH; discovery showed RNGH 2.20+ already exposes the needed fields.
- **Alternatives Considered**:
  1. Custom native module (iOS `UIPencilInteraction` / `UITouch`, Android `MotionEvent`).
  2. RNGH `event.stylusData` (selected).
  3. Deprecated `useTouchHandler` from RN-Skia (rejected).
- **Selected Approach**: Use RNGH `Gesture.Pan` with the brush tool, drop `.runOnJS(true)`, read `event.stylusData?.pressure` / `tiltX` / `tiltY` / `altitudeAngle` / `azimuthAngle` inside the worklet body.
- **Rationale**: Avoids a custom native bridge; uses already-installed library; UI-thread delivery is automatic when Reanimated is installed.
- **Trade-offs**: Apple Pencil Pro–only fields (rollAngle, perpendicularForce) are not exposed by RNGH; if needed later, a thin native module can be added without changing this spec's contract.
- **Follow-up**: Validate on real devices that `stylusData` is non-undefined when an Apple Pencil / S-Pen is in use.

### Decision: Incremental stamp expander as a worklet-shareable factory

- **Context**: Requirement 3 forbids O(N²) re-walks and requires worklet callability.
- **Alternatives Considered**:
  1. Keep `expandStrokeToStamps` pure and call it on every point (current behavior).
  2. New `createIncrementalStampExpander(preset)` factory exposing `pushPoint(point) → Stamp[]`.
- **Selected Approach**: Add an incremental factory in `libs/canvas-core/src/brush/incremental-stroke.ts`. Reuse spacing math + pressure curve. Expose a worklet-shareable object (plain data + worklet-marked methods).
- **Rationale**: Keeps the pure-TS implementation intact for server-side `paint_strokes` consumption while giving the runtime renderer the O(new-stamps-only) per-call cost it needs.
- **Trade-offs**: Two implementations of the same math (incremental + bulk); they must stay in sync, validated against the existing test corpus when re-enabled.
- **Follow-up**: Property-test that the incremental version emits the same total stamps as the bulk version for any prefix-shared input sequence.

### Decision: Simulator vs device fallback policy

- **Context**: Requirement 10 demands a documented fallback for simulator quirks without letting them dictate device architecture.
- **Alternatives Considered**:
  1. Use `MakeOffscreen` everywhere; let simulator fail loudly.
  2. Detect simulator and use `makeImageSnapshotAsync` defensively (selected).
  3. Maintain two parallel implementations.
- **Selected Approach**: Default path is GPU-backed `MakeOffscreen` + sync `makeImageSnapshot`. If the runtime detects iOS Simulator and `Platform.OS === 'ios'`, the layer-snapshot path uses `makeImageSnapshotAsync` (already supported in 2.6.x) which awaits flush completion and is robust against the historical simulator flakiness. The selected path is logged once at session start.
- **Rationale**: Keeps the device path canonical and mostly synchronous (lower latency); contains the simulator-only quirk in a one-call branch.
- **Trade-offs**: A small amount of platform-detection code; one extra await on simulator commit.
- **Follow-up**: Smoke-test commit on iOS Simulator (iPad Pro 13-inch M4 image) and on iOS device.

## Verified Baseline

Recorded during Task 1.1 (kiro-impl) on 2026-05-06:

| Package | Version installed | Required |
|---|---|---|
| `react-native-gesture-handler` | 2.30.x (`apps/mobile/package.json`: `~2.30.0`; node_modules resolved 2.30.x) | ≥ 2.20 (for `event.stylusData` on `Gesture.Pan`) |
| `react-native-reanimated` | 4.2.1 | ≥ 3 (worklet runtime + `useDerivedValue`) |
| `@shopify/react-native-skia` | 2.6.2 | ≥ 2.6 (`MakeOffscreen` + `<Image image={shared}>`) |

All three are above the required minimum. The hot-path architecture (worklet-driven, `stylusData`-fed, GPU-offscreen-snapshot-based) is supported by the installed versions out of the box; no library upgrades or custom native modules are required for v1.

## Risks & Mitigations

- **R1: Worklet-side `MakeOffscreen` regression in 2.6.x.** — *Mitigation*: 1-day device spike before locking the implementation; if regression confirmed, fall back to sync surface allocation on the JS thread once at gesture begin and pass the surface handle into the worklet runtime (Reanimated supports passing JSI handles).
- **R2: `SharedValue<SkImage>` lifetime mishandling.** — Snapshots replace the previous image; the previous image must be disposed to release native memory. *Mitigation*: explicit `.dispose()` on the prior `SkImage` at every snapshot replacement, with a unit test verifying handle count stays bounded over 1000 sequential strokes (deferred per `testing.md`).
- **R3: Picture-as-texture path crash (#3390).** — *Mitigation*: do not use `usePictureAsTexture`. Pictures are displayed directly via `<Picture>`.
- **R4: Stylus event throttling.** — Apple Pencil ProMotion delivers 120 events/sec; the worklet must not allocate per event. *Mitigation*: per-stroke pool (Requirement 4); profile per-event stamp count and fall back to coalescing if needed.
- **R5: `runOnJS(true)` re-introduced accidentally during merges.** — *Mitigation*: a `no-restricted-syntax` lint rule banning `.runOnJS(true)` inside the editor screen, plus a code-review checklist item.

## References

- [RN Gesture Handler — Pan gesture event payload](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pan-gesture/) — `stylusData` field reference.
- [RN Gesture Handler 2.20.0 release notes](https://github.com/software-mansion/react-native-gesture-handler/releases/tag/2.20.0) — stylus support shipped.
- [RN-Skia — Textures doc](https://shopify.github.io/react-native-skia/docs/animations/textures/) — `MakeOffscreen` + worklet pattern.
- [RN-Skia — Pictures doc](https://shopify.github.io/react-native-skia/docs/shapes/pictures/) — PictureRecorder pattern.
- [RN-Skia discussion #2859](https://github.com/Shopify/react-native-skia/discussions/2859) — `useTouchHandler` deprecation.
- [RN-Skia issue #3390](https://github.com/Shopify/react-native-skia/issues/3390) — `usePictureAsTexture` GC crash; avoid that path.
- [RN-Skia issue #1811](https://github.com/Shopify/react-native-skia/issues/1811) — historical `makeImageSnapshot` iOS quirks; mitigated by `makeImageSnapshotAsync`.
- [Apple developer doc — Illustrating force/altitude/azimuth](https://developer.apple.com/documentation/uikit/illustrating-the-force-altitude-and-azimuth-properties-of-touch-input) — semantics of the underlying iOS fields.
- [doublelam/react-native-free-canvas](https://github.com/doublelam/react-native-free-canvas) — reference for worklet-driven Skia drawing.
- Local: `libs/canvas-skia/node_modules/@shopify/react-native-skia/lib/typescript/src/skia/types/Surface/Surface.d.ts` — installed Surface API.
- Local: `apps/mobile/package.json` — RNGH `~2.30.0`, Reanimated `4.2.1`, both above the required minimum for stylusData and worklet support.
