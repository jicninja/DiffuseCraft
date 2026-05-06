# control-layers — Design

> **Companion to:** `requirements.md`. **References:** `comfyui-management`, `canvas-fundamentals`, `mask-system`, `regions` (next), krita-ai-diffusion `ai_diffusion/control.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No paint on control layers in v1.** Edit the source. |
| Q2 | **Failed preprocess → exclude from generation with warning.** Don't block. |
| Q3 | **No auto-detect of control type in v1.** Explicit pick. |
| Q4 | **start/end step in advanced settings only.** |
| Q5 | **One source per layer; stack multiple layers for combined effect.** |
| Q6 | **Content-hash-keyed cache** of preprocessed blobs cross-document. |

## 2. Module layout

```
libs/canvas-core/src/control-layers/
├── index.ts
├── types.ts                     # ControlLayerType, ControlLayerFamily, ControlLayer
├── families.ts                  # mapping type → family + preprocessor name
└── operations.ts                # pure ops (add/remove/update/regenerate)

libs/server/src/lib/comfy/control/
├── preprocess.ts                # dispatch type → ComfyUI preprocess graph
├── preprocess-cache.ts          # SHA256 + type + params keyed cache
├── graph-attach.ts              # builder helper: add ControlNet/IP-Adapter nodes to a generate graph
└── handlers/
    ├── add-control-layer.ts
    ├── remove-control-layer.ts
    └── regenerate-control-preprocess.ts

libs/ui/src/control-layers/
├── ControlLayerRow.tsx          # row in layer panel
├── ControlLayerSettings.tsx     # long-press settings sheet
├── ControlTypePicker.tsx        # picker when adding
└── ControlPreviewOverlay.tsx    # show preprocessed image faded over canvas
```

## 3. Type & family

```typescript
// libs/canvas-core/src/control-layers/types.ts
export const CONTROL_TYPES = [
  "reference", "style", "composition", "face",                         // family: reference (IP-Adapter)
  "scribble", "line_art", "soft_edge", "canny", "depth", "normal",
  "pose", "segmentation", "unblur", "stencil"                          // family: structural (ControlNet)
] as const;

export type ControlLayerType = typeof CONTROL_TYPES[number];
export type ControlLayerFamily = "reference" | "structural";

export const FAMILY_OF: Record<ControlLayerType, ControlLayerFamily> = {
  reference: "reference", style: "reference", composition: "reference", face: "reference",
  scribble: "structural", line_art: "structural", soft_edge: "structural", canny: "structural",
  depth: "structural", normal: "structural", pose: "structural", segmentation: "structural",
  unblur: "structural", stencil: "structural",
};

export interface ControlLayer extends Layer {
  kind: "control";
  type: ControlLayerType;
  family: ControlLayerFamily;
  source_blob_id: string;                  // raw source image
  source_layer_id?: LayerId;               // when source comes from a paint layer (for change tracking)
  preprocessed_blob_id?: string;           // cached after preprocessing
  preprocess_status: "pending" | "success" | "failure" | "stale";
  preprocess_error?: string;
  preprocess_params?: Record<string, unknown>;
  strength: number;                         // 0-2, default 1
  start_step: number;                       // 0-1, default 0
  end_step: number;                         // 0-1, default 1
  region_scope: RegionId[] | null;          // null = global
}
```

## 4. Preprocessor mapping

```typescript
// libs/server/src/lib/comfy/control/preprocess.ts
const PREPROCESSOR_GRAPH: Record<ControlLayerType, GraphBuilder | null> = {
  // Reference-family — no preprocessing
  reference: null, style: null, composition: null, face: null,

  // Structural — each maps to a ComfyUI preprocessor custom node
  scribble: (image, params) => buildScribblePreprocessGraph(image, params),
  line_art: (image, params) => buildLineArtPreprocessGraph(image, params),
  soft_edge: (image, params) => buildHEDPreprocessGraph(image, params),
  canny: (image, params) => buildCannyPreprocessGraph(image, params ?? { low: 100, high: 200 }),
  depth: (image, params) => buildDepthPreprocessGraph(image, params ?? { model: "DPT" }),
  normal: (image, params) => buildNormalPreprocessGraph(image, params),
  pose: (image, params) => buildPosePreprocessGraph(image, params ?? { model: "DWPose" }),
  segmentation: (image, params) => buildSegPreprocessGraph(image, params),
  unblur: null,                              // input IS the blurred image
  stencil: null,                             // input IS the stencil
};

export async function preprocess(
  type: ControlLayerType,
  source: Uint8Array,
  params: Record<string, unknown> | undefined,
  comfy: ComfyClient,
  cache: PreprocessCache
): Promise<Uint8Array> {
  const builder = PREPROCESSOR_GRAPH[type];
  if (!builder) return source;   // identity passthrough

  const cacheKey = sha256Hex(source) + ":" + type + ":" + canonicalize(params);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const graph = builder(source, params);
  const { prompt_id } = await comfy.submitGraph(graph);
  const result = await waitForPreprocessResult(prompt_id);
  cache.set(cacheKey, result, { ttl_ms: 60 * 60 * 1000 });
  return result;
}
```

## 5. add_control_layer handler

```typescript
// libs/server/src/lib/comfy/control/handlers/add-control-layer.ts
export const addControlLayerHandler: Handler<typeof addControlLayer> = async (input, ctx) => {
  // 1. Acquire source bytes
  const sourceBytes = await resolveSource(input.source, ctx);
  const sourceBlobId = await ctx.assets.writeBlob(sourceBytes);

  // 2. Build the layer record (preprocess_status: pending)
  const layer_id = ulid();
  const family = FAMILY_OF[input.type];
  const command = buildCommand({
    tool_name: "add_control_layer",
    document_id: input.document_id ?? ctx.activeDocumentId,
    args_summary: `Add ${family} control: ${input.type}`,
    weight: "small",
    apply: async () => {
      await ctx.layers.create({
        id: layer_id,
        document_id: input.document_id,
        kind: "control",
        type: input.type,
        family,
        source_blob_id: sourceBlobId,
        source_layer_id: input.source.kind === "layer" ? input.source.layer_id : undefined,
        strength: input.strength ?? 1,
        start_step: input.start_step ?? 0,
        end_step: input.end_step ?? 1,
        region_scope: input.region_scope ?? null,
        name: input.name ?? defaultName(input.type),
        preprocess_status: "pending",
        preprocess_params: input.preprocess_params,
      });
      // 3. Asynchronously preprocess + emit event
      this.preprocessAsync(layer_id, sourceBytes, input.type, input.preprocess_params, ctx);
      return { layer_id };
    },
    revert: async () => { await ctx.layers.remove(input.document_id, layer_id); },
  });

  return ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, input.document_id, command);
};

async function preprocessAsync(layer_id, sourceBytes, type, params, ctx) {
  try {
    const result = await preprocess(type, sourceBytes, params, ctx.comfy, ctx.cache);
    const blobId = await ctx.assets.writeBlob(result);
    await ctx.layers.update(ctx.activeDocumentId, layer_id, { preprocessed_blob_id: blobId, preprocess_status: "success" });
    ctx.bus.publish({ name: "control_layer.preprocessed", payload: { layer_id, status: "success" } });
  } catch (err) {
    await ctx.layers.update(ctx.activeDocumentId, layer_id, { preprocess_status: "failure", preprocess_error: String(err) });
    ctx.bus.publish({ name: "control_layer.preprocessed", payload: { layer_id, status: "failure", error: String(err) } });
  }
}
```

## 6. Graph integration (called from `comfyui-management/graph/builder.ts`)

```typescript
// libs/server/src/lib/comfy/control/graph-attach.ts
export function attachControlLayers(
  graph: ComfyGraph,
  controls: ControlLayer[],
  region_id_for_this_pass: RegionId | null,
  baseConditioning: NodeRef
): { conditioning: NodeRef; model: NodeRef } {
  let cond = baseConditioning;
  let model = graph.modelNode;

  for (const c of controls) {
    if (c.preprocess_status !== "success") continue;   // skip failed
    if (c.region_scope !== null && region_id_for_this_pass !== null && !c.region_scope.includes(region_id_for_this_pass)) continue;

    if (c.family === "reference") {
      // IP-Adapter: modifies the model itself
      model = appendIPAdapterNode(graph, model, c);
    } else {
      // ControlNet: modifies conditioning
      cond = appendControlNetNode(graph, cond, c);
    }
  }
  return { conditioning: cond, model };
}
```

The `generate_image` graph builder calls this after computing base conditioning and model. Up to 8 control layers (FR-19).

## 7. Source resolution

```typescript
async function resolveSource(source: ControlSource, ctx: HandlerContext): Promise<Uint8Array> {
  switch (source.kind) {
    case "image":
      return await ctx.client.image.fetch(source.image);
    case "layer":
      return await ctx.layers.getRasterizedContent(ctx.activeDocumentId, source.layer_id);
    case "selection":
      return await ctx.canvas.rasterizeSelection(ctx.activeDocumentId);
  }
}
```

## 8. Preprocess cache

```typescript
// libs/server/src/lib/comfy/control/preprocess-cache.ts
export class PreprocessCache {
  // SQLite-backed (cross-session) + in-memory hot tier
  private hot = new Map<string, { blob: Uint8Array; ts: number }>();

  async get(key: string): Promise<Uint8Array | undefined> {
    const h = this.hot.get(key);
    if (h && Date.now() - h.ts < 60 * 60 * 1000) return h.blob;
    // fallback: SQLite lookup by key
    const row = this.db.queryOne("SELECT blob_id FROM preprocess_cache WHERE cache_key = ? AND expires_at > ?", key, new Date().toISOString());
    if (!row) return undefined;
    return await this.assets.readBlob(row.blob_id);
  }

  async set(key: string, bytes: Uint8Array, opts: { ttl_ms: number }): Promise<void> {
    const blob_id = await this.assets.writeBlob(bytes);
    this.hot.set(key, { blob: bytes, ts: Date.now() });
    this.db.exec("INSERT OR REPLACE INTO preprocess_cache (cache_key, blob_id, expires_at) VALUES (?, ?, ?)",
      key, blob_id, new Date(Date.now() + opts.ttl_ms).toISOString());
  }
}
```

Cache spans documents and sessions. GC purges expired rows.

## 9. Source-change tracking

When a control layer's `source_layer_id` references a paint layer that the user later edits, the system marks `preprocess_status: "stale"` and surfaces a "regenerate" indicator on the row. User taps → `regenerate_control_preprocess` → fresh preprocess.

```typescript
// in document.changed event handling:
function onLayerContentChanged(documentId, layer_id) {
  const dependents = ctx.db.query<ControlLayer>(
    "SELECT * FROM layers WHERE source_layer_id = ? AND kind = 'control'", layer_id);
  for (const c of dependents) {
    ctx.layers.update(documentId, c.id, { preprocess_status: "stale" });
  }
}
```

## 10. Tablet UX

### 10.1 Add control flow

```
1. User long-presses a paint layer in the panel.
2. Context menu: "Use as control →".
3. Submenu: 14 type options grouped by family (Reference / Structural).
4. User picks (e.g., Pose).
5. add_control_layer is called with source_layer_id.
6. Row appears immediately with a "Preprocessing..." spinner.
7. control_layer.preprocessed event lands → row shows preprocessed thumbnail.
8. User can adjust strength, region scope, etc. via long-press settings sheet.
```

### 10.2 Layer row

```typescript
// libs/ui/src/control-layers/ControlLayerRow.tsx
export const ControlLayerRow: React.FC<{ layer: ControlLayer }> = ({ layer }) => (
  <Row>
    <TypeIcon family={layer.family} type={layer.type} />
    <PreprocessedThumb status={layer.preprocess_status} blob_id={layer.preprocessed_blob_id} />
    <ColumnGroup>
      <Title>{layer.name}</Title>
      <StrengthSlider value={layer.strength} onChange={(v) => updateLayer({ ...layer, strength: v })} compact />
      {layer.region_scope && <RegionBadge regions={layer.region_scope} />}
    </ColumnGroup>
    {layer.preprocess_status === "stale" && <RegenerateButton layerId={layer.id} />}
    <VisibilityToggle layer={layer} />
  </Row>
);
```

### 10.3 Settings sheet

Long-press → bottom sheet with:
- Strength slider (full range 0–2 with 1 highlighted as default).
- Start step / End step sliders (advanced — collapsed by default).
- Preprocess params (advanced — type-specific; e.g., Canny low/high).
- Region scope picker (multi-select from current document's regions).
- Source picker (re-route source).
- Regenerate button.

### 10.4 Preview overlay

Tapping the visibility toggle on a control layer shows the preprocessed image **faded at 50% opacity** over the canvas — useful for validating that pose/depth/canny was extracted correctly. Toggle off to hide.

## 11. Performance notes

- Reference-family adds without preprocessing — cheap.
- Structural-family preprocessing budgets per FR-25.
- Warm pool keeps active preprocessor models loaded; LRU evicted on VRAM pressure.
- Cross-document cache: a Pose preprocessor result on the same source image used in 5 documents = 1 inference total.

## 12. Cross-spec references

- **`mcp-tool-catalog`**: `add_control_layer` schema in §3.3.7 extended per FR-13. New tool `regenerate_control_preprocess`. Catalog total ~55.
- **`comfyui-management`**: required-nodes list includes `comfyui_controlnet_aux` + `ComfyUI_IPAdapter_plus` (already in scope from Section 3.3 of that spec).
- **`regions` (next spec)**: `region_scope` is a list of region IDs; the regions spec defines those.
- **`generation-workflow`**: graph builder calls `attachControlLayers` per the verb's needs (FR-17).

## 13. Acceptance criteria

1. All 14 types have working preprocess paths (or identity for no-preprocess types).
2. Add/remove/regenerate flows are reversible.
3. Per-region scope correctly filters which controls apply per generation pass.
4. Cross-document preprocess cache works (same source image hash → reuse).
5. Stale-source detection triggers UI indicator + manual regenerate.
6. Tablet UX surfaces all controls without overwhelming the layer panel.
