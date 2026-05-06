# control-layers — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `server`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~5–7 weeks for one engineer.** ComfyUI preprocessor wiring is the long pole.

---

## Phase A — Types & families

- [ ] **A.1** `ControlLayer` interface + `CONTROL_TYPES` const + `FAMILY_OF` map. **(S)**
- [ ] **A.2** Default-name helper per type. **(XS)**
- [ ] **A.3** Pure ops in `canvas-core`: addControl/removeControl/updateControl/regenerate-marker. **(M)**

## Phase B — ComfyUI preprocessor graphs

- [ ] **B.1** Required-nodes update in `comfyui-management/required-nodes.ts`: ensure `comfyui_controlnet_aux` + `ComfyUI_IPAdapter_plus` are pinned. **(XS)**
- [ ] **B.2** `buildScribblePreprocessGraph`. **(S)**
- [ ] **B.3** `buildLineArtPreprocessGraph`. **(S)**
- [ ] **B.4** `buildHEDPreprocessGraph` (Soft Edge). **(S)**
- [ ] **B.5** `buildCannyPreprocessGraph` with low/high params. **(S)**
- [ ] **B.6** `buildDepthPreprocessGraph` (DPT default; MiDaS optional). **(M)**
- [ ] **B.7** `buildNormalPreprocessGraph`. **(S)**
- [ ] **B.8** `buildPosePreprocessGraph` (DWPose default; OpenPose fallback). **(M)**
- [ ] **B.9** `buildSegPreprocessGraph` (Segformer or similar). **(M)**
- [ ] **B.10** Identity passthroughs for `unblur`, `stencil`, and reference-family types. **(XS)**
- [ ] **B.11** Tests: each preprocessor produces sensible output on fixture images. **(L)**

## Phase C — Preprocess cache

- [ ] **C.1** Migration `00X-preprocess-cache.ts`: table `preprocess_cache (cache_key TEXT PK, blob_id TEXT, expires_at TEXT)`. **(S)**
- [ ] **C.2** `PreprocessCache` class with hot-tier + SQLite cold-tier. **(M)**
- [ ] **C.3** Hourly GC of expired entries. **(S)**
- [ ] **C.4** Tests: cache hit / miss / TTL expire. **(M)**

## Phase D — Server handlers

- [ ] **D.1** `add_control_layer` extended schema (per FR-13) in `mcp-tools`. **(S)**
- [ ] **D.2** `addControlLayerHandler` with reversible Command + async preprocess kickoff. **(M)**
- [ ] **D.3** `removeControlLayerHandler` with reversible Command. **(S)**
- [ ] **D.4** `regenerateControlPreprocess` tool + handler. Catalog +1 (~55). **(M)**
- [ ] **D.5** `control_layer.preprocessed` event emission. **(XS)**
- [ ] **D.6** Stale detection: hook into `document.changed` for source-layer edits. **(M)**
- [ ] **D.7** Tests: full lifecycle (add, preprocess success, regenerate, stale, remove). **(M)**

## Phase E — Graph integration

- [ ] **E.1** `attachControlLayers(graph, controls, region_id, baseConditioning)` helper. **(L)**
- [ ] **E.2** `appendIPAdapterNode` for reference-family with strength + start/end_percent. **(M)**
- [ ] **E.3** `appendControlNetNode` for structural-family with strength + start/end_percent. **(M)**
- [ ] **E.4** Region scope filtering during graph build. **(S)**
- [ ] **E.5** Max 8 control layers per generation enforcement (`TOO_MANY_CONTROL_LAYERS`). **(S)**
- [ ] **E.6** Integration with `generation-workflow` graph builders (each verb attaches controls per region). **(M)**
- [ ] **E.7** Tests: representative graphs (1 control, 5 controls mixed family, region-scoped) executed against fixture ComfyUI. **(L)**

## Phase F — Catalog updates

- [ ] **F.1** Update `mcp-tool-catalog/requirements.md` schema for `add_control_layer` (extended) + new `regenerate_control_preprocess`. **(S)**
- [ ] **F.2** Catalog footprint test. ~55 tools. **(XS)**
- [ ] **F.3** Update §3.3.19 final tally. **(XS)**

## Phase G — Tablet UX

- [ ] **G.1** "Use as control →" entry in paint-layer context menu with type submenu grouped by family. **(M)**
- [ ] **G.2** `<ControlTypePicker />` modal. **(S)**
- [ ] **G.3** `<ControlLayerRow />` with type icon + preprocessed thumb + compact strength slider + status badge. **(M)**
- [ ] **G.4** `<ControlLayerSettings />` long-press sheet with full controls. **(M)**
- [ ] **G.5** `<ControlPreviewOverlay />` toggle for showing preprocessed image faded over canvas. **(M)**
- [ ] **G.6** Stale indicator + tap-to-regenerate. **(S)**
- [ ] **G.7** Region-scope picker integrated with `regions` spec (placeholder until regions ships). **(S)**
- [ ] **G.8** Tests: each control flow against in-memory server. **(M)**

## Phase H — Performance

- [ ] **H.1** Preprocessor latency benchmarks per FR-25 in CI. **(M)**
- [ ] **H.2** Cross-document cache effectiveness test (same source twice → 1 inference). **(S)**
- [ ] **H.3** Warm-pool retention strategy (per type) verified. **(S)**

## Phase I — Documentation

- [ ] **I.1** README on each of 14 types with example use cases. **(L)**
- [ ] **I.2** UX guide: when to use Reference vs Structural; when to scope to a region. **(M)**
- [ ] **I.3** Performance budgets per type. **(S)**

---

## Dependency order

```
A → B → C → D → E → F
                    \
                     → G → H → I
```

A is foundational. B (preprocessors) and C (cache) parallel. D depends on both. E plugs into generation-workflow (already specced; this hooks in). F catalog last on server side. G/H/I tablet + perf + docs.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Preprocessor model availability varies (`comfyui_controlnet_aux` versions) | B.1 pins by hash; build asserts presence; D.7 tests check graceful failure when missing. |
| User adds 8 controls and overwhelms generation latency | E.5 enforces; UI surfaces a "too many" warning before submission. |
| Stale source detection misses (e.g., user pastes new content into a layer) | D.6 hooks all `document.changed` events; missed cases user-driven via "regenerate" button. |
| IP-Adapter "face" mode quality varies by model | Document recommended IP-Adapter checkpoint in `comfyui-management/default-models.ts`. |
| Cross-document cache grows unbounded | C.3 GC; max-size-bytes config (already exists in server-architecture FR-30 GC). |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. All 14 types have working preprocess paths.
3. Catalog ≤55 tools.
4. Cross-document cache effective.
5. Risks acceptable.

After approval, implementation begins with Phase A.
