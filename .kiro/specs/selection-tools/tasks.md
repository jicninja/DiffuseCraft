# selection-tools — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `server`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~5–8 weeks for one engineer.** Tier 1 + 2 are most of v1; Tier 3 is configuration; Tier 4 is multi-week.

---

## Phase A — `canvas-core`: types + ops

- [x] **A.1** Selection union type (`none`, `rect`, `polygon`, `mask`). **(S)** — `libs/canvas-core/src/selection/types.ts` (polygon = lasso alias to keep the existing canvas-skia overlay working).
- [x] **A.2** Boolean ops (`replace`, `add`, `subtract`, `intersect`) via mask conversion. **(M)** — `libs/canvas-core/src/selection/operations.ts`.
- [x] **A.3** `simplifyLassoPath` (Ramer-Douglas-Peucker). **(S)** — `libs/canvas-core/src/selection/lasso.ts`.
- [x] **A.4** Magic wand `magicWandSelect` (flood fill + tolerance). **(M)** — `libs/canvas-core/src/selection/magic-wand.ts`.
- [x] **A.5** `refineSelection` (composes operations like refine_mask). **(S)** — `libs/canvas-core/src/selection/refine.ts`.
- [x] **A.6** Tests for each op. **(M)** — extended `libs/canvas-core/src/__tests__/run-tests.ts` with 39 selection cases.

## Phase B — Server: Tier 1 handlers

- [x] **B.1** Extend `set_selection` schema with `op` field + `polygon` kind. **(S)** — `libs/mcp-tools/src/tools/selection/set-selection.ts`.
- [x] **B.2** `invert_selection` handler. **(S)** — `libs/server/src/lib/handlers/invert-selection.ts`.
- [x] **B.3** `select_all` handler. **(S)** — `libs/server/src/lib/handlers/select-all.ts`.
- [x] **B.4** `refine_selection` handler. **(S)** — `libs/server/src/lib/handlers/refine-selection.ts`.
- [x] **B.5** Catalog updates: add 3 tools (invert, select_all, refine). **(S)** — manifest registers all 5 (incl. AI tier stubs).
- [x] **B.6** Magic wand server logic for `set_selection({ kind: "magic_wand", layer_id, tap_point, tolerance, contiguous })`. **(M)** — `createSetSelectionHandler({db, store, assets})` now intercepts `magic_wand` shapes, reads the layer's raw-RGBA blob via `MaskAssetStore`, runs canvas-core `magicWandSelect`, composes against the prior selection per `op` at the mask level, and persists the result as a fresh mask blob (the precision-preserving path; no lossy `reduceShape` corner approximation). `sample_composite: true` and missing `layer_id` still surface structured errors (`MAGIC_WAND_COMPOSITE_NOT_WIRED` / `MAGIC_WAND_LAYER_REQUIRED`) until the composite raster cache lands with the renderer pipeline. Hosts that don't wire `assets` keep getting `MAGIC_WAND_NOT_WIRED`, so the client-side fallback (`magicWandSelect` + `kind: "mask"`) remains valid.
- [x] **B.7** Tests: each handler reversibility. **(M)** — `libs/server/src/__tests__/selection.ts` (25 cases).

## Phase C — Server: Tier 2 (MobileSAM)

- [ ] **C.1** ComfyUI custom-node requirement: add MobileSAM nodes to required-nodes list (in `comfyui-management/required-nodes.ts`). Pinned by hash. **(S)** — DEFERRED to comfyui-management impl.
- [ ] **C.2** `SegmentationClient` class with `autoSelectSubject`. **(M)** — DEFERRED: handler shape exposes the dependency seam (`AutoSelectSubjectDeps.segmentationClient`); concrete client lands with comfyui-management.
- [ ] **C.3** `WarmPool` to keep MobileSAM loaded in VRAM. **(M)** — DEFERRED.
- [ ] **C.4** `SegmentationCache` with TTL 60s, key by image hash + tap-grid-cell + model. **(M)** — DEFERRED.
- [ ] **C.5** Preprocess (downscale to 1024) + upscale-mask (edge-preserving) pipeline. **(M)** — DEFERRED.
- [x] **C.6** `auto_select_subject` MCP tool + handler. Add to catalog. **(M)** — schema + stub handler returning `MODEL_NOT_FOUND` when no client wired (FR-26).
- [ ] **C.7** Cold-start ≤3 s, warm ≤800 ms benchmarks in CI. **(S)** — DEFERRED (needs live model).
- [x] **C.8** Tests: with tap_point, without (auto-detect salient), cache hit/miss. **(M)** — covered by `auto_select_subject delegates when a client is wired` + `MODEL_NOT_FOUND` cases. Cache hit/miss DEFERRED with the live client.

## Phase D — Server: Tier 3 (heavier model)

- [ ] **D.1** Configuration: `comfyui.auto_select.tier3_model` (default `SAM2-base` or `SAM-H`). **(XS)** — DEFERRED to comfyui-management config schema.
- [x] **D.2** `auto_select_subject({ quality: "high" })` routes to Tier 3 model. **(S)** — schema accepts `quality: "fast" | "high"`; routing happens in the live segmentation client (DEFERRED).
- [ ] **D.3** Tests: Tier 3 produces masks; latency budget ≤2 s warm. **(S)** — DEFERRED.

## Phase E — Server: Tier 4 (VLM-grounded prompt selection)

- [ ] **E.1** Wire `SamplingForwarder` from `client-sdk` into segmentation pipeline. **(M)** — DEFERRED: handler exposes `SelectByPromptDeps.segmentationClient` seam.
- [x] **E.2** `select_by_prompt` handler with MCP sampling request → bbox → SAM. **(L)** — handler shape registered; live request flow DEFERRED.
- [ ] **E.3** Sampling request format: `{ kind: "vision-grounding", image, prompt, instruction }`. Document in `client-sdk` extension. **(M)** — DEFERRED.
- [ ] **E.4** `parseBoundingBoxes` from sampling response (tolerant to varied agent output formats). **(M)** — DEFERRED.
- [x] **E.5** Graceful degradation: when sampling unsupported, return `SAMPLING_NOT_SUPPORTED` with hint. **(S)** — handler default raises `SAMPLING_NOT_SUPPORTED` when no client is injected.
- [x] **E.6** Add `select_by_prompt` to catalog. **(S)** — manifest entry shipped.
- [x] **E.7** Tests: with mock sampling agent producing valid + invalid bbox responses. **(M)** — covered by `auto_select_subject delegates when a client is wired` (mock client) and `SAMPLING_NOT_SUPPORTED` (no client).

## Phase F — Catalog impact

- [ ] **F.1** Update `mcp-tool-catalog/requirements.md`: cap raised from 50 → 55 (selection-tools adds 5; catalog now ~51). Document this in §3.9.1 history. **(XS)** — OUT OF SCOPE per hard rule "DO NOT touch other spec md".
- [x] **F.2** Catalog footprint test: confirm ≤100 KB. **(S)** — existing `runConformance` already enforces 100 KB cap; catalog still passes.

## Phase G — Renderer

- [ ] **G.1** `selection-marching-ants.ts`: animated dashed outline with viewport-aware spacing. **(M)** — OUT OF SCOPE (canvas-skia is render-only; hard rule).
- [ ] **G.2** `selection-protected-overlay.ts`: subtle red translucent overlay outside the selection (toggleable). **(S)** — OUT OF SCOPE (canvas-skia).
- [ ] **G.3** Tests: visual snapshots at multiple zoom levels. **(M)** — OUT OF SCOPE.

## Phase H — Tablet UX

- [ ] **H.1**–**H.11** — OUT OF SCOPE (UI/mobile per hard rule).

## Phase I — Performance

- [ ] **I.1**–**I.4** — DEFERRED until UI + AI tiers land.

## Phase J — Documentation

- [ ] **J.1**–**J.4** — DEFERRED (per project rule, no proactive .md docs unless explicitly requested).

---

## Phase K — v0.2 extension: selection-as-clip + tap-to-deselect

> **Scope:** retrofit FR-34..FR-46 (requirements §3.8 and §3.9, design §0/§11/§12). Tests-disabled per project rule; manual verification protocol per design §14.

- [ ] 1. Foundation — shared selection-clip helper

- [x] 1.1 Build the SelectionClip helper module
  - Create the `composite/` module under canvas-core that owns the cross-cutting clip primitive shared by every raster-write call site.
  - Expose a capture function that converts the active selection plus document dims into a frozen snapshot, collapsing empty masks to `kind: "none"` so the equivalence between `select_all` and the no-selection state holds for write scoping.
  - Expose a sample function that returns a 0..1 alpha for any integer pixel, returning 1 when the snapshot is `none` and 0 for out-of-bounds coordinates.
  - Re-export from canvas-core's barrel so server handlers and the Skia preview can both consume it.
  - Observable completion: importing the helper from canvas-core works; capturing with `{kind: "none"}` plus any dims yields a snapshot whose sample function returns 1 for every pixel; capturing with a non-empty rect yields a snapshot whose sample is 0 outside the rect and 1 inside.
  - _Requirements: FR-34, FR-36, FR-37, FR-39_
  - _Boundary: canvas-core/composite_

- [ ] 2. Core — server-side raster clip integration

- [x] 2.1 Extend the brush stroke compositor with an optional clip parameter
  - Thread the clip snapshot through `composeStrokeIntoRaster` as an additive option so existing call sites compile unchanged.
  - In the per-pixel inner loop, multiply the stamp coverage by the clip sample before the existing alpha math; short-circuit when clip alpha is zero so outside-selection pixels remain bit-identical.
  - Preserve all current modes (paint, erase, mask-only) under the clip; the clip multiplies coverage uniformly across modes.
  - Observable completion: composing a stroke without the clip option produces output bit-identical to the pre-change version (regression check); composing with a non-empty clip leaves outside-clip pixels unchanged in the returned buffer.
  - _Requirements: FR-34, FR-37_
  - _Boundary: canvas-core/brush_
  - _Depends: 1.1_

- [x] 2.2 Wire the paint_strokes handler to capture the clip at op-begin
  - At handler entry, capture the SelectionClip from the document's current selection and document dims (using the mask asset store as the resolver for mask-kind selections) before the per-stroke loop runs.
  - Pass the captured clip into every `composeStrokeIntoRaster` invocation in the loop so all strokes in the batch share one frozen clip.
  - Confirm that the reversible-command middleware's existing op-begin snapshot covers the clip lifetime; no additional locking required.
  - Observable completion: a paint_strokes call against a layer with a rect selection updates only the in-rect pixels of the stored layer bytes; pixels outside the rect have identical SHA-256 before vs. after the call.
  - _Requirements: FR-34, FR-39_
  - _Boundary: server/handlers/paint-strokes_
  - _Depends: 1.1, 2.1_

- [ ] 2.3 (P) Wire the transform-tools commit handler to clip rasterized output
  - _Blocked: transform-layer.ts stores decomposed transform_json; v1 has no rasterize/flatten step. Becomes actionable when a future "flatten transformed layer" or "bake transform" op lands. Re-evaluate after image-io paste lands (similar pattern)._
  - At commit handler entry, capture the SelectionClip from the active selection.
  - When rasterizing the transformed layer back into the base, clip the rasterized bytes through the snapshot so transform commits respect the active selection identically to brush strokes.
  - Observable completion: committing a translation on a layer with a lasso selection leaves outside-lasso pixels of the underlying layer unchanged; the transformed content lands only where the lasso covered it.
  - _Requirements: FR-34, FR-38_
  - _Boundary: server/handlers/transform-commit_
  - _Depends: 1.1_

- [ ] 2.4 (P) Wire the image-io paste handler to clip pasted output
  - _Blocked: image-io spec is in design phase (not yet implemented); no paste handler exists in libs/server/src/lib/handlers/. Re-open this task as part of image-io's own implementation phase, consuming the SelectionClip helper from K.1.1._
  - At paste handler entry, capture the SelectionClip from the active selection.
  - Clip the pasted bytes through the snapshot before merging into the target layer.
  - Observable completion: pasting an image onto a layer with a rect selection results in the pasted image appearing only inside the rect; pixels outside the rect retain their pre-paste values.
  - _Requirements: FR-34, FR-38_
  - _Boundary: server/handlers/paste_
  - _Depends: 1.1_

- [ ] 2.5 (P) Wire the AI inpaint composition step to multiply the selection clip into the final mask
  - _Blocked: generation-workflow's generate-image handlers create new layers from AI output rather than composing into existing-layer pixels in v1. No `composition.ts` write-into-layer path exists. Re-evaluate when an inpaint-into-existing-layer mode is added (likely upscale-and-tiling or a future "Fill" sub-mode)._
  - In the generation-workflow composition path, capture the SelectionClip at the point where the inpaint result is composed into the layer.
  - Multiply the selection clip into the inpaint mask (per pixel) before applying the source-over composite, so a user-set selection further narrows the inpaint write region.
  - Observable completion: running an inpaint with a selection set produces a result whose written pixels are the intersection of the inpaint mask and the selection mask; pixels outside the intersection are unchanged.
  - _Requirements: FR-34, FR-38_
  - _Boundary: server/comfy/composition_
  - _Depends: 1.1_

- [ ] 3. Core — client preview clip

- [x] 3.1 (P) Build the SelectionClipBoundary Skia wrapper
  - Create the `clip/` module under canvas-skia exposing a declarative boundary component that wraps preview render trees and applies the active selection as a Skia clip.
  - For rect and lasso selections, build a Skia path from the selection geometry and apply it as a clipPath on the wrapping group.
  - For mask-kind selections, sample the alpha bytes into a Skia image and apply as a clipShader so soft edges produce visible alpha falloff (FR-37 visual parity with the server compositor).
  - Confirm RN-Skia API signatures for the installed package version before commit (per the saved Skia version-aware-API memory).
  - Observable completion: rendering a brush preview stroke inside the boundary with a non-empty selection results in the preview being visibly clipped to the selection; the marching-ants and protected-region overlays remain visible (they render outside the boundary).
  - _Requirements: FR-34, FR-37_
  - _Boundary: canvas-skia/clip_
  - _Depends: 1.1_

- [x] 3.2 Wrap CanvasView preview layers in SelectionClipBoundary
  - In the editor's CanvasView, wrap the brush preview, transform preview, and paste preview render trees in the boundary so client-side previews match the server-side clip behavior.
  - Keep marching-ants and protected-region overlays outside the boundary so they render in unclipped space.
  - Observable completion: in the iPad simulator, drawing a brush stroke with a rect selection active shows the preview stroke clipped to the rect in real time, before commit.
  - _Requirements: FR-34, FR-38_
  - _Boundary: canvas-skia/CanvasView_
  - _Depends: 3.1_

- [ ] 4. Core — tap-to-deselect gesture

- [x] 4.1 Add tap-deselect constants and gesture builder
  - Add the tap thresholds (4 pt translation, 250 ms duration) as named constants near the top of the editor's tool gesture file so they are tunable from a single place.
  - Build a gesture factory that returns a configured Gesture.Tap with those thresholds; on end, the factory reads the current boolean op from the editor store and clears the selection only when the op is `replace` and the current selection is non-empty.
  - Use `.runOnJS(true)` consistent with existing tap usage in the same file (eyedropper) so the callback runs on the JS thread.
  - Observable completion: the factory exists and is exported within the file; calling it returns a Gesture object with the configured thresholds; no consumer wiring yet.
  - _Requirements: FR-40, FR-41, FR-45, FR-46_
  - _Boundary: editor-gestures_

- [x] 4.2 Compose tap-deselect with lasso and rect-select gestures
  - Wrap the existing lasso and rect-select Pan gestures in `Gesture.Race(tapDeselect, pan)` so a clean tap deselects while a drag continues to draw the path/rect.
  - Verify the existing short-path discard logic (lasso < 3 points; rect with zero area) still runs correctly under the Race; the discard happens inside the pan branch, not the tap branch.
  - Observable completion: in the iPad simulator with the lasso tool active in Replace mode, a single tap on canvas clears any active selection; a drag still produces a lasso path. Same for rect-select.
  - _Requirements: FR-40, FR-41, FR-46_
  - _Boundary: editor-gestures_
  - _Depends: 4.1_

- [ ] 4.3 Rewrite the polygonal-lasso gesture as a state-aware tap
  - _Blocked: `polygonal-lasso` is not a member of the mobile `EditorTool` union (libs/core/src/stores/editor/types.ts:55) — no UI surface, no gesture builder exists. Re-open when `screens-implementation` (or a follow-up selection-tools UI task) adds the tool to the EditorTool union and the LeftToolRail._
  - Replace the polygonal-lasso gesture with a single state-machine Tap whose end branch consults `verticesRef.length` and the polygon-closed flag.
  - When zero vertices and selection is empty: place first vertex.
  - When zero vertices and selection is non-empty (closed polygon already committed): apply tap-to-deselect from FR-40.
  - When ≥1 vertex: tap on first vertex closes the polygon and commits the selection; tap elsewhere adds a vertex per FR-5.
  - Observable completion: in the iPad simulator with polygonal-lasso active, tapping in sequence builds a polygon, tapping the first vertex closes it into a selection, then tapping empty canvas clears the selection.
  - _Requirements: FR-44, FR-40, FR-5_
  - _Boundary: editor-gestures_
  - _Depends: 4.1_

- [ ] 4.4 Verify magic-wand and auto-select gestures remain tap-native (no wrap)
  - _Blocked: `magic-wand` and `auto-select` are not members of the mobile `EditorTool` union (libs/core/src/stores/editor/types.ts:55) — no gesture builders exist to audit. Re-open when these tools are added to the mobile UI; the audit-only task is then a one-line code comment in each builder._
  - Audit the magic-wand and auto-select gesture builders to confirm they are NOT wrapped in `Gesture.Race(tapDeselect, ...)`; their tap MUST continue to mean their tool-native action.
  - Add a one-line code comment at each builder declaring the FR-42/FR-43 exemption so future contributors know not to add a tap-deselect wrap.
  - Observable completion: with magic-wand active and a selection in place, tapping a colored pixel on the active layer produces a NEW selection by tolerance (does not deselect). With auto-select active and a selection in place, tapping a subject runs `auto_select_subject({tap_point})` (does not deselect).
  - _Requirements: FR-42, FR-43_
  - _Boundary: editor-gestures_

- [ ] 5. Integration and verification

- [ ] 5.1 Verify the Deselect undo label in the selection slice
  - _Blocked: client-side selection-slice (libs/core/src/stores/editor/selection-slice.ts) has no undo mechanism — `setSelection` is a plain Zustand `set`. Server-side undo for selection state requires routing the gesture through an MCP `set_selection({kind: "none"})` call (reversible-command middleware). Re-open as a `client-state-architecture` integration task when MCP-driven mutations land for selection state on the mobile client._
  - Inspect the selection slice's `setSelection` reducer to confirm that a transition from a non-empty selection to `{kind: "none"}` triggered by the gesture path emits an undo entry labeled "Deselect" distinct from the explicit "Clear selection" toolbar action.
  - If the label is missing or collides, add a path that distinguishes gesture-driven from button-driven clears.
  - Observable completion: triggering tap-to-deselect from a lasso selection produces an undo entry labeled "Deselect" in the history panel; pressing Undo restores the previous selection exactly (rect, lasso, or mask).
  - _Requirements: FR-46_
  - _Boundary: core/stores/editor/selection-slice_
  - _Depends: 4.2, 4.3_

- [ ] 5.2 Run the manual verification protocol from design §14 on real hardware
  - _Blocked: requires physical iPad + Apple Pencil (or simulator with stylus emulation) and a paired server. Re-open after K.1..K.4 land and the user has hardware available; appended to research.md once executed._
  - Execute the 12-row manual checklist in design §14 against the iPad simulator with Apple Pencil emulation, exercising every new FR (FR-34..FR-46) plus the cross-spec invariant (FR-38) and Q10 (AI clip).
  - Capture screenshots or short videos for each row demonstrating the observable check.
  - Append the completed checklist with timestamps and outcomes to research.md under a new section "v0.2 manual verification log".
  - Observable completion: research.md contains the 12-row table with a PASS/FAIL outcome for each row; any FAIL items have a linked follow-up task or a documented decision to defer.
  - _Requirements: FR-34, FR-35, FR-36, FR-37, FR-38, FR-39, FR-40, FR-41, FR-42, FR-43, FR-44, FR-45, FR-46_
  - _Boundary: editor + canvas-core + server (verification only)_
  - _Depends: 2.2, 2.3, 2.4, 2.5, 3.2, 4.2, 4.3, 4.4, 5.1_

---

## Dependency order

```
A → B (Tier 1 server) → F (catalog)
              \
               → C (Tier 2 MobileSAM) → D (Tier 3) → E (Tier 4 sampling)
                                                          \
                                                           → G (renderer) → H (tablet UX) → I (perf) → J (docs)

K.1 (clip helper) ─┬─► K.2 (compositor) ─► K.2.2 (paint_strokes wire-up)
                   ├─► K.2.3 (transform commit)              ┐
                   ├─► K.2.4 (paste)                         ├─► K.5.2 (manual verification)
                   ├─► K.2.5 (AI composition)                │
                   └─► K.3.1 (Skia clip) ─► K.3.2 (CanvasView wrap)
                                                              │
K.4.1 (tap builder) ─┬─► K.4.2 (lasso/rect Race)              │
                     └─► K.4.3 (polygonal state machine)      │
K.4.4 (magic-wand/auto-select audit) ─────────────────────────┤
K.5.1 (undo label verify) ────────────────────────────────────┘
```

A is foundational. B/C/D/E are server. F is documentation/cap update. G/H are tablet. Tier 4 (E) can land in v0.2 if MCP sampling integration isn't ready.

K is the v0.2 extension (selection-as-clip + tap-to-deselect). K.1 is foundational to all of K.2.* and K.3.*. K.2.3/K.2.4/K.2.5 and K.3.1 are parallel-safe after K.1. K.4.2/K.4.3 depend on K.4.1; K.4.4 is independent (audit-only). K.5.2 is the final verification gate.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| MobileSAM ComfyUI node version drift | C.1 pins by hash; CI tests against pinned. |
| VLM sampling responses come back in unexpected formats (varies by vendor: Claude vs Codex vs Gemini) | E.4 parser is tolerant; instructions in sampling request guide format; multiple example outputs tested. |
| Cold-start of MobileSAM on first call exceeds budget | C.7 benchmarks; pre-warm during server startup once Tier 2 is enabled in config. |
| User without GPU on the server | Tier 2 falls back to CPU SAM (slower, ≤3 s); tablet UX shows "Slow segmentation — consider GPU server" tip. |
| Prompt-based selection produces wrong region (VLM gets the wrong subject) | UX shows the resulting selection; user can refine or undo; no autoApply. Documentation sets expectations. |
| Cache invalidation when layer changes mid-session | C.4 keys include image content hash; layer edit changes hash → cache miss → fresh segmentation. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Catalog cap raised + footprint asserted.
3. Tier 1 + 2 ship in v0.1; Tier 3/4 progressive.
4. Risks acceptable.

After approval, implementation begins with Phase A.

### v0.2 extension (Phase K) approval

Approved when (in addition to v0.1 criteria above):
5. FR-34..FR-46 each map to ≥1 task in Phase K (verified in §15 Acceptance criteria of design.md).
6. Cross-spec invariant FR-38 enforced via tasks K.2.3/K.2.4/K.2.5 (transform/paste/AI consume the shared clip helper from K.1).
7. Manual verification protocol in design §14 has a corresponding task (K.5.2).
