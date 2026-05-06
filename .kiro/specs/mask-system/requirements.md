# mask-system — Requirements

> **Status:** Draft v0.1.
> **Tier 2 — DECENT.** Used heavily for AI gating; not Photoshop's quick-mask depth.
> **Depends on:** `canvas-fundamentals` (mask layer kind), `undo-redo-system`, `mcp-tool-catalog`, `comfyui-management/graph/helpers/selection-masks.ts` (krita-ai-diffusion port), `selection-tools` (selection→mask conversion).
> **References:** krita-ai-diffusion `ai_diffusion/selection.py` (denoising vs blend mask), editor philosophy (collage + light sketch), P10, P27.

## 1. Purpose

Define the **mask system** — alpha-only layers and runtime mask construction — used to:

1. **Constrain AI generation** to a region of the canvas (inpaint, fill, region-bound generation).
2. **Clip painting and edits** to a region.
3. **Compose** layers via mask-as-alpha in collage workflows.

A mask in DiffuseCraft is **always single-channel alpha** (0–255). Color masks are out of scope.

This spec defines:
- The two mask layer types (`mask` painted, `mask-from-layer` derived).
- Mask paint operations (brush-paintable masks).
- The two-mask split (denoising mask + blend mask) inherited from krita-ai-diffusion.
- Mask preview overlays on the tablet.
- MCP tools for mask operations.
- Integration with selection (selection→mask, mask→selection).

## 2. Stakeholders & user stories

### S1 — Illustrator gating an AI fill
> **Story 1.** As an illustrator, I lasso a region on my canvas, then tap "Make Mask" → the selection becomes a new mask layer. I refine the mask edge by painting on it with the brush. I trigger Fill — the AI sees my mask, generation is bound to the painted region.

### S2 — Illustrator masking a paint layer for collage
> **Story 2.** As an illustrator, I have a sky paint layer that I want to fade out at the bottom. I add a mask layer on top, paint a gradient on it. The sky fades out. I generate using this composite as control input — the AI sees the masked composite.

### S3 — Illustrator using a layer's alpha as a mask elsewhere
> **Story 3.** As an illustrator, I have a paint layer with a character cut-out (alpha-only outside the character). I want to constrain a Fill to "everything except the character." I create a `mask-from-layer` referring to the character layer, invert it, and use it for the Fill mask.

### S4 — Agent setting up a fill operation
> **Story 4.** As Claude Code preparing an inpaint, I `set_selection({ kind: "mask", mask: <ImageEnvelope> })` to install a precise mask. Then I call `generate_image` with `selection_mode: "Fill"`. The mask is pre-positioned for the operation.

### S5 — Multi-step refinement
> **Story 5.** As an illustrator, I painted a mask but it's too sharp at the edges. I tap "Refine Mask" → grow 3px, feather 5px, blur 2px. The mask softens; I see the preview update live.

## 3. Functional requirements (EARS)

### 3.1 Mask layer types

**FR-1 (Ubiquitous).** v1 SHALL support two mask kinds (sub-types of `kind: "mask"` from `canvas-fundamentals`):

| Sub-kind | Source | Editable directly? |
|---|---|---|
| `painted` | Stored alpha bytes (in `content_blob_id`) | Yes — paint with brush, fill, erase |
| `from_layer` | Reference to another layer's alpha (or paint-content luminance) | No — implicit; modify by editing the source layer |

**FR-2 (Ubiquitous).** Mask layers SHALL be added via `add_layer({ kind: "mask", subkind: "painted" \| "from_layer", source_layer_id?, invert? })`.

**FR-3 (Ubiquitous).** Mask layers do NOT render as visible content on the composited canvas. They influence the canvas only when:
- Used as a clip mask for a paint layer (`paint_layer.clip_mask = { source_layer_id }`).
- Used as a generation mask (selection from mask, region coverage from mask, control-layer mask).
- Previewed via the **mask preview overlay** when toggled.

### 3.2 Mask preview / visibility on tablet

**FR-4 (Ubiquitous).** A mask layer in the layers panel has a "Preview" toggle. When ON:
- The mask is rendered as a **red translucent overlay** on the canvas, where alpha=255 → fully red, alpha=0 → no overlay.
- A small marching-ants outline around the mask's effective boundary.

**FR-5 (Ubiquitous).** When the user is **actively editing** a mask layer (selected as active, brush tool active), the preview is forced ON regardless of the toggle. After deselect, the toggle's state takes over.

**FR-6 (Ubiquitous).** The user MAY switch the overlay color via per-document preference (red default; alternative: green, blue, custom). Affects display only, not data.

### 3.3 Mask paint operations

**FR-7 (Ubiquitous).** When the active layer is a `painted` mask, brush operations (`paint_strokes`, `paint_area` per `brush-system`) write to the alpha channel:
- Brush color is **always greyscale** (interpreted as alpha): white = add to mask, black = subtract.
- Eraser tool subtracts (same as black brush).
- Pressure modulates alpha intensity (per `brush-system`).

**FR-8 (Ubiquitous).** Mask "Refine" tool (single combined operation): `refine_mask({ layer_id, grow_px?, shrink_px?, feather_px?, blur_px?, threshold? })`. Each parameter optional; missing = no-op. Reversible.

**FR-9 (Ubiquitous).** Mask invert (`invert_mask({ layer_id })`): swaps 0↔255. Reversible.

**FR-10 (Ubiquitous).** Mask clear (`clear_mask({ layer_id })`): sets all to 0. Reversible.

**FR-11 (Ubiquitous).** Mask fill (`fill_mask({ layer_id, value: 0..255 })`): sets all to value. Reversible.

### 3.4 Selection ↔ mask conversion

**FR-12 (Ubiquitous).** `selection_to_mask({ document_id?, layer_id? (target), name? })`: creates a new `painted` mask layer from the active selection. If `layer_id` is provided, replaces that mask's content; otherwise creates a new mask. Reversible.

**FR-13 (Ubiquitous).** `mask_to_selection({ mask_layer_id, threshold?: 0..255 })`: sets the active selection from a mask layer's content (alpha ≥ threshold becomes selected). Reversible (registers a selection-set Command).

**FR-14 (Ubiquitous).** Both directions SHALL be lossless when the threshold is 128 and the source mask uses pure 0/255 values.

### 3.5 Layer-to-mask derivation (`mask-from-layer`)

**FR-15 (Ubiquitous).** A `from_layer` mask references a paint layer and uses one of:
- **alpha** (default): the source's alpha channel.
- **luminance**: greyscale conversion of the source's RGB.

**FR-16 (Ubiquitous).** A `from_layer` mask can be **inverted** via the `invert: true` field at creation time or later toggled.

**FR-17 (Ubiquitous).** When the source paint layer changes, the derived mask updates automatically — the mask is computed at use time, not pre-rasterized.

**FR-18 (Ubiquitous).** A `from_layer` mask CAN be "baked" into a `painted` mask via `bake_mask({ layer_id })` — converts the dynamic derivation to a static painted mask. Reversible.

### 3.6 Two-mask split for AI generation (krita-ai-diffusion port)

For inpaint / fill operations, the server constructs two distinct masks per krita-ai-diffusion:

**FR-19 (Ubiquitous).** **Denoising mask**: controls where the diffusion model is allowed to alter pixels. Built from selection or active mask layer. Includes the krita-ai-diffusion "orange offset" (a small region just outside the selection where denoising fades to avoid hard edges).

**FR-20 (Ubiquitous).** **Blend mask**: controls alpha composition of the result onto the original. Larger and softer than the denoising mask. Defines the smooth boundary where AI result blends into surrounding pixels.

**FR-21 (Ubiquitous).** Both masks are **derived server-side** from the user's input mask (or selection) at job submission time. The user does not author them separately — they author **one** mask, the server expands it.

**FR-22 (Ubiquitous).** The transformation parameters (orange offset px, feather %, blend size) come from:
- The selected `selection_mode` config (`comfyui-management/graph/fill-config.ts`).
- A user override via `mask_settings` field of `generate_image` (post-v1; v1 uses defaults).

### 3.7 MCP tools added by this spec

This spec adds the following tools to v1 catalog (incrementing tool count past `transform-tools`'s promotion):

| Tool | Category | Reversible | Purpose |
|---|---|---|---|
| `refine_mask` | write | yes | Grow / shrink / feather / blur a mask in one op. |
| `invert_mask` | write | yes | Invert mask 0↔255. |
| `clear_mask` | write | yes | Set all to 0. |
| `fill_mask` | write | yes | Set all to value. |
| `selection_to_mask` | write | yes | Active selection → mask layer. |
| `mask_to_selection` | write | yes | Mask layer → active selection. |
| `bake_mask` | write | yes | Convert `from_layer` mask to `painted`. |

**FR-23 (Ubiquitous).** All seven tools added to `@diffusecraft/mcp-tools` catalog. Total v1 catalog count after this + transform-tools: **46 tools**. Update `mcp-tool-catalog` accordingly. (Still under FR-36 cap of 40? **No — exceeds**; we need to revisit either the cap or split tools further. See open question Q1.)

### 3.8 Integration with `paint_strokes` / `paint_area`

**FR-24 (Ubiquitous).** When `paint_strokes` is invoked with a mask layer as target, the server interprets brush color as greyscale alpha (per FR-7). Brush color input range still 0–255 RGBA, but G is the only channel honored; R+B converted to G via luminance.

**FR-25 (Ubiquitous).** `paint_area` on a mask layer fills with greyscale alpha; `mode: "erase"` subtracts.

### 3.9 Performance & memory

**FR-26 (Ubiquitous).** Painted masks SHALL be stored at the document's full resolution. A 4096×4096 mask = 16 MB raw; compressed PNG typically 1–4 MB. Storage budget per `generation-history` retention applies.

**FR-27 (Ubiquitous).** Mask preview overlay rendering SHALL not drop framerate below 60 FPS at 4096×4096 mask on iPad Pro M-class.

### 3.10 Multi-client coordination

**FR-28 (Ubiquitous).** Mask edits from another client emit `document.changed` with `affected_layer_ids: [mask_layer_id]`; local client refreshes its mask cache.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Mask paint roundtrip (stroke → render preview) latency SHALL be ≤ 50 ms on iPad Pro M-class.

**NFR-2 (Ubiquitous).** Mask refinement (grow/shrink/feather/blur) for a 4096×4096 mask SHALL complete server-side in ≤ 500 ms.

**NFR-3 (Ubiquitous).** Mask thumbnails for the layer panel SHALL be 256 px previews using greyscale colormap (or red overlay).

## 5. Out of scope

- **Color masks** (RGB-channel masks). v1 is alpha-only.
- **Vector masks**. Post-v1.
- **Quick mask mode** (Photoshop-style temporary mask painting). v1 uses explicit mask layers.
- **Channel masks** (separate alpha channels per layer for multi-mask scenarios). v1: one mask layer = one mask.
- **Mask compositor** (combining multiple masks via boolean ops as a layer). Post-v1.

## 6. Open questions

### Q1 — Catalog tool count (now exceeds FR-36 cap of 40)
After `transform-tools` (+1) and `mask-system` (+7), the catalog reaches 46 tools. The cap was set in `mcp-tool-catalog` FR-36.

**Recommendation:** **raise the cap to 50** in `mcp-tool-catalog` and update FR-36 accordingly. 46 tools is still small relative to GitHub MCP / Linear MCP catalogs (which exceed 60). The footprint NFR-3 (≤100 KB) is the hard constraint, not tool count. Update `mcp-tool-catalog` requirements and design.

### Q2 — Should mask painting use a separate brush UI or share the brush palette?
Same brushes, different interpretation (greyscale = alpha)?

**Recommendation:** **share brush palette** (same tools per `brush-system`). Mask context auto-converts brush color to greyscale alpha. Simpler UX; fewer panels.

### Q3 — `from_layer` mask: should it support per-channel selection (e.g., red channel only)?
Photoshop allows that.

**Recommendation:** **no in v1**. Just `alpha` and `luminance`. Per-channel post-v1 if needed.

### Q4 — Should `refine_mask` be one tool or split (`grow_mask`, `feather_mask`, etc.)?
Split would be 4–5 tools instead of 1.

**Recommendation:** **single `refine_mask` with optional fields**. Keeps catalog small. Per FR-8.

### Q5 — Bake `from_layer` mask: when does the user need this?
Use case: source layer might be deleted/changed; user wants a stable copy.

**Recommendation:** keep the `bake_mask` tool but document that it's for power users. UI long-press menu option.

### Q6 — Preview overlay on multiple visible mask layers
If two mask layers have Preview ON, they overlap.

**Recommendation:** **render both with reduced opacity** (each at 0.5×); user can identify which is which by the mask layer's selection state in the panel.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized.
2. Both mask kinds (`painted`, `from_layer`) work as specified.
3. Selection ↔ mask conversion is lossless at threshold=128.
4. Two-mask AI split (denoising + blend) is implemented per krita-ai-diffusion semantics.
5. Seven new tools added to v1 catalog with the cap raised to 50 (Q1).
6. Mask painting shares the brush palette per Q2.
7. Performance and memory budgets are met.
