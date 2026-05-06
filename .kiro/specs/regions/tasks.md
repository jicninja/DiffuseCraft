# regions — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `server`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer.**

---

## Phase A — `canvas-core`: types & ops

- [ ] **A.1** `Region`, `RootPrompt`, `CoverageMask` types. **(S)**
- [ ] **A.2** Pure ops: `defineRegion`, `updateRegion`, `removeRegion`, `setRootPrompt`. **(M)**
- [ ] **A.3** `composeEffectivePrompts` helper. **(S)**
- [ ] **A.4** `computeCoverage` with layer-stacking + threshold. **(M)**
- [ ] **A.5** `selectActiveRegions` based on selection overlap. **(S)**
- [ ] **A.6** Tests: each pure op + edge cases (orphan, threshold, occlusion). **(M)**

## Phase B — Persistence

- [ ] **B.1** Migration `00X-regions.ts`: table `regions (id, document_id, paint_layer_id, prompt, negative_prompt, name, orphaned, created_at)`. **(S)**
- [ ] **B.2** Migration adding `root_prompt`, `root_negative_prompt` to `documents` table. **(S)**
- [ ] **B.3** Indexes on `document_id` + `paint_layer_id`. **(XS)**
- [ ] **B.4** `RegionsService` repository class. **(M)**
- [ ] **B.5** Tests: CRUD + listForDocument. **(S)**

## Phase C — Server handlers

- [ ] **C.1** `defineRegionHandler` with reversible Command. Catalog +0 (already in catalog). **(M)**
- [ ] **C.2** `updateRegionHandler` (NEW tool). **(S)**
- [ ] **C.3** `removeRegionHandler`. **(S)**
- [ ] **C.4** `setRootPromptHandler` (NEW tool). **(S)**
- [ ] **C.5** Validation: paint layer kind, max 16 regions, no duplicate per layer. **(S)**
- [ ] **C.6** Orphan detector hooked into `document.changed` / layer removal. **(M)**
- [ ] **C.7** Tests: full lifecycle including orphan path. **(M)**

## Phase D — Catalog updates

- [ ] **D.1** **Raise catalog cap from 55 → 60** in `mcp-tool-catalog/requirements.md` FR-36. **(XS)**
- [ ] **D.2** Add `update_region`, `set_root_prompt` schemas to `@diffusecraft/mcp-tools`. **(S)**
- [ ] **D.3** Resource `diffusecraft://regions/list` extended (`orphaned` field included). **(S)**
- [ ] **D.4** Resource `diffusecraft://document/<id>/root-prompt`. **(S)**
- [ ] **D.5** Footprint test re-run (≤100 KB). **(XS)**
- [ ] **D.6** Update final tally to ~57 tools. **(XS)**

## Phase E — Graph integration

- [ ] **E.1** `attachRegions(graph, prompts, masks, baseClip, baseClipNeg)` per design.md §7. **(L)**
- [ ] **E.2** Wire into `generate_image` graph builder for Generate / Refine / Fill verbs. **(M)**
- [ ] **E.3** Selection-region filtering in graph for Fill / Refine cases. **(M)**
- [ ] **E.4** Per-region control layers via `attachControlLayers(controls, region_id, ...)`. **(M)**
- [ ] **E.5** Tests: snapshot of graph for representative docs (1 region, 3 regions, 8 regions, with controls). **(L)**

## Phase F — Coverage cache

- [ ] **F.1** `CoverageCache` short-lived per-generation cache (compute once, reuse for selection-filter + graph attach). **(S)**
- [ ] **F.2** Invalidation on `document.changed` for relevant layers. **(S)**
- [ ] **F.3** Tests. **(S)**

## Phase G — Tablet UX

- [ ] **G.1** `<RegionsPanel />` tab next to Layers panel. Virtualized list. **(M)**
- [ ] **G.2** `<RegionRow />` with coverage thumbnail + name + prompt preview. **(M)**
- [ ] **G.3** `<DefineRegionSheet />` from layer context menu. **(M)**
- [ ] **G.4** `<RegionSettings />` long-press sheet (full prompt + scoped controls + delete). **(M)**
- [ ] **G.5** `<RootPromptBar />` always-visible bar at top with collapse/expand + negative toggle. **(M)**
- [ ] **G.6** `<RegionOverlay />` cyan coverage preview on canvas. **(M)**
- [ ] **G.7** Orphan UI: red ⚠ + Remove button. **(S)**
- [ ] **G.8** Tap region row → set active layer to source paint layer. **(XS)**
- [ ] **G.9** Tests: end-to-end define/update/remove + orphan flow. **(M)**

## Phase H — Performance & validation

- [ ] **H.1** Coverage computation ≤100 ms on 4K canvas. **(S)**
- [ ] **H.2** Graph construction ≤200 ms with 8 regions. **(S)**
- [ ] **H.3** Visual regression: generation with regions matches krita-ai-diffusion behavior on canonical scenarios. **(M)**

## Phase I — Documentation

- [ ] **I.1** README on regions concept with diagrams (root + region prompt composition). **(M)**
- [ ] **I.2** UX guide: when to use regions vs control layers vs masks. **(M)**

---

## Dependency order

```
A → B → C → D
            \
             → E → F → G → H → I
```

A foundational. B persistence. C handlers. D catalog. E graph. F cache. G tablet. H+I last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Layer-stacking occlusion misses partial-opacity layers | A.4 only excludes layers with opacity >0.95; lower-opacity stacks compose normally. Documented. |
| ConditioningSetMask + ConditioningCombine ordering matters in ComfyUI | E.5 snapshot tests catch ordering regressions. |
| Many regions overlapping cause prompt token explosion | Server warns when total combined prompt > model token limit; E.5 tests. |
| Orphan regions accumulate after frequent layer deletion | C.6 marks orphan; GC purges orphans ≥7 days (history-gc analog). |
| User confused by "region with empty prompt is valid" | UI shows empty-prompt regions explicitly; help text explains use case (control-only scope). |
| Coverage threshold (0.05 fixed) excludes faint sketches | Configurable server-side; UI shows "coverage too faint" hint when region renders empty. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Cap raised to 60; footprint ≤100 KB asserted.
3. Visual regression for region-driven generation passes.
4. Risks acceptable.

After approval, implementation begins with Phase A.
