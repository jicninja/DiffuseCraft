# upscale-and-tiling — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration + visual-regression tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~4–6 weeks for one engineer.** Stitcher quality + diffusion-refine seam handling are the long poles.

---

## Phase A — Types & multi-pass logic

- [ ] **A.1** `UpscaleFactor`, `UpscaleMode`, `UpscaleSource`, `UpscaleInput` types. **(S)**
- [ ] **A.2** `decomposeFactor` for 1.5/2/3/4/6/8 → 1 or 2 passes. **(S)**
- [ ] **A.3** Tests for decomposition. **(XS)**

## Phase B — Tiler

- [ ] **B.1** `Tiler.split(image, output_tile_size, overlap, factor)`. **(M)**
- [ ] **B.2** Edge-tile clipping (no padding). **(S)**
- [ ] **B.3** Tests: tile count, geometry, edge clipping. **(M)**

## Phase C — Stitcher

- [ ] **C.1** Float32 RGB accumulator + weight buffer. **(M)**
- [ ] **C.2** `linear` and `gaussian` weight functions. **(S)**
- [ ] **C.3** Stream-to-disk for outputs >4K to bound RAM. **(L)**
- [ ] **C.4** Visual regression: 9-tile uniform gradient → no banding. **(M)**
- [ ] **C.5** Visual regression: photo with sharp edges → no seam visible. **(M)**

## Phase D — UpscalePipeline

- [ ] **D.1** Single-pass `runPass` orchestrating tile upscales + stitch. **(M)**
- [ ] **D.2** Multi-pass `run` chaining passes per `decomposeFactor`. **(M)**
- [ ] **D.3** Progress emission per tile. **(S)**
- [ ] **D.4** Cancellation propagation via AbortSignal. **(S)**
- [ ] **D.5** Tests with mock ComfyUI: pipeline produces expected dimensions for each factor. **(M)**

## Phase E — Memory budget & retry

- [ ] **E.1** `estimateTileVramBytes` heuristic per model. **(S)**
- [ ] **E.2** `recommendTileSize` based on available VRAM (queried from ComfyUI `/system_stats`). **(S)**
- [ ] **E.3** Auto-shrink on VRAM error: detect, reduce tile_size by 25%, retry once per pass. **(M)**
- [ ] **E.4** `UPSCALE_VRAM_EXHAUSTED` error after 3 retries. **(XS)**
- [ ] **E.5** Tests with simulated VRAM error. **(M)**

## Phase F — Diffusion refinement

- [ ] **F.1** `buildTileImg2imgGraph` ComfyUI graph builder using `MaskedTileSampler` (or equivalent for shared seed + per-tile mask). **(L)**
- [ ] **F.2** `diffusionRefineTile` invocation per tile after upscale. **(M)**
- [ ] **F.3** Shared-seed coordination across tiles. **(S)**
- [ ] **F.4** Visual regression: refined output at denoise=0.3 has fine detail without visible seams. **(M)**
- [ ] **F.5** UI warning when denoise > 0.4. **(S)**

## Phase G — Models

- [ ] **G.1** Default-models registry update (`comfyui-management/default-models.ts`): include `4x-UltraSharp` + `RealESRGAN_x4plus` + `RealESRGAN_x4plus_anime` + 1 latent SD upscaler. **(S)**
- [ ] **G.2** `MODEL_VRAM_FACTOR` lookup table. **(S)**
- [ ] **G.3** Tests: each model produces a valid upscale. **(M)**

## Phase H — Handler & catalog

- [ ] **H.1** Extend `upscale_image` schema in `@diffusecraft/mcp-tools` with new fields per FR-1. **(M)**
- [ ] **H.2** `upscaleImageHandler` per design.md §9 with reversibility branches (new_layer / replace_target). **(M)**
- [ ] **H.3** Job tracker integration — long-running. **(S)**
- [ ] **H.4** Cancellation handler. **(S)**
- [ ] **H.5** Catalog footprint test still ≤100 KB. **(XS)**
- [ ] **H.6** Tests: full handler roundtrip including replace_target reversibility. **(M)**

## Phase I — Tablet UX

- [ ] **I.1** `<UpscaleSettingsPanel />` mounted under `<UpscaleLayout />`. **(M)**
- [ ] **I.2** `<SourcePicker />` (Active doc / history item picker / layer picker). **(M)**
- [ ] **I.3** `<FactorPicker />` 6 segmented buttons. **(S)**
- [ ] **I.4** `<ModelPicker />` reading from `models/list?type=upscale`. **(M)**
- [ ] **I.5** `<ModePicker />` (Native / Diffusion refine) with mode-specific subpanel. **(S)**
- [ ] **I.6** `<DiffusionRefineSubpanel />` denoise slider + prompt input + preset picker. **(M)**
- [ ] **I.7** `<AdvancedSettings />` collapsed (tile_size, tile_overlap, seam_blending). **(M)**
- [ ] **I.8** Action button "Upscale to Nx" triggers handler. **(S)**
- [ ] **I.9** Progress indicator: stage label (Pass 1/2, Tiling 4/9, Refining 4/9). **(M)**
- [ ] **I.10** Tile-size recommendation display when settings would exceed VRAM budget. **(S)**
- [ ] **I.11** Tests against in-memory server. **(M)**

## Phase J — Performance

- [ ] **J.1** Bench 1024→2048 native: ≤5 s. **(S)**
- [ ] **J.2** Bench 1024→4096 native: ≤30 s. **(S)**
- [ ] **J.3** Bench 1024→8192 native: ≤2 min. **(S)**
- [ ] **J.4** Bench 1024→4096 diffusion-refine denoise=0.3: ≤90 s. **(S)**
- [ ] **J.5** Memory leak test: 100 sequential upscales, RAM stable. **(M)**
- [ ] **J.6** Cancel response time ≤3 s. **(S)**

## Phase K — Documentation

- [ ] **K.1** README on tile-based upscale with diagram. **(M)**
- [ ] **K.2** Per-model recommendations (when to pick which). **(M)**
- [ ] **K.3** Diffusion-refine guide (denoise range, seam tradeoffs). **(M)**

---

## Dependency order

```
A → B → C → D → E
                \
                 → F (diffusion) → G (models) → H (handler) → I (UI) → J (perf) → K (docs)
```

A foundational. B/C/D/E build the pipeline. F adds diffusion path. G provides models. H wires to MCP. I/J/K final.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Visible seams in diffusion-refine at higher denoise | UI warning at >0.4; F.4 visual regression catches regressions; document expected ceiling. |
| 8K outputs blow RAM during stitching | C.3 streams to disk; tested at 8192×8192. |
| Different upscaler models output unexpected dimensions | G.3 verifies each pinned model produces 4× output for 4× factor; fail build if unexpected. |
| User picks 8x with diffusion-refine on 8 GB GPU | E.2 recommends safer tile_size; E.3 auto-shrinks on first failure; E.4 fails clearly if untenable. |
| Auto-shrink loop indefinitely | E.4 caps at 3 retries; clear error after. |
| ComfyUI custom node for MaskedTileSampler version drift | F.1 pinned by hash in `comfyui-management/required-nodes.ts`. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Visual-regression seam tests pass.
3. Performance budgets met on RTX 3060-class hardware.
4. Cancellation reliability verified.
5. Risks acceptable.

After approval, implementation begins with Phase A.
