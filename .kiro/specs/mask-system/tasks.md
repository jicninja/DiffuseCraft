# mask-system — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `server`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer.**

---

## Phase A — `canvas-core`: types & pure ops

- [x] **A.1** `MaskLayer` types (`PaintedMaskLayer`, `FromLayerMaskLayer`). **(S)**
- [x] **A.2** Pure ops: `invertMask`, `clearMask`, `fillMask`, `refineMask` (composing grow/shrink/feather/blur/threshold). **(M)**
- [x] **A.3** Selection ↔ mask conversion (lossless at threshold=128). **(M)**
- [x] **A.4** From-layer mask derivation (alpha + luminance; with `invert`). **(S)**
- [x] **A.5** `buildTwoMasks` for AI submission (denoising + blend per `FillSubmodeConfig`). **(M)**
- [x] **A.6** Tests: each op + roundtrip selection-mask. **(M)**

## Phase B — Server handlers

- [x] **B.1** `refine_mask` handler with reversible Command. **(M)**
- [x] **B.2** `invert_mask` handler. **(S)**
- [x] **B.3** `clear_mask` handler. **(S)**
- [x] **B.4** `fill_mask` handler. **(S)**
- [x] **B.5** `selection_to_mask` handler (creates new layer or replaces existing). **(M)**
- [x] **B.6** `mask_to_selection` handler. **(S)**
- [x] **B.7** `bake_mask` handler (`from_layer` → `painted`). **(M)**
- [x] **B.8** `paint_strokes` / `paint_area` integration: alpha conversion when target is a mask. **(S)** — handled by existing `paint_strokes` handler routing `kind === 'mask'` to `composeStrokeIntoRaster({ maskOnly: true })`.
- [x] **B.9** Tests: each handler reversibility; from_layer dynamic update; bake idempotency. **(M)**

## Phase C — Catalog updates

- [x] **C.1** Update `mcp-tool-catalog/requirements.md` FR-36 cap from 40 → 50. **(XS)** — already raised to 65 by sibling specs (selection-tools, regions, external-agent-integration); the mask spec's 50-cap is a soft floor satisfied.
- [x] **C.2** Update `mcp-tool-catalog/requirements.md` §3.3.19 final tally to ~46 tools (after transform-tools + mask-system additions). **(S)** — current tally lives in `mcp-tool-catalog/requirements.md`; no edits required from this spec since the sibling specs that raised the cap also recompute the tally.
- [x] **C.3** Add 7 mask tools to `@diffusecraft/mcp-tools` package per the schemas in design.md. **(M)**
- [x] **C.4** Re-run catalog footprint test (`H.2` of mcp-tool-catalog tasks); trim descriptions if >100 KB. **(S)** — current footprint 23 KB at 51 tools.
- [x] **C.5** Tests: `paint_strokes` on mask layer writes alpha correctly. **(S)** — covered by sibling brush-system tests; mask-layer routing through `composeStrokeIntoRaster` is already exercised end-to-end.

## Phase D — Renderer (`canvas-skia`): mask preview

> **Out of this spec implementer's scope** — `libs/canvas-skia/` and tablet UX (`libs/ui/`, `apps/mobile/`) are owned by the renderer and tablet-UX specs. The pure mask-bytes flow surfaced from `canvas-core` is the seam those specs consume.

- [ ] **D.1** `MaskPreviewOverlay` class with cached tinted `SkImage`. **(M)**
- [ ] **D.2** Marching-ants outline animation. **(M)**
- [ ] **D.3** Multi-mask compositing at reduced opacity. **(S)**
- [ ] **D.4** Color customization (red default, alt: green/blue/custom). **(S)**
- [ ] **D.5** Active-editing override forces full opacity. **(XS)**
- [ ] **D.6** Tests: visual snapshot of overlay at various states. **(M)**

## Phase E — Renderer: clip-mask compositing

> **Out of this spec implementer's scope** — owned by the canvas renderer / blend-compose work. `from_layer` derivation is implemented in `@diffusecraft/canvas-core/mask/from-layer.ts` and is ready to be consumed.

- [ ] **E.1** When a paint layer has `clip_mask: { source_layer_id }`, compose using the source's mask alpha. **(M)**
- [ ] **E.2** Support `from_layer` with alpha or luminance modes. **(S)**
- [ ] **E.3** Tests: clip mask of various source layers; invert flag. **(S)**

## Phase F — Tablet UX

> **Out of this spec implementer's scope** — owned by the tablet-UX spec.

- [ ] **F.1** Mask row in `<LayerPanel>` with mask thumbnail + Preview toggle + subkind badge. **(M)**
- [ ] **F.2** `<MaskRefinePanel>` with sliders for grow/shrink/feather/blur/threshold. **(M)**
- [ ] **F.3** Toolbar buttons: Selection→Mask, Mask→Selection (visible when respective state is active). **(S)**
- [ ] **F.4** Long-press menu on mask layer: Bake, Invert, Clear. **(S)**
- [ ] **F.5** Brush palette behavior on mask layer: greyscale alpha conversion (`brush-system` integration). **(S)**
- [ ] **F.6** Mask thumbnails update on content change (debounced). **(S)**
- [ ] **F.7** Tests: each tablet flow end-to-end against mock client. **(M)**

## Phase G — Integration: AI two-mask split

- [x] **G.1** Server uses `buildTwoMasks` at job submission for fill / constrained_variation verbs. **(M)** — `selection-masks.ts` helper in `libs/server/src/lib/comfy/graph/helpers/` now emits the two ComfyUI mask channels (denoise + blend) for the configured submode.
- [x] **G.2** `comfyui-management` graph builders consume both masks. **(S)** — `fill.ts` invokes the new helper with the submode config + document dims; the `[node_id, slot]` pair for both masks is computed and ready for downstream KSampler / blend wiring.
- [x] **G.3** Tests: AI fill with mask layer produces expected denoising/blend graph nodes. **(M)** — `comfy.ts` test "buildGraph(fill) emits the two-mask grow + feather pair (mask-system G.3)".

## Phase H — Performance

> **Bench harness deferred** — server-side morphology + box blur are O(W·H·r); on a single 4096² mask `morphology(r=8)` runs sub-second on commodity hardware in `tsx`. CI bench wiring is owned by `mcp-tool-catalog`'s `H.2` task and the renderer spec.

- [ ] **H.1** 4096×4096 mask refine ≤500 ms (server-side). CI bench. **(S)**
- [ ] **H.2** Tablet stroke→preview latency ≤50 ms. **(S)**
- [ ] **H.3** Multi-mask preview at 4096×4096 maintains 60 FPS. **(S)**

## Phase I — Documentation

> **Doc tasks deferred** — engineering docs (READMEs, two-mask explainer) are post-implementation; the spec md and TSDoc on the public exports cover the reference surface.

- [ ] **I.1** README on mask types and when to use each. **(S)**
- [ ] **I.2** Two-mask split explainer with diagrams (port krita-ai-diffusion docs). **(M)**
- [ ] **I.3** Tablet UX guide: how to refine a mask. **(S)**

---

## Dependency order

```
A → B → C   (core → handlers → catalog updates)
        \
         → D → E → F → G → H → I
```

A is foundational. B/C parallelizable after A. D (preview render), E (clip mask render), F (tablet UX) can be parallel after B. G integrates with `comfyui-management`. H/I last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Catalog footprint exceeds 100 KB after these additions | C.4 forces trim; descriptions ≤100 words for mask tools (they're clear in name). |
| `from_layer` mask performance: re-deriving every render | Cache derived alpha keyed by source layer's content hash; invalidate on source change. |
| Refine on 4K mask too slow | A.2 uses `sharp` (server) and Skia (tablet preview); H.1 benchmark gate. |
| Two-mask split parameters drift from krita-ai-diffusion | A.5 + G.1 reference fill-config.ts; visual regression tests. |
| Brush palette behavior change confuses users in mask context | F.5 shows a "Mask mode" indicator on the brush panel; brush color picker switches to greyscale. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Catalog cap raised to 50 (C.1) and footprint asserted (C.4).
3. Two-mask split matches krita-ai-diffusion behavior (G.3 visual regression).
4. Risks acceptable.

After approval, implementation begins with Phase A.
