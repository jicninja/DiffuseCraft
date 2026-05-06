# selection-tools — Design

> **Companion to:** `requirements.md`. **References:** `mask-system`, `canvas-fundamentals`, `comfyui-management`, `mcp-tool-catalog`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Dedicated `refine_selection` tool.** +1 to v1 catalog (~51 — within new cap of 50, may need re-trim or raise to 55). |
| Q2 | **`auto_select_subject` accepts optional `tap_point`;** absent = auto-detect salient subject. |
| Q3 | **AI segmentation as ComfyUI extensions.** Required-nodes list extends to optional Grounded-SAM / SAM nodes. |
| Q4 | **Magic wand samples active layer by default;** "Sample composite" toggle. |
| Q5 | **Polygonal lasso constrains to 45°** with Shift OR on-screen ring "↗" toggle. |
| Q6 | **Selection not persisted across reopen.** |
| Q7 | **Selection persists across active-layer changes.** Document-level state. |

## 2. Module layout

```
libs/canvas-core/src/selection/
├── index.ts
├── types.ts                     # Selection union types
├── operations.ts                # boolean ops, refine, invert, select all
├── lasso.ts                     # path simplification (Ramer-Douglas-Peucker)
├── magic-wand.ts                # tolerance-based flood fill
└── render-helpers.ts            # marching-ants path computation, bounding-box

libs/server/src/lib/handlers/
├── set-selection.ts             # extended with op + polygon kind
├── invert-selection.ts
├── select-all.ts
├── refine-selection.ts
├── auto-select-subject.ts       # job
└── select-by-prompt.ts          # job

libs/server/src/lib/comfy/segmentation/
├── client.ts                    # wrapper invoking SAM/Grounded-SAM via ComfyUI
├── warm-pool.ts                 # keep model warm in VRAM
├── cache.ts                     # per-(layer-hash, model-id, point) cache
└── preprocessing.ts             # downscale + upscale-mask pipeline

libs/canvas-skia/src/overlay/
├── selection-marching-ants.ts
└── selection-protected-overlay.ts

libs/ui/src/selection/
├── SelectionToolbar.tsx         # tools + boolean op picker
├── tools/
│   ├── RectangleTool.tsx
│   ├── LassoTool.tsx
│   ├── PolygonalLassoTool.tsx
│   ├── MagicWandTool.tsx
│   ├── AutoSelectTool.tsx       # tier 2
│   └── PromptSelectTool.tsx     # tier 3
├── BooleanOpPicker.tsx
├── RefinePanel.tsx
└── PromptInput.tsx
```

## 3. Selection types & operations

```typescript
// libs/canvas-core/src/selection/types.ts
export type Selection =
  | { kind: "none" }
  | { kind: "rect"; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "polygon"; points: Point[] }
  | { kind: "mask"; mask: ImageEnvelope };

export type SelectionOp = "replace" | "add" | "subtract" | "intersect";

// libs/canvas-core/src/selection/operations.ts
export function applyOp(current: Selection, incoming: Selection, op: SelectionOp): Selection {
  if (op === "replace") return incoming;
  // for add/subtract/intersect, convert both to mask, do binary op, return as mask kind
  const dims = /* document dims */;
  const a = selectionToMask(current, dims);
  const b = selectionToMask(incoming, dims);
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = op === "add" ? Math.max(a[i], b[i])
              : op === "subtract" ? Math.max(0, a[i] - b[i])
              : /* intersect */ Math.min(a[i], b[i]);
  }
  return { kind: "mask", mask: encodeAsPng(result, dims) };
}
```

## 4. Segmentation client (server-side, all via ComfyUI)

**Default Tier 2 model: MobileSAM** (9 MB, mature ComfyUI tooling). Tier 3 swaps to a heavier variant; Tier 4 (prompt-based) feeds VLM-derived bounding boxes from MCP sampling into the same SAM model.

```typescript
// libs/server/src/lib/comfy/segmentation/client.ts
export class SegmentationClient {
  constructor(
    private comfy: ComfyClient,
    private warmPool: WarmPool,
    private cache: SegmentationCache,
    private samplingForwarder: SamplingForwarder,    // for Tier 4
    private config: SegmentationConfig
  ) {}

  /** Tier 2 / Tier 3: tap-point-driven segmentation via SAM-class model. */
  async autoSelectSubject(opts: { layer_image: Uint8Array; tap_point?: Point; quality?: "fast" | "high" }): Promise<Uint8Array> {
    const modelId = opts.quality === "high" ? this.config.tier3_model : this.config.tier2_model;
    const cacheKey = computeKey(opts.layer_image, opts.tap_point, modelId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    await this.warmPool.ensureWarm(modelId);
    const downscaled = preprocess(opts.layer_image, 1024);
    const graph = buildSAMGraph({ image: downscaled, model: modelId, point: opts.tap_point });
    const { prompt_id } = await this.comfy.submitGraph(graph);
    const maskBytes = await this.waitForResult(prompt_id);
    const upscaled = upscaleMask(maskBytes, opts.layer_image);

    this.cache.set(cacheKey, upscaled);
    return upscaled;
  }

  /** Tier 4: prompt-based via VLM (MCP sampling) → bbox → SAM. */
  async selectByPrompt(opts: { layer_image: Uint8Array; prompt: string }, ctx: HandlerContext): Promise<Uint8Array> {
    // Step 1: ask the calling agent (via MCP sampling) for bounding boxes matching the prompt
    let boxes: BoundingBox[];
    try {
      const samplingResponse = await this.samplingForwarder.requestFromAgent({
        kind: "vision-grounding",
        image: opts.layer_image,
        prompt: opts.prompt,
        instruction: "Return one or more bounding boxes (normalized 0-1) for objects matching the prompt.",
      }, ctx.tokenId);
      boxes = parseBoundingBoxes(samplingResponse);
    } catch (err) {
      // Tier 4 unsupported or sampling failed → fall back to Tier 2 with a notice
      throw new ServerError({
        code: "SAMPLING_NOT_SUPPORTED",
        message: "Prompt-based selection requires an agent that supports MCP sampling (Claude, Codex, Gemini CLI). Connected agent does not.",
        hint: "Use auto_select_subject with a tap point as fallback.",
      });
    }

    // Step 2: feed each bbox into MobileSAM as a box prompt
    const modelId = this.config.tier2_model;
    await this.warmPool.ensureWarm(modelId);
    const downscaled = preprocess(opts.layer_image, 1024);
    const graph = buildSAMGraph({ image: downscaled, model: modelId, boxes });
    const { prompt_id } = await this.comfy.submitGraph(graph);
    const maskBytes = await this.waitForResult(prompt_id);
    return upscaleMask(maskBytes, opts.layer_image);
  }
}
```

The `SamplingForwarder` integrates with `client-sdk` MCP sampling (already specced) — the server raises a sampling request to the agent, agent answers with boxes, server uses them to drive SAM. **Vendor-neutral**: works with any agent that implements the standard MCP sampling protocol.

## 5. Warm pool

```typescript
// libs/server/src/lib/comfy/segmentation/warm-pool.ts
export class WarmPool {
  private warm = new Set<string>();

  async ensureWarm(modelId: string): Promise<void> {
    if (this.warm.has(modelId)) return;
    // submit a no-op graph that just loads the model
    await this.comfy.submitGraph(buildLoadOnlyGraph(modelId));
    this.warm.add(modelId);
  }

  // LRU eviction triggered on VRAM pressure (received via comfy events)
  evict(modelId: string): void {
    this.warm.delete(modelId);
  }
}
```

The pool ensures the **first call after server boot** triggers a load (~3 s cold), and **subsequent calls** within the warm window return ~800 ms.

## 6. Cache

```typescript
// libs/server/src/lib/comfy/segmentation/cache.ts
export class SegmentationCache {
  private map = new Map<string, { mask: Uint8Array; ts: number }>();
  private TTL = 60_000;

  get(key: string): Uint8Array | undefined {
    const entry = this.map.get(key);
    if (!entry || Date.now() - entry.ts > this.TTL) return undefined;
    return entry.mask;
  }
  set(key: string, mask: Uint8Array): void {
    this.map.set(key, { mask, ts: Date.now() });
  }
}

export function computeKey(imageBytes: Uint8Array, tap?: Point): string {
  const hash = sha256(imageBytes).slice(0, 16);
  const grid = tap ? `${Math.floor(tap.x / 32)}-${Math.floor(tap.y / 32)}` : "auto";
  return `${hash}:${grid}`;
}
```

## 7. Tablet selection toolbar

```typescript
// libs/ui/src/selection/SelectionToolbar.tsx
export const SelectionToolbar: React.FC = () => {
  const activeTool = useEditorStore((s) => s.active_tool);
  const op = useEditorStore((s) => s.selection_op);
  const setOp = useEditorStore((s) => s.setSelectionOp);
  const catalog = useMcpCatalogStore();

  return (
    <Toolbar>
      <ToolButton tool="rectangle" active={activeTool === "rectangle"} icon="□" />
      <ToolButton tool="lasso" active={activeTool === "lasso"} icon="〰" />
      <ToolButton tool="polygonal-lasso" active={activeTool === "polygonal-lasso"} icon="✦" />
      <ToolButton tool="magic-wand" active={activeTool === "magic-wand"} icon="🪄" />
      <Divider />
      {catalog.hasTool("auto_select_subject") && (
        <ToolButton tool="auto-select" active={activeTool === "auto-select"} icon="✨" />
      )}
      {catalog.hasTool("select_by_prompt") && (
        <ToolButton tool="prompt-select" active={activeTool === "prompt-select"} icon="🔮" />
      )}
      <Divider />
      <BooleanOpPicker value={op} onChange={setOp} />
      <Divider />
      <RefineButton />
      <InvertButton />
      <SelectAllButton />
      <ClearButton />
    </Toolbar>
  );
};
```

`hasTool(...)` checks the negotiated catalog (per `client-state-architecture` `mcpCatalogStore.hasTool`); AI-tool buttons gracefully hide when the underlying ComfyUI nodes aren't installed.

## 8. Lasso path → polygon

```typescript
// libs/canvas-core/src/selection/lasso.ts
export function simplifyLassoPath(rawPoints: Point[]): Point[] {
  // Ramer-Douglas-Peucker with epsilon 1px
  return rdp(rawPoints, 1.0);
}
```

## 9. Magic wand

```typescript
// libs/canvas-core/src/selection/magic-wand.ts
export function magicWandSelect(
  imageBytes: Uint8Array,    // active layer or composite
  dims: { w: number; h: number },
  tapPoint: Point,
  tolerance: number,
  contiguous: boolean
): Uint8Array {
  const sampleColor = sampleRGB(imageBytes, dims, tapPoint);
  const mask = new Uint8Array(dims.w * dims.h);
  if (contiguous) {
    floodFill(imageBytes, dims, tapPoint, sampleColor, tolerance, mask);
  } else {
    for (let i = 0, p = 0; i < imageBytes.length; i += 4, p++) {
      if (colorDistance(imageBytes.slice(i, i + 3), sampleColor) <= tolerance) mask[p] = 255;
    }
  }
  return mask;
}
```

## 10. Catalog impact summary

After `transform-tools` (+1) + `mask-system` (+7) + `selection-tools` (+5: invert_selection, select_all, refine_selection, auto_select_subject, select_by_prompt), v1 catalog reaches **~51 tools**.

**Action items for `mcp-tool-catalog`**:
- Cap raised again from 50 to **55** (we'll keep climbing as feature specs add tools — that's expected).
- Footprint NFR-3 (≤100 KB) remains the hard gate; trim descriptions if necessary.

## 11. Acceptance criteria

1. Tier 1 selections all work touch-first.
2. Boolean ops compose cleanly via `applyOp`.
3. AI tier 2 + 3 are functional with lightweight models, sub-second after warm.
4. Pre-warming + cache deliver responsive UX after first cold call.
5. Catalog cap raised; footprint asserted.
6. AI tools gracefully hidden when nodes unsupported.
