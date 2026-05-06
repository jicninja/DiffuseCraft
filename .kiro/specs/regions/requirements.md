# regions — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`define_region`, `remove_region`), `canvas-fundamentals` (region layer kind), `control-layers` (per-region scope), `comfyui-management` (graph integration), `undo-redo-system`, `generation-workflow` (root + region prompt composition), krita-ai-diffusion `ai_diffusion/region.py`.
> **References:** P11 (regions-as-areas).

## 1. Purpose

Define the **regions system** — per-area prompts that compose into the final generation. A region is a (paint-layer, prompt, optional control layers) tuple where the **paint layer's opacity** defines spatial coverage, the **prompt** is concatenated with the document's root prompt within that area, and **control layers scoped to the region** apply only there.

Regions are the primary mechanism for **compositional generation**: the user paints "here goes a robot" and "there goes a samurai" rather than prompt-juggling everything into a single text.

## 2. Stakeholders & user stories

### S1 — Illustrator composing a two-character scene
> **Story 1.** As an illustrator, I paint a left silhouette and a right silhouette on two paint layers. I long-press each → "Define region from this layer" → enter a prompt for each ("robot warrior, neon" / "samurai, ink wash"). I write a root prompt ("cinematic lighting, high contrast"). I generate; the AI honors each region's prompt within its area, with the root prompt globally.

### S2 — Illustrator with regional style references
> **Story 2.** As an illustrator from Story 1, I add a Style control layer to the left region (cyberpunk reference) and a different Style control to the right region (sumi-e reference). The model honors per-region style.

### S3 — Illustrator inpainting on top of regions
> **Story 3.** As an illustrator with the above scene generated, I lasso a small area inside the left region. I trigger Fill. The Fill applies only the regions whose coverage overlaps my selection — only the left region's prompt + control are used.

### S4 — Agent setting up regions programmatically
> **Story 4.** As Claude Code, I `define_region({ paint_layer_id, prompt })` for each subject layer. Subsequent `generate_image` honors them automatically.

### S5 — Region with no prompt (control-only)
> **Story 5.** As an illustrator, I want a region defined only by control layers (e.g., a face-reference applied only to a head area) without altering the prompt for that area. I create a region with empty `prompt` and add a Face control layer scoped to it.

## 3. Functional requirements (EARS)

### 3.1 Region data model

**FR-1 (Ubiquitous).** A `Region` SHALL have: `id` (ULID), `document_id`, `paint_layer_id` (the layer whose alpha defines coverage), `prompt` (string, English per P23), `negative_prompt?` (optional), `name`, `created_at`. Plus computed/derived fields: `coverage_mask` (lazily computed from `paint_layer_id`'s alpha + layer-stacking rules).

**FR-2 (Ubiquitous).** Each paint layer can have **at most one** associated region. Attempting to define a second region for the same `paint_layer_id` returns `REGION_ALREADY_EXISTS`.

**FR-3 (Ubiquitous).** Regions are associated with paint layers only. Mask, control, and other layer kinds cannot anchor a region.

**FR-4 (Ubiquitous).** Document SHALL have a `root_prompt` field (string). Default: empty. Stored per-document.

### 3.2 Coverage rules

**FR-5 (Ubiquitous).** A region's **coverage** at any pixel = the paint layer's effective alpha at that pixel after layer-stacking compositing. "Effective alpha" means: a layer hidden by a higher visible opaque layer contributes 0 to its region's coverage in that area.

**FR-6 (Ubiquitous).** Coverage SHALL be computed at generation time, not stored eagerly. When the source paint layer changes (paint stroke, transform, opacity, visibility), the coverage is invalidated; next generation recomputes.

**FR-7 (Ubiquitous).** Coverage SHALL be normalized to 0–1; values below a threshold (default 0.05) are treated as "not covered" (excluded from the region's effective area).

**FR-8 (Ubiquitous).** When two regions' coverages overlap on the same pixel, the diffusion graph applies **both** prompts at that pixel — they accumulate (typical practice in regional prompting). The user can mitigate by adjusting paint layer alpha or using exclusive layer stacking.

### 3.3 Prompt composition

**FR-9 (Ubiquitous).** During generation, for each pixel inside any region's coverage, the **effective prompt** is: `<root_prompt> + ", " + <region.prompt>` (concatenation with comma separator). For pixels in multiple regions: `root + ", " + region_A.prompt + ", " + region_B.prompt`.

**FR-10 (Ubiquitous).** For pixels not covered by any region, only `root_prompt` applies.

**FR-11 (Ubiquitous).** When `region.prompt` is empty, only the root prompt applies in that region's coverage; the region exists only for control-layer scoping (Story 5).

**FR-12 (Ubiquitous).** Negative prompts SHALL compose analogously: root negative + region negative.

### 3.4 Control layers per region (cross-spec with `control-layers`)

**FR-13 (Ubiquitous).** Control layers MAY be scoped to specific regions via `control_layer.region_scope: RegionId[]` (already in `control-layers` FR-11). When generating, controls scoped to a region apply only inside that region's coverage.

**FR-14 (Ubiquitous).** Reference-family control layers (Reference / Style / Composition / Face) per krita-ai-diffusion are the most common case for per-region scoping. Structural controls (ControlNet) per region are valid but less common.

**FR-15 (Ubiquitous).** Tablet UI surfaces "Add control to this region" entry on the region's settings sheet.

### 3.5 Selection-region overlap (Fill semantics)

**FR-16 (Ubiquitous).** When a Fill / Refine operation runs with an active selection, ONLY the regions whose coverage overlaps the selection (above a configurable threshold, default 5% of region pixels in selection) apply. Other regions are dormant for that pass.

**FR-17 (Ubiquitous).** This matches krita-ai-diffusion: a localized inpaint inside one region picks up that region's prompt + controls, not other regions'.

### 3.6 MCP tools and resources

**FR-18 (Ubiquitous).** Tools (already partially in catalog):
- `define_region({ document_id?, paint_layer_id, prompt, negative_prompt?, name? })` — write, reversible. Returns `region_id`.
- `update_region({ region_id, prompt?, negative_prompt?, name? })` — write, reversible. New tool added by this spec.
- `remove_region({ region_id })` — write, reversible.
- `set_root_prompt({ document_id?, root_prompt, root_negative_prompt? })` — write, reversible. New tool added by this spec.

**FR-19 (Ubiquitous).** Resource: `diffusecraft://regions/list?document_id=...` returns regions with summary fields including a thumbnail of the source paint layer.

**FR-20 (Ubiquitous).** Resource: `diffusecraft://document/<id>/root-prompt` returns `{ root_prompt, root_negative_prompt }`.

**FR-21 (Ubiquitous).** Catalog impact: 2 new tools (`update_region`, `set_root_prompt`). Catalog ~57 — **exceeds current cap of 55**. Cap raised to **60** in tasks (Q1 below).

### 3.7 Tablet UX

**FR-22 (Ubiquitous).** Region creation flow:
1. User long-presses a paint layer in the panel → context menu.
2. "Define region from this layer" → opens a small sheet with a prompt input field + optional negative + name.
3. User types prompt and hits "Create". Region is added.

**FR-23 (Ubiquitous).** Regions panel: a sub-section of the layer panel (or a tab next to "Layers") shows all defined regions for the active document. Each row:
- Coverage thumbnail (paint layer's alpha rendered as a silhouette).
- Region name (defaults to "Region N" or prompt prefix).
- Compact display of the prompt (truncated).
- Tap → opens settings sheet (full prompt editor + controls list + delete).

**FR-24 (Ubiquitous).** Root prompt input: persistent at the top of the document UI (single-line collapsed; expands to multiline on focus). Updates via `set_root_prompt`.

**FR-25 (Ubiquitous).** Region overlay preview: tapping a region row shows its coverage faded over the canvas (similar to mask preview, different color — say cyan) so the user visually confirms which area gets the prompt.

**FR-26 (Ubiquitous).** When the source paint layer is deleted, the dependent region(s) become orphaned. Server transitions them to `orphaned: true`; UI shows them with a warning indicator and a "remove" button.

### 3.8 ComfyUI graph integration

**FR-27 (Ubiquitous).** The `comfyui-management/graph/helpers/regions.ts` builder consumes the document's regions and:
1. Computes each region's coverage mask.
2. Builds a separate text-conditioning node per region (root + region prompt).
3. Uses `ConditioningSetMask` (or equivalent) to apply each region's conditioning to its coverage mask.
4. Combines region conditionings with the root-only conditioning (for uncovered area) using `ConditioningCombine`.

**FR-28 (Ubiquitous).** When `region_ids` is explicitly provided in `generate_image` input, only those regions are used (others are ignored even if defined). When omitted, all defined regions for the active document are used.

**FR-29 (Ubiquitous).** When a Fill / Refine operation has an active selection (FR-16), the graph builder filters regions to those overlapping the selection, then proceeds as above.

### 3.9 Performance

**FR-30 (Ubiquitous).** Coverage mask computation for one region on a 4K canvas: ≤ 100 ms (pure alpha read + composite).

**FR-31 (Ubiquitous).** Generation graph with up to 8 regions: graph construction ≤ 200 ms (excludes ComfyUI inference time).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Regions are persisted in SQLite; orphan regions GC'd by `generation-history` GC pass when paint layer is deleted ≥7 days.

**NFR-2 (Ubiquitous).** Maximum regions per document: 16 (configurable). Beyond → `TOO_MANY_REGIONS`.

## 5. Out of scope

- **Per-region negative-prompt-only mode** (no positive prompt) — works (FR-12) but not an explicit UX feature.
- **Per-region seed override** (different seed per region). Post-v1.
- **Per-region model override** (different checkpoint per region). Post-v1; complex.
- **Animated regions** (changing coverage over time). Out of scope.
- **Vector-defined regions** (paths instead of paint layers). Post-v1.

## 6. Open questions

### Q1 — Catalog cap raise
Adding 2 tools pushes catalog past 55.

**Recommendation:** **raise cap to 60** in `mcp-tool-catalog` FR-36. Footprint NFR-3 (≤100 KB) remains the actual hard gate. Update accordingly.

### Q2 — How is `set_root_prompt` reversibility handled?
Root prompt is a single string; revert restores prior value. Trivial Command.

**Recommendation:** standard Command pattern with `previousRoot` captured.

### Q3 — Should "tap region to focus" also auto-set the active layer to the region's paint layer?
Convenience.

**Recommendation:** **yes**. Tapping a region row sets active layer to its `paint_layer_id`. User can still switch layer manually after.

### Q4 — Coverage threshold for "not covered" — fixed 0.05 or user-configurable?
Edge case for very faint paint layers.

**Recommendation:** **fixed 0.05 in v1.** Configurable in server config, not in UI.

### Q5 — Multiple regions on the same paint layer (different prompts in different alpha bands)?
Photoshop-style multi-tone mask.

**Recommendation:** **no in v1.** One region per paint layer. Use multiple paint layers if you need finer composition.

### Q6 — When a region is removed, does the source paint layer also get deleted?
No — paint layers are independent of regions.

**Recommendation:** **explicit**. `remove_region` removes only the region record; the paint layer stays. Tablet UI confirms this in the delete dialog.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized end-to-end.
2. Coverage computation correctly reflects layer-stacking.
3. Prompt composition (root + region) produces correct effective prompts per area.
4. Selection-region overlap filtering works for Fill / Refine.
5. Per-region control layers integrate correctly via `control_layer.region_scope`.
6. Catalog impact ≤60 tools (cap raised).
7. Open questions have acceptable recommendations.
