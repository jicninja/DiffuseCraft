# meshcraft-integration — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **Type:** B1 contract spec — **no DiffuseCraft code is written for MeshCraft integration in v1**. Tasks here describe what MeshCraft will need to do (in MeshCraft's repo) when migration begins post-v1, and which DiffuseCraft-side validations should exist.
> **DoD per task:** documented contract; for "validation" tasks (DiffuseCraft side), code merged with passing CI.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total v1 effort on the DiffuseCraft side: minimal (~1 week).** The bulk of work happens in MeshCraft's repo when migration begins (estimated 8-12 weeks for MeshCraft team). This file lists both for completeness.

---

## DiffuseCraft side (v1 deliverables)

### Phase A — Validation that the contract is buildable

- [ ] **A.1** Verify `@diffusecraft/server` exports the embedding API needed by FR-2 (createDiffuseCraftServer + hooks + custom tool registration). Manual review against `server-architecture/design.md`. **(S)**
- [ ] **A.2** Verify `@diffusecraft/canvas-core` exports the `CanvasRenderAdapter` interface and pure logic per FR-7. **(S)**
- [ ] **A.3** Verify `@diffusecraft/diffusion-client` accepts the in-memory transport with a bridged server reference (FR-3). **(S)**
- [ ] **A.4** Verify `@diffusecraft/core` exports store factories that work in both Expo and Electron React contexts. **(S)**
- [ ] **A.5** Confirm `addCustomTool` hook accepts MeshCraft's `meshcraft.*` prefixed tools (FR-21..23). Test in isolation. **(M)**
- [ ] **A.6** Document-level lock support: `DOCUMENT_LOCKED` error code in `mcp-tool-catalog` errors enum. Tested with a mocked pipeline lock. **(S)**

### Phase B — Reference test harness (DiffuseCraft side)

- [ ] **B.1** Write a tiny test app at `tools/meshcraft-contract-test/` that simulates MeshCraft: instantiates server, registers a fake custom tool, exercises in-memory client. Validates the contract end-to-end. **(M)**
- [ ] **B.2** Visual regression fixture set: render a fixed document via `canvas-skia` and compare to the same document rendered via a hand-stubbed CanvasKit adapter. Used as a parity reference for MeshCraft. **(M)**
- [ ] **B.3** Document the fixture set (which scenes, expected outputs) for MeshCraft's adapter implementation. **(S)**

### Phase C — Documentation

- [ ] **C.1** README in `.kiro/specs/meshcraft-integration/` summarizing the contract for the MeshCraft team. **(S)**
- [ ] **C.2** "How to embed DiffuseCraft" guide in `libs/server/README.md` with an example matching FR-2. **(M)**
- [ ] **C.3** Migration playbook stub: a checklist that MeshCraft will follow when migrating from its current adapter (link to this spec). **(S)**

---

## MeshCraft side (post-v1, estimated for the MeshCraft team)

> The following tasks are listed to scope the migration effort. They live in MeshCraft's repo, NOT DiffuseCraft's.

### Phase D — MeshCraft: dependency wiring

- [ ] **D.1** Add `@diffusecraft/server`, `@diffusecraft/diffusion-client`, `@diffusecraft/core`, `@diffusecraft/canvas-core`, `@diffusecraft/mcp-tools` to `package.json`. **(S)**
- [ ] **D.2** Pin to a specific catalog version. **(XS)**
- [ ] **D.3** Choose UI option: RN-Web for verbatim component reuse OR pure React with re-implementation (Q5). **(S)**

### Phase E — MeshCraft: server embedding (main process)

- [ ] **E.1** `MeshCraft/main/diffusecraft-bridge.ts` per design.md §3. Instantiate server + register hooks + bridge IPC. **(L)**
- [ ] **E.2** `onPairingRequest` hook backed by MeshCraft's pairing dialog component. **(M)**
- [ ] **E.3** ComfyUI managed-install progress UI wired to install events. **(M)**
- [ ] **E.4** Lifecycle: server.start at app boot, server.stop at app quit (graceful with timeout). **(S)**
- [ ] **E.5** Rip out MeshCraft's existing bespoke ComfyUI adapter once parity is achieved with DiffuseCraft tools. **(L)**
- [ ] **E.6** Tests: server starts; tools/list reflects custom + standard tools. **(M)**

### Phase F — MeshCraft: renderer client (in-process)

- [ ] **F.1** `MeshCraft/renderer/diffusecraft-client.ts` per design.md §3. **(M)**
- [ ] **F.2** Wire stores from `@diffusecraft/core` into MeshCraft's React tree via `StoresProvider`. **(M)**
- [ ] **F.3** Tests: invoke a tool, subscribe to events, IPC overhead ≤5 ms. **(S)**

### Phase G — MeshCraft: CanvasKit render adapter

- [ ] **G.1** `MeshCraft/renderer/diffusecraft-paint/CanvasKitAdapter.ts` implementing `CanvasRenderAdapter`. **(XL)**
- [ ] **G.2** drawDocument, drawGroup, drawLayer with all blend modes. **(L)**
- [ ] **G.3** Hardness shader (CanvasKit-WASM) for brushes; fallback to alpha-multiplied tip. **(L)**
- [ ] **G.4** Smudge sample-and-stamp logic. **(L)**
- [ ] **G.5** Mask preview overlay. **(M)**
- [ ] **G.6** Hit-test (single + stack). **(M)**
- [ ] **G.7** rasterizeLayer, rasterizeDocument. **(M)**
- [ ] **G.8** Visual regression against DiffuseCraft's fixture set (B.2). **(L)**
- [ ] **G.9** Performance: 60 FPS at 50 layers in Electron WebView. **(M)**

### Phase H — MeshCraft: paint UI components

- [ ] **H.1** `<LayerPanel />` (RN-Web reuse OR pure React). **(M)**
- [ ] **H.2** `<RegionsPanel />` (same options). **(M)**
- [ ] **H.3** `<TransformController />` with mouse + keyboard (FR Q3 of transform-tools). **(M)**
- [ ] **H.4** `<SelectionToolbar />`, `<BrushPalette />`, `<ColorDisc />`, etc. **(L)**
- [ ] **H.5** `<HistoryStrip />`, `<RootPromptBar />`. **(M)**
- [ ] **H.6** `<ScriptPanel />`, `<UpscaleSettingsPanel />`. **(M)**

### Phase I — MeshCraft: pipeline tools + 6-phase orchestration

- [ ] **I.1** Define `meshcraft.run_pipeline_phase` schema (post-Q2 reversible composite). **(M)**
- [ ] **I.2** Phase 1 handler: concept-art generation orchestration. **(L)**
- [ ] **I.3** Phase 2 handler: refinement / variation. **(L)**
- [ ] **I.4** Phase 5 handler: texture authoring. **(L)**
- [ ] **I.5** Phase 6 handler: texture refinement. **(L)**
- [ ] **I.6** `meshcraft.list_characters`, `meshcraft.get_character_state`, `meshcraft.cancel_pipeline_phase`. **(M)**
- [ ] **I.7** Document-level lock during pipeline phases (per Q3). **(M)**
- [ ] **I.8** Tests with mocked DiffuseCraft tools. **(L)**

### Phase J — MeshCraft: external client UX

- [ ] **J.1** "Devices" panel listing paired tablets + agents. **(M)**
- [ ] **J.2** Pairing dialog component used by `onPairingRequest` hook. **(M)**
- [ ] **J.3** "Pair tablet" button → opens pairing window via `server.pairing.openWindow`. **(S)**

### Phase K — MeshCraft: documentation + migration

- [ ] **K.1** Migration guide / changelog for users on the MeshCraft side. **(M)**
- [ ] **K.2** Compatibility note: MeshCraft v1.X requires DiffuseCraft catalog v1.X.X+ . **(S)**

---

## Dependency order

DiffuseCraft side: A → B → C (sequential, ~1 week). MeshCraft side: D → E parallel with G, then F, then H, then I, then J, then K. Migration is the largest single effort post-v1.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| MeshCraft's CanvasKit adapter renders inconsistently with `canvas-skia` | B.2 fixture set + visual regression CI. |
| IPC overhead higher than 5 ms in real Electron versions | F.3 benchmark; fall back to message-batching if needed. |
| Custom pipeline tool catalog inflates handshake | Custom tools live behind workspace filtering; `meshcraft.*` only visible when MeshCraft is the host (not in standalone server). |
| Document-lock starvation if pipeline phases are long | Phase progress visible to all clients; pipelines can be cancelled. |
| MeshCraft team inherits maintenance of CanvasKit adapter | Adapter contract is small (FR-5..6); fixtures help; can be extracted to a published `@diffusecraft/canvas-canvaskit` post-v1 if widely useful. |
| ComfyUI managed install conflicts with MeshCraft's existing install | E.5 retires existing adapter atomically; install uses dedicated subdir under userData. |

---

## Approval

Approved when:
1. Every requirement in `requirements.md` maps to one or more tasks (DiffuseCraft side or MeshCraft side).
2. DiffuseCraft side validation tasks (A, B, C) are achievable in v1 within ~1 week.
3. MeshCraft side tasks (D-K) are clearly scoped for post-v1 implementation.
4. Risks acceptable.

After approval, **DiffuseCraft team** ships A/B/C in v1. **MeshCraft team** picks up D–K when their migration sprint starts.
