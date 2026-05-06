# mask-system — Design

> **Companion to:** `requirements.md`. **References:** `canvas-fundamentals`, `transform-tools`, `mcp-tool-catalog`, `comfyui-management`, krita-ai-diffusion `selection.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Raise catalog cap from 40 to 50.** Update `mcp-tool-catalog` FR-36. Footprint NFR-3 (100 KB) remains the hard constraint. |
| Q2 | **Mask paint shares the brush palette.** Brush color is converted to greyscale alpha when active layer is a mask. |
| Q3 | **`from_layer` modes: alpha and luminance only.** Per-channel post-v1. |
| Q4 | **Single `refine_mask` tool with optional fields.** |
| Q5 | **`bake_mask` kept as power-user op; long-press menu option.** |
| Q6 | **Multiple mask previews render at 0.5× opacity each.** |

## 2. Module layout

```
libs/canvas-core/src/mask/
├── index.ts
├── types.ts                     # MaskLayer subtypes
├── operations.ts                # pure: invert, clear, fill, refine
├── selection-mask.ts            # selection ↔ mask conversion
├── from-layer.ts                # alpha / luminance derivation
└── two-mask-split.ts            # denoising + blend mask construction (called server-side at job submit)

libs/server/src/lib/handlers/
├── refine-mask.ts
├── invert-mask.ts
├── clear-mask.ts
├── fill-mask.ts
├── selection-to-mask.ts
├── mask-to-selection.ts
└── bake-mask.ts

libs/canvas-skia/src/overlay/
└── mask-preview.ts              # red overlay rendering

libs/ui/src/mask/
└── MaskPreviewToggle.tsx        # per-layer toggle in panel
```

## 3. Mask types

```typescript
// libs/canvas-core/src/mask/types.ts
export type MaskSubKind = "painted" | "from_layer";

export interface PaintedMaskLayer extends Omit<Layer, "kind"> {
  kind: "mask";
  subkind: "painted";
  content_blob_id: string;        // alpha-only PNG (greyscale)
}

export interface FromLayerMaskLayer extends Omit<Layer, "kind"> {
  kind: "mask";
  subkind: "from_layer";
  source_layer_id: LayerId;
  channel: "alpha" | "luminance";
  invert: boolean;
}

export type MaskLayer = PaintedMaskLayer | FromLayerMaskLayer;
```

## 4. Pure operations

```typescript
// libs/canvas-core/src/mask/operations.ts
export const invertMask = (mask: Uint8Array): Uint8Array =>
  new Uint8Array(mask.map((v) => 255 - v));

export const clearMask = (size: number): Uint8Array => new Uint8Array(size);

export const fillMask = (size: number, value: number): Uint8Array =>
  new Uint8Array(size).fill(value);

export const refineMask = (
  mask: Uint8Array,
  width: number, height: number,
  ops: { grow_px?: number; shrink_px?: number; feather_px?: number; blur_px?: number; threshold?: number }
): Uint8Array => {
  let result = mask;
  if (ops.threshold !== undefined) result = thresholdMask(result, ops.threshold);
  if (ops.grow_px) result = morphology(result, width, height, "dilate", ops.grow_px);
  if (ops.shrink_px) result = morphology(result, width, height, "erode", ops.shrink_px);
  if (ops.feather_px) result = featherEdge(result, width, height, ops.feather_px);
  if (ops.blur_px) result = gaussianBlur(result, width, height, ops.blur_px);
  return result;
};
```

For server-side execution (4K masks), `morphology` and `gaussianBlur` use `sharp` under the hood (CPU SIMD-accelerated). For tablet-side preview, we use Skia's image filters.

## 5. Selection ↔ mask conversion

```typescript
// libs/canvas-core/src/mask/selection-mask.ts
export function selectionToMask(selection: Selection, dims: { w: number; h: number }): Uint8Array {
  const mask = new Uint8Array(dims.w * dims.h);
  switch (selection.kind) {
    case "rect":
      fillRect(mask, dims, selection.rect, 255);
      break;
    case "mask":
      // copy from selection's mask image
      return decodeAlphaPng(selection.mask);
    case "none":
      break;
  }
  return mask;
}

export function maskToSelection(mask: Uint8Array, dims: { w: number; h: number }, threshold = 128): Selection {
  const binary = new Uint8Array(mask.map((v) => v >= threshold ? 255 : 0));
  return { kind: "mask", mask: encodeAsPng(binary, dims) };
}
```

## 6. Two-mask split (krita-ai-diffusion port)

```typescript
// libs/canvas-core/src/mask/two-mask-split.ts
export function buildTwoMasks(
  inputMask: Uint8Array,            // user's mask (selection or mask layer alpha)
  dims: { w: number; h: number },
  config: FillSubmodeConfig
): { denoising: Uint8Array; blend: Uint8Array } {
  // Denoising: inputMask grown by orange offset, with feather
  const denoising = refineMask(inputMask, dims.w, dims.h, {
    grow_px: config.denoise_offset_px,
    feather_px: config.feather_px,
  });
  // Blend: even larger, softer, for alpha composition
  const blend = refineMask(inputMask, dims.w, dims.h, {
    grow_px: config.blend_grow_px,
    feather_px: dims.w * (config.blend_feather_pct / 100),
  });
  return { denoising, blend };
}
```

`FillSubmodeConfig` comes from `comfyui-management/graph/fill-config.ts` (already specced in `generation-workflow` design.md §4).

## 7. Server handlers (representative)

```typescript
// libs/server/src/lib/handlers/refine-mask.ts
export const refineMaskHandler: Handler<typeof refineMask> = async (input, ctx) => {
  const layer = await ctx.layers.get(input.document_id, input.layer_id);
  if (layer.kind !== "mask" || layer.subkind !== "painted") {
    throw new ValidationError({ code: "INVALID_INPUT", field_path: "layer_id", message: "Target is not a painted mask layer" });
  }
  const original = await ctx.blobs.read(layer.content_blob_id);
  const refined = refineMask(original, layer.width, layer.height, input);
  const newBlobId = await ctx.blobs.write(refined);

  const command = buildCommand({
    tool_name: "refine_mask",
    document_id: input.document_id,
    args_summary: `Refine mask: ${summarizeOps(input)}`,
    weight: "medium",
    apply: async () => {
      await ctx.layers.update(input.document_id, input.layer_id, { content_blob_id: newBlobId });
      return { layer_id: input.layer_id };
    },
    revert: async () => {
      await ctx.layers.update(input.document_id, input.layer_id, { content_blob_id: layer.content_blob_id });
    },
  });

  return ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, input.document_id, command);
};
```

Other handlers follow the same Command pattern with appropriate revert.

## 8. Mask preview overlay (Skia)

```typescript
// libs/canvas-skia/src/overlay/mask-preview.ts
export class MaskPreviewOverlay {
  private cachedTinted: Map<LayerId, SkImage> = new Map();

  draw(canvas: SkCanvas, mask: PaintedMaskLayer | FromLayerMaskLayer, color: SkColor, opacity: number) {
    const tinted = this.getTinted(mask, color);
    const paint = Skia.Paint();
    paint.setAlphaf(opacity);
    paint.setBlendMode(BlendMode.SrcOver);
    canvas.drawImage(tinted, 0, 0, paint);
    // marching ants outline (animated dash) along mask boundary
    this.drawAntsOutline(canvas, mask);
  }

  private getTinted(mask: MaskLayer, color: SkColor): SkImage {
    // alpha-channel-only image with the chosen color (e.g., red)
    // cached; invalidated on mask content change
  }
}
```

Multiple visible mask previews render with `opacity = 0.5 / count` to blend; active editing forces full opacity (1.0).

## 9. Tool integration with `paint_strokes` / `paint_area`

When the active layer is a `painted` mask:
- `paint_strokes` interprets `color` field as greyscale: takes the green channel as alpha (0–255).
- Eraser mode (`paint_area({ mode: "erase" })`) sets to 0; "Add" mode sets to 255 with brush opacity multiplier.
- Pressure modulates alpha: a pressure 0.5 stroke writes alpha 128 (or higher if accumulated within stroke).

## 10. Tablet UX

### 10.1 Layer panel mask row

Mask layer row shows a small mask thumbnail (greyscale or red-tinted preview), plus:
- Eye icon: visibility toggle (affects clip masks, not preview).
- Preview toggle (mask icon with eye): toggles overlay.
- Lock toggle.
- Subkind badge: "Painted" or "From: <layer name>".

### 10.2 Mask refine mini-panel

When a `painted` mask is active, a "Refine" mini-panel docks near the layer panel with sliders:
- Grow (0–32 px)
- Shrink (0–32 px)
- Feather (0–32 px)
- Blur (0–32 px)
- Threshold (0–255)

Sliders preview the result on the canvas with reduced quality; commit on lift (single `refine_mask` call applies all non-zero values atomically).

### 10.3 Selection ↔ mask buttons

Toolbar buttons (when a selection is active or a mask layer is active):
- **Selection → Mask**: creates a mask layer from selection.
- **Mask → Selection**: sets selection from active mask.

## 11. Catalog impact

This spec adds 7 tools. Combined with `transform-tools` (+1), the v1 catalog reaches **46 tools**. We're updating `mcp-tool-catalog` FR-36 cap from 40 to **50** (Q1 resolution). Footprint NFR-3 (≤100 KB compiled) remains the hard gate; expected ~120 KB at 46 tools — must verify and trim descriptions if over.

**Action items for `mcp-tool-catalog` spec**:
- Update FR-36 cap to 50.
- Update §3.3.19 final tally.
- Add 7 mask tools + `transform_layer` to §3.3 sections (insert into appropriate domains).
- Re-run footprint test.

## 12. Acceptance criteria

1. Both mask kinds work end-to-end.
2. Selection ↔ mask conversion is lossless at threshold=128.
3. Two-mask split produces correct denoising/blend masks per krita-ai-diffusion behavior.
4. Catalog cap update applied; footprint ≤100 KB asserted.
5. Tablet UX: preview toggle, refine panel, selection↔mask buttons all functional.
6. `paint_strokes` writes alpha when target is a mask.
