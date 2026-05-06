# resolution-handling — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~2–3 weeks for one engineer.** Mostly pure-function math + integration into existing graph builders. No tablet UX work (P13).

---

## Phase A — Types & metadata

- [ ] **A.1** `ModelMetadata`, `PassPlan`, `PassSpec`, `VramTier` types. **(S)**
- [ ] **A.2** `MODEL_METADATA` table seeded for SDXL, SD 1.5, Flux. **(S)**
- [ ] **A.3** `FALLBACK_SDXL_METADATA` for unknown models. **(XS)**
- [ ] **A.4** `VRAM_TIERS` table. **(XS)**

## Phase B — Pass planner (pure)

- [ ] **B.1** `planPasses(canvas, preset, model_meta, vram)` per design.md §4. **(L)**
- [ ] **B.2** Aspect-window clamping. **(S)**
- [ ] **B.3** Multiples-of-N rounding helper. **(S)**
- [ ] **B.4** Cap-fitting logic preserving aspect. **(S)**
- [ ] **B.5** Tests:
  - SDXL on 1080×1920 (single pass after rounding).
  - SDXL on 2048×2048 (two-pass hires-fix).
  - SDXL on 4096×4096 (capped + two-pass).
  - SD 1.5 on 1024×512 (within range).
  - Flux on 1280×1280 (within range).
  - Tall aspect 256×2048 (clamped to native window).
  - Edge cases: tiny canvas, oversized canvas, oddly square-rooted dims.
  **(L)**

## Phase C — Batch splitter

- [ ] **C.1** `splitBatch(target_pixels, requested, vram, model)` pure function. **(M)**
- [ ] **C.2** Tests for typical and edge batch counts. **(S)**

## Phase D — Selection bounds

- [ ] **D.1** `selectionInferenceDims(selection, feather_pct, model)`. **(M)**
- [ ] **D.2** Tiny-selection (<128) rounding-up. **(XS)**
- [ ] **D.3** Tests: rect, mask, polygon selections produce sensible bounds. **(M)**

## Phase E — VRAM tier detection

- [ ] **E.1** `detectVramTier(comfy)` reading `/system_stats`. **(S)**
- [ ] **E.2** Cache on server startup; expose via `ctx.vramTier`. **(XS)**
- [ ] **E.3** `ServerConfig.comfyui_proxy.max_pixel_count` override. **(XS)**
- [ ] **E.4** Admin tool to re-detect on hardware change (post-v1; documented). **(XS)**
- [ ] **E.5** Tests with mocked /system_stats. **(S)**

## Phase F — Graph integration

- [ ] **F.1** `buildGenerateGraphFromPlan` in `comfyui-management`: consumes `PassPlan` and emits single-pass or two-pass ComfyUI graph. **(L)**
- [ ] **F.2** Hires-fix second-pass nodes: `LatentUpscale` + 2nd `KSampler` + correct denoise. **(M)**
- [ ] **F.3** Per-pass `final_resize_to` downsample step (Lanczos via Pillow / Skia). **(M)**
- [ ] **F.4** `generate_image` handler invokes `planPasses` + `splitBatch`. **(M)**
- [ ] **F.5** Tests: graph snapshot for each pass-plan scenario. **(L)**

## Phase G — Audit & observability

- [ ] **G.1** Audit log entries include serialized `pass_plan`. **(S)**
- [ ] **G.2** `job.progress { stage: "capped", message }` event when cap hit. **(S)**
- [ ] **G.3** Tablet UI badge on history item when capped (informational). **(S)**
- [ ] **G.4** Tests: cap event fires; audit log readable. **(S)**

## Phase H — Documentation

- [ ] **H.1** Operator note: how to tune `max_pixel_count` per host. **(S)**
- [ ] **H.2** Power-user note: how presets' `resolution_multiplier` and `hires_denoise` work. **(M)**
- [ ] **H.3** Cross-link with `upscale-and-tiling` to clarify hires-fix vs tile-upscale boundary. **(S)**

---

## Dependency order

```
A → B → C
        \
         → D → E → F → G → H
```

A foundational. B/C/D pure functions. E VRAM detection. F graph integration. G/H last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong native_max_pixels for a custom model produces awful output | A.3 fallback to conservative SDXL values; operators add to table for known models. |
| Hires-fix at extreme aspect ratios (e.g., 256×2048) produces visible boundary banding | B.2 clamps; F.3 final downsample smoothing minimizes; tests at edge ratios. |
| VRAM detection unreliable on multi-GPU | E.1 reads first device; document. Fallback to default tier. |
| Cap event spams UI when most calls cap | G.3 displays badge once per history item; tablet UI doesn't show toast. |
| Graph builder regression breaks single-pass flow when adding two-pass | F.5 snapshot tests cover both branches; CI gates. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Pure planner has comprehensive test matrix.
3. Hires-fix produces correct two-pass graphs.
4. Cap events surface to UI without noise.
5. Risks acceptable.

After approval, implementation begins with Phase A.
