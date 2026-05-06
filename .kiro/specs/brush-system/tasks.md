# brush-system — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `canvas-skia`, `server`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~4–6 weeks for one engineer.** ABR parser + Skia stamp shaders are the biggest pieces.

---

## Phase A — Types & built-in presets

- [x] **A.1** `BrushPreset`, `Stroke`, `StrokePoint`, `Stamp` types in `canvas-core/src/brush/{presets.ts, stroke.ts, stamps.ts}`. **(S)**
- [x] **A.2** `BUILTIN_PRESETS` data — 5 v1 presets (Pen, Pencil, Marker, Eraser, Smooth). Per editor philosophy, Airbrush + Smudge are deferred to a post-v1 expansion of this spec. Eraser is a fixed preset whose `erase: true` flag is honored by the compositor. **(M)**
- [ ] **A.3** Bundle 5 tip-shape PNGs (binary blobs) at sensible resolutions (512×512). Deferred — v1 stamps are pure radial alpha discs with hardness falloff (see `compose-stroke.ts`); custom tip shapes ride the post-v1 ABR + Skia path. **(S — deferred)**
- [x] **A.4** Pressure-curve helpers: `samplePressureCurve` (piecewise-linear) covers v1; full Bezier (`linearCurve`, `easedCurve`, `applyPressureCurve`) is post-v1 once tip atlases land. **(S)**

## Phase B — Stroke renderer (canvas-core)

- [x] **B.1** `expandStrokeToStamps(preset, points, options)` pure function: spacing-driven stamp generation with per-segment lerp. **(M)**
- [x] **B.2** Smoothing (`smoothStrokePoints`) — moving-average filter on input points. **(S)**
- [x] **B.3** Pressure → size mapping via `samplePressureCurve` + preset curve. **(S)**
- [ ] **B.4** Tilt → angle mapping for Marker. Deferred — tilt fields are preserved on `StrokePoint` but unused in the v1 disc compositor; Skia stamp-renderer will consume them. **(S — deferred)**
- [ ] **B.5** Velocity → opacity mapping for Pencil. Deferred — same rationale as B.4 (computed at the renderer seam, not the geometry seam). **(S — deferred)**
- [x] **B.6** Tests: each preset produces sensible stamp counts; spacing honored; pressure scales size; eraser flag propagates; bbox is correct. **(M)**

## Phase C — Skia stamp renderer

> **Deferred to a follow-up Skia spec.** v1 server-side compositor (`composeStrokeIntoRaster` in `canvas-core/src/brush/compose-stroke.ts`) covers C.3 (mask routing) and C.5 (eraser blend) so `paint_strokes` is functional today; the on-tablet Skia stamp renderer ships once the canvas-skia adapter lands.

- [ ] **C.1** `TipAtlas` cache for tip shapes. **(M — deferred)**
- [ ] **C.2** `SkiaStampRenderer` with hardness shader (radial alpha falloff). **(L — deferred)**
- [x] **C.3** Mask-layer routing — handled in `compose-stroke.ts` `maskOnly` mode + `paint_strokes` handler routing on `layer.kind`. **(M)**
- [ ] **C.4** Smudge brush: sample-and-stamp logic. **(L — deferred; v1 ships pen/pencil/marker/eraser/smooth, no smudge)**
- [x] **C.5** Eraser handling — `composeStrokeIntoRaster` honors `stamp.erase` via destination-out math. **(S)**
- [ ] **C.6** Tests: visual regression for each preset stroke at fixed inputs. **(M — deferred to Skia adapter)**

## Phase D — Pencil/S-Pen input

> **Deferred.** v1 records `pressure` / `tilt_x` / `tilt_y` on `StrokePoint` so the geometry seam already accepts stylus data; the input adapter on the tablet is owned by the Skia / mobile spec (see `canvas-skia` work).

- [ ] **D.1** `PencilInput` adapter wrapping `react-native-skia` pressure events. **(M — deferred)**
- [ ] **D.2** Tilt event capture. **(S — deferred)**
- [ ] **D.3** Velocity calculation (point-to-point time + distance). **(XS — deferred)**
- [ ] **D.4** Pencil-only mode toggle (block finger touch on canvas). **(S — deferred)**
- [ ] **D.5** Tests with mocked pressure / tilt streams. **(M — deferred)**

## Phase E — ABR parser (canvas-core)

> **Deferred.** Custom-brush import is explicit post-v1 per editor philosophy and the requirements scope; v1 ships the 5 fixed presets only.

- [ ] **E.1** `parseAbr(bytes)` reads ABR v1.x + v6.x binary format. **(L — deferred)**
- [ ] **E.2** Extract brush tip alpha image from sample data section. **(L — deferred)**
- [ ] **E.3** Extract spacing, diameter, hardness, pressure curve fields when present. **(M — deferred)**
- [ ] **E.4** Detect ignored features (texture, dual brush, scattering, color dynamics) and report in `ignored_features` array. **(M — deferred)**
- [ ] **E.5** Multi-brush ABRs: parse all brushes from one file. **(S — deferred)**
- [ ] **E.6** Tests with 10+ representative ABR files. **(M — deferred)**

## Phase F — Server-side brush registry

- [ ] **F.1** Migration `00X-brushes.ts`. Deferred — v1 only ships built-in presets resolved from `BRUSH_PRESETS`; the SQLite registry table lands with the post-v1 ABR/PNG import path. **(S — deferred)**
- [ ] **F.2** Seed built-in presets on first migration. Deferred — same rationale as F.1. **(S — deferred)**
- [ ] **F.3** `BrushRegistry` class: list, get, create, delete. Deferred — same rationale as F.1. **(S — deferred)**
- [ ] **F.4** `import_brush` handler with ABR + PNG paths. Deferred — explicit post-v1 per spec scope. **(M — deferred)**
- [ ] **F.5** `delete_brush` handler with built-in protection. Deferred — paired with F.4. **(S — deferred)**
- [x] **F.6** `paint_strokes` handler — `createPaintStrokesHandler` in `libs/server/src/lib/handlers/paint-strokes.ts`. Validates `brush_id` against built-in `BRUSH_PRESETS`, throws `BRUSH_NOT_FOUND`; routes paint vs mask layer kinds; honors selection bbox clip; persists raw-RGBA via `AssetStore` and emits `document.changed`. **(S)**
- [ ] **F.7** Resource: `diffusecraft://brushes/list`. Deferred — paired with F.1–F.5. **(S — deferred)**
- [x] **F.8** Tests — `libs/server/src/__tests__/paint-strokes.ts` (13 cases) covers blank-paint, eraser preserves color, mask alpha-only routing, BRUSH_NOT_FOUND, NOT_FOUND, INVALID_INPUT, selection-clip drop, ignore_selection, over-paint of an existing raster, and the `defaultRawRgbaCodec` round-trip. **(M)**

## Phase G — Catalog updates

- [ ] **G.1** Add `import_brush` and `delete_brush` to `@diffusecraft/mcp-tools`. Deferred — paired with the import path (Phase E + F.4/F.5). v1 catalog stays at the existing tool count. **(S — deferred)**
- [ ] **G.2** Update `mcp-tool-catalog/requirements.md` final tally. Deferred. **(XS — deferred)**
- [ ] **G.3** Footprint test re-run; confirm ≤100 KB. Deferred. **(XS — deferred)**

## Phase H — Tablet UX

> **Deferred.** UI is out of scope per the implementation prompt; ships once the Skia adapter (Phase C) lands.

- [ ] **H.1** `<BrushPalette />` vertical thumbnail strip. **(M — deferred)**
- [ ] **H.2** `<BrushThumb />` with active + erase indicators. **(M — deferred)**
- [ ] **H.3** `<BrushSettings />` long-press panel with sliders for size/hardness/opacity/flow/spacing. **(M — deferred)**
- [ ] **H.4** `<ColorDisc />` HSV picker + recent/favorite swatches. **(L — deferred)**
- [ ] **H.5** Eraser toggle gesture (two-finger long-press). **(S — deferred)**
- [ ] **H.6** Pinch-and-drag size hot-gesture. **(M — deferred)**
- [ ] **H.7** `<BrushImportDialog />` for picking + uploading ABR files. **(M — deferred)**
- [ ] **H.8** "Custom" section in palette with imported brushes. **(S — deferred)**
- [ ] **H.9** Pencil-only-mode setting + auto-detection. **(S — deferred)**
- [ ] **H.10** Tests: each gesture; brush-switch latency. **(M — deferred)**

## Phase I — Performance

> **Deferred** to the Skia spec (Phase C); the v1 server-side handler is correctness-only and runs only when the agent calls `paint_strokes` (out of the interactive loop).

- [ ] **I.1** Stroke latency ≤30 ms benchmark on iPad-class device. **(S — deferred)**
- [ ] **I.2** Stroke commit (round-trip to server) ≤200 ms benchmark. **(S — deferred)**
- [ ] **I.3** Smudge ≤50 ms per sample on 1024×1024. **(S — deferred)**
- [ ] **I.4** Tip-atlas cache hit rate >90% in normal session. **(S — deferred)**

## Phase J — Documentation

- [ ] **J.1** README on brush philosophy + 5 presets + import flow. Deferred — TSDoc on every public export already documents the surface. **(M — deferred)**
- [ ] **J.2** ABR import limitations doc. Deferred — paired with Phase E. **(S — deferred)**
- [ ] **J.3** Custom brush authoring is post-v1 — explicit note. Deferred — already documented in the spec's `requirements.md` §1 and §5. **(XS — deferred)**

---

## Dependency order

```
A → B → C
        \
         → D (input) → H (UI) → I (perf) → J (docs)
        \
         → E (ABR) → F (registry+handlers) → G (catalog)
```

A → B → C is the rendering chain. D feeds C with input events. E + F is the ABR import path. H consumes everything.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Skia hardness shader doesn't perform on lower-end iPads | C.2 measures FPS; falls back to alpha-multiplied tip without shader if budget exceeded. |
| ABR format edge cases (rare versions, non-standard fields) | E.6 fixtures cover known variants; unknown variants are imported with all features in `ignored_features` and a warning. |
| Smudge sample-and-stamp visible artifact on rapid strokes | C.4 uses small step + lerp between consecutive samples. |
| Pencil pressure 0 events at start of stroke (Apple bug) | D.1 ignores first event if pressure==0; uses default mid-pressure. |
| Mask-layer painting routes wrong shader | C.3 explicit unit test for paint vs mask target. |
| Built-in tip blobs miss after first-run migration | F.2 idempotent seed; falls back to bundled file if blob missing. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. ABR import covers the test fixture set.
3. Performance gates pass.
4. Risks acceptable.

After approval, implementation begins with Phase A.
