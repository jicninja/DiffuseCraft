# resolution-handling — Design

> **Companion to:** `requirements.md`. **References:** `comfyui-management/graph/helpers/resolution.ts`, `generation-workflow`, `upscale-and-tiling`, krita-ai-diffusion `resolution.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Hires-fix triggers automatically; preset has `hires_fix_enabled: true` default.** |
| Q2 | **VRAM detection on startup via `/system_stats`; default to 8 GB tier on failure.** |
| Q3 | **`job.progress { stage: "capped" }` event when cap hit; tablet UI shows badge.** |
| Q4 | **`hires_denoise` only via preset edit; not per-call.** |
| Q5 | **Selection aspect drives inference pass aspect.** |
| Q6 | **No "quality preset toggle" in v1.** |

## 2. Module layout

```
libs/server/src/lib/comfy/resolution/
├── index.ts
├── model-metadata.ts            # native_min/max, dim_multiple per model
├── vram-tiers.ts                # VRAM tier table + detection
├── pass-planner.ts              # PURE: (canvas_dims, preset, model_meta, vram) → PassPlan
├── batch-splitter.ts            # PURE: (target_pixels, requested_batch, vram) → submission_groups
└── selection-bounds.ts          # selection rect → inference dims (with feather)
```

## 3. Types

```typescript
// libs/server/src/lib/comfy/resolution/index.ts
export interface ModelMetadata {
  model_id: string;
  native_min_pixels: number;     // e.g., 768 * 768
  native_max_pixels: number;     // e.g., 1024 * 1024 for SDXL
  native_aspect_min: number;     // e.g., 0.5
  native_aspect_max: number;     // e.g., 2.0
  dim_multiple: 8 | 16 | 64;     // e.g., 64 for SDXL
}

export interface PassPlan {
  passes: PassSpec[];            // 1 or 2 passes
  final_resize_to: { w: number; h: number };  // canvas dims (downsampled-to)
  capped: boolean;
  cap_reason?: string;
}

export interface PassSpec {
  pass_index: number;
  dims: { w: number; h: number };  // post-rounding
  pre_round_dims: { w: number; h: number };
  is_hires_fix_second_pass: boolean;
  denoise?: number;              // hires_denoise for 2nd pass
}
```

## 4. Pass planner (the core function)

```typescript
// libs/server/src/lib/comfy/resolution/pass-planner.ts
export function planPasses(
  canvas: { w: number; h: number },
  preset: Preset,
  model: ModelMetadata,
  vram: VramTier
): PassPlan {
  // 1. Compute target dims: canvas × resolution_multiplier
  const targetW = canvas.w * preset.resolution_multiplier;
  const targetH = canvas.h * preset.resolution_multiplier;
  const targetPixels = targetW * targetH;

  // 2. Apply max_pixel_count cap
  let capped = false;
  let capReason: string | undefined;
  let inferenceW = targetW, inferenceH = targetH;
  if (targetPixels > vram.max_pixel_count) {
    const scale = Math.sqrt(vram.max_pixel_count / targetPixels);
    inferenceW = Math.floor(targetW * scale);
    inferenceH = Math.floor(targetH * scale);
    capped = true;
    capReason = `Reduced from ${targetW}×${targetH} to ${inferenceW}×${inferenceH} due to VRAM tier`;
  }

  // 3. Aspect window check
  const aspect = inferenceW / inferenceH;
  if (aspect < model.native_aspect_min || aspect > model.native_aspect_max) {
    // clamp to nearest in-window aspect
    const clampedAspect = Math.min(Math.max(aspect, model.native_aspect_min), model.native_aspect_max);
    if (clampedAspect > aspect) {
      inferenceW = Math.floor(inferenceH * clampedAspect);
    } else {
      inferenceH = Math.floor(inferenceW / clampedAspect);
    }
  }

  // 4. Hires-fix decision
  const inferencePixels = inferenceW * inferenceH;
  if (!preset.hires_fix_enabled || inferencePixels <= model.native_max_pixels) {
    // Single-pass at inference dims (rounded)
    const round = roundToMultiple(inferenceW, inferenceH, model.dim_multiple);
    return {
      passes: [{
        pass_index: 0,
        dims: round,
        pre_round_dims: { w: inferenceW, h: inferenceH },
        is_hires_fix_second_pass: false,
      }],
      final_resize_to: canvas,
      capped, cap_reason: capReason,
    };
  }

  // Two-pass hires-fix
  const firstPassPixels = model.native_max_pixels;
  const firstScale = Math.sqrt(firstPassPixels / inferencePixels);
  const firstW = Math.floor(inferenceW * firstScale);
  const firstH = Math.floor(inferenceH * firstScale);
  const firstRound = roundToMultiple(firstW, firstH, model.dim_multiple);
  const secondRound = roundToMultiple(inferenceW, inferenceH, model.dim_multiple);

  return {
    passes: [
      { pass_index: 0, dims: firstRound, pre_round_dims: { w: firstW, h: firstH }, is_hires_fix_second_pass: false },
      { pass_index: 1, dims: secondRound, pre_round_dims: { w: inferenceW, h: inferenceH }, is_hires_fix_second_pass: true, denoise: preset.hires_denoise ?? 0.45 },
    ],
    final_resize_to: canvas,
    capped, cap_reason: capReason,
  };
}

function roundToMultiple(w: number, h: number, m: number): { w: number; h: number } {
  return { w: Math.floor(w / m) * m, h: Math.floor(h / m) * m };
}
```

## 5. Batch splitter

```typescript
// libs/server/src/lib/comfy/resolution/batch-splitter.ts
export function splitBatch(target_pixels: number, requested: number, vram: VramTier, model: ModelMetadata): number[] {
  const max_per_submission = Math.max(1, Math.floor(vram.max_pixel_count / target_pixels));
  if (requested <= max_per_submission) return [requested];

  // split into groups
  const groups: number[] = [];
  let remaining = requested;
  while (remaining > 0) {
    const chunk = Math.min(remaining, max_per_submission);
    groups.push(chunk);
    remaining -= chunk;
  }
  return groups;
}
```

The graph builder for `generate_image` calls `splitBatch` and submits one ComfyUI graph per group; aggregates results into one logical job (with N history items).

## 6. VRAM tiers

```typescript
// libs/server/src/lib/comfy/resolution/vram-tiers.ts
export const VRAM_TIERS = [
  { vram_gb: 6,  max_pixel_count: 1_500_000 },
  { vram_gb: 8,  max_pixel_count: 2_500_000 },
  { vram_gb: 12, max_pixel_count: 4_000_000 },
  { vram_gb: 16, max_pixel_count: 6_000_000 },
  { vram_gb: 24, max_pixel_count: 8_000_000 },
  { vram_gb: 48, max_pixel_count: 16_000_000 },
] as const;

export async function detectVramTier(comfy: ComfyClient): Promise<VramTier> {
  try {
    const stats = await comfy.health();
    const totalGb = (stats.devices?.[0]?.vram_total ?? 8 * 1024 * 1024 * 1024) / (1024 ** 3);
    return VRAM_TIERS.find((t) => totalGb >= t.vram_gb) ?? VRAM_TIERS[1];   // 8 GB default
  } catch {
    return VRAM_TIERS[1];
  }
}
```

Tier is detected at server startup, cached, and overrideable via `ServerConfig.comfyui_proxy.max_pixel_count`.

## 7. Model metadata table

```typescript
// libs/server/src/lib/comfy/resolution/model-metadata.ts
export const MODEL_METADATA: Record<string, ModelMetadata> = {
  // SDXL family
  "Stability-AI/sdxl-base-1.0": { model_id: "Stability-AI/sdxl-base-1.0", native_min_pixels: 768 * 768, native_max_pixels: 1024 * 1024, native_aspect_min: 0.5, native_aspect_max: 2.0, dim_multiple: 64 },
  // SD 1.5 family
  "runwayml/stable-diffusion-v1-5": { model_id: "runwayml/stable-diffusion-v1-5", native_min_pixels: 512 * 512, native_max_pixels: 768 * 768, native_aspect_min: 0.5, native_aspect_max: 2.0, dim_multiple: 8 },
  // Flux
  "black-forest-labs/FLUX.1-dev": { model_id: "black-forest-labs/FLUX.1-dev", native_min_pixels: 768 * 768, native_max_pixels: 1280 * 1280, native_aspect_min: 0.5, native_aspect_max: 2.0, dim_multiple: 64 },
};

export function getModelMetadata(model_id: string): ModelMetadata {
  return MODEL_METADATA[model_id] ?? FALLBACK_SDXL_METADATA;
}
```

Unknown models fall back to SDXL conservative defaults. Operators can extend the table for custom checkpoints.

## 8. Selection-bounds resolution

```typescript
// libs/server/src/lib/comfy/resolution/selection-bounds.ts
export function selectionInferenceDims(
  selection: Selection,
  feather_pct: number,
  model: ModelMetadata
): { w: number; h: number } {
  const bounds = selectionBoundingBox(selection);
  const featherPx = Math.round(Math.max(bounds.w, bounds.h) * feather_pct / 100);
  let w = bounds.w + featherPx * 2;
  let h = bounds.h + featherPx * 2;
  // Round up tiny selections to 128
  if (w < 128) w = 128;
  if (h < 128) h = 128;
  return { w, h };
}
```

The graph builder for Fill/Refine uses these dims as inference target (per FR-17).

## 9. Integration with generate_image handler

```typescript
// in generation-workflow's handler
async function generateImageHandler(input, ctx) {
  const verb = resolveVerb(input);
  const preset = resolvePreset(input.preset, ctx);
  const model = await ctx.models.getMetadata(input.model ?? preset.model);
  const vram = ctx.vramTier;

  const canvas = await ctx.documents.getDimensions(input.document_id);
  const inferenceDims = input.selection
    ? selectionInferenceDims(input.selection, preset.feather_pct, model)
    : canvas;
  const plan = planPasses(inferenceDims, preset, model, vram);

  if (plan.capped) {
    ctx.bus.publish({ name: "job.progress", payload: { job_id: ctx.job_id, percent: 0, stage: "capped", message: plan.cap_reason } });
  }

  const batches = splitBatch(plan.passes[0].dims.w * plan.passes[0].dims.h, input.batch_size ?? 1, vram, model);

  // Build graph using plan + each batch group
  const graphs = batches.map((batch) => buildGenerateGraphFromPlan(input, plan, batch, ctx));
  // Submit each; aggregate; emit per-result history items
  // ... (job tracker handles)
}
```

The audit log entry includes `pass_plan: <serialized>` for forensics.

## 10. Cross-spec integration

- **`comfyui-management/graph/helpers/resolution.ts`**: lives in this spec's module layout. The graph builders import `planPasses` and use the returned `PassPlan` to construct the right ComfyUI nodes (single-pass = `EmptyLatentImage` + `KSampler`; two-pass = those + `LatentUpscale` + 2nd `KSampler` with denoise).
- **`generation-workflow`**: extended handler invokes `planPasses` (FR-20).
- **`upscale-and-tiling`**: orthogonal — that's post-hoc 4x+ via tile pipeline; this spec's hires-fix is intra-graph ≤2x.
- **`generation-history`**: history item dimensions = `final_resize_to` (canvas dims), making caller-facing output consistent.

## 11. Catalog impact

**0 new tools.** Pure server-side mechanics. Catalog stays at ~57 (cap 60).

Audit log fields gain `pass_plan` for support; not exposed via tools (P13). Power users access via `get_audit_log` if they want forensics.

## 12. Acceptance criteria

1. `planPasses` is a pure function with comprehensive unit tests.
2. SDXL / SD 1.5 / Flux all produce valid graphs through their respective metadata.
3. Hires-fix correctly triggers above native max pixels.
4. Multiples-of-N rounding never produces invalid ComfyUI input.
5. Max-pixel-count cap respected per detected VRAM tier.
6. Batch splitting produces correct group counts for over-VRAM requests.
7. P13 preserved: no leaks to caller-facing schemas.
