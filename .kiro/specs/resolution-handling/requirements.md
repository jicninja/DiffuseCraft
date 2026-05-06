# resolution-handling — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `comfyui-management` (graph builders), `generation-workflow` (consumes the resolution decisions), `upscale-and-tiling` (sister spec — resolution-handling does in-graph hires-fix; upscale does post-hoc tile-based scaling).
> **References:** P13 (resolution abstraction — non-negotiable: tools never expose model native resolution to callers), krita-ai-diffusion `ai_diffusion/resolution.py`.

## 1. Purpose

Define the **server-side resolution handling** layer that sits between user-supplied canvas/dimensions and ComfyUI graphs. The user authors at any size; the server transparently:

- Determines the model's **native trained resolution range** and decides whether single-pass or **hires-fix two-pass** is needed.
- **Rounds dimensions** to the model's required multiple (8 / 16 / 64).
- Applies the preset's **resolution multiplier** (scale generation relative to canvas).
- Enforces **max pixel count** caps (server-side budget for VRAM safety).
- Determines **batch_size** based on user request + VRAM.

Per P13, **none of these mechanics are exposed in MCP tool inputs**. Callers say `prompt`, `strength`, `selection`, etc.; the server does the math. Power users who need to override go through preset configuration, not per-call parameters.

## 2. Stakeholders & user stories

### S1 — Illustrator at non-standard size
> **Story 1.** As an illustrator working on a 1080×1920 mobile-portrait canvas, I generate. The model is SDXL (native ~1024 trained range). The server: (a) computes that 1080 is close to 1024, so single-pass at 1024×1920 (rounded to multiples of 64) works; (b) on hires-fix needed, runs second pass to upscale-back to canvas. Result lands at 1080×1920 (canvas dims), invisible to me.

### S2 — Illustrator at very high resolution
> **Story 2.** As an illustrator with a 2048×2048 canvas, I generate. Native SDXL trained range is ~1024. Server runs first pass at 1024×1024 (rounded), latent upscales to ~2048, then second KSampler with `denoise: 0.45` adds detail. Result fits canvas.

### S3 — Power user adjusting via preset
> **Story 3.** As a power user, I edit my preset's `resolution_multiplier: 1.25`. Now my generations on a 1024×1024 canvas internally compute at ~1280×1280 (with hires-fix if needed) and downscale-back. I get more model detail at the cost of time.

### S4 — Server protecting VRAM
> **Story 4.** As a user on a 6 GB GPU trying to generate at 4096×4096 canvas, the server caps at `max_pixel_count = 1.5M` (configured for the VRAM tier) and emits a warning that the result will be downscaled-from-server-side. UI explains; user can lower canvas or accept.

### S5 — Agent batch
> **Story 5.** As Claude Code requesting `batch_size: 8` on a 1024×1024 canvas, the server checks: 8 × native-resolution VRAM ≤ available VRAM? If yes, runs as 1 graph with batch=8. If no, splits into smaller batches (2 × batch=4, etc.). Result: 8 history items as expected; agent doesn't know how it was sliced internally.

## 3. Functional requirements (EARS)

### 3.1 Model native resolution metadata

**FR-1 (Ubiquitous).** Each model in the registry SHALL include metadata: `native_min_pixels`, `native_max_pixels`, `native_aspect_window: { min, max }`, `dim_multiple: 8 | 16 | 64`. Sourced from a curated lookup keyed by model id; default to SDXL values for unknowns.

**FR-2 (Ubiquitous).** The metadata is server-side only. Tools and resources don't surface it (P13).

### 3.2 Hires-fix decision

**FR-3 (Ubiquitous).** Given `target_dims = canvas_dims × resolution_multiplier`, the server decides:
- If `target_pixels <= native_max_pixels` AND aspect within native range → **single-pass** at `target_dims` (rounded).
- Else → **two-pass hires-fix**:
  - First pass at the largest dimensions inside the native range matching the target's aspect.
  - Latent upscale by ratio.
  - Second KSampler with `denoise = preset.hires_denoise` (default 0.45).
- After model output: if `output_dims != canvas_dims`, downsample to canvas dims (Lanczos).

**FR-4 (Ubiquitous).** Hires-fix is fully transparent — the resulting history item is always `canvas_dims × resolution_multiplier_applied?` (default = canvas_dims).

### 3.3 Multiples-of-N rounding

**FR-5 (Ubiquitous).** Before submitting any pass to ComfyUI, the server SHALL round both dimensions DOWN to the nearest multiple of `dim_multiple` (typically 64 for SDXL, 8 for SD 1.5).

**FR-6 (Ubiquitous).** When rounding produces dimensions that significantly differ from the user's canvas (>5% loss in any axis), the result is **upscaled back** via the same downsample step (FR-3) — the user never sees rounded dims.

### 3.4 Resolution multiplier

**FR-7 (Ubiquitous).** Each preset has `resolution_multiplier: number` (default 1.0). The server multiplies canvas dims by this before computing pass dims.

**FR-8 (Ubiquitous).** Reasonable range: 0.5 to 2.0. Outside → server clamps and logs a warning.

### 3.5 Max pixel count

**FR-9 (Ubiquitous).** Server config has `comfyui_proxy.max_pixel_count` per VRAM tier (default tiers: 6GB → 1.5M, 8GB → 2.5M, 12GB → 4M, 24GB → 8M). The server detects available VRAM at startup via `/system_stats` and selects the tier.

**FR-10 (Ubiquitous).** When `target_pixels > max_pixel_count`, the server:
- Caps the pass dims to fit within max_pixel_count (preserving aspect).
- Runs the cap-fitting pass.
- Upscales the result to match the user's intended canvas dims.

**FR-11 (Event-driven).** WHEN cap is hit, THE server SHALL emit a non-fatal `job.progress { stage: "capped", message }` informing the client that internal computation was reduced.

### 3.6 Batch size

**FR-12 (Ubiquitous).** Effective batch size = `min(user_batch_size, max_batch_for_vram(target_pixels, model))`. If less than user requested, the server splits into multiple sequential ComfyUI submissions and aggregates results.

**FR-13 (Ubiquitous).** Each result of a batched generation is its own history item (per `generation-history` FR-21).

**FR-14 (Ubiquitous).** Server enforces `batch_size <= 8` per user input (matching `mcp-tool-catalog`'s `generate_image` schema), AND `<= max_batch_for_vram` internally.

### 3.7 Aspect handling

**FR-15 (Ubiquitous).** The native aspect window for SDXL is roughly 0.5–2.0 (portrait to landscape extremes). Beyond → server clamps to nearest in-window aspect for the inference pass and downsamples to user's aspect.

**FR-16 (Ubiquitous).** Square-1:1 aspect always works (within native pixel limits).

### 3.8 Selection / fill resolution

**FR-17 (Ubiquitous).** When generating with a selection (Fill/Refine/Constrained):
- The selection's bounding rect dims (with feather padding) are the **target_dims** for the inference pass.
- Single-pass if these fit native range; hires-fix otherwise.
- Result is composited onto the canvas at the original selection location (not downsampled to whole canvas).

**FR-18 (Ubiquitous).** Tiny selections (<128 px) round up to 128 to avoid producing trivially-small generations. The result is then masked back into the original selection alpha.

### 3.9 Hires-fix variant for upscale spec

**FR-19 (Ubiquitous).** The `upscale-and-tiling` spec's "diffusion refinement" is **distinct** from hires-fix:
- Hires-fix = part of the initial generate graph; latent-upscale + 2nd KSampler.
- Upscale tile-based diffusion refine = post-generation, per-tile img2img.

Hires-fix runs at most ~2x; upscale tile pipeline handles 4x+. Documented to avoid confusion.

### 3.10 Caller-visible behavior

**FR-20 (Ubiquitous).** `generate_image` callers see:
- Input: `prompt`, `strength`, `selection`, `batch_size`, etc.
- Output: `job_id`, `resolved_verb`, `batch_size` (effective; may equal user's input or be lower if VRAM split).
- Result: history items at the dimensions requested (canvas dims or selection dims).

**FR-21 (Ubiquitous).** Callers SHALL NOT see: dim_multiple, native_max_pixels, hires-fix decision, latent-upscale ratio, internal pass dims. These are pure server concern.

**FR-22 (Ubiquitous).** Audit log entries record the internal decisions for debugging (e.g., `pass_1_dims: 1024×1024, pass_2_dims: 2048×2048, hires_fix: true, capped: false`). Helpful for support without polluting the agent's view.

**FR-22-bis (Ubiquitous).** **P13 leak prevention in `list_models` / `models/list` resource:** the model resource SHALL expose only `{ id, name, type, file_size, integrity_hash, discovered_at }` to clients. Internal-only fields (`native_min_pixels`, `native_max_pixels`, `native_aspect_min`, `native_aspect_max`, `dim_multiple`, `prompt_style`) are stored in `MODEL_METADATA` server-side and SHALL NOT appear in the resource response or in `list_models` tool output. They are accessible only via internal handler context. Audit log entries containing these fields are gated to admin-equivalent access (currently single-tier per Q7 simplification — same caveat as audit-log access in general).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Resolution decision logic SHALL be a pure function (`canvas_dims, preset, model_metadata, vram → pass_plan`) testable in isolation.

**NFR-2 (Ubiquitous).** Decision computation SHALL be < 1 ms (no I/O, just math).

**NFR-3 (Ubiquitous).** When VRAM tier changes (e.g., user attaches a different GPU), server re-detects on next start; no client change needed.

## 5. Out of scope

- **User-controlled hires-fix denoise per call** — lives in preset, not per-call params (P13). Power users edit preset.
- **Adaptive resolution per region** (different regions at different internal resolutions). Post-v1.
- **Latent caching across passes** — possible optimization for hires-fix; post-v1.
- **VRAM tier per-graph adaptive switching** mid-job. Post-v1.

## 6. Open questions

### Q1 — Should `hires_fix` always trigger when canvas_dims > native, or be opt-out?
Some users prefer the speed of single-pass even at lower quality.

**Recommendation:** **always trigger** when needed; preset has `hires_fix_enabled: true` by default. User who wants single-pass-only sets it to false in preset, accepting quality tradeoff.

### Q2 — How are VRAM tiers detected exactly?
ComfyUI's `/system_stats` returns total + free VRAM.

**Recommendation:** read on server startup; cache; offer reload via admin tool if user changes hardware. Default to "8 GB tier" (2.5M pixels) if detection fails.

### Q3 — Should server warn user when capped?
A non-fatal stage event in `job.progress`.

**Recommendation:** **yes** per FR-11. Tablet UI surfaces a small "computed at reduced internal res" badge on the resulting history item.

### Q4 — Should `hires_denoise` (0.45 default) be exposed in advanced UI?
Power users want to tune.

**Recommendation:** **expose only via preset edit**, not per-call. Per FR P13 commitment. Preset settings panel is power-user territory.

### Q5 — When the canvas is square but the selection inside it is highly oblong (e.g., 1024×128), what aspect does the inference pass use?
Aspect of the selection bounding rect with feather padding.

**Recommendation:** **selection rect aspect** (FR-17). Result fits cleanly back. No surprise.

### Q6 — Should there be a "quality preset" that automatically picks high resolution_multiplier + hires_fix?
A "Draft / Standard / High" toggle.

**Recommendation:** **post-v1** — UX decision, not a resolution-handling concern. v1: presets fixed; user picks one preset.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized.
2. Hires-fix decision is correct for SDXL, SD 1.5, and Flux.
3. Multiples-of-N rounding never errors out ComfyUI.
4. Max-pixel-count cap respected per VRAM tier.
5. Batch size auto-splits when over VRAM.
6. Selection-driven generation respects FR-17/18.
7. P13 preserved: no resolution mechanics leak to MCP tools.
8. Open questions have acceptable recommendations.
