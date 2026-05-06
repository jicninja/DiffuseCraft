# selection-tools — Requirements

> **Status:** Draft v0.1.
> **Tier 2-elevated.** Selection is **important** in DiffuseCraft — primary mechanism for AI gating + collage clipping + targeted edits. Touch-first design, with AI-assisted selection as a secondary layer (figure-ground detection + prompt-based).
> **Depends on:** `canvas-fundamentals` (selection state on document), `mask-system` (selection ↔ mask), `undo-redo-system`, `mcp-tool-catalog` (`set_selection` already polymorphic).
> **References:** P22 (touch-first), P27 (reversibility), editor philosophy (collage + AI gating).

## 1. Purpose

Selection is **the** primary spatial-scoping mechanism in DiffuseCraft: it controls where AI generation is constrained, where edits apply, where masks come from. This spec defines:

- **Tier 1 (P0, basic, touch-first)**: rectangle, lasso, polygonal lasso, magic wand, refine edge, boolean ops (add/subtract/intersect).
- **Tier 2 (P0–P1, fast AI on server)**: **MobileSAM** (9 MB, ~50–100 ms GPU) via ComfyUI for instantaneous figure-ground / subject detection on tap. General-purpose, promptable (point/box → mask). Default Tier 2 model in v1. **SAM 2 tiny** (38 MB) available as alternative configuration when its tooling matures further.
- **Tier 3 (P1, higher-quality AI on server)**: heavier variants (SAM 2 base/small, SAM-H) via ComfyUI when Tier 2's edge accuracy isn't enough. Same mechanism, larger model.
- **Tier 4 (P1–P2, VLM-refined prompt selection)**: text-prompted selection ("select the tree on the left") via VLM-assisted bounding-box detection (using **MCP sampling against the paired agent**, agent-agnostic per P3) feeding into SAM 2 for the precise mask.

The user explicitly chose this priority: **basics first, then AI in increasing levels of cost/quality**. v1 ships Tier 1 + Tier 2. Tier 3 is a configuration upgrade (swap to a heavier SAM 2 variant). Tier 4 ships progressively as MCP sampling integration matures across vendor agents.

**Why MobileSAM as default Tier 2 (not MediaPipe, not SAM 2 tiny in v1).**
- MediaPipe Image Segmenter is optimized for specific classes (selfie, multi-class subjects, hair) and is fast on CPU but **not general-purpose** for arbitrary subjects.
- **MobileSAM** (2023) is general-purpose, promptable (tap point → mask), tiny (9 MB), well-established in ComfyUI ecosystem, and ~50–100 ms on GPU. **It's the pragmatic choice for v1.**
- **SAM 2 tiny** (Meta, 2024) is the future-proof option (better edge quality, official Meta successor) and SHALL be available as an alternative; default may switch in v2 when ComfyUI tooling for SAM 2 reaches parity with MobileSAM's ecosystem.
- Heavier variants (SAM 2 base, SAM-H) live as Tier 3 for power users.

Routing all server AI through ComfyUI also avoids maintaining a second inference pipeline (no parallel CPU MediaPipe path).

**Architecture note on Tier 4 ("server consumes Claude/Codex/Gemini-class VLM").** The server SHALL NOT carry a vendor API key (P4). Instead, refined prompt-based selection works via **MCP sampling**: the server, while handling the user's `select_by_prompt` call, asks the calling agent (the user's paired Claude / Claude Code / Codex / Gemini CLI) to return a bounding box / point set for the prompt, then feeds those into the local SAM 2 model for the final mask. This preserves agent-agnosticism while giving Tier 4 quality. If sampling is not supported by the connected agent, Tier 4 gracefully degrades to Tier 3 with a notice. (The user's earlier suggestion of "exposing Claude CLI as a backend" maps to MCP sampling here — same outcome, vendor-neutral, no per-vendor adapter needed in the server.)

## 2. Stakeholders & user stories

### S1 — Illustrator selecting a region for inpaint
> **Story 1.** As an illustrator, I tap the lasso tool, draw around a face on my canvas with my finger or Apple Pencil. Selection appears with marching ants. I trigger Fill — generation is bound to my selection.

### S2 — Illustrator combining selections
> **Story 2.** As an illustrator, I rect-select a region. I tap the lasso with the "+" modifier (or two-finger tap a button). Drawing a lasso adds to the existing selection. I draw another with "−" to subtract a piece. Result: precise compound selection.

### S3 — Illustrator selecting by color (magic wand)
> **Story 3.** As an illustrator on a flat-color illustration, I tap magic wand, then tap on the sky. Everything within my color tolerance of that pixel becomes selected. I drag a slider to adjust tolerance live.

### S4 — Illustrator using AI subject detection
> **Story 4.** As an illustrator with a complex photo as a reference, I tap "Auto-select subject". The server runs SAM (or equivalent) on the active layer; the foreground subject becomes the selection. ~2 seconds wait. I refine if needed.

### S5 — Illustrator using prompt-based selection
> **Story 5.** As an illustrator, I tap "Select by prompt", type "the tree". The server runs Grounded-SAM (or equivalent); the tree(s) in the active layer become the selection. ~3 seconds wait.

### S6 — Refining the selection edge
> **Story 6.** As an illustrator with a rough lasso, I tap "Refine" → grow 2px, feather 4px, blur 1px. Edge softens. Output usable for fill without halos.

### S7 — Agent setting a selection programmatically
> **Story 7.** As Claude Code, I `set_selection({ kind: "mask", mask: <ImageEnvelope> })` with a precise pre-computed mask. Then `generate_image({ ..., selection_mode: "Fill" })`.

## 3. Functional requirements (EARS)

### 3.1 Tier 1 — basic selections (P0)

#### 3.1.1 Selection state model

**FR-1 (Ubiquitous).** The active document SHALL have at most one **active selection** at a time. The selection is one of:
- `kind: "none"` (no selection; whole canvas implicit).
- `kind: "rect"` with `{ x, y, w, h }`.
- `kind: "polygon"` with `{ points: [{x,y}, ...] }` (closed polygon, lasso path).
- `kind: "mask"` with `{ mask: ImageEnvelope }` (any free-form, including AI-derived).

**FR-2 (Ubiquitous).** Internally, the renderer + handlers convert all selection kinds to a unified mask representation when needed (for fill, region overlap, mask conversion).

#### 3.1.2 Rectangle selection

**FR-3 (Ubiquitous).** **Rectangle tool**: drag from one corner to the opposite corner. Hold modifier (Shift / on-screen ring) to constrain to square. Live preview during drag.

#### 3.1.3 Lasso selection (freehand)

**FR-4 (Ubiquitous).** **Lasso tool**: drag with finger or Apple Pencil to trace a path. Releasing closes the path automatically (line from last point to start). Path captured as polygon points (sampled at ≥120 Hz, simplified via Ramer-Douglas-Peucker to ~100 points before storage).

#### 3.1.4 Polygonal lasso

**FR-5 (Ubiquitous).** **Polygonal lasso**: tap to add a vertex; double-tap or tap on first vertex to close. Useful for precise architectural/geometric selections.

#### 3.1.5 Magic wand

**FR-6 (Ubiquitous).** **Magic wand**: tap on a pixel. The selection becomes all pixels within `tolerance` of the tapped pixel's RGB on the **active layer** (or composite if no layer is active and a "Sample composite" toggle is on).

**FR-7 (Ubiquitous).** Tolerance slider: 0–255 (default 32). Live preview as user drags slider; commits on lift.

**FR-8 (Ubiquitous).** Magic wand `contiguous` flag (default true): only the connected region; `false` selects all matching pixels regardless of connectivity.

#### 3.1.6 Refine edge

**FR-9 (Ubiquitous).** `refine_selection({ grow_px?, shrink_px?, feather_px?, blur_px?, smooth_px?, threshold? })`. Same composition pattern as `refine_mask`.

#### 3.1.7 Boolean operations

**FR-10 (Ubiquitous).** Selections SHALL support boolean ops via `set_selection({ kind, op: "replace" | "add" | "subtract" | "intersect" })`. Default `replace`.

**FR-11 (Ubiquitous).** Tablet UI exposes ops via a 4-button mode picker on the selection toolbar: ▢ Replace, ⊕ Add, ⊖ Subtract, ⊗ Intersect. Active mode persists until changed; visible.

#### 3.1.8 Common operations

**FR-12 (Ubiquitous).** `clear_selection({ document_id? })` (already in catalog as `set_selection({ kind: "clear" })` — keep simple). Reversible.

**FR-13 (Ubiquitous).** `invert_selection({ document_id? })` — swaps selected ↔ unselected. Reversible. New tool added by this spec.

**FR-14 (Ubiquitous).** `select_all({ document_id? })` — sets selection to entire canvas. Reversible. New tool added by this spec.

### 3.2 Tier 2 — AI figure-ground detection (P1)

**FR-15 (Ubiquitous).** **`auto_select_subject({ document_id?, layer_id?, tap_point?: {x,y} })`** (write, job, reversible) — invokes a server-side segmentation model (SAM-class) on the target.

**FR-16 (Ubiquitous).** With `tap_point`: the model treats the point as a positive prompt and segments the subject containing that point. Without `tap_point`: the model auto-selects the salient foreground subject.

**FR-17 (Ubiquitous).** Model SHALL be **lightweight by default for fast interaction** (sub-100 ms warm latency goal). Default v1: **MobileSAM**. Candidates configurable via `comfyui.auto_select.model`:
- **`MobileSAM`** (9 MB) — **default for v1.** General-purpose, promptable, ~50–100 ms GPU warm, mature ComfyUI tooling.
- **`SAM2-tiny`** (38 MB) — alternative; better edge quality; eligible to become default in v2.
- **`FastSAM`** (~70 MB) — fastest absolute, generates all-segments-then-filter pattern; useful for "explore segments" workflows.
- **`EfficientSAM`** — intermediate quality/speed.
- **Heavier (`SAM2-base`, `SAM-H`)** — Tier 3 power-user option for highest quality; longer latency.

All run as ComfyUI custom nodes; no parallel server-side inference pipeline.

**FR-18 (Ubiquitous).** **Job latency budget: ≤ 800 ms** on a typical local GPU (RTX 3060+ tier) for a 1024×1024 input with the default lightweight model. Critical for the "tap → selection appears" UX feel.

**FR-19 (Ubiquitous).** Result returned as a mask `ImageEnvelope`; sets the active selection as `kind: "mask"`. Multi-segment results (e.g., two subjects) are merged into one mask in v1; multi-subject picking is post-v1.

**FR-20 (Ubiquitous).** Tablet UX: a button "✨ Auto-select" in the selection toolbar; **tap a subject on canvas** (when this tool is active) immediately fires `auto_select_subject({ tap_point })`. No long-press wait — single tap.

**FR-20-bis (Ubiquitous).** **Pre-warming.** The server SHALL load the lightweight segmentation model into VRAM on first job submission and keep it warm (LRU eviction with VRAM pressure). Cold-start (first call after server boot) MAY take longer (≤ 3 s); subsequent calls hit the warm model and meet the FR-18 budget.

**FR-20-ter (Ubiquitous).** **Image preprocessing pipeline optimized for latency.** The pipeline SHALL: (1) downscale input to model's native resolution (1024 px typical) before segmentation, (2) run segmentation, (3) upscale the resulting mask back to canvas resolution with edge-preserving filter (e.g., guided filter). This keeps inference time bounded regardless of canvas size.

**FR-20-quat (Ubiquitous).** **Per-layer segmentation cache.** Recent segmentations SHALL be cached keyed by `(layer_content_hash, model_id, tap_point_grid_cell)` with TTL 60 s. Repeated taps on the same subject in the same area return cached result immediately (≤ 50 ms perceived).

### 3.3 Tier 3 — prompt-based selection (P1–P2)

**FR-21 (Ubiquitous).** **`select_by_prompt({ document_id?, layer_id?, prompt: string })`** (write, job, reversible) — invokes a text-conditioned segmentation model (Grounded-SAM-class).

**FR-22 (Ubiquitous).** Prompt is **English** per P23. The tablet's text input is multilingual; if the user types non-English, the SDK calls `enhance_prompt` first to translate (per `prompt-enhancement` spec). Or the consumer agent does this.

**FR-23 (Ubiquitous).** Job latency budget: ≤ **2 s** on a typical local GPU. Achieved using lightweight Grounded-SAM variants (e.g., `Grounded-MobileSAM`, `Grounded-FastSAM`). Same warm-pool + downscale pipeline as FR-20-bis / FR-20-ter applies here.

**FR-24 (Ubiquitous).** Multiple matches (e.g., "tree" with three trees in image) → union of all matches by default; per-match disambiguation post-v1.

**FR-25 (Ubiquitous).** Tablet UX: button "✨ Select by prompt" → opens a text field. Type prompt + tap "Find" → selection set.

**FR-26 (Ubiquitous).** Both tier 2 and tier 3 SHALL be optional features: when the underlying model isn't installed (e.g., user is using external ComfyUI without SAM nodes), the tools return `MODEL_NOT_FOUND` with a hint to install. Tablet UI gracefully hides/grays the buttons when the catalog reports the tools as unsupported.

### 3.4 Selection rendering

**FR-27 (Ubiquitous).** Active selection renders as **marching ants** outline (animated dashed line) along the selection boundary, scaled with viewport zoom but kept readable.

**FR-28 (Ubiquitous).** When a selection is active during fill / refine / inpaint, the renderer additionally shows a subtle red translucent overlay outside the selection (showing what's protected) — toggleable.

### 3.5 Catalog impact

This spec adds 4 new tools:

| Tool | Category | Reversible |
|---|---|---|
| `invert_selection` | write | yes |
| `select_all` | write | yes |
| `auto_select_subject` | job | yes |
| `select_by_prompt` | job | yes |

`refine_selection` is added but mirrors `refine_mask` (Q1 below).

`set_selection` is **extended** with new fields:
- `op: "replace" | "add" | "subtract" | "intersect"` (default replace).
- `kind: "polygon"` for polygonal lasso paths.

### 3.6 Multi-client

**FR-29 (Ubiquitous).** Active selection is **per-document, server-side**, shared across paired clients. When client A sets a selection, client B's UI shows it (`document.changed` event). Per-client selection is not v1 (open question).

### 3.7 Performance

**FR-30 (Ubiquitous).** Lasso path drawing latency (finger/pencil → preview render): ≤ 30 ms on iPad Pro M-class.

**FR-31 (Ubiquitous).** Magic wand on 4K canvas: ≤ 200 ms server-side; tablet shows spinner if exceeded.

**FR-32 (Ubiquitous).** AI auto-select with warm model on 1024×1024 layer: ≤ **800 ms**; cold-start ≤ 3 s. Tablet shows shimmer skeleton briefly; if exceeding 200 ms, transitions to spinner with "Detecting…" label.

**FR-33 (Ubiquitous).** AI prompt-select with warm model: ≤ **2 s**; cold-start ≤ 5 s. Same UX progression.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Touch hit zones for selection tool buttons: ≥ 44×44 pt.

**NFR-2 (Ubiquitous).** Lasso path simplification SHALL preserve enough detail to remain visually identical at 100% zoom (Douglas-Peucker tolerance ≤ 1 px).

**NFR-3 (Ubiquitous).** Selection rendering SHALL not drop framerate below 60 FPS on iPad Pro M-class.

## 5. Out of scope

- **Per-client selection** (each token has its own selection) — v1 uses shared server-side selection.
- **Quick mask mode** (Photoshop-style temporary mask painting). Use mask layers per `mask-system`.
- **Color range selection** (multi-color sample). Post-v1.
- **Object-aware grow/shrink** (smart edge detection beyond simple morphology). Post-v1.
- **Saved named selections** (recall a selection by name). Post-v1.
- **Multi-subject disambiguation in AI selection**. Post-v1.

## 6. Open questions

### Q1 — `refine_selection` vs use existing `refine_mask` after selection→mask roundtrip
Selection refinement could be: (a) selection → mask → refine_mask → mask → selection, OR (b) dedicated `refine_selection` tool.

**Recommendation:** **dedicated `refine_selection` tool** that operates directly on selection state; saves two roundtrip ops; same parameter shape as `refine_mask`. Adds 1 tool to catalog. Total catalog now ~50 (within new cap of 50).

### Q2 — Should `auto_select_subject` work without a `tap_point`?
"Auto-detect the salient foreground" without user input.

**Recommendation:** **yes**, optional parameter. Server uses saliency or "largest non-background segment" heuristic. Useful for "select the obvious subject" workflow.

### Q3 — Where does Grounded-SAM (or equivalent) live?
ComfyUI extension? Native server module?

**Recommendation:** **as a ComfyUI extension** (custom node), aligning with how all other AI ops happen. Required-nodes list in `comfyui-management` extends to include the optional Grounded-SAM nodes. Marked **optional**: tier 2 + tier 3 features turn off if nodes missing.

### Q4 — Should magic wand sample the **composite** by default or the **active layer**?
Photoshop: active layer (with "sample all layers" toggle for composite). Procreate: similar.

**Recommendation:** **active layer by default**, toggleable to composite. Matches user expectations.

### Q5 — Polygonal lasso: hold-shift to constrain to 45° angles?
Standard in Photoshop.

**Recommendation:** **yes when keyboard available**; on-screen ring "↗" toggle button when not.

### Q6 — Selection persistence across document reopen?
A selection is a per-session state.

**Recommendation:** **not persisted in v1.** Reopening clears selection. (Consistent with Photoshop's default behavior.)

### Q7 — When the active layer for magic wand / auto-select changes mid-flow, does the selection adapt?
The user might have wand-selected on layer A, then switched to layer B.

**Recommendation:** **selection persists**, even when active layer changes. Selection is a document-level state, not layer-level.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The seven user stories (§2) are realized by the FRs.
2. All Tier 1 selection methods work touch-first.
3. Boolean ops (replace/add/subtract/intersect) integrate cleanly.
4. Tier 2 (auto-select) and Tier 3 (prompt-select) are functional **when models are present**, gracefully disabled otherwise.
5. New tools added to v1 catalog (4 + extended `set_selection` + new `refine_selection`); cap stays ≤50.
6. Performance budgets achievable.
7. Open questions have acceptable recommendations.
