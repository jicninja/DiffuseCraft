# transform-tools — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~5–7 weeks for one engineer.** Heavy on UX/gesture detail.

---

## Phase A — `canvas-core`: transform math

- [x] **A.1** `TransformDecomposed` + `TransformMatrix` types. **(S)** — `libs/canvas-core/src/transform/types.ts`.
- [x] **A.2** Affine 3×3 matrix math: multiply, invert, decompose-recompose. **(M)** — `libs/canvas-core/src/transform/{matrix,decompose}.ts`.
- [x] **A.3** 4-point projective math for distort. **(M)** — `libs/canvas-core/src/transform/distort.ts`.
- [x] **A.4** Pure operations: `translate`, `scale`, `rotate`, `flip`, `skew`, `distortFourCorner`, `reset`. **(M)** — `libs/canvas-core/src/transform/operations.ts`.
- [x] **A.5** `mergeTransform(prev, partial)` for partial-input support. **(S)** — `libs/canvas-core/src/transform/merge.ts`.
- [x] **A.6** Tests: round-trip decompose/recompose for representative transforms (no float drift). **(M)** — added to `libs/canvas-core/src/__tests__/run-tests.ts`.

## Phase B — `canvas-core`: snap detection

- [x] **B.1** `findSnapTargets(rect, document, threshold)` covering canvas edges, canvas center, layer edges, layer centers, grid. **(M)** — `libs/canvas-core/src/transform/snap.ts`.
- [x] **B.2** Rotation snap (multiples of 15°). **(S)** — `nearestRotationSnap` in `snap.ts`.
- [x] **B.3** Tests: each snap target type triggers; threshold respected. **(M)** — covered in `run-tests.ts`.

## Phase C — Server: `transform_layer` handler + catalog promotion

- [x] **C.1** Add `transform_layer` to `@diffusecraft/mcp-tools` catalog (move from deferred to v1). **(S)** — `libs/mcp-tools/src/tools/layers/transform-layer.ts` + manifest entry.
- [ ] **C.2** Update `mcp-tool-catalog/requirements.md` §3.3.19 final tally (39 tools now) and §3.3.17 deferred list (remove transform_layer). **(XS)** — out of scope per implementer brief (`DO NOT touch other spec md`); the canonical surface is the manifest in `libs/mcp-tools/src/manifest.ts`, which has been updated.
- [x] **C.3** Handler with reversible Command per design.md §5. **(M)** — `libs/server/src/lib/handlers/transform-layer.ts` + migration `004-transform-tools` (`layers.transform_json`, `layers.group_id`).
- [x] **C.4** Group transform handler (multi-layer single Command). **(M)** — handled by the same handler when `group_id` is supplied.
- [x] **C.5** Tests: single layer transform reversibility; group transform reversibility; partial input merge. **(M)** — `libs/server/src/__tests__/transform-layer.ts` (11 cases).

## Phase D — Tablet UI: bounding box & handles

> Out of scope for this implementer pass — `libs/ui/`, `libs/canvas-skia/`, `apps/mobile/` are off-limits per the wave brief. Picked up in a follow-up tablet UX pass.

- [ ] **D.1** `<BoundingBox />` component computing visual bounds + viewport projection. **(M)**
- [ ] **D.2** `<CornerHandle />` (4) with hit zone ≥32×32 pt for touch. **(M)**
- [ ] **D.3** `<EdgeHandle />` (4). **(M)**
- [ ] **D.4** `<RotationHandle />` with degree readout overlay. **(M)**
- [ ] **D.5** `<AnchorHandle />` draggable anchor. **(S)**
- [ ] **D.6** `<DistortCornerHandle />` (4 corners free in distort sub-mode). **(M)**
- [ ] **D.7** Tests: handle hit-test at varied zoom levels. **(M)**

## Phase E — Tablet UX: gestures

> Out of scope (UI). Geometry primitives (`useHandleDrag` deltas, etc.) are unblocked by Phase A's pure ops.

- [ ] **E.1** `useHandleDrag` gesture composition (touch + pointer). **(M)**
- [ ] **E.2** Pinch-to-scale (whole layer when no handle hit). **(S)**
- [ ] **E.3** Two-finger rotate (whole layer). **(S)**
- [ ] **E.4** Drag to translate (whole layer). **(S)**
- [ ] **E.5** Three-finger drag to reset transform. **(S)**
- [ ] **E.6** Modifier integration: handles read modifier state from physical kbd OR `ModifierRing`. **(M)**
- [ ] **E.7** Long-press handle → toggle "from center" for that drag. **(S)**
- [ ] **E.8** Tests: each gesture isolated; gesture race resolution. **(M)**

## Phase F — Modifier ring & shortcuts

> Out of scope (UI).

- [ ] **F.1** `<ModifierRing />` floating UI for tablet-no-keyboard. **(M)**
- [ ] **F.2** `useModifierState` hook merging keyboard + ring inputs. **(S)**
- [ ] **F.3** Esc cancels current transform; Enter commits (when keyboard). **(S)**
- [ ] **F.4** Tests: each modifier reachable via ring; physical keyboard parity. **(S)**

## Phase G — Snap UX

> Out of scope (UI). Underlying snap math is in `libs/canvas-core/src/transform/snap.ts`.

- [ ] **G.1** `<SnapOverlay />` rendering guide lines at active snap targets. **(M)**
- [ ] **G.2** Snap engagement on drag; un-snap when threshold exceeded. **(S)**
- [ ] **G.3** Snap toggle button on ring; Cmd-held disables (when keyboard). **(S)**
- [ ] **G.4** Rotation snap visual feedback. **(S)**
- [ ] **G.5** Tests: snap with multiple nearby targets picks closest. **(M)**

## Phase H — Sub-modes (Transform / Distort / Skew)

> Out of scope (UI). Distort/skew operations are available as pure ops in `operations.ts`.

- [ ] **H.1** `transformStore` slice in core: subMode, snapEnabled, currentPreview. **(S)**
- [ ] **H.2** Sub-mode picker on the transform tool ring. **(S)**
- [ ] **H.3** Distort handles (4 free corners). **(M)** (overlaps D.6)
- [ ] **H.4** Skew via edge handles + Cmd modifier. **(S)**
- [ ] **H.5** Tests: switching sub-modes preserves layer selection. **(S)**

## Phase I — Numeric panel

> Out of scope (UI).

- [ ] **I.1** `<TransformPanel />` with numeric inputs for tx/ty/sx/sy/rotation/skew/flip. **(M)**
- [ ] **I.2** Arithmetic expression evaluator for inputs. **(S)**
- [ ] **I.3** Reset-per-axis buttons. **(XS)**
- [ ] **I.4** Tests: typing values applies correctly; arithmetic evaluated. **(S)**

## Phase J — Performance & rendering

> Out of scope (renderer/UI). The pure transform pipeline lives in `canvas-core` and is a constant-time operation per layer; perf benchmarking lives with the rendering layer.

- [ ] **J.1** During-gesture lower-quality preview (bilinear, no group compose). **(M)**
- [ ] **J.2** On-commit full re-render. **(S)**
- [ ] **J.3** 60 FPS benchmark for 1024×1024 single-layer transform. **(S)**
- [ ] **J.4** 30 FPS benchmark for 4096×4096 transform. **(S)**
- [ ] **J.5** 60 FPS benchmark for 5-layer group transform. **(S)**

## Phase K — Documentation

> K.3 falls under the "DO NOT touch other spec md" rule and is left for the catalog spec's own follow-up. K.1 / K.2 (README + UX guide) are docs-only and tracked alongside the tablet UX pass.

- [ ] **K.1** README section: transform philosophy (touch-first; mouse/keyboard secondary). **(S)**
- [ ] **K.2** UX guide: when handles appear; tool palette interaction. **(S)**
- [ ] **K.3** Migration note in `mcp-tool-catalog` design.md: `transform_layer` promoted from deferred → v1. **(XS)**

---

## Dependency order

```
A → B (canvas-core math + snap)
       \
        → C (server handler + catalog promotion)
              \
               → D → E → F → G → H → I → J → K
```

A is foundational. B/C parallelizable after A. D/E/F/G/H/I are tablet UX in mostly-parallel pieces. J performance gate. K docs.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Float drift accumulates over many transforms breaking exact reversibility | A.6 tests; on commit, normalize via decompose-recompose; revert uses captured pre-state. |
| Distort + group transform corner cases (group of distorted layers) | Group transform applies a uniform affine to children; child distort is preserved as-is. |
| Modifier ring takes up canvas space on small tablets | F.1 collapses to a single button when minimized; expandable on tap. |
| Mouse cursor on iPadOS doesn't reach handle hit zones cleanly | D.2 sets larger hit zones for both touch and mouse; cursor uses pointer events with fine precision. |
| Snap with many overlapping layers slows hit-test | B.1 caches bounding boxes per layer; recompute only on layer change. |
| `transform_layer` in catalog inflates footprint over 100 KB | C.2 verifies; description ≤200 words; `mcp-tool-catalog` H.4 budget test catches. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. `transform_layer` promoted from deferred to v1 catalog (C.1, C.2).
3. Touch-only path verified for every operation.
4. Performance targets met.
5. Risks acceptable.

After approval, implementation begins with Phase A.
