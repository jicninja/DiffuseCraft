# upscale-and-tiling — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`upscale_image` already in v1 catalog), `workspaces` (Upscale workspace), `comfyui-management` (graph builders), `generation-history` (output as history item), `undo-redo-system`.
> **References:** P13 (resolution abstraction), krita-ai-diffusion `ai_diffusion/workflow.py` upscale logic.

## 1. Purpose

Define the **tile-based upscale system**: take an image (active document, history item, or specific layer) and produce a higher-resolution version that fits into a target factor (2x, 4x, 8x). For images larger than the upscaler's input limit, the server tiles the input, upscales each tile, and stitches with overlap blending — invisible to the caller.

This spec also defines the optional **diffusion pass** (img2img on each tile after upscale) for higher fidelity, and the workspace UX that surfaces all of this.

## 2. Stakeholders & user stories

### S1 — Illustrator finishing at 4K
> **Story 1.** As an illustrator with a 1024×1024 result I love, I switch to **Upscale** workspace, pick `4x` factor, model `4x-UltraSharp`. I tap "Upscale to 4x". The server tiles + upscales + stitches; ~30 s later, a 4096×4096 result lands in history. I apply.

### S2 — Power user at 8K
> **Story 2.** As an illustrator finalizing for print, I pick `8x` from a 1024×1024 source. The server uses 2 passes (4x then 2x) automatically; ~2 min later, an 8192×8192 result is ready.

### S3 — Illustrator with diffusion refinement
> **Story 3.** As an illustrator wanting more detail (not just sharper pixels), I enable "diffusion refinement" with denoise=0.3. The server upscales then runs img2img per tile with the prompt I provide. Result has new fine detail consistent with the prompt.

### S4 — Agent batch upscaling
> **Story 4.** As Claude Code processing 50 history items, I `upscale_image` each with `factor: 2x`. Each runs as its own job in sequence; I track via `job.progress` events.

### S5 — User canceling mid-upscale
> **Story 5.** As an illustrator who realized a mistake mid-upscale, I tap the progress indicator → cancellation. Already-completed tiles are discarded; the job ends.

## 3. Functional requirements (EARS)

### 3.1 Inputs

**FR-1 (Ubiquitous).** `upscale_image` input (extending the existing catalog tool):
- `source`: `{ kind: "document", document_id? }` | `{ kind: "history_item", id }` | `{ kind: "layer", document_id, layer_id }`. Default = active document.
- `factor`: `1.5 | 2 | 3 | 4 | 6 | 8`. Default = 2.
- `model`: name of upscaler model. Default = server default (`4x-UltraSharp` or similar).
- `mode`: `"native"` (just the upscaler model) | `"diffusion_refine"` (upscaler + per-tile img2img). Default = `native`.
- `tile_size`: pixels of each tile (output-space). Default = 768.
- `tile_overlap`: pixels of overlap between tiles. Default = 64.
- `seam_blending`: `"linear" | "gaussian"`. Default = `gaussian`.
- `diffusion_params`: when `mode === "diffusion_refine"`: `{ prompt?, negative_prompt?, denoise?: 0..1 (default 0.3), preset? }`.
- `output_target`: `"new_layer"` (default; goes to history) | `"replace_target"` (only valid when `source.kind: "layer"`).

**FR-2 (Ubiquitous).** Output is a job handle; on completion, `job.completed { history_item_id, layer_id?, dimensions: { w, h } }` arrives.

### 3.2 Multi-pass for high factors

**FR-3 (Ubiquitous).** For factors above 4x, the server SHALL chain passes automatically:
- 6x = 4x then 1.5x.
- 8x = 4x then 2x.
- 1.5x / 2x / 3x / 4x = single pass.

**FR-4 (Ubiquitous).** Each pass uses tile-based upscaling internally per FR-5..9.

### 3.3 Tile-based pipeline

**FR-5 (Ubiquitous).** Tile geometry:
- Input image is split into tiles where each output tile is `tile_size × tile_size` pixels.
- Tiles overlap by `tile_overlap` pixels on adjacent edges.
- Edge tiles are clipped to the image bounds (no padding-with-noise).

**FR-6 (Ubiquitous).** Each tile is upscaled independently by the chosen model. The server submits the tile as a graph to ComfyUI; the model's native resolution determines internal scaling.

**FR-7 (Ubiquitous).** Stitching: overlap regions are blended via the `seam_blending` weight function:
- `"linear"`: weight = distance from tile edge / overlap_size.
- `"gaussian"`: weight = Gaussian falloff from tile center.
- Multiple tiles overlapping at a pixel → weighted average.

**FR-8 (Event-driven).** WHEN each tile completes, THE server SHALL emit `job.progress { stage: "tiling", percent }` reflecting tiles done / total.

**FR-9 (Ubiquitous).** Tile concurrency: respects ComfyUI's queue. Default 1 tile at a time (matches typical single-GPU setup); configurable.

### 3.4 Diffusion refinement (optional)

**FR-10 (Ubiquitous).** When `mode === "diffusion_refine"`:
- Each upscaled tile runs through an img2img pass with `denoise = diffusion_params.denoise` (default 0.3).
- Prompt = `diffusion_params.prompt` (or document's root prompt if absent).
- Lower denoise = smaller deviation from upscaler output; higher = more model creativity (and risk of seam visibility).
- Cross-tile consistency is approximated via shared seed across tiles + tile overlap blending.

**FR-11 (Ubiquitous).** Diffusion refinement multiplies the per-tile time by ~3–5x. The progress indicator reflects total tile count (upscale + refine = 2× tile work).

### 3.5 Models

**FR-12 (Ubiquitous).** v1 SHALL ship with at least the following upscaler model identifiers (downloaded on-demand via `download_model`):
- `4x-UltraSharp` (RealESRGAN-derived; default for general content).
- `RealESRGAN_x4plus` (general purpose, slightly more conservative).
- `RealESRGAN_x4plus_anime` (anime/illustration optimized).
- `4x-LaplacianFusion` or similar latent SD upscaler (for diffusion-refine compatibility).

**FR-13 (Ubiquitous).** Model registry exposes upscalers via `diffusecraft://models/list?type=upscale`. Tablet UI picker reads from this resource.

**FR-14 (Ubiquitous).** When the requested model isn't installed, server returns `MODEL_NOT_FOUND` with `hint` listing locally available upscalers + suggesting `download_model`.

### 3.6 Memory and resource budgeting

**FR-15 (Ubiquitous).** Per-tile VRAM budget: ≤ 6 GB peak (fits on 8 GB consumer GPUs with headroom). Larger tiles → smaller `tile_size`; UI surfaces a recommendation if user picks a tile_size + factor combination that exceeds budget.

**FR-16 (Unwanted).** IF VRAM exceeded mid-job, THE server SHALL gracefully reduce tile_size by 25% and retry the failed tile. After 3 retries → fail with `UPSCALE_VRAM_EXHAUSTED`.

**FR-17 (Ubiquitous).** Disk budget: intermediate tile blobs live in scratch dir; cleaned up after job (success or failure). On orphan recovery (server restart mid-job), older-than-1-hour scratch dirs are removed.

### 3.7 Reversibility

**FR-18 (Ubiquitous).** When `output_target === "new_layer"`: result lands in `generation-history`; user/agent applies via `apply_history_item` (reversible per `generation-history` FR-4).

**FR-19 (Ubiquitous).** When `output_target === "replace_target"`: replace via reversible Command (revert restores prior layer content).

### 3.8 Cancellation

**FR-20 (Event-driven).** WHEN `cancel_job` arrives mid-upscale, THE server SHALL: (1) interrupt ComfyUI on the current tile; (2) stop submitting further tiles; (3) discard partial result blobs; (4) emit `job.completed { outcome: "cancelled" }`.

### 3.9 Workspace integration

**FR-21 (Ubiquitous).** In Upscale workspace, the action button is "Upscale to Nx" with the current factor. Tap submits with the current settings.

**FR-22 (Ubiquitous).** Upscale workspace settings panel shows:
- Source picker (Active document / history item / layer).
- Factor picker (1.5 / 2 / 3 / 4 / 6 / 8).
- Model picker (from registry).
- Mode picker (Native / Diffusion refine).
- When Diffusion refine: denoise slider + prompt input + preset picker.
- Advanced (collapsed): tile_size, tile_overlap, seam_blending.

**FR-23 (Ubiquitous).** Upscale-mode preview: after the job completes, the result enters the history strip (or replaces, per output_target). Tablet allows pinch-zoom to inspect at 1:1.

### 3.10 Performance targets

**FR-24 (Ubiquitous).** Reference benchmarks on RTX 3060 / equivalent:
- 1024 → 2048 (2x), Native, single tile, 4x-UltraSharp: ≤ 5 s.
- 1024 → 4096 (4x), Native, 9 tiles: ≤ 30 s.
- 1024 → 8192 (8x), Native, 2 passes: ≤ 2 min.
- 1024 → 4096 (4x), Diffusion refine denoise=0.3: ≤ 90 s.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Stitch quality: visual seam test on a 9-tile upscale of a uniform gradient passes (no banding visible). Validated via image-diff in CI.

**NFR-2 (Ubiquitous).** Upscale memory does not leak across jobs: 100 sequential upscales don't grow RAM.

**NFR-3 (Ubiquitous).** Cancel response: from `cancel_job` invocation to `job.completed` ≤ 3 s in worst case (current ComfyUI step finishing).

## 5. Out of scope

- **GAN-only models without latent path** for diffusion-refine. Only models compatible with both pipelines are shipped.
- **Per-region different upscale strategies** (e.g., upscale background heavier than foreground). Post-v1.
- **Vector upscaling** for line art. Post-v1.
- **Smart-frame upscale** (different upscale per region of the image based on content type detection). Post-v1.

## 6. Open questions

### Q1 — Default tile_size + overlap?
Trade-off between memory and quality.

**Recommendation:** default `tile_size: 768`, `tile_overlap: 64`. Works on 8 GB GPUs; quality good. Power users override via Advanced.

### Q2 — Should the document's root prompt be auto-used in Diffusion refine?
Convenience.

**Recommendation:** **yes, as default**. User can override via `diffusion_params.prompt`. UI's prompt input pre-fills with `root_prompt`.

### Q3 — Diffusion refine denoise default
0.3 is conservative; some users want 0.5+ for more reinterpretation.

**Recommendation:** default 0.3. UI slider 0–1 with "preserves source ↔ reinterprets" labels.

### Q4 — Should the Upscale workspace allow editing the source before upscale?
Like a "preview crop" or quick adjustments.

**Recommendation:** **no in v1.** Upscale workspace is focused on the upscale action. To edit, switch to Generate workspace. Post-v1 may add a quick crop tool.

### Q5 — Do we expose tile_size in the basic UI?
Most users shouldn't see it.

**Recommendation:** **Advanced section only.** Default 768 hidden.

### Q6 — Cross-tile consistency in Diffusion refine: shared seed, sequential conditioning, or other?
Tile-based diffusion is famous for visible seams when each tile generates independently.

**Recommendation:** **shared seed across all tiles + ComfyUI's `MaskedTileSampler` or equivalent** (krita-ai-diffusion's approach). Combined with overlap blending, seams are nearly invisible at denoise ≤ 0.4. Above that, seams become visible — UI warns.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) work end-to-end.
2. 1.5x–8x factors all produce correct dimensions.
3. Stitch quality test passes (no visible seams on uniform gradient).
4. Diffusion refine produces additional detail without obvious seams at denoise ≤ 0.4.
5. VRAM exhaustion gracefully retries with smaller tiles.
6. Cancellation works mid-tile.
7. Open questions have acceptable recommendations.
