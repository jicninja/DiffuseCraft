# upscale-and-tiling — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `comfyui-management`, `workspaces`, `generation-history`, krita-ai-diffusion `workflow.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Default tile_size 768, tile_overlap 64.** |
| Q2 | **Diffusion refine prompt defaults to root_prompt.** |
| Q3 | **Default denoise 0.3.** |
| Q4 | **No editing in Upscale workspace.** Switch to Generate to edit. |
| Q5 | **tile_size in Advanced only.** |
| Q6 | **Shared seed across tiles + MaskedTileSampler** (krita-ai-diffusion's approach). |

## 2. Module layout

```
libs/server/src/lib/comfy/upscale/
├── pipeline.ts                  # UpscalePipeline (multi-pass orchestration)
├── tiler.ts                     # tile geometry (split + index)
├── stitcher.ts                  # weighted blend stitcher
├── seam-weights.ts              # linear vs gaussian falloff functions
├── pass.ts                      # single pass = upscale all tiles
├── diffusion-refine.ts          # img2img per tile after upscale
├── memory-budget.ts             # per-tile VRAM check + auto-shrink
└── handlers/
    └── upscale-image.ts

libs/canvas-core/src/upscale/
├── factors.ts                   # supported factors enum + multi-pass decomposition
└── types.ts

libs/ui/src/upscale/
├── UpscaleSettingsPanel.tsx
├── FactorPicker.tsx
├── ModelPicker.tsx
├── ModePicker.tsx
├── DiffusionRefineSubpanel.tsx
└── AdvancedSettings.tsx
```

## 3. Multi-pass decomposition

```typescript
// libs/canvas-core/src/upscale/factors.ts
export const SUPPORTED_FACTORS = [1.5, 2, 3, 4, 6, 8] as const;
export type UpscaleFactor = typeof SUPPORTED_FACTORS[number];

export function decomposeFactor(factor: UpscaleFactor): UpscaleFactor[] {
  if (factor <= 4) return [factor];
  if (factor === 6) return [4, 1.5];
  if (factor === 8) return [4, 2];
  throw new Error("unreachable");
}
```

## 4. UpscalePipeline

```typescript
// libs/server/src/lib/comfy/upscale/pipeline.ts
export class UpscalePipeline {
  async run(input: UpscaleInput, ctx: HandlerContext, signal: AbortSignal): Promise<Uint8Array> {
    const passes = decomposeFactor(input.factor);
    let current = await loadSource(input.source, ctx);

    for (let i = 0; i < passes.length; i++) {
      const passFactor = passes[i];
      const isLastPass = i === passes.length - 1;
      const usingDiffusion = isLastPass && input.mode === "diffusion_refine";

      ctx.bus.publish({ name: "job.progress", payload: { job_id: ctx.job_id, percent: (i / passes.length) * 50, stage: `upscale-pass-${i + 1}` } });

      current = await this.runPass(current, {
        factor: passFactor,
        model: input.model,
        tile_size: input.tile_size ?? 768,
        tile_overlap: input.tile_overlap ?? 64,
        seam_blending: input.seam_blending ?? "gaussian",
        diffusion: usingDiffusion ? input.diffusion_params : null,
      }, ctx, signal);
    }
    return current;
  }

  private async runPass(image: Uint8Array, opts: PassOpts, ctx: HandlerContext, signal: AbortSignal): Promise<Uint8Array> {
    const tiles = this.tiler.split(image, opts.tile_size, opts.tile_overlap, opts.factor);
    const upscaledTiles: TileResult[] = [];
    for (const tile of tiles) {
      if (signal.aborted) throw new AbortError();
      const upscaled = await this.upscaleTile(tile, opts.model, opts.factor, ctx);
      const refined = opts.diffusion
        ? await this.diffusionRefine(upscaled, tile, opts.diffusion, ctx)
        : upscaled;
      upscaledTiles.push({ ...tile, bytes: refined });
      ctx.bus.publish({ name: "job.progress", payload: { job_id: ctx.job_id, percent: /* ... */, stage: "tiling" } });
    }
    return this.stitcher.stitch(upscaledTiles, opts.seam_blending);
  }

  private async upscaleTile(tile: Tile, model: string, factor: number, ctx: HandlerContext): Promise<Uint8Array> {
    let attempts = 0;
    while (attempts < 3) {
      try {
        const graph = buildUpscaleTileGraph({ image: tile.bytes, model, factor });
        const { prompt_id } = await ctx.comfy.submitGraph(graph);
        return await waitForOutput(prompt_id, ctx);
      } catch (err) {
        if (isVramError(err) && attempts < 2) {
          attempts++;
          // shrink would be retried at the pipeline level with smaller tile_size; this catch escalates
          throw new ServerError({ code: "UPSCALE_VRAM_EXHAUSTED", message: "VRAM exhausted; reduce tile_size", retry_with_smaller_tile: true });
        }
        throw err;
      }
    }
    throw new Error("unreachable");
  }
}
```

## 5. Tiler

```typescript
// libs/server/src/lib/comfy/upscale/tiler.ts
export class Tiler {
  split(image: Uint8Array, output_tile_size: number, overlap: number, factor: number): Tile[] {
    const inputDims = decodePngDims(image);
    const inputTileSize = Math.floor(output_tile_size / factor);
    const inputOverlap = Math.floor(overlap / factor);
    const stride = inputTileSize - inputOverlap;

    const tiles: Tile[] = [];
    for (let y = 0; y < inputDims.h; y += stride) {
      for (let x = 0; x < inputDims.w; x += stride) {
        const w = Math.min(inputTileSize, inputDims.w - x);
        const h = Math.min(inputTileSize, inputDims.h - y);
        if (w < inputOverlap || h < inputOverlap) continue;
        tiles.push({
          x, y, w, h,
          out_x: x * factor, out_y: y * factor,
          out_w: w * factor, out_h: h * factor,
          bytes: cropPng(image, x, y, w, h),
        });
      }
    }
    return tiles;
  }
}
```

## 6. Stitcher (weighted blend)

```typescript
// libs/server/src/lib/comfy/upscale/stitcher.ts
export class Stitcher {
  stitch(tiles: TileResult[], blending: "linear" | "gaussian"): Uint8Array {
    const dims = computeOutputDims(tiles);
    const accum = new Float32Array(dims.w * dims.h * 3);   // RGB accumulator
    const weightSum = new Float32Array(dims.w * dims.h);

    for (const tile of tiles) {
      const rgba = decodePng(tile.bytes);
      for (let ty = 0; ty < tile.out_h; ty++) {
        for (let tx = 0; tx < tile.out_w; tx++) {
          const w = computeWeight(tx, ty, tile.out_w, tile.out_h, blending);
          const dx = tile.out_x + tx;
          const dy = tile.out_y + ty;
          const dstIdx = (dy * dims.w + dx) * 3;
          const srcIdx = (ty * tile.out_w + tx) * 4;
          accum[dstIdx + 0] += rgba[srcIdx + 0] * w;
          accum[dstIdx + 1] += rgba[srcIdx + 1] * w;
          accum[dstIdx + 2] += rgba[srcIdx + 2] * w;
          weightSum[dy * dims.w + dx] += w;
        }
      }
    }

    // Normalize and emit final RGBA
    const final = new Uint8Array(dims.w * dims.h * 4);
    for (let i = 0; i < dims.w * dims.h; i++) {
      const ws = weightSum[i] || 1;
      final[i * 4 + 0] = clamp255(accum[i * 3 + 0] / ws);
      final[i * 4 + 1] = clamp255(accum[i * 3 + 1] / ws);
      final[i * 4 + 2] = clamp255(accum[i * 3 + 2] / ws);
      final[i * 4 + 3] = 255;
    }
    return encodePng(final, dims.w, dims.h);
  }
}

function computeWeight(tx: number, ty: number, tw: number, th: number, kind: "linear" | "gaussian"): number {
  // distance-from-edge falloff
  const dx = Math.min(tx, tw - tx);
  const dy = Math.min(ty, th - ty);
  const d = Math.min(dx, dy);
  if (kind === "linear") return Math.min(1, d / 32);
  // gaussian
  const sigma = Math.min(tw, th) / 4;
  return Math.exp(-((tw / 2 - tx) ** 2 + (th / 2 - ty) ** 2) / (2 * sigma * sigma));
}
```

For very large outputs (≥ 4K), the stitcher streams tile-by-tile to disk to avoid loading the full output in memory.

## 7. Diffusion refinement

```typescript
// libs/server/src/lib/comfy/upscale/diffusion-refine.ts
export async function diffusionRefineTile(
  upscaledTile: Uint8Array,
  originalTile: Tile,
  params: DiffusionParams,
  ctx: HandlerContext
): Promise<Uint8Array> {
  // Build an img2img graph using krita-ai-diffusion's MaskedTileSampler approach:
  // - shared seed across all tiles (params.seed if provided, else first tile's draw)
  // - prompt = params.prompt or root_prompt
  // - denoise = params.denoise (default 0.3)
  // - mask: a feathered mask matching the tile's overlap region for blending
  const graph = buildTileImg2imgGraph({
    image: upscaledTile,
    prompt: params.prompt ?? ctx.document.root_prompt,
    negative_prompt: params.negative_prompt ?? ctx.document.root_negative_prompt,
    denoise: params.denoise ?? 0.3,
    seed: params.seed ?? ctx.sharedSeed,
    sampler: ctx.preset.sampler,
    model: ctx.preset.model,
  });
  const { prompt_id } = await ctx.comfy.submitGraph(graph);
  return await waitForOutput(prompt_id, ctx);
}
```

When `denoise > 0.4`, the UI shows a warning that seams may become visible.

## 8. Memory budget

```typescript
// libs/server/src/lib/comfy/upscale/memory-budget.ts
const VRAM_PER_TILE_BUDGET_BYTES = 6 * 1024 * 1024 * 1024;

export function estimateTileVramBytes(tile_size: number, factor: number, model: string): number {
  // Rough heuristic: output size in pixels × bytes/pixel × model overhead
  const outputPixels = (tile_size * tile_size);
  const baseBytes = outputPixels * 4 * 4;  // RGBA float32
  const modelOverheadFactor = MODEL_VRAM_FACTOR[model] ?? 8;
  return baseBytes * modelOverheadFactor;
}

export function recommendTileSize(factor: number, model: string, available_vram: number): number {
  for (const size of [1024, 768, 512, 384, 256]) {
    if (estimateTileVramBytes(size, factor, model) <= Math.min(VRAM_PER_TILE_BUDGET_BYTES, available_vram)) return size;
  }
  return 256;
}
```

UI's Advanced panel shows a recommendation: "For your model + factor, recommended tile_size: 768. Lower tile_size = safer memory; higher = fewer seams."

## 9. Handler

```typescript
// libs/server/src/lib/comfy/upscale/handlers/upscale-image.ts
export const upscaleImageHandler: Handler<typeof upscaleImage> = async (input, ctx) => {
  // 1. Resolve source
  const sourceBytes = await loadSource(input.source, ctx);

  // 2. Submit as a job via tracker
  const job_id = await ctx.tracker.submit({
    kind: "upscale",
    spec: { ...input, source_bytes: sourceBytes, document_id: input.source.document_id ?? ctx.activeDocumentId },
  }, async (signal) => {
    const pipeline = new UpscalePipeline(ctx.tiler, ctx.stitcher, ctx.comfy);
    const result = await pipeline.run({ ...input, source_bytes: sourceBytes }, ctx, signal);

    // 3. Persist + create history item OR replace target per output_target
    if (input.output_target === "replace_target" && input.source.kind === "layer") {
      const layer = await ctx.layers.get(input.source.document_id, input.source.layer_id);
      const previousBlobId = layer.content_blob_id;
      const newBlobId = await ctx.assets.writeBlob(result);
      const command = buildCommand({
        tool_name: "upscale_image",
        document_id: input.source.document_id,
        args_summary: `Upscale ${input.factor}x to layer`,
        weight: "large",
        apply: async () => { await ctx.layers.update(input.source.document_id, input.source.layer_id, { content_blob_id: newBlobId }); },
        revert: async () => { await ctx.layers.update(input.source.document_id, input.source.layer_id, { content_blob_id: previousBlobId }); },
      });
      await ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, input.source.document_id, command);
      return { layer_id: input.source.layer_id };
    } else {
      // new_layer path: persist as history_item
      const blob_id = await ctx.assets.writeBlob(result);
      const thumb_id = await ctx.assets.writeThumbnail(result, 256);
      const history_item_id = ulid();
      ctx.db.exec("INSERT INTO history_items ...", { id: history_item_id, /* ... */, parameters_json: JSON.stringify({ kind: "upscale", factor: input.factor, model: input.model }) });
      return { history_item_id, dimensions: getDims(result) };
    }
  });

  return { job_id };
};
```

## 10. Tablet UX

```typescript
// libs/ui/src/upscale/UpscaleSettingsPanel.tsx
export const UpscaleSettingsPanel: React.FC = () => {
  const ws = useEditorStore((s) => s.workspace);
  if (ws !== "Upscale") return null;

  const [source, setSource] = useState<UpscaleSource>({ kind: "document" });
  const [factor, setFactor] = useState<UpscaleFactor>(2);
  const [model, setModel] = useState("4x-UltraSharp");
  const [mode, setMode] = useState<"native" | "diffusion_refine">("native");
  const [denoise, setDenoise] = useState(0.3);
  const [advanced, setAdvanced] = useState({ tile_size: 768, tile_overlap: 64, seam: "gaussian" });

  const onUpscale = () => client.tools.upscaleImage({ source, factor, model, mode, ...(mode === "diffusion_refine" ? { diffusion_params: { denoise } } : {}), ...advanced });

  return (
    <Panel>
      <SourcePicker value={source} onChange={setSource} />
      <FactorPicker value={factor} onChange={setFactor} />
      <ModelPicker value={model} onChange={setModel} />
      <ModePicker value={mode} onChange={setMode} />
      {mode === "diffusion_refine" && <DiffusionRefineSubpanel denoise={denoise} onChangeDenoise={setDenoise} />}
      <AdvancedSettings value={advanced} onChange={setAdvanced} />
      <PrimaryButton onPress={onUpscale}>Upscale to {factor}x</PrimaryButton>
    </Panel>
  );
};
```

## 11. Catalog impact

**0 new tools.** `upscale_image` already in v1 catalog from `mcp-tool-catalog` §3.3.10. This spec extends its schema (new fields like `mode`, `diffusion_params`, `tile_size`, `output_target`) but keeps the count. Catalog stays at ~57.

## 12. Cross-spec touches

- **`mcp-tool-catalog`**: extend `upscale_image` schema per FR-1.
- **`comfyui-management`**: graph builders (`buildUpscaleTileGraph`, `buildTileImg2imgGraph`) live in `libs/server/src/lib/comfy/graph/upscale.ts`.
- **`workspaces`**: Upscale workspace surfaces this panel; `upscale_image` is the primary tool there.
- **`generation-history`**: results land as history items.

## 13. Acceptance criteria

1. All 6 factors produce correct dimensions.
2. Stitch uniformly-gradient test passes.
3. Diffusion refine at denoise ≤ 0.4 produces seamless output.
4. VRAM auto-shrink retry works on 8 GB GPU with aggressive settings.
5. Cancellation mid-tile completes within 3 s.
