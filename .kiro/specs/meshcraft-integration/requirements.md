# meshcraft-integration — Requirements

> **Status:** Draft v0.1.
> **Type:** **B1 contract spec** per Q4 of clarifying questions — no migration code in v1; documents how MeshCraft consumes DiffuseCraft. Migration is post-v1.
> **Depends on:** every prior DiffuseCraft spec (the contract surface MeshCraft consumes).
> **References:** `tech.md` ("Backends model" + "External hosts"), P16 (Server-as-library), P17 (DiffuseCraft owns no desktop app), `tech.md` Q3 / Q4, "MeshCraft is the de facto desktop host" memory.

## 1. Purpose

Define the **integration contract** between DiffuseCraft (provider) and MeshCraft (consumer). Specifically: which DiffuseCraft packages MeshCraft consumes, how it embeds them, how MeshCraft's 6-phase pipeline orchestrates DiffuseCraft via MCP, and how MeshCraft reuses **the same paint engine** (canvas-core + a MeshCraft-supplied CanvasKit adapter) for desktop editing.

This spec is **the contract** — MeshCraft will reference it when migrating from its current bespoke ComfyUI adapter to the DiffuseCraft library. The spec produces:
- A list of DiffuseCraft packages MeshCraft imports.
- The embedding shape (server, paint engine, MCP client, stores).
- The 6-phase pipeline → MCP tool mapping.
- Job queue integration (MeshCraft pipeline jobs ↔ DiffuseCraft job tracker ↔ ComfyUI).
- The MeshCraft-specific CanvasKit render adapter (whose code lives in MeshCraft, not DiffuseCraft).
- Custom tool registration (`addCustomTool`) for MeshCraft pipeline-level operations.

This spec does **NOT** contain migration code, scaffolding, or PRs against MeshCraft. Implementation happens in MeshCraft's repo using this spec as input.

## 2. Stakeholders & user stories

### S1 — MeshCraft pipeline phase 1 (concept art)
> **Story 1.** As MeshCraft phase 1 generating concept art for a character, I instantiate `createDiffuseCraftServer` in-process. I open a document via in-memory MCP. I invoke `generate_image({ prompt, batch_size: 8, preset: "concept-art" })`. I subscribe to job events. When all 8 results arrive in history, I (or my user) pick one. The chosen image becomes phase 1's output, fed into phase 2.

### S2 — MeshCraft phase 6 (texture refinement)
> **Story 2.** As MeshCraft phase 6, I have a baked texture map. I open it as a document, set workspace to `Inpaint`, lasso problem areas, invoke `generate_image({ prompt: <texture-style>, strength: 100, selection: <lasso>, selection_mode: "Fill" })`. Refined texture replaces the source via `apply_history_item`.

### S3 — MeshCraft user editing in desktop UI
> **Story 3.** As a MeshCraft user clicking "Edit concept art", a panel opens with a paint canvas, layer panel, regions panel, control layers panel — exactly like the DiffuseCraft tablet app but rendered in Electron. The canvas uses CanvasKit; brushes, transforms, masks all work the same. I sketch on top, generate variations, refine — same flow as DiffuseCraft.

### S4 — MeshCraft using its own paired tablet
> **Story 4.** As a MeshCraft user, my iPad is paired to MeshCraft's embedded server. I can edit on the tablet while MeshCraft on the desktop runs phases. Both clients see the same document. MeshCraft pipeline jobs and tablet user actions queue in the same DiffuseCraft job tracker (server-side), executed by ComfyUI in arrival order.

### S5 — MeshCraft custom pipeline tool
> **Story 5.** As MeshCraft, I register a custom MCP tool `meshcraft.run_pipeline_phase({ phase, character_id })` via `server.hooks.addCustomTool`. External agents (Claude Code) paired with MeshCraft can invoke pipeline phases programmatically. Internally, the tool dispatches DiffuseCraft tool sequences.

## 3. Functional requirements (EARS)

### 3.1 Packages MeshCraft consumes (npm)

**FR-1 (Ubiquitous).** MeshCraft SHALL consume the following DiffuseCraft packages via npm:

| Package | Purpose | Required for v1 integration? |
|---|---|---|
| `@diffusecraft/server` | Embed the server in MeshCraft's Electron main process | **Yes** — the server backbone |
| `@diffusecraft/mcp-tools` | Schema types for typed tool invocations | **Yes** — type safety |
| `@diffusecraft/diffusion-client` | MCP client (in-memory transport for self-calls; HTTP for paired tablet) | **Yes** |
| `@diffusecraft/core` | Store factories, types, contracts | **Yes** — shared state |
| `@diffusecraft/canvas-core` | Document model, layers, brushes (math), transforms, masks, regions, selection | **Yes** — paint engine logic |
| `@diffusecraft/canvas-skia` | RN-Skia render adapter | **No** — MeshCraft writes its own adapter (see FR-13) |
| `@diffusecraft/ui` | React Native components | **Partially** — only RN-web-compatible components if any; MeshCraft otherwise writes Electron-native React components |

### 3.2 Embedding shape (Electron main + renderer)

**FR-2 (Ubiquitous).** MeshCraft Electron **main process** SHALL:
- Instantiate `createDiffuseCraftServer({ comfyui: { mode: "managed", install_dir: app.getPath("userData") + "/comfyui" }, transports: { http: { host: "0.0.0.0", port: 7860 }, stdio: false }, in_memory_token_name: "_in_process_meshcraft", host_name: "MeshCraft" })`.
- Register `onPairingRequest` hook to surface MeshCraft's UI prompt.
- Register `addCustomTool` for MeshCraft pipeline tools (FR-23).
- Bridge in-memory MCP invocation from renderer via IPC (FR-4).

**FR-3 (Ubiquitous).** MeshCraft Electron **renderer** SHALL:
- Instantiate `DiffuseCraftClient` with `transport: { kind: "in-memory", server: <bridged-via-IPC> }`. **No HTTP, no token, no pairing** — renderer and server are the same program, communication is in-process via IPC.
- Use the client to invoke tools, subscribe to events.
- Render the paint UI using its own React components built atop `@diffusecraft/core` stores + `@diffusecraft/canvas-core` document logic + a MeshCraft-supplied CanvasKit adapter.

**FR-4 (Ubiquitous).** IPC bridge: MeshCraft's main process exposes `server.mcp.invokeTool` / `server.events.on` / `server.resources.read` to the renderer via Electron IPC. The renderer's `DiffuseCraftClient` (in-memory transport) routes through this bridge transparently.

### 3.3 Paint engine reuse (the same paint in MeshCraft)

**FR-5 (Ubiquitous).** MeshCraft SHALL implement a **CanvasKit render adapter** conforming to `CanvasRenderAdapter` interface from `@diffusecraft/canvas-core`. The adapter renders documents via CanvasKit in an Electron WebView OR via `@shopify/react-native-skia` web build (CanvasKit-WASM under the hood) embedded in the renderer.

**FR-6 (Ubiquitous).** The MeshCraft adapter SHALL implement the full interface: `drawDocument`, `hitTest`, `hitTestStack`, `rasterizeLayer`, `rasterizeDocument`. Adapter code lives in MeshCraft's repo, not DiffuseCraft's.

**FR-7 (Ubiquitous).** MeshCraft reuses these `canvas-core` modules verbatim:
- Document + layer + group operations (pure functions).
- Selection types + boolean ops + lasso simplification + magic wand.
- Mask types + refine + invert + selection-mask conversion.
- Transform math (3×3 affine + projective for distort).
- Region coverage + prompt composition.
- Brush stroke expansion (`expandStrokeToStamps`).
- Snap target detection.
- Two-mask split (denoising + blend) for AI fill.

The adapter only renders; logic stays in `canvas-core`.

**FR-8 (Ubiquitous).** Brushes: MeshCraft reuses `BUILTIN_PRESETS` + ABR-imported brushes verbatim. Stamp rendering happens in the CanvasKit adapter mirroring the Skia adapter's `SkiaStampRenderer` behavior.

**FR-9 (Ubiquitous).** Stores: MeshCraft instantiates `createEditorStore`, `createConnectionStore`, `createModelsStore`, `createJobsStore`, `createHistoryStore`, `createMcpCatalogStore` from `@diffusecraft/core`. UI components subscribe via context-bound hooks (same as `apps/mobile`).

### 3.4 Job queue integration

**FR-10 (Ubiquitous).** MeshCraft pipeline phases **submit jobs via MCP tools** (`generate_image`, `upscale_image`, `apply_script`, etc.). Each job is tracked by DiffuseCraft's job tracker, which routes to ComfyUI. There is **no separate "MeshCraft job tracker"** — one queue, owned by ComfyUI, mirrored by DiffuseCraft.

**FR-11 (Ubiquitous).** When MeshCraft invokes a job tool, it receives a `job_id`. MeshCraft tracks this id within its pipeline-phase state. `job.progress` and `job.completed` events update both DiffuseCraft's history and MeshCraft's pipeline tracker.

**FR-12 (Ubiquitous).** Concurrent submissions from MeshCraft pipeline + paired tablet user are **serialized by ComfyUI's queue**. They don't interfere; each gets its own history items. Multi-client coordination per `mcp-tool-catalog` FR-21..23.

**FR-13 (Ubiquitous).** MeshCraft pipeline does NOT bypass DiffuseCraft to talk to ComfyUI directly. P19 enforced.

### 3.5 6-phase pipeline → MCP mapping

**FR-14 (Ubiquitous).** MeshCraft's 6-phase pipeline maps to MCP sequences as follows (representative; each phase may evolve):

| Phase | Purpose | Primary MCP tools |
|---|---|---|
| 1 | Concept art (character look) | `set_workspace("Generate")`, `generate_image(batch=N)`, `list_history`, `apply_history_item` |
| 2 | Refinement / variation | `generate_image(strength<100)`, `add_control_layer({type: "reference"})`, `apply_history_item` |
| 3 | 3D base mesh generation | (out of scope for this spec — handled by MeshCraft's own pipeline outside DiffuseCraft) |
| 4 | UV unwrap + base coloring | (out of scope) |
| 5 | Texture map authoring | (partly DiffuseCraft when texturing) |
| 6 | Texture refinement on the unwrapped mesh | `set_workspace("Inpaint")`, `set_selection({mask: <UV-island>})`, `generate_image({selection_mode: "Fill"})`, `apply_history_item`, `upscale_image` |

**FR-15 (Ubiquitous).** Phases 1, 2, 5, 6 are DiffuseCraft-driven. Phases 3, 4 are out of DiffuseCraft scope; this spec doesn't constrain them.

### 3.6 Pairing & auth — local is in-process; no QR for the renderer

**Important:** MeshCraft's renderer (the desktop UI) and the embedded server **are the same program** (single Electron process tree). The renderer connects to the server **in-process via Electron IPC** — there is **no pairing flow, no QR, no token typing, no mDNS, no HTTP roundtrip** for that local connection.

**FR-16 (Ubiquitous).** **Local connection (renderer ↔ embedded server)**: in-memory transport bridged via Electron IPC. The renderer instantiates `DiffuseCraftClient({ transport: { kind: "in-memory", server: <bridged> } })`. Trust model: trust-in-process. No token presented; the IPC channel itself is the auth boundary (only the renderer of this Electron process can hit it).

**FR-17 (Ubiquitous).** Audit log entries for in-process invocations are tagged with the synthetic token name configured at server creation: `_in_process_meshcraft` (configurable via `ServerConfig.in_memory_token_name`). This is informational only — there is no actual token value.

**FR-18 (Ubiquitous).** **External clients only** (e.g., a paired tablet, Claude Desktop running on the same laptop, custom agents) use the standard pairing flow per `pairing-protocol` — QR / mDNS / numeric code / manual paste — when connecting via Streamable HTTP transport. MeshCraft's `onPairingRequest` hook surfaces a confirmation dialog in the desktop UI to approve/reject these external connections.

**FR-19 (Ubiquitous).** Pairing in MeshCraft is **only relevant when an external device connects**. The MeshCraft user does not pair the desktop with itself — that's a single program.

**FR-20 (Ubiquitous).** MeshCraft can revoke external paired tokens via the standard `revoke_token` flow exposed in its "Devices" panel. The synthetic in-process identifier is non-revocable (it represents the program itself).

### 3.7 ComfyUI lifecycle (managed mode default)

**FR-19 (Ubiquitous).** MeshCraft uses **managed ComfyUI mode** by default — first-run installs ComfyUI + custom nodes + default models into `app.getPath("userData") + "/comfyui"`. User can switch to external mode in MeshCraft's settings.

**FR-20 (Ubiquitous).** Install progress UX: MeshCraft displays its own "Installing ComfyUI..." progress dialog backed by `comfyui.install.starting/progress/completed/failed` events.

### 3.8 Custom tool registration

**FR-21 (Ubiquitous).** MeshCraft SHALL register custom MCP tools via `server.hooks.addCustomTool` for pipeline-level operations:

```
meshcraft.run_pipeline_phase({ phase: 1..6, character_id, params? })
meshcraft.list_characters()
meshcraft.get_character_state(character_id)
meshcraft.cancel_pipeline_phase(character_id)
```

**FR-22 (Ubiquitous).** Custom tools are prefixed with `meshcraft.` to avoid catalog collisions per `server-architecture` FR-12. They are visible to paired clients (agents can drive MeshCraft pipeline programmatically).

**FR-23 (Ubiquitous).** Custom tool handlers internally invoke DiffuseCraft tools as building blocks. They register with the same Command/undo system per P27 (`pipeline-phase` Commands aggregate the underlying tool Commands as one unit).

### 3.9 What this spec does NOT define

**FR-24 (Ubiquitous).** This is a contract spec — out of scope here:
- Migration code in MeshCraft from its current adapter to `@diffusecraft/server`.
- MeshCraft-specific UI design (its desktop UI is its own concern).
- 3D pipeline internals (phase 3, 4) — fully MeshCraft's domain.
- The MeshCraft-supplied CanvasKit adapter implementation (lives in MeshCraft repo).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Embedding the server SHALL not increase MeshCraft's startup time by more than 1.5 s on a developer laptop with managed ComfyUI already installed (per `server-architecture` NFR-1).

**NFR-2 (Ubiquitous).** In-memory MCP transport from renderer to main process SHALL add ≤ 5 ms per call vs direct invocation. IPC overhead is the bottleneck; round-trip serialization should be efficient.

**NFR-3 (Ubiquitous).** MeshCraft's CanvasKit adapter SHALL match `apps/mobile`'s `canvas-skia` adapter on a parity matrix: same blend modes, same transforms, same brush stamps, same mask preview overlay. Visual regression on a fixture set verifies parity.

## 5. Out of scope

- **Code-level migration** of MeshCraft (lives in MeshCraft's repo).
- **MeshCraft's UI** beyond the contract this spec implies.
- **3D modeling internals**.
- **Multi-instance MeshCraft** (multiple windows each running their own server). Post-v1.
- **Cross-MeshCraft-instance shared state**. Post-v1.

## 6. Open questions

### Q1 — Should MeshCraft's CanvasKit adapter live in DiffuseCraft after all?
If we ship `@diffusecraft/canvas-canvaskit` as a published adapter, MeshCraft can `npm install` instead of writing one.

**Recommendation:** **NO in v1.** Prior decision (`tech.md`) was that DiffuseCraft does not maintain CanvasKit adapter. MeshCraft writes it; if the adapter proves widely useful, we can extract to a shared package post-v1.

### Q2 — Should MeshCraft pipeline phases be reversible?
Pipeline phase 6 might apply many tool calls; user wants single-step undo.

**Recommendation:** **yes**. Pipeline-phase custom tool handler aggregates underlying Commands into one composite Command. Tablet/MeshCraft user undoes once → entire phase reverts.

### Q3 — Multi-client editing: tablet user paints while MeshCraft phase is running on the same document
Concurrent canvas mutation from human + pipeline.

**Recommendation:** **document-level lock during pipeline phases**. When a phase starts, the document is marked `DOCUMENT_LOCKED` for the phase's duration; tablet user gets read-only with a "Phase 6 in progress…" indicator. After phase completes, lock releases. (Lock mechanism already specced in `mcp-tool-catalog` Q3.)

### Q4 — MeshCraft's character data model maps to DiffuseCraft's document model how?
A "character" might span multiple documents (concept art doc, texture doc, etc.).

**Recommendation:** **MeshCraft owns its character data model**; this spec doesn't try to fit characters into DiffuseCraft documents. MeshCraft pipeline tools transform 1 character → many DiffuseCraft documents as needed.

### Q5 — Does MeshCraft's desktop UI use React Native Web or pure React?
RN Web could share `@diffusecraft/ui` components verbatim.

**Recommendation:** **MeshCraft's choice**. Either works as long as the contract from FR-3 is met (consume stores + canvas-core + diffusion-client). RN-Web reuses `apps/mobile` components mostly verbatim; pure React requires re-implementation of UI. Documented as MeshCraft-side decision.

### Q6 — Should this spec include a sample MeshCraft phase implementation?
Helpful as reference.

**Recommendation:** **post-v1 example app**. v1 keeps spec contract-only; an `examples/meshcraft-pipeline-phase-1` reference might be added later.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are achievable via the contracts defined in §3.
2. Every package MeshCraft consumes is listed (FR-1).
3. Embedding shape is unambiguous (FR-2..4).
4. Paint engine reuse is feasible (`canvas-core` is render-agnostic per existing specs; FR-5..9 specify what MeshCraft writes vs reuses).
5. Job queue integration: one queue (DiffuseCraft tracker → ComfyUI), MeshCraft jobs flow through it (FR-10..13).
6. 6-phase mapping documented (FR-14..15).
7. Custom tool registration pattern works for pipeline phases (FR-21..23).
8. Open questions have acceptable recommendations.
