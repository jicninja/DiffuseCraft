# generation-workflow — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (the `generate_image` tool), `server-architecture` (the dispatcher), `comfyui-management` (graph builders).
> **References:** P9 (strength-driven verb switching), P8 (preview-then-apply), P5, P6, krita-ai-diffusion `ai_diffusion/model.py` Generate/Refine/Fill semantics.

## 1. Purpose

This spec defines the user-facing and agent-facing **generation workflow** — the rules that turn `(prompt, strength, selection, selection_mode, control_layers, regions)` into one of four resolved verbs and into the right ComfyUI graph. It also specifies the tablet UX dynamics: how the action button text changes, when sub-mode pickers appear, how previews land in the history strip.

**This spec is the contract bridge** between user intent (or agent intent) on the input side and ComfyUI graph builders on the output side. It is explicitly NOT about ComfyUI graph construction (that's `comfyui-management`) nor about history management (that's `generation-history`).

## 2. Stakeholders & user stories

### S1 — Tablet illustrator on the canvas
> **Story 1 (Generate).** As an illustrator on a blank canvas, I type "neo-tokyo skyline at dawn" and tap the action button labeled "Generate". The server uses my prompt + selected preset to produce 1–N preview images that land in the history strip. I tap one to apply.

> **Story 2 (Refine).** As an illustrator with a rough sketch on the canvas, I drag the strength slider down to 60% and the action button label changes to "Refine". I tap it; the model uses my sketch as starting point. Previews land in the history strip.

> **Story 3 (Fill).** As an illustrator, I lasso a face on the canvas. The action button changes to "Fill — Replace Background" by default (or whichever sub-mode I selected). I type "softer, younger, gentle lighting" and tap. The model regenerates only inside the selection.

> **Story 4 (Refine inside selection).** As an illustrator, I have a selection on the canvas AND I drag strength to 70%. The action button changes to "Constrained Variation" (or similar wording). The selected pixels are partially transformed using the prompt as guidance.

### S2 — Agent driving generation
> **Story 5 (Agent).** As Claude Code orchestrating a session, I invoke `generate_image({ prompt, strength: 100 })` on a blank canvas. The server returns `resolved_verb: "generate"`. I subscribe to events. When done, I list history items, pick the best, apply.

### S3 — MeshCraft pipeline
> **Story 6 (Pipeline batch).** As MeshCraft phase 1, I invoke `generate_image` 8 times in parallel with the same prompt + different seeds (or `batch_size: 8` once) to get concept-art variations. I read the resolved_verb to confirm "generate" and proceed.

## 3. Functional requirements (EARS)

### 3.1 Verb resolution

**FR-1 (Ubiquitous).** The server SHALL resolve the verb of a `generate_image` call from input shape using the following decision table:

| `strength` | `selection` present | `selection_mode` | resolved verb |
|---|---|---|---|
| 100 | absent | — | `generate` |
| <100 | absent | — | `refine` |
| 100 | present | required (one of Fill/Expand/AddContent/RemoveContent/ReplaceBackground) | `fill` |
| <100 | present | optional (defaults to Fill) | `constrained_variation` |

**FR-2 (Unwanted).** IF `strength === 100` AND `selection` is present AND `selection_mode` is missing, THE server SHALL respond with error `INVALID_INPUT` and field path `selection_mode` and hint listing the valid sub-modes.

**FR-3 (Ubiquitous).** The server SHALL include `resolved_verb` in `generate_image` output (per `mcp-tool-catalog` §3.3.5).

### 3.2 Selection sub-modes (when `resolved_verb === "fill"`)

Per krita-ai-diffusion's selection semantics:

**FR-4 (Ubiquitous).** `selection_mode === "Fill"` (default sub-mode) SHALL produce content that **balances flexibility with blending** — generic inpaint that fits surrounding context. Suitable for replacing a part with something similar.

**FR-5 (Ubiquitous).** `selection_mode === "Expand"` SHALL be tuned for canvas extension (outpainting): prefers continuations of existing content over novel content. Used by the "extend canvas" UX flow.

**FR-6 (Ubiquitous).** `selection_mode === "AddContent"` SHALL prioritize the prompt's instructions over surrounding colors/composition; suitable when the user wants the prompt to drive change drastically.

**FR-7 (Ubiquitous).** `selection_mode === "RemoveContent"` SHALL ignore the selected area's existing pixels and fill with continuations of the surrounding content. Suitable for object removal — prompt is optional.

**FR-8 (Ubiquitous).** `selection_mode === "ReplaceBackground"` SHALL preserve foreground subject (heuristically detected via pose/depth/segmentation reference layers) and replace the rest. Suitable for "swap the background" UX.

**FR-9 (Ubiquitous).** Each sub-mode maps to a specific configuration in `comfyui-management/graph/fill.ts` (denoising mask construction, blend mask sizing, prompt strength weights).

### 3.3 Strength slider semantics

**FR-10 (Ubiquitous).** `strength` SHALL be a 0–100 number.
- `100` → no canvas content used (full generation from prompt + control inputs).
- `<100` → canvas content used as starting point, with denoising amount inversely proportional to strength.
- `0` → degenerate (no change); the server SHALL still process the call but the result will be effectively the source. No special-casing.

**FR-11 (Ubiquitous).** When `selection` is present and `strength` is between 1 and 99, the server SHALL apply the strength **only inside the selection's denoising mask** — the rest of the canvas is preserved.

### 3.4 Tablet UX dynamics

**FR-12 (Event-driven).** WHEN the user changes strength, selection, or selection_mode, THE tablet UI SHALL update the action button label live, with at most 50 ms latency. Label rules:

- `strength=100, no selection` → "Generate"
- `strength<100, no selection` → "Refine (XX%)"
- `strength=100, selection present, sub-mode "Fill"` → "Fill"
- `strength=100, selection present, sub-mode "Expand"` → "Expand canvas"
- `strength=100, selection present, sub-mode "AddContent"` → "Add content"
- `strength=100, selection present, sub-mode "RemoveContent"` → "Remove content"
- `strength=100, selection present, sub-mode "ReplaceBackground"` → "Replace background"
- `strength<100, selection present` → "Constrained variation (XX%)"

(Labels are localized at runtime; English shown for spec.)

**FR-13 (Ubiquitous).** The selection sub-mode picker SHALL appear **only when a selection is active and strength=100**. It defaults to "Fill" but remembers the last used sub-mode per session.

**FR-14 (Ubiquitous).** The tablet SHALL allow the user to override the resolved verb's defaults: tapping the label briefly opens an overflow menu with all sub-modes plus advanced options (negative prompt, batch size, seed override).

**FR-15 (Ubiquitous).** The tablet SHALL show a real-time **preview indicator** in the corner of the canvas while a generation is running: thumbnail-sized animated indicator with progress percentage from `job.progress` events.

**FR-16 (Event-driven).** WHEN `job.completed { outcome: "success" }` arrives, the tablet SHALL: (1) add the new history item to the history strip; (2) optionally auto-select the latest preview if user prefs `auto_apply_latest === true` (default false).

### 3.5 Multi-result handling (batch_size > 1)

**FR-17 (Ubiquitous).** When `batch_size > 1`, the server SHALL submit the appropriate ComfyUI graph (with `batch_size` set) and emit one `job.completed { outcome: "success" }` per result; each gets its own `history_item_id`.

**FR-18 (Ubiquitous).** The tablet SHALL render all batch results side by side in the history strip; agents can list/get them via `list_history` resource and `get_history_item` tool.

### 3.5-bis Auto-translate phase (cross-spec with `prompt-enhancement`)

**FR-AT-1 (Event-driven).** WHEN `generate_image` is invoked AND the prompt's detected language is not English, THE server SHALL run **auto-translate** before constructing the ComfyUI graph (per `prompt-enhancement` FR-29). The translated prompt is what reaches ComfyUI.

**FR-AT-2 (Ubiquitous).** Both raw and translated prompts SHALL be persisted in the `history_items` row's `parameters_json` for traceability.

**FR-AT-3 (Event-driven).** WHEN translation fails or sampling is unsupported, THE server SHALL pass the raw prompt to the model and emit `prompt.translation_skipped` per `prompt-enhancement` FR-30. Generation proceeds; quality may drop.

**FR-AT-4 (Ubiquitous).** Auto-translate uses the **target model** (`input.model ?? preset.model`) to select the appropriate system prompt template (tag-style for SDXL, natural-language for Flux per `prompt-enhancement` FR-16-a).

### 3.6 Integration with control layers and regions

**FR-19 (Ubiquitous).** Generation honors active control layers (`control_layer_ids` input or all if omitted) and regions (`region_ids` input or all if omitted), per `control-layers` spec and `regions` spec respectively.

**FR-20 (Ubiquitous).** When a Fill operation overlaps with one or more regions, the server SHALL apply only the regions whose coverage overlaps the selection (per krita-ai-diffusion's region logic).

### 3.7 Cancellation

**FR-21 (Ubiquitous).** A generation in progress SHALL be cancellable via the `cancel_job` tool; the tablet maps this to a tap on the corner progress indicator.

**FR-22 (Event-driven).** WHEN cancellation succeeds, THE server SHALL emit `job.completed { outcome: "cancelled" }`; the tablet removes the in-progress indicator.

### 3.8 Errors

**FR-23 (Unwanted).** IF the prompt is empty AND no canvas content is present (Generate from nothing), THE server SHALL respond with `INVALID_INPUT { hint: "provide either a prompt or canvas content with strength<100" }`.

**FR-24 (Unwanted).** IF the resolved model is missing locally, THE server SHALL respond with `MODEL_NOT_FOUND` and hint to call `download_model`.

**FR-25 (Unwanted).** IF generation fails inside ComfyUI, THE server SHALL emit `job.completed { outcome: "failure", error: <ComfyError> }`; the tablet displays the error in a non-modal toast.

### 3.9 Default presets

**FR-26 (Ubiquitous).** The server SHALL ship with at least three default presets in v1: `photographic`, `illustration`, `concept-art`. Each preset bundles model + sampler + LoRAs + sane defaults. Defined in `comfyui-management/presets/defaults.ts`.

**FR-27 (Ubiquitous).** The tablet's primary preset picker SHALL surface the three defaults prominently; user-created presets appear below.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Verb resolution SHALL happen server-side in <1 ms (it's a decision table, no I/O).

**NFR-2 (Ubiquitous).** Tablet UI button label updates SHALL not introduce layout shift.

**NFR-3 (Ubiquitous).** First preview from `job.progress` to render in tablet UI SHALL be ≤ 500 ms after `job.completed` arrives (typical: thumbnail decode + paint).

## 5. Out of scope

- **Custom Graph workspace** (post-v1): users will be able to author graphs directly there.
- **Animation workspace** (post-v1): multi-frame generation.
- **Live mode**: streaming generation, separate spec deferred.
- **Sub-second iterative generation** as in Live mode: the latency target there is much lower.
- **History UI details** (`generation-history` spec).

## 6. Open questions

### Q1 — Should the tablet auto-apply the result when batch_size === 1?
Single-result generations could skip the "tap to apply" step if the user has already committed to the prompt.

**Recommendation:** **no auto-apply by default.** Keep preview-then-apply consistent regardless of batch size (P8). Add a user preference to opt in. This honors the principle and avoids surprise destructive applies.

### Q2 — Should `Generate` on a non-blank canvas warn the user?
If the user has work on the canvas and taps Generate (strength=100, no selection), it ignores their canvas content. Surprise.

**Recommendation:** **no warning, but make the strength slider's effect highly visible.** The label "Generate" tells the user this ignores canvas; if they wanted to use the canvas they'd lower strength. Adding warnings creates dialog fatigue.

### Q3 — How is the active document's `current strength` and `current selection_mode` persisted?
The slider position and last sub-mode should persist across sessions but per-document.

**Recommendation:** **persist per-document in `editorStore`.** When the document loads, restore the last used strength + selection_mode. Cross-document sticky settings live in user prefs.

### Q4 — Should the tablet expose individual control-layer toggles next to the action button, or only via the layers panel?
Quick toggle while generating could be useful.

**Recommendation:** **layers panel only.** Avoid action-button bloat. Power users can pin a "Control layers visible" toggle row above the canvas if they want.

### Q5 — When does `enhance_prompt` get invoked relative to `generate_image`?
Two flows: (a) user taps "Enhance" explicitly before "Generate"; (b) auto-enhance on Generate if user prefs say so.

**Recommendation:** **explicit only in v1** per P24 (independent + composable). Auto-enhance is a user preference post-v1; default is explicit.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The verb resolution table (§3.1) is complete and implemented as a pure function.
2. All five selection sub-modes have a graph-builder configuration in `comfyui-management`.
3. The six tablet UX dynamics (label rules, sub-mode picker, preview indicator, etc.) cover the four user stories.
4. The integration with control layers, regions, history, and cancellation is unambiguous.
5. Open questions have acceptable recommendations.
