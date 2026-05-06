# Spec Backlog

This is the index of feature specs that compose DiffuseCraft v1 and beyond. Each entry will eventually have its own folder under `.kiro/specs/<slug>/` with `requirements.md`, `design.md`, `tasks.md`.

The backlog is organized by **concern** (server / client / editor / AI workflow / integration) and tagged with **layer** (which packages it touches) and **size** (S / M / L / XL t-shirt). The **v0.1 minimal cut** is called out explicitly at the bottom.

> Status legend: `proposed` (in this backlog only) · `specced` (folder exists, all three docs written) · `approved` (all three docs reviewed and approved) · `implemented` (matching code shipped).

---

## Server / backend

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `mcp-tool-catalog` | The canonical list of MCP tools, resources, prompts, events, schemas, descriptions, side-effect labels, idempotency markers, versioning policy. **Source of truth every other spec references.** | `mcp-tools` | XL | **P0 — first** | specced |
| `server-architecture` | `@diffusecraft/server` library shape: API surface, embedding contract, lifecycle (`createDiffuseCraftServer`, `start/stop`, hooks), how the three transports mount, how handlers register against `mcp-tools` schemas, error model. | `server`, `mcp-tools` | L | P0 | specced |
<!-- auth-and-proxy spec ELIMINATED. Its content is distributed across:
     - Token verification middleware → server-architecture (D.3 in tasks.md, design.md §4.2 authMw)
     - Token issuance → pairing-protocol
     - Token storage / revocation / audit log / rate limit → server-architecture (FR-36/37, tasks Phase D, J)
     - ComfyUI proxy semantics + graph construction → comfyui-management
     - "ComfyUI never raw" enforcement → principle P19 + ComfyClient internal-only (server-architecture §4.5, task G.5)
     Removed because, after Q7 simplification (single-tier token, no scopes), no content remained that justified a dedicated spec. -->

| `pairing-protocol` | QR + mDNS + manual fallback. Claim flow, token rotation, multi-device, offline scenarios. <30s onboarding budget. | `server`, `diffusion-client` | L | P0 | specced |
| `comfyui-management` | Three modes (managed / external local / external remote), required custom-node validation at startup, model discovery via `extra_model_paths.yml` mirror, lifecycle for managed mode. | `server` | L | P0 | specced |
<!-- job-queue spec ELIMINATED. Decision: ComfyUI owns the queue; the server is a tracker, not a queue manager.
     - Job tracking (mapping our ULID job_id ↔ ComfyUI prompt_id, persistence, audit) → server-architecture
     - ComfyUI queue interaction (submit, cancel, /interrupt, WebSocket subscription, restart-resume reconciliation) → comfyui-management
     - MCP tools cancel_job / get_job_status → already in mcp-tool-catalog
     Removed because a parallel server-side queue would diverge from ComfyUI's real queue, doubling cancellation paths and progress trackers.
-->

| `presets-and-models` | Style presets (model + sampler + LoRAs + defaults), checkpoint/LoRA/ControlNet/IP-Adapter registry, `download_model` tool with progress, deduplication, integrity checks. | `server`, `mcp-tools` | L | P1 | proposed |
| `standalone-server-binary` | `apps/server` CLI flags, config file, daemon mode, log formatting. v1 = `npx`; v2 = compiled binary + service integration. | `apps/server`, `server` | S (v1) | P1 | proposed |

## Client SDK / state / connection

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `client-sdk` | `@diffusecraft/diffusion-client`: pairing client, token storage, transport abstraction (stdio/HTTP/in-memory), tool invocation typed against `mcp-tools`, event subscription. Mirrors the MCP catalog 1:1. | `diffusion-client`, `mcp-tools` | L | P0 | specced |
| `client-state-architecture` | Zustand store layout: `editorStore` (slices) + `connectionStore` + `modelsStore` + `jobsStore` + `historyStore` + `mcpCatalogStore`. Factory pattern. Persistence boundaries. Server-state-via-stores rules. | `core`, `apps/mobile` | M | P0 | specced |
| `connection-management` | Paired backends list, current connection, switching, manual fallback, reconnect, mDNS discovery, multi-server scenarios. | `diffusion-client`, `core` | M | P1 | proposed |

## Tablet app (cross-cutting UX)

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `document-management` | Document lifecycle: create, open, save, delete, rename. Persistence model (server-side SQLite + image storage). Document list screen with thumbnails, metadata (last modified, canvas size, layer count). v1 = single active document per session; multi-document post-v1. | `server`, `core`, `apps/mobile` | M | P0 | proposed |
| `chat-panel` | Persistent chat panel in the tablet UI for conversing with the paired agent. Agent reasons about canvas state and invokes DiffuseCraft tools. Renders agent text responses, tool invocations in real-time, tool result summaries. Voice input via STT. Works with any sampling-capable agent (Claude Desktop/Code, Codex, Gemini CLI, custom). | `apps/mobile`, `server`, `mcp-tools` | L | P1 | proposed |
| `image-export` | Export current canvas or selected layers to PNG/JPEG. Save to device gallery (iOS Photos, Android MediaStore). Share sheet integration. Copy to clipboard. Optional metadata embedding (prompt, model, seed). MCP tool: `export_image({ format, layers?, quality? })`. | `server`, `mcp-tools`, `apps/mobile` | S | P1 | proposed |

## Editor (canvas, selection, layers)

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `undo-redo-system` | **Cross-cutting capability per P27.** Command pattern with periodic snapshots; per-client per-document stacks; default 100 ops, 1 snapshot every 20; MCP tools `undo`, `redo`, `get_undo_stack`, `get_redo_stack`, `clear_undo_stack`. **Every state-mutating operation in every editor spec wires into this system.** Used by `apply_history_item`, control-layer mutations, region mutations, layer ops, mask edits, transform, brush strokes. | `core`, `canvas-core`, `server`, `mcp-tools` | L | **P0** | specced |
| `canvas-fundamentals` | Document model, layers (paint, mask, control, region), groups, z-order, opacity, **blend modes (rich)**, layer thumbnails, drag-and-drop image import, paste from clipboard. Render-agnostic logic in `canvas-core`. All mutations wire into `undo-redo-system`. **Tier 1 — rich.** | `canvas-core`, `canvas-skia` | L | P0 | specced |
| `transform-tools` | **Tier 1 — rich.** Move, scale, rotate, free transform, **flip H/V, distort/perspective, skew, snap-to-grid, magic-snap to other layers' edges**. Pinch + two-finger rotation gestures. **Load-bearing for collage workflow.** | `canvas-core`, `apps/mobile` | M | **P0** (was P1) | specced |
| `selection-tools` | **Tier 2 — decent, NOT Photoshop.** Rectangle, lasso, polygonal lasso, magic wand (color-tolerance based), refine edge minimal (feather/grow/shrink/invert). No quick-mask, no color-range, no advanced refinement. Touch + stylus. | `canvas-core`, `apps/mobile` | M | P1 | specced |
| `mask-system` | **Tier 2 — decent.** Mask layers, brush-paintable masks, alpha-from-layer, blend mask vs denoising mask split (per krita-ai-diffusion). Used heavily for AI gating. | `canvas-core` | M | P1 | specced |
| `brush-system` | **Tier 3 — simple.** **4–6 fixed presets in v1**: pen, pencil, marker, eraser, smooth/blur, smudge. Pressure sensitivity. NO custom brush engine in v1 (post-v1 expansion). Apple Pencil + S-Pen pressure curves. | `canvas-core`, `canvas-skia` | S (was M, simplified) | P1 | specced |

## AI workflow (composes editor + client SDK)

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `generation-workflow` | The Generate / Refine / Fill verb-resolution logic. Tool: `generate_image(prompt, strength, selection?, control_layers[], region_overrides?)`. Selection sub-modes (Fill/Expand/Add Content/Remove Content/Replace Background). | `mcp-tools`, `server`, `apps/mobile` | XL | **P0** | specced |
| `generation-history` | Preview-then-apply pattern. `list_history`, `get_history_item`, `apply_history_item` tools. UI panel in the tablet app. Persistence in SQLite + image storage. | `mcp-tools`, `server`, `apps/mobile` | L | **P0** | specced |
| `control-layers` | Reference (IP-Adapter) + Structural (ControlNet) layer types, their tools (`add_control_layer`, `update_control_layer`, `list_control_layers`), preprocessing pipelines, per-region scope. | `mcp-tools`, `server`, `canvas-core`, `apps/mobile` | XL | P1 | specced |
| `regions` | Per-area prompts tied to layer opacity. Tools: `define_region`, `list_regions`, `update_region`. Root prompt + concatenation logic. | `mcp-tools`, `server`, `canvas-core`, `apps/mobile` | L | P1 | specced |
| `workspaces` | Mode switching: `Generate`, `Inpaint`, `Upscale`, `Live`, `Custom Graph`, `Animation`. Tools: `set_workspace`, `get_workspace`. UI panel changes. | `mcp-tools`, `apps/mobile` | M | P1 | specced |
| `live-mode` | Streaming generation with constant seed. Real-time canvas updates. Tool: `start_live_session`, `update_live_input`, `stop_live_session`. | `mcp-tools`, `server`, `apps/mobile` | L | P2 | proposed |
| `upscale-and-tiling` | Tile-based upscaling for ≥4K. Tool: `upscale_image(target, factor, model?)`. Tile + overlap + stitch logic invisible to caller. | `mcp-tools`, `server` | M | P1 | specced |
| `resolution-handling` | Hires-fix two-pass, multiples-of-N rounding, batch sizing, max-pixel-count enforcement — all server-side, transparent to caller. | `server` | S | P1 | specced |

## Scripting (sandboxed code execution on images)

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `script-execution` | Sandboxed Python/JS script runner that takes an image + params, runs user-supplied code in an isolated subprocess (no network, no FS write outside scratch, RAM + CPU + timeout limits), returns the modified image. Whitelisted libraries (Python: numpy, Pillow, opencv-python, scipy, scikit-image; JS: sharp, jimp). MCP tool: `apply_script({ language, code, target, params? })`. Reversible (commits result as a new layer or replaces target via Command). | `server`, `mcp-tools` | L | P1 | specced |

## Voice and prompt enhancement

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `speech-to-text` | OS-native STT in `apps/mobile` (default). Optional server-side Whisper exposed as MCP tool `transcribe_audio`. Multilingual. | `apps/mobile`, `server`, `mcp-tools` | M | P1 | specced |
| `prompt-enhancement` | `enhance_prompt(input, context)` MCP tool. Server uses MCP sampling to ask the calling agent to rewrite. Client-direct fallback. Independent of STT. | `mcp-tools`, `server` | M | P1 | specced |

## Integration

| Slug | Description | Layer | Size | Priority | Status |
|---|---|---|---|---|---|
| `meshcraft-integration` | **Contract-only spec** (B1 from Q4). What MCP tools MeshCraft consumes per pipeline phase, how it embeds `@diffusecraft/server` in-process, loopback auth without pairing UI, orchestration of the 6-phase pipeline as MCP client. No code, no PoC. | `server`, `mcp-tools` | M | P1 | specced |
| `external-agent-integration` | How Claude Desktop, Claude Code, OpenAI Codex / ChatGPT Desktop, Gemini CLI, custom agents connect to the server's MCP **as clients** AND how the server uses the same connected agent **as a backend** via MCP sampling (for prompt enhancement, prompt-based selection, etc.). Configuration examples per agent. Tested compatibility matrix for both roles. Sampling protocol contract documented. | `server`, docs | L (was M; expanded scope) | P1 | specced |

---

## v0.1 minimal cut

The smallest possible v0.1 that exercises the **full architecture seam** end to end. It is intentionally narrow on features so we can validate the contract surface (server → MCP catalog → client SDK → host integration → tablet UI) before scaling.

### Scope

**Server (`@diffusecraft/server` + `apps/server`):**
- Loads, runs `createDiffuseCraftServer`, mounts stdio + Streamable HTTP transports.
- Connects to an external local ComfyUI (managed and remote modes deferred).
- Validates required custom nodes at startup; fails clearly if missing.
- Persists tokens, audit log, history metadata in SQLite.
- Bootstrap admin token printed at first run.

**MCP catalog (`@diffusecraft/mcp-tools`):**
- Just enough tools to validate the architecture:
  - `list_models` *(read)*
  - `list_presets` *(read)*
  - `list_history` *(read)*
  - `get_history_item` *(read)*
  - `generate_image` *(job)* — txt2img only at first; no selection, no control layers, no regions
  - `apply_history_item` *(write, reversible)*
  - `cancel_job` *(write)*
  - `undo` *(write, reversible)*
  - `redo` *(write, reversible)*
  - `get_undo_stack` *(read)*
- Plus events: `job.progress`, `job.completed`, `job.failed`, `document.changed`.
- No `enhance_prompt`, no `transcribe_audio`, no `add_control_layer`, no `define_region`, no `set_workspace` in v0.1.

**Pairing (`pairing-protocol` minimal v0.1):**
- **mDNS-first** in v0.1. The server advertises `_diffusecraft._tcp.local` with name and port; the tablet lists discovered servers, user taps, server approves (auto-window for `npx @diffusecraft/server`, visual prompt in MeshCraft).
- **QR fallback** also in v0.1 — implemented but secondary path. Used when mDNS is blocked or unavailable.
- Numeric 6-digit code and URL+token paste deferred to v0.2 (rare cases).
- Single-tier access: paired device gets full capability. No scope picker.
- **LAN-only.** Internet reachability is post-v1 and tunnel-only (see `tech.md` deferred decisions).

**Client SDK (`@diffusecraft/diffusion-client`):**
- HTTP transport only; stdio for agents but not exercised in v0.1 GUI.
- Calls the 7 catalog tools; subscribes to job events.
- Stores token in AsyncStorage; one paired backend at a time.

**Tablet app (`apps/mobile`):**
- Onboarding flow: **mDNS-first auto-discovery + tap-to-pair (default), QR fallback (secondary), URL+token paste (hidden Advanced)** per `pairing-protocol`. Numeric 6-digit code is post-v0.1.
- Single screen: prompt input (typed only — no STT yet), Generate button, current job progress, history strip at the bottom, tap to apply.
- No layers, no selection, no canvas editor. The "canvas" is just a single image preview that shows the latest applied result.

**Agent path:**
- Via MCP, an external agent (Claude Desktop or Claude Code) can perform exactly the same flow: list models, generate image, apply history item.
- This is the agent-first proof: the agent's experience is feature-complete relative to the GUI's experience for this scope.

### Explicit non-goals for v0.1

- No selection, no Fill/Expand/Add/Remove/Replace, no canvas editor, no layers, no transform.
- No control layers (Reference or Structural).
- No regions.
- No workspaces (the app is implicitly always in a "generate" mode).
- No live mode.
- No upscale / tiling.
- No prompt enhancement (raw prompt only — must be English; no auto-translate phase yet either).
- No speech-to-text.
- No numeric-code pairing (mDNS + QR + URL paste only).
- No managed ComfyUI install — user brings their own.
- No MeshCraft integration.

### What v0.1 proves

| Architecture seam | Validated by |
|---|---|
| MCP catalog → server handler registration | Build fails if a catalogued tool has no handler |
| Server → ComfyUI proxy | A txt2img job round-trips via the server |
| Server → client SDK type contract | Generated TS types from `mcp-tools` consumed in `diffusion-client` calls |
| Client SDK → tablet UI | One screen drives the full workflow |
| Server → agent (MCP stdio + HTTP) | External agent runs the same flow |
| Auth model | Token-based pairing + scoped invocation works end-to-end |
| Persistence | History survives server restart |
| Job model | Progress events stream, cancel works |

### Dependency order (for execution after specs)

1. `mcp-tool-catalog` (full v1 catalog scope, but only the v0.1 subset is implemented first)
2. `server-architecture` (token verification middleware lives here; no separate `auth-and-proxy` spec — superseded)
3. `comfyui-management` (external local mode only in v0.1)
4. `pairing-protocol` (mDNS-first + QR fallback + URL paste; numeric code post-v0.1)
5. `client-sdk`
6. `client-state-architecture`
7. `generation-workflow` (txt2img path only in v0.1)
8. `generation-history`
9. **v0.1 minimal cut shippable here.**

After v0.1: pairing-protocol full (numeric code + multi-device + revocation UX), generation-workflow (selection sub-modes, refine, fill), document-management, control-layers, regions, workspaces, presets-and-models full, prompt-enhancement (incl. server-side auto-translate), speech-to-text, upscale-and-tiling, resolution-handling, undo-redo-system, transform-tools, mask-system, selection-tools, brush-system, script-execution, chat-panel, image-export, live-mode, connection-management (multi-server), meshcraft-integration spec, external-agent-integration spec, standalone-server-binary v2 (compiled binary).

---

## Spec ordering for Phase 3 (after this backlog is approved)

Per Q4 in clarifying questions, **Phase 3 starts with `mcp-tool-catalog`** as the first feature spec. It is the contract every other spec references. After it is approved (requirements + design + tasks), the next specs in dependency order are:

1. `mcp-tool-catalog` ✅ specced
2. `server-architecture` ✅ specced
3. `client-state-architecture` ✅ specced
4. `client-sdk` ✅ specced
5. `comfyui-management` ✅ specced
6. `generation-workflow` ✅ specced
7. `generation-history` ✅ specced
8. `pairing-protocol` ✅ specced
9. `canvas-fundamentals` ✅ specced
10. `undo-redo-system` ✅ specced
11. `transform-tools` ✅ specced
12. `selection-tools` ✅ specced
13. `mask-system` ✅ specced
14. `brush-system` ✅ specced
15. `control-layers` ✅ specced
16. `regions` ✅ specced
17. `workspaces` ✅ specced
18. `upscale-and-tiling` ✅ specced
19. `resolution-handling` ✅ specced
20. `prompt-enhancement` ✅ specced
21. `speech-to-text` ✅ specced
22. `script-execution` ✅ specced
23. `external-agent-integration` ✅ specced
24. `meshcraft-integration` ✅ specced

**Remaining specs to write (no folder yet):**

25. `presets-and-models` — P1, depends on `mcp-tool-catalog` + `server-architecture`
26. `standalone-server-binary` — P1, depends on `server-architecture`
27. `connection-management` — P1, depends on `client-sdk` + `pairing-protocol`
28. `document-management` — P0, depends on `server-architecture` + `canvas-fundamentals` + `client-state-architecture`
29. `chat-panel` — P1, depends on `external-agent-integration` + `client-state-architecture`
30. `image-export` — P1, depends on `canvas-fundamentals` + `server-architecture`
31. `live-mode` — P2, depends on `generation-workflow` + `comfyui-management`

**UI implementation roadmap specs (all specced, see `_ui-implementation-roadmap.md`):**

- `design-system-foundation` ✅ specced
- `ui-component-library` ✅ specced
- `app-shell-navigation` ✅ specced
- `screens-implementation` ✅ specced
- `visual-verification` ✅ specced

> Note: `auth-and-proxy` was removed after Q7 simplification (content distributed across server-architecture, pairing-protocol, comfyui-management).
> Note: `job-queue` was removed after the decision "ComfyUI owns the queue" — server is a job *tracker*, not a queue manager. Tracking lives in `server-architecture` + `comfyui-management`.

`meshcraft-integration` (B1 contract-only) can be specced any time after `mcp-tool-catalog` is approved; it primarily references the catalog.

---

## Open questions

- **Confirm the v0.1 minimal cut.** Is the scope above too narrow? Too wide? Specifically: should v0.1 include selection + Fill (inpaint), or is txt2img-only enough to prove the seam?
- **Confirm the order.** Does anything in the dependency chain need to move?
- **Write remaining specs.** 7 specs still need folders: `presets-and-models`, `standalone-server-binary`, `connection-management`, `document-management`, `chat-panel`, `image-export`, `live-mode`.
- **`document-management` priority.** Currently not in the backlog at all. Without it, there's no document lifecycle (create/open/save/delete). Should it be P0 for v0.1, or can v0.1 assume a single implicit document?
- **`chat-panel` scope.** `external-agent-integration` covers the protocol side. The chat panel is the UX side — rendering agent responses, showing tool invocations live, voice input in chat. Confirm it warrants its own spec vs being folded into `external-agent-integration`.
- **Error handling / offline resilience.** No cross-cutting spec for client-side error recovery (server disconnect mid-generation, WiFi drop, reconnection). Currently handled ad-hoc per spec. Confirm whether a dedicated spec is needed or if per-spec coverage is sufficient.

---

## Known limitations / nice-to-have polish (post-v1)

The following gaps were identified in cross-spec audit but are intentionally not blocking v1 implementation. Each is a small clarification to add when the corresponding spec is touched next.

| Item | Spec | Note |
|---|---|---|
| Multi-document v1 assumption | `client-state-architecture` | v1 = single active document per session. Document the assumption in acceptance criteria; multi-window post-v1. |
| `MODEL_METADATA[unknown_id]` safe fallback | `prompt-enhancement` + `resolution-handling` | Always return SDXL-conservative defaults via `?? FALLBACK_SDXL_METADATA` to avoid undefined-throw. |
| P22 touch-first formal audit | cross-spec | Add a CI lint rule or doc check that scans editor specs for "mouse" appearing before "touch" in interaction lists. |
| Region naming editability in tablet | `regions` | Confirm tablet UI lets user rename regions (default `Region N`); add to `<RegionRow />` UX. |
| `summarize` function for chat tool results | `external-agent-integration` | Define a small per-tool summarizer (e.g., `generate_image → "Generated 4 images"`); 1–2 lines per tool type. |
| Hires-fix ↔ tile-upscale at exactly 3x | `resolution-handling` + `upscale-and-tiling` | 3x falls in `decomposeFactor` as single pass; verify graph builder handles it without ambiguity. |
| MCP prompt templates expansion | `mcp-tool-catalog` | Ship full text for all 4 templates (currently only one shown in design); move to prompts/ subfolder. |
| Resource cache invalidation on catalog version change | `client-state-architecture` | `mcpCatalogStore` should invalidate on handshake when negotiated catalog version differs from cached. |
| Performance composition test | cross-cutting | Single integration test: 100 layers + active transform + brush stroke maintains 60 FPS (no spec covers the composite). |
| Custom tool source restriction | `meshcraft-integration` + `external-agent-integration` | Document explicitly that `addCustomTool` is host-only (MeshCraft, future hosts); agents cannot register their own tools in v1. |
| Document lock behavior during chat | `external-agent-integration` | Chat tool execution does NOT lock the document; conflicts resolve last-write-wins per `mcp-tool-catalog` FR-23. |
| Stdio vs HTTP for embedded-host external agents | `external-agent-integration` + `meshcraft-integration` | Host-embedded servers (MeshCraft) accept external agents via HTTP only; stdio is for the standalone binary. |

These items are tracked here rather than in individual specs to avoid scattering tiny TBDs. Each is sub-day work; bundle into a "v1 polish PR" before release.
