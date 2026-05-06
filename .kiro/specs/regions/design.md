# regions — Design

> **Companion to:** `requirements.md`. **References:** `canvas-fundamentals`, `control-layers`, `comfyui-management`, krita-ai-diffusion `region.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Raise catalog cap to 60.** Update `mcp-tool-catalog` FR-36. |
| Q2 | **`set_root_prompt` standard Command** with previousRoot capture. |
| Q3 | **Tap region row → set active layer** to its source paint layer. |
| Q4 | **Coverage threshold 0.05 fixed in v1**, configurable server-side only. |
| Q5 | **One region per paint layer.** |
| Q6 | **`remove_region` does NOT delete the paint layer.** |

## 2. Module layout

```
libs/canvas-core/src/regions/
├── index.ts
├── types.ts                     # Region, RootPrompt, CoverageMask
├── operations.ts                # pure ops: define/update/remove + root-prompt set
├── coverage.ts                  # compute coverage mask from paint layer + stack
└── prompt-compose.ts            # root + region prompt combiner

libs/server/src/lib/regions/
├── handlers/
│   ├── define-region.ts
│   ├── update-region.ts
│   ├── remove-region.ts
│   └── set-root-prompt.ts
├── orphan-detector.ts           # marks regions orphaned when paint layer deleted
└── coverage-cache.ts            # short-lived coverage cache (per-doc generation)

libs/server/src/lib/comfy/regions/
└── graph-attach.ts              # ConditioningSetMask + ConditioningCombine builder

libs/ui/src/regions/
├── RegionsPanel.tsx             # list with thumbnails
├── RegionRow.tsx
├── RegionSettings.tsx           # full prompt editor + scoped controls list
├── RootPromptBar.tsx            # always-visible at top
├── RegionOverlay.tsx            # cyan coverage preview
└── DefineRegionSheet.tsx        # initial creation flow
```

## 3. Data types

```typescript
// libs/canvas-core/src/regions/types.ts
export interface Region {
  readonly id: RegionId;
  readonly document_id: DocumentId;
  readonly paint_layer_id: LayerId;
  readonly prompt: string;
  readonly negative_prompt: string;
  readonly name: string;
  readonly orphaned: boolean;
  readonly created_at: string;
}

export interface RootPrompt {
  readonly document_id: DocumentId;
  readonly root_prompt: string;
  readonly root_negative_prompt: string;
}

export interface CoverageMask {
  readonly region_id: RegionId;
  readonly mask: Uint8Array;            // alpha-only, doc dimensions
  readonly width: number;
  readonly height: number;
}
```

## 4. Coverage computation

```typescript
// libs/canvas-core/src/regions/coverage.ts
export function computeCoverage(
  region: Region,
  document: Document,
  rasterizeLayer: (layer: Layer) => Uint8Array,
  threshold: number = 0.05
): CoverageMask | null {
  const paintLayer = document.layers.find((l) => l.id === region.paint_layer_id);
  if (!paintLayer || !paintLayer.visible) return null;

  // Get this layer's alpha
  const rgba = rasterizeLayer(paintLayer);
  const alphaOnly = extractAlpha(rgba);

  // Apply layer-stacking: subtract coverage of any opaque layers ABOVE this one
  // (those layers occlude this one for region coverage purposes)
  const above = document.layers.filter((l) =>
    l.position > paintLayer.position && l.visible && l.kind === "paint" && l.opacity > 0.95
  );
  for (const occluder of above) {
    const occluderAlpha = extractAlpha(rasterizeLayer(occluder));
    for (let i = 0; i < alphaOnly.length; i++) {
      // wherever occluder is fully opaque, this layer's region coverage is 0
      if (occluderAlpha[i] > 245) alphaOnly[i] = 0;
    }
  }

  // Apply threshold
  const t = Math.round(threshold * 255);
  for (let i = 0; i < alphaOnly.length; i++) {
    if (alphaOnly[i] < t) alphaOnly[i] = 0;
  }

  return {
    region_id: region.id,
    mask: alphaOnly,
    width: document.width,
    height: document.height,
  };
}
```

## 5. Prompt composition

```typescript
// libs/canvas-core/src/regions/prompt-compose.ts
export function composeEffectivePrompts(
  root: RootPrompt,
  regions: Region[]
): { region_id: RegionId | null; positive: string; negative: string }[] {
  const out: { region_id: RegionId | null; positive: string; negative: string }[] = [];
  // Root-only entry (for uncovered area)
  out.push({ region_id: null, positive: root.root_prompt, negative: root.root_negative_prompt });
  for (const r of regions) {
    out.push({
      region_id: r.id,
      positive: joinPrompts(root.root_prompt, r.prompt),
      negative: joinPrompts(root.root_negative_prompt, r.negative_prompt),
    });
  }
  return out;
}

function joinPrompts(root: string, region: string): string {
  if (!root && !region) return "";
  if (!root) return region;
  if (!region) return root;
  return `${root}, ${region}`;
}
```

## 6. Selection-region filtering

```typescript
// libs/server/src/lib/comfy/regions/select-active-regions.ts
export function selectActiveRegions(
  regions: Region[],
  selection: Selection | null,
  coverageMasks: Map<RegionId, CoverageMask>,
  selectionThresholdPct: number = 5
): Region[] {
  if (!selection || selection.kind === "none") return regions;
  const selMask = selectionToMask(selection, /* doc dims */);
  return regions.filter((r) => {
    const cov = coverageMasks.get(r.id);
    if (!cov) return false;
    const overlapPx = countOverlap(selMask, cov.mask);
    const regionPx = countNonZero(cov.mask);
    return regionPx > 0 && (overlapPx / regionPx) * 100 >= selectionThresholdPct;
  });
}
```

## 7. ComfyUI graph integration

```typescript
// libs/server/src/lib/comfy/regions/graph-attach.ts
export function attachRegions(
  graph: ComfyGraph,
  effectivePrompts: ReturnType<typeof composeEffectivePrompts>,
  coverageMasks: Map<RegionId, CoverageMask>,
  baseClipNode: NodeRef,
  baseClipNeg: NodeRef
): { positive: NodeRef; negative: NodeRef } {
  // For each entry in effectivePrompts:
  //   - encode positive + negative via CLIPTextEncode (re-using base CLIP)
  //   - if region_id, wrap with ConditioningSetMask using its coverage mask
  // Combine all positive entries via ConditioningCombine; same for negatives.

  let combinedPos: NodeRef | null = null;
  let combinedNeg: NodeRef | null = null;

  for (const e of effectivePrompts) {
    let pos = node("CLIPTextEncode", { text: e.positive, clip: baseClipNode });
    let neg = node("CLIPTextEncode", { text: e.negative, clip: baseClipNeg });
    if (e.region_id) {
      const mask = coverageMasks.get(e.region_id)!;
      pos = node("ConditioningSetMask", { conditioning: pos, mask: maskRef(mask), strength: 1.0 });
      neg = node("ConditioningSetMask", { conditioning: neg, mask: maskRef(mask), strength: 1.0 });
    }
    combinedPos = combinedPos ? node("ConditioningCombine", { a: combinedPos, b: pos }) : pos;
    combinedNeg = combinedNeg ? node("ConditioningCombine", { a: combinedNeg, b: neg }) : neg;
  }

  return { positive: combinedPos!, negative: combinedNeg! };
}
```

The `generate_image` graph builder calls `attachRegions` after computing base CLIP encoding, then passes the combined conditioning to the KSampler. Per-region control layers are attached via `attachControlLayers` (already specced) using each region's coverage mask as scope.

## 8. Handlers

```typescript
// libs/server/src/lib/regions/handlers/define-region.ts
export const defineRegionHandler: Handler<typeof defineRegion> = async (input, ctx) => {
  const document_id = input.document_id ?? ctx.activeDocumentId;
  // Check max regions
  const existing = await ctx.regions.listForDocument(document_id);
  if (existing.length >= 16) throw new ServerError({ code: "TOO_MANY_REGIONS", message: "Max 16 regions per document" });
  // Check no existing region for this paint layer
  if (existing.some((r) => r.paint_layer_id === input.paint_layer_id)) {
    throw new ServerError({ code: "REGION_ALREADY_EXISTS", message: "Paint layer already has a region" });
  }
  // Validate paint layer kind
  const layer = await ctx.layers.get(document_id, input.paint_layer_id);
  if (layer.kind !== "paint") throw new ValidationError({ field_path: "paint_layer_id", message: "Region anchor must be a paint layer" });

  const region_id = ulid();
  const command = buildCommand({
    tool_name: "define_region",
    document_id,
    args_summary: `Define region: ${(input.name ?? input.prompt).slice(0, 60)}`,
    weight: "small",
    apply: async () => {
      await ctx.regions.create({
        id: region_id, document_id, paint_layer_id: input.paint_layer_id,
        prompt: input.prompt, negative_prompt: input.negative_prompt ?? "",
        name: input.name ?? `Region ${existing.length + 1}`,
        orphaned: false,
      });
      return { region_id };
    },
    revert: async () => { await ctx.regions.remove(region_id); },
  });
  return ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, document_id, command);
};
```

`set_root_prompt` is analogous, capturing previous root + negative for revert.

## 9. Orphan detection

```typescript
// libs/server/src/lib/regions/orphan-detector.ts
export function onLayerRemoved(documentId: DocumentId, layer_id: LayerId, ctx: HandlerContext) {
  const dependentRegions = ctx.db.query<Region>(
    "SELECT * FROM regions WHERE paint_layer_id = ? AND document_id = ?", layer_id, documentId);
  for (const r of dependentRegions) {
    ctx.db.exec("UPDATE regions SET orphaned = 1 WHERE id = ?", r.id);
    ctx.bus.publish({
      name: "document.changed",
      payload: { document_id: documentId, change_summary: `Region "${r.name}" orphaned (paint layer removed)`, affected_layer_ids: [], originating_token_name: ctx.tokenName },
    });
  }
}
```

GC removes orphan regions ≥7 days old (consistent with history GC).

## 10. Tablet UX

### 10.1 Define region flow

```typescript
// libs/ui/src/regions/DefineRegionSheet.tsx
export const DefineRegionSheet: React.FC<{ paint_layer_id: LayerId; onClose: () => void }> = ({ paint_layer_id, onClose }) => {
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");

  const onCreate = async () => {
    await client.tools.defineRegion({ paint_layer_id, prompt, name: name || undefined });
    onClose();
  };

  return (
    <BottomSheet>
      <Title>Define region from this layer</Title>
      <PromptInput value={prompt} onChange={setPrompt} placeholder="What's in this area? (English)" multiline />
      <TextInput value={name} onChange={setName} placeholder="Region name (optional)" />
      <Row>
        <Button onPress={onClose}>Cancel</Button>
        <Button primary onPress={onCreate}>Create region</Button>
      </Row>
    </BottomSheet>
  );
};
```

### 10.2 Regions panel

A tab next to "Layers" in the side panel. Lists all regions for the active document. Each row:
- Coverage thumbnail (silhouette of the paint layer's alpha, cyan-tinted).
- Name + prompt preview (~30 chars).
- Tap → settings sheet + sets active layer to source paint layer.
- Long-press → quick actions (Toggle preview overlay, Delete, Add control).

### 10.3 Root prompt bar

A persistent collapsed bar at the top of the document UI:
- Single line preview of `root_prompt`.
- Tap → expands to multiline editor.
- Negative prompt accessible via toggle inside the expanded editor.
- Saves on blur.

### 10.4 Region overlay preview

Tapping a region's "preview" toggle → overlays the coverage mask in cyan at 40% opacity over the canvas. Used to validate which area gets the region's prompt. Tap again to hide.

### 10.5 Orphan handling

Orphan regions show with a red ⚠ icon and a "Remove" button. UI does not silently delete them — user explicitly resolves.

## 11. Performance

- Coverage cache (`libs/server/src/lib/regions/coverage-cache.ts`) computed once per generation submission; reused across multi-region passes.
- Threshold check is a single linear pass over alpha bytes (~60 ms on 4K).
- Layer-stacking occlusion: only opaque layers above are considered (most documents have few).

## 12. Cross-spec touches

- **`mcp-tool-catalog`**: catalog cap → 60. Add `update_region` and `set_root_prompt`. Total ~57.
- **`control-layers`**: `region_scope` already in place; this spec confirms semantics.
- **`generation-workflow`**: graph builder calls `attachRegions` and `selectActiveRegions` based on selection state.
- **`canvas-fundamentals`**: layer kind `region` is unused for v1 — regions are stored in their own SQL table tied to a paint layer, not as a layer subtype. (`canvas-fundamentals` mentions `region` as a layer kind for visual outlining; v1 simplifies to a separate table.)

## 13. Acceptance criteria

1. The five user stories run end-to-end.
2. Coverage computation respects layer stacking + threshold.
3. Effective prompts compose root + region correctly.
4. Selection overlap filters active regions for Fill/Refine.
5. Per-region control layers are honored in the graph.
6. Orphan detection + UI handling work.
7. Catalog footprint stays ≤100 KB after cap raise to 60.
