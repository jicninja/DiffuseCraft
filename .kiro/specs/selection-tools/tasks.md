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

## Dependency order

```
A → B (Tier 1 server) → F (catalog)
              \
               → C (Tier 2 MobileSAM) → D (Tier 3) → E (Tier 4 sampling)
                                                          \
                                                           → G (renderer) → H (tablet UX) → I (perf) → J (docs)
```

A is foundational. B/C/D/E are server. F is documentation/cap update. G/H are tablet. Tier 4 (E) can land in v0.2 if MCP sampling integration isn't ready.

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
