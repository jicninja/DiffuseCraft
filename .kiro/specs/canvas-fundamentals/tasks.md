# canvas-fundamentals — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `canvas-core`, `canvas-skia`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~6–9 weeks for one engineer.**

---

## Phase A — `canvas-core`: scaffolding & types

- [x] **A.1** Initialize `libs/canvas-core/` Nx project. Tags: `scope:canvas`, `type:lib`. Single dep: `zod` (and `ulid`). NO Skia/RN deps. **(S)**
- [x] **A.2** `Document`, `Layer`, `GroupNode`, `Viewport`, `Selection` type definitions. **(S)**
- [x] **A.3** Branded ID types via re-export from `@diffusecraft/mcp-tools`. **(XS)**
- [ ] **A.4** Tree-shakeability assertion: build emits ≤60 KB minified+gzipped. **(XS)**

## Phase B — `canvas-core`: pure operations

- [x] **B.1** `addLayer`, `removeLayer`, `updateLayer` pure functions. **(M)**
- [x] **B.2** `duplicateLayer`, `mergeDown` (with injected `BlobBlender`), `flattenVisible`. **(M)**
- [x] **B.3** Group operations: `createGroup`, `ungroup`, `moveLayersIntoGroup`, `updateGroup`. **(M)**
- [x] **B.4** Position management: insert + shift, multi-client conflict tiebreaker by `created_at`. **(S)**
- [x] **B.5** Hit-test pure helper (works on document model + viewport, no rendering). **(M)**
- [x] **B.6** Invariant checks (positions consistent, no orphan group refs, group nesting ≤5). **(S)**
- [x] **B.7** Tests: each operation produces correct output document; invariants hold. **(M)**

## Phase C — `canvas-core`: blend & compose

- [x] **C.1** `BlendMode` enum + 20 blend modes per `requirements.md` §3.4. **(S)**
- [x] **C.2** Blend formulas reference doc `formulas.md`. **(S)**
- [x] **C.3** `compose(layer, background, blend, opacity)` pure function (used for thumbnail simulation; real rendering goes through Skia). **(M)**
- [ ] **C.4** Tests: snapshot test of composed bytes for each blend mode against reference output. **(M)**

## Phase D — `canvas-core`: render adapter interface

- [x] **D.1** `CanvasRenderAdapter` interface. **(XS)**
- [x] **D.2** `Viewport` zoom/pan/rotation type + helpers (compose viewport transforms). **(S)**
- [ ] **D.3** Adapter contract tests: any conforming adapter passes them (used by Skia adapter tests). **(S)**

## Phase E — `canvas-skia`: scaffolding

- [x] **E.1** Initialize `libs/canvas-skia/`. Tags: `scope:canvas`, `type:lib`, `platform:rn`. Deps: `canvas-core`, `react-native-skia`. **(S)**
- [x] **E.2** `SkiaRenderAdapter` implements interface. **(M)**
- [x] **E.3** Image cache by `content_blob_id`. **(S)**

## Phase F — `canvas-skia`: rendering

- [x] **F.1** `drawDocument` honoring layer visibility/opacity/blend. **(M)**
- [ ] **F.2** Group composition with isolated buffer. **(M)**
- [ ] **F.3** Clip mask application. **(M)**
- [ ] **F.4** Custom shader for blend modes Skia doesn't natively support. **(L)**
- [x] **F.5** `hitTest` (single + stack). **(M)**
- [x] **F.6** `rasterizeLayer` and `rasterizeDocument`. **(M)**
- [ ] **F.7** Incremental render path: only re-render `changedLayerIds` when possible. **(L)**
- [x] **F.8** Overlays: selection (rect/mask/marching-ants), region outlines, active-layer border. **(M)**
- [ ] **F.9** Tests: visual regression on key scenarios (5+ layers with mixed blends; group compose; clip mask). **(M)**

## Phase G — `canvas-skia`: viewport & gestures

- [x] **G.1** `viewport-canvas.ts` matrix helpers. **(S)**
- [ ] **G.2** Performance: 60 FPS at 100 layers — instrumented test. **(M)**

## Phase H — Tablet UX: layer panel

- [ ] **H.1** `<LayerPanel />` with virtualized FlatList. **(M)**
- [ ] **H.2** `<LayerRow />` thumbnail + name + opacity slider + visibility/lock toggles + blend badge. **(M)**
- [ ] **H.3** Group rows: collapse/expand, member count, opacity slider. **(M)**
- [ ] **H.4** Drag-and-reorder gesture. **(L)**
- [ ] **H.5** Swipe-left delete + swipe-right toggle visibility. **(S)**
- [ ] **H.6** Long-press context menu: Duplicate, Merge down, Delete, Convert to mask, Convert to control, Group, Rename, Lock. **(M)**
- [ ] **H.7** Pinch-two-layers-in-panel → group. **(M)**
- [ ] **H.8** Layer thumbnails update reactively, throttled to 60 Hz. **(S)**
- [ ] **H.9** Tests: 200-layer panel renders smoothly; gestures dispatch correct tools. **(M)**

## Phase I — Tablet UX: canvas gestures

- [ ] **I.1** `<CanvasGestures />` wrapper composing pinch/pan/rotate/undo/redo/paste/eyedropper. **(M)**
- [ ] **I.2** Pinch-to-zoom with min/max bounds. **(S)**
- [ ] **I.3** Two-finger pan. **(S)**
- [ ] **I.4** Two-finger rotate (toggleable preference). **(S)**
- [ ] **I.5** Two-finger tap → undo. **(S)**
- [ ] **I.6** Three-finger tap → redo. **(S)**
- [ ] **I.7** Three-finger swipe down → menu. **(S)**
- [ ] **I.8** Four-finger tap → toggle UI chrome. **(S)**
- [ ] **I.9** Long-press → eyedropper. **(M)**
- [ ] **I.10** Two-finger long-press → paste from clipboard. **(M)**
- [ ] **I.11** Tests: each gesture in isolation; gesture conflicts resolved by precedence. **(M)**

## Phase J — Image import paths

- [ ] **J.1** Drag-and-drop handler (iPad multitasking + Android Files). **(M)**
- [ ] **J.2** Paste-from-clipboard handler. **(S)**
- [ ] **J.3** Camera-capture optional integration (Expo Camera). **(M)**
- [ ] **J.4** All paths upload bytes via `client.image.upload`, then `add_layer({ kind: "paint", content })`. **(S)**
- [ ] **J.5** Tests: drag, paste, camera each produce a layer. **(M)**

## Phase K — Document creation flow

- [ ] **K.1** Document creation modal with aspect ratio presets. **(S)**
- [ ] **K.2** Custom dimensions input with multiples-of-8 validation. **(XS)**
- [ ] **K.3** Calls `create_document` tool. **(XS)**

## Phase L — Multi-client coordination

- [ ] **L.1** Local edits dispatch immediately; server confirmation reconciles via `document.changed`. **(M)**
- [ ] **L.2** "Edited remotely" indicator on layer rows for ~3s. **(S)**
- [ ] **L.3** Tests: simulated two clients editing same document; conflict resolution last-write-wins. **(M)**

## Phase M — Performance benchmarks

- [ ] **M.1** 100-layer 4K canvas: 60 FPS interaction. CI test on iPad simulator (manual on real device). **(M)**
- [ ] **M.2** 50-layer document load <1.5 s. **(S)**
- [ ] **M.3** 200-layer panel scroll smooth. **(S)**

## Phase N — Documentation

- [ ] **N.1** `canvas-core` README: pure ops, render-adapter pattern. **(S)**
- [ ] **N.2** `canvas-skia` README: how to swap render targets. **(S)**
- [ ] **N.3** Layer panel UX docs with screenshots. **(S)**

---

## Dependency order

```
A → B → C → D
              \
               → E → F → G   (Skia adapter)
                              \
                               → H → I → J → K   (tablet UX)
                                              \
                                               → L → M → N
```

A→B→C is core foundation. D unlocks adapters. E/F/G is Skia work. H–K is tablet UX (parallelizable across pieces). L/M/N at the end.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Blend modes Skia doesn't natively support yield wrong output | C.4 + F.4 visual regression tests against reference renders. |
| Render performance degrades at 100+ layers | F.7 incremental render; M.1 benchmark gate. |
| Layer panel virtualization edge cases (drag during scroll) | H.4 + H.9 stress tests; fallback to non-virtualized for ≤50 layers. |
| Drag-and-drop iPad multitasking flaky | J.1 + Expo's drop API; document known limitations on Android tablets. |
| Clip mask + group + blend interactions produce unexpected composition | C.4 + F.9 cross-cutting visual tests for all combinations. |
| Renderer memory blows up at 4K with 50 layers | NFR-5 budget; tile-based rendering as fallback (post-v1 if reached). |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct.
3. Performance targets are in CI/instrumented tests.
4. Risks acceptable.

After approval, implementation begins with Phase A.
