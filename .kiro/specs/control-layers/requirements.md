# control-layers — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`add_control_layer`, `remove_control_layer`), `canvas-fundamentals` (control layer kind), `comfyui-management` (graph integration), `undo-redo-system`.
> **References:** P10 (control-layers-as-layers), krita-ai-diffusion `ai_diffusion/control.py`, ComfyUI custom nodes (`comfyui_controlnet_aux`, `ComfyUI_IPAdapter_plus`).

## 1. Purpose

Define the **control layer system** — the layer types that contribute guidance to AI generation rather than visible pixels. Two families:

1. **Reference (IP-Adapter)** — creative guidance: Reference, Style, Composition, Face. The model treats these as "soft prompts" on top of the text prompt.
2. **Structural (ControlNet)** — pixel-aligned guidance: Scribble, Line Art, Soft Edge, Canny, Depth, Normal, Pose, Segmentation, Unblur, Stencil. The model preserves spatial features from these inputs.

This spec defines:
- The 14 control-layer types and their semantics.
- Source-image acquisition (paint or external image).
- The **preprocessing pipeline** (e.g., extracting Canny edges or pose stick figures from a source image).
- Per-region scope (control layer can apply globally or only to certain regions).
- Strength / weight per layer.
- Tablet UX (add control layer flow, preview rendered preprocessor output).
- ComfyUI graph integration semantics.

## 2. Stakeholders & user stories

### S1 — Illustrator using a sketch as guidance
> **Story 1.** As an illustrator, I sketch a figure on a paint layer with the Pen brush. I tap "Use as control → Scribble". The system creates a Scribble control layer from my sketch (preprocesses if needed). Subsequent Generate uses my sketch as the structural input.

### S2 — Illustrator referencing a style
> **Story 2.** As an illustrator wanting a specific style, I import a reference image. I tap "Use as control → Style". The system creates a Style control layer (IP-Adapter); the AI inherits stylistic features without copying pixels.

### S3 — Illustrator with multiple controls
> **Story 3.** As an illustrator, I have a Pose control (stick figure for character pose), a Style control (reference image for art style), and a Scribble control (rough composition). All three apply globally; AI honors all. I adjust each layer's weight slider.

### S4 — Illustrator with regional control
> **Story 4.** As an illustrator with two regions ("character" and "background"), I want a different style per region. I create two Style control layers, each scoped to one region. AI applies each style only within its region.

### S5 — Agent setting up a generation
> **Story 5.** As Claude Code, I `add_control_layer({ type: "depth", source_image: <ref>, strength: 0.8 })` to inject depth guidance. The server runs the Depth preprocessor on the source if needed; the layer is available for the next `generate_image`.

### S6 — User adjusting control weight live
> **Story 6.** As an illustrator, I drag a control layer's strength slider during a non-active state — the AI re-uses this control on the next generate. Slider changes are persisted with the layer.

## 3. Functional requirements (EARS)

### 3.1 Control layer types and families

**FR-1 (Ubiquitous).** v1 SHALL support 14 control-layer types in two families:

| Family | Type | Description | Underlying |
|---|---|---|---|
| Reference | `reference` | Generic "use this image as reference" | IP-Adapter |
| Reference | `style` | Stylistic features only | IP-Adapter (style-only mode) |
| Reference | `composition` | Composition / layout | IP-Adapter (composition-only mode) |
| Reference | `face` | Face features for character consistency | IP-Adapter Face / InstantID |
| Structural | `scribble` | Hand-drawn sketches | ControlNet Scribble |
| Structural | `line_art` | Clean line drawings | ControlNet Lineart |
| Structural | `soft_edge` | Soft edges (HED, PiDiNet) | ControlNet Soft-Edge |
| Structural | `canny` | Canny edges | ControlNet Canny |
| Structural | `depth` | Depth map | ControlNet Depth |
| Structural | `normal` | Normal map | ControlNet Normal |
| Structural | `pose` | OpenPose stick figure | ControlNet OpenPose |
| Structural | `segmentation` | Semantic segmentation | ControlNet Seg |
| Structural | `unblur` | Blurred → sharp | ControlNet Tile/Unblur |
| Structural | `stencil` | B/W stencil | ControlNet QR / Brightness-style |

**FR-2 (Ubiquitous).** Each control layer SHALL have: `id` (ULID), `kind: "control"`, `type` (one of 14 above), `family: "reference" | "structural"`, `source_blob_id` (the image that drives it), `preprocessed_blob_id?` (the post-preprocess image used for inference), `strength` (0–2, default 1), `start_step?` (0–1, when in diffusion process this control engages), `end_step?` (0–1, when it disengages), `region_scope?` (RegionId[] | null = global), `name`, plus standard layer fields (position, opacity has no effect for control, visible toggles preview).

### 3.2 Source acquisition

**FR-3 (Ubiquitous).** A control layer's `source_blob_id` can come from:
- An **existing paint layer** (`add_control_layer({ type, source_layer_id })` → uses that layer's content).
- An **imported image** (`add_control_layer({ type, source_image: ImageEnvelope })`).
- A **selection from the document composite** (`add_control_layer({ type, source: { kind: "selection" } })`).

**FR-4 (Ubiquitous).** When `source_layer_id` is provided, the control layer **references** the paint layer; if the paint layer changes, the control layer's `preprocessed_blob_id` is invalidated and recomputed on next use.

### 3.3 Preprocessing pipeline

**FR-5 (Ubiquitous).** Most structural types require **preprocessing**: the source image goes through a model that extracts the structural feature. Mappings:

| Type | Preprocessor (ComfyUI custom node) |
|---|---|
| `scribble` | Already a sketch; minor cleanup (HED-based scribble preprocessor) |
| `line_art` | LineArt preprocessor |
| `soft_edge` | HED / PiDiNet |
| `canny` | Canny edge detector (configurable thresholds) |
| `depth` | MiDaS / DPT (depth estimator) |
| `normal` | Normal-map estimator |
| `pose` | OpenPose / DWPose detector |
| `segmentation` | Segformer / similar segmentation model |
| `unblur` | None (source IS the blurred image) |
| `stencil` | None (source IS the stencil) |
| `reference` / `style` / `composition` / `face` | None (IP-Adapter consumes raw image directly) |

**FR-6 (Event-driven).** WHEN a control layer is added with a source that needs preprocessing, THE server SHALL:
- Run the appropriate ComfyUI preprocessing graph asynchronously.
- Store the result as `preprocessed_blob_id`.
- Emit `control_layer.preprocessed` event with `{ layer_id, status: "success" | "failure", error? }`.

**FR-7 (Ubiquitous).** Preprocessing SHALL be **cached**: the same source image hash + same type + same preprocess params → reuse cached result. Cache TTL 1 hour or until source changes.

**FR-8 (Ubiquitous).** Preprocessor parameters MAY be exposed: e.g., Canny low/high thresholds, depth model selection. v1 ships sane defaults; advanced override is post-v1.

### 3.4 Strength, start/end steps, and per-region scope

**FR-9 (Ubiquitous).** `strength` is multiplied with the control's effective weight in the diffusion graph. `0` = effectively disabled; `1` = standard; `>1` = over-emphasis.

**FR-10 (Ubiquitous).** `start_step` and `end_step` define a sub-range of the diffusion process during which the control engages. Default: `0..1` (entire process). Useful for "structure early, detail late" workflows.

**FR-11 (Ubiquitous).** `region_scope: RegionId[] | null`:
- `null` (default) → applies to entire generation.
- non-empty array → applies only when generating those regions; outside regions, this control is inactive.

**FR-12 (Ubiquitous).** When multiple control layers of the **same type** exist with overlapping region scopes, the diffusion graph applies all of them; their weights add up. UI surfaces a warning when total weight per region per type exceeds 2 (likely over-control).

### 3.5 MCP tools and resources

**FR-13 (Ubiquitous).** Tools (`add_control_layer` and `remove_control_layer` already in catalog from `mask-system` flow). This spec extends `add_control_layer`'s schema:

```typescript
add_control_layer({
  document_id?,
  type: ControlLayerType,
  source: { kind: "layer", layer_id } | { kind: "image", image: ImageEnvelope } | { kind: "selection" },
  strength?: number,                      // default 1
  start_step?: number,                    // default 0
  end_step?: number,                      // default 1
  region_scope?: RegionId[],              // default global
  name?: string,
  preprocess_params?: object,             // e.g., canny: { low: 100, high: 200 }
})
```

**FR-14 (Ubiquitous).** New tool `regenerate_control_preprocess({ layer_id, preprocess_params? })` (write, reversible) — re-runs preprocessing with optionally different params.

**FR-15 (Ubiquitous).** Resource `diffusecraft://control-layers/list?document_id=...` returns control layers with summary fields including `preprocessed_thumbnail_ref`.

**FR-16 (Ubiquitous).** Catalog impact: 1 tool added (`regenerate_control_preprocess`). Catalog ~55 tools (at cap).

### 3.6 ComfyUI graph integration

**FR-17 (Ubiquitous).** The graph builder (`comfyui-management/graph/helpers/control-layers.ts`) consumes the document's active control layers (filtered by region scope when applicable) and attaches the appropriate ControlNet / IP-Adapter nodes:
- For Structural: `ControlNetApply` chain with the preprocessed image and weight.
- For Reference: `IPAdapterApply` chain with the source image and weight.

**FR-18 (Ubiquitous).** Graph builder honors `start_step` / `end_step` via ControlNet's `start_percent` / `end_percent` parameters.

**FR-19 (Ubiquitous).** Maximum simultaneous control layers per generation: 8 (configurable). Beyond → server rejects with `TOO_MANY_CONTROL_LAYERS`. UI surfaces this limit before submission.

### 3.7 Tablet UX

**FR-20 (Ubiquitous).** "Add Control Layer" entry point: long-press an existing paint layer → "Use as control → [type picker]". Or via the layer panel "+" → Control Layer → type picker.

**FR-21 (Ubiquitous).** Control layer row in panel shows:
- Type icon + name.
- Preprocessed thumbnail.
- Strength slider (compact, on-row).
- Region badge if scoped (e.g., "Region: character").
- Visibility toggle = preview of preprocessed image overlaid on canvas.

**FR-22 (Ubiquitous).** Long-press → settings panel: full strength + start/end step sliders, preprocess params (when applicable), region scope picker.

**FR-23 (Ubiquitous).** Preview: tapping the visibility toggle shows the preprocessed image faded over the canvas; useful for validating that pose/depth/canny extraction worked correctly.

**FR-24 (Ubiquitous).** When the source paint layer changes, the control layer row shows a "regenerate" indicator; tap → `regenerate_control_preprocess`.

### 3.8 Performance

**FR-25 (Ubiquitous).** Preprocessing latency on 1024×1024 source (warm pool):
- Canny: ≤ 200 ms
- Line Art / Soft Edge: ≤ 500 ms
- Depth (MiDaS / DPT): ≤ 800 ms
- Pose (OpenPose / DWPose): ≤ 1 s
- Segmentation: ≤ 1.5 s

Cold-start adds 1–3 s for first-time model load.

**FR-26 (Ubiquitous).** Reference-family (IP-Adapter) layers don't need preprocessing — added in <100 ms.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Each preprocessor is a ComfyUI custom node from `comfyui_controlnet_aux` or `ComfyUI_IPAdapter_plus` packages, pinned by hash (per `comfyui-management/required-nodes.ts`).

**NFR-2 (Ubiquitous).** Preprocessing models are kept in the warm pool when an active document has at least one control layer of that type.

**NFR-3 (Ubiquitous).** Catalog impact: 1 tool added; cap 55 reached (this is the last tool that fits before next cap raise).

## 5. Out of scope

- **Custom preprocessor models** (user-supplied). Use ComfyUI extensions for that.
- **Per-control-step independent strength** (e.g., variable weight per diffusion step). Post-v1.
- **Mixing IP-Adapter + ControlNet weights interactively at runtime** beyond a single weight slider. Post-v1.
- **Multi-image IP-Adapter** (averaging multiple references). Post-v1.
- **Control-layer keyframing** (animation). Out of scope for v1 (animation workspace is post-v1).

## 6. Open questions

### Q1 — Should the user be able to paint directly on a control layer (e.g., touch up a generated pose)?
Pose stick figures are vector-ish; user might want to drag joints.

**Recommendation:** **no in v1.** Edit the source paint layer or import a different image. Direct paint on control layers is post-v1 (would need vector pose editor).

### Q2 — What if preprocessing fails (model not installed, OOM, etc.)?
Generation can't proceed without the preprocessed image.

**Recommendation:** the control layer is created with `preprocess_status: "failed"`; UI marks it red; generation **excludes** failed control layers and proceeds (with warning) rather than blocking entirely.

### Q3 — Auto-detect best control type from source image?
A user adds an image; the system suggests "looks like a sketch — Scribble?".

**Recommendation:** **post-v1** — interesting but adds ML complexity. v1 = explicit type pick.

### Q4 — Should `start_step` / `end_step` be exposed in the basic UI or only in advanced?
Most users won't tune these.

**Recommendation:** **advanced settings only** (long-press → settings). Basic UI shows just strength.

### Q5 — Reference-family with multiple sources averaged
A user wants "style of A + B"; can they combine?

**Recommendation:** **post-v1.** v1 = one source per control layer; user can stack two Style controls if they want overlap.

### Q6 — Caching preprocessed blobs across documents
The same source image used in two documents → preprocess once?

**Recommendation:** **yes, content-hash-keyed cache** (per FR-7). Cross-document, cross-session sharing within the server's blob store.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The six user stories (§2) work end-to-end.
2. All 14 control types have a working preprocessing path (or no-preprocess for Reference family + Unblur + Stencil).
3. Strength, start/end steps, region scope work correctly in the graph.
4. Tablet UX surfaces preview + strength + advanced settings.
5. Catalog impact ≤55 tools.
6. Open questions have acceptable recommendations.
