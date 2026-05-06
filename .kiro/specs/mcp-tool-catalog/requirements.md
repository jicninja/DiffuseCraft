# mcp-tool-catalog — Requirements

> **Status:** Draft v0.1 — Phase 3 first feature spec.
> **Owners:** Tech Lead.
> **References:** P1 (Agent-first), P2 (Human UX on top of agent API), P3 (Agent-agnostic), P5 (State queryable), P6 (Idempotency & explicit side effects), P7 (Long-running ops expose progress), P27 (Universal undo/redo).
> **Krita-ai-diffusion analogues:** `ai_diffusion/model.py`, `ai_diffusion/control.py`, `ai_diffusion/region.py`, `ai_diffusion/jobs.py`, `ai_diffusion/connection.py`.
> **MCP design patterns referenced:** Filesystem MCP (clear naming, side-effect labels), GitHub MCP (composable verbs), Linear MCP (typed schemas with rich descriptions).

## 1. Purpose

This spec defines the **canonical MCP tool catalog** that DiffuseCraft exposes to AI agents and to its own GUI client. The catalog is the **single source of truth** for every operation the platform supports — every other spec (`server-architecture`, `client-sdk`, every editor and AI-workflow spec) must align with the schemas and semantics declared here.

The catalog lives in the `@diffusecraft/mcp-tools` package as Zod schemas + manifest. The build pipeline emits a JSON Schema artifact for the MCP handshake. The server registers handlers against the schemas; the client SDK consumes the same schemas for typed call sites; agents discover the catalog via standard MCP `tools/list` + `resources/list` calls.

**This spec defines the contract surface.** It does not define handler implementations (that's `server-architecture` and individual feature specs), nor UI surfaces (that's `apps/mobile` work).

## 2. Stakeholders & primary user stories

The catalog is consumed by four concrete classes of clients. Every requirement below must satisfy all four.

### S1 — Tablet app (`apps/mobile`)
The DiffuseCraft Expo app is itself an MCP-equivalent client. Every screen, button, gesture in the app maps to a tool invocation or a resource read.

> **Story 1.** As the tablet app, when the illustrator taps "Generate", I invoke `generate_image(...)`, receive a job handle, subscribe to `job.progress` events, and update the UI as previews land. When the user taps a preview, I invoke `apply_history_item(...)` and the canvas updates.

> **Story 2.** As the tablet app, when the illustrator opens a document, I read `canvas.state` and `history.list` resources (or call the equivalent tools) to populate the UI without any internal-only API.

> **Story 3.** As the tablet app, when the user makes a mistake, I invoke `undo` and the canvas reverts. The same tool an agent would use.

### S2 — Claude Code / Claude Desktop / external CLI agents
Vendor-agnostic agents that connect via stdio (local) or Streamable HTTP (remote). Drive sessions autonomously or interactively with a human.

> **Story 4.** As Claude Code given a creative brief, I list available presets via `list_presets`, pick one, generate a series of variations via `generate_image` with different seeds, observe progress via `job.progress` events, list the resulting previews via `list_history`, and apply the best one via `apply_history_item` — all without any GUI.

> **Story 5.** As Claude Desktop running alongside DiffuseCraft on the user's laptop, when the human asks me "make this brighter", I read the current canvas state via `get_canvas_state`, invoke `generate_image` with a refine strength and a brightness-shifted prompt, and present the preview in the chat.

### S3 — MeshCraft pipeline (in-process MCP client of its own embedded server)
MeshCraft's 6-phase pipeline embeds `@diffusecraft/server` and drives it via the in-memory transport for phases 1-2 (concept art) and phase 6 (texture refinement).

> **Story 6.** As the MeshCraft pipeline starting phase 1 (concept art), I open a document via `create_document`, set parameters via `set_workspace("Generate")`, batch-invoke `generate_image` with the character description, list the results, and pass the best previews to phase 2 — without any GUI involvement.

> **Story 7.** As the MeshCraft pipeline reaching phase 6 (texture refinement), I load the texture as a layer via `import_image`, define a region via `define_region(mask, prompt)`, invoke `generate_image` constrained to that region, and apply the result.

### S4 — Custom external agents (third-party orchestrators)
Batch-processing scripts, automation pipelines, research tools.

> **Story 8.** As a batch-processing agent, I receive a list of 100 prompts, invoke `generate_image` for each (queued by the server), monitor `job.progress` and `job.completed` events to track completion, and write the results to disk via `export_image`.

## 3. Functional requirements (EARS-style)

### 3.1 Catalog discovery and structure

**FR-1 (Ubiquitous).** The system SHALL expose its full tool catalog via the standard MCP `tools/list` request and its full resource catalog via `resources/list`.

**FR-2 (Ubiquitous).** Each tool entry SHALL include: `name` (snake_case `verb_noun`), `title` (human-readable), `description` (rich, multi-paragraph, English, suitable for an agent prompt), `inputSchema` (JSON Schema), `outputSchema` (JSON Schema), and the DiffuseCraft-specific extension fields `category`, `idempotent`, and `since` (catalog version).

**FR-3 (Ubiquitous).** Each tool's `category` SHALL be one of: `read` (no side effects), `write` (mutates state synchronously, completes within 5 seconds), or `job` (long-running, returns a job handle, side effects on completion).

**FR-4 (Ubiquitous).** Each tool entry SHALL declare whether it is `idempotent: true | false`. Read tools SHALL be idempotent. Write and job tools MAY be idempotent or not, declared explicitly.

**FR-5 (Ubiquitous).** Each tool's `description` SHALL include at minimum: a one-paragraph summary, a list of preconditions, a list of side effects (or "none" for read tools), at least one example invocation in JSON, and a link to the relevant feature spec.

**FR-6 (Ubiquitous).** The catalog SHALL declare a top-level `version` field following semver. Adding a tool is a minor bump; removing or renaming a tool, or changing an existing schema in a non-backward-compatible way, is a major bump; backward-compatible schema additions are minor bumps.

**FR-7 (Event-driven).** WHEN the catalog version changes between client and server, THEN the server SHALL respond to handshake with the supported catalog version range and SHALL return error code `UNSUPPORTED_CATALOG_VERSION` for tool calls whose schema differs.

### 3.2 Resources (queryable state)

**FR-8 (Ubiquitous).** The system SHALL expose at least the following resources, each with stable URI templates and JSON content:

| Resource URI | Content |
|---|---|
| `diffusecraft://server/info` | Version, supported catalog version, mounted transports, comfyui status, audit-log enabled, server name |
| `diffusecraft://document/current` | Current document metadata: id, name, dimensions, layer count, active workspace |
| `diffusecraft://document/<id>/state` | Full document state: layers (id, type, name, opacity, visibility, blend), selection, active tool, regions, control layers |
| `diffusecraft://history/list` | Generation history previews (paginated): id, prompt, parameters, thumbnail URI, created_at, applied_to_layer |
| `diffusecraft://history/<id>` | Full history item including image URI |
| `diffusecraft://models/list` | Available checkpoints, LoRAs, ControlNets, IP-Adapters, VAEs |
| `diffusecraft://presets/list` | All presets with their underlying parameters |
| `diffusecraft://jobs/active` | All active and recently-completed jobs |
| `diffusecraft://undo-stack/<document-id>` | Undo stack for a document (list of operation summaries) |
| `diffusecraft://redo-stack/<document-id>` | Redo stack for a document |

**FR-9 (Ubiquitous).** Resource reads SHALL be idempotent and SHALL NOT mutate any state.

**FR-10 (Ubiquitous).** Every resource SHALL be reachable via at least one read tool as a parallel route (e.g., `get_document_state(id)` returning the same content as `diffusecraft://document/<id>/state`). Rationale: agents that prefer tool-first orchestration should not need to switch paradigms to read state.

### 3.3 Tools — minimum viable catalog (v1 scope)

The catalog v1 totals **60 tools** (post all spec extensions; baseline 38 + 22 added across editor/AI specs). Cap is **65** per FR-36 (history of cap raises in §3.3.21). List operations are exposed as **resources** (FR-8/9), not as parallel `list_*` tools, to reduce catalog footprint. Tools are grouped by domain. Tables below in §3.3.1–3.3.18 cover the **38-tool baseline**; §3.3.21 lists the 22 tools added by descendant specs and the running total / cap raises.

#### 3.3.1 Server / session (3 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `get_server_info` | read | yes | Returns version, transports, comfyui status, recommended starting workflow. |
| `revoke_token` | write | yes | Revokes a pairing token by id. |
| `get_audit_log` | read | yes | Returns recent audit log entries (paginated). |

> Lists exposed as resources: `diffusecraft://server/info`, `diffusecraft://server/paired-devices`, `diffusecraft://server/audit-log`.

#### 3.3.2 Documents (3 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `create_document` | write | no | Creates a new document with given dimensions. Becomes active. |
| `set_active_document` | write | yes | Discriminated union: `{ action: "open" \| "close" \| "set_active", id, params? }`. Replaces individual open/close/set tools. |
| `get_document_state` | read | yes | Returns full bundled state: layers + selection + workspace + regions + control layers (FR-44 bundled query). |

> List exposed as resource: `diffusecraft://documents/list`.

#### 3.3.3 Layers (3 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `add_layer` | write | no | Adds a layer (paint, mask, control, region). Optional initial image content. Reversible. |
| `remove_layer` | write | yes | Removes a layer by id. Reversible. |
| `update_layer` | write | yes | Updates one or more of: name, opacity, visibility, blend_mode, position (reorder). Reversible. |

> Reorder collapsed into `update_layer({ id, position })`. Import absorbed into `add_layer({ kind: "paint", content })`.

#### 3.3.4 Selection

Collapsed to two tools per MCP optimization (§3.9): one universal setter + one reader.

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `set_selection` | write | yes | Sets / clears / modifies the active selection. Input shape (one of): `{ kind: "rect", rect }`, `{ kind: "mask", mask: ImageRef }`, `{ kind: "clear" }`, `{ kind: "modify", op: "grow"\|"shrink"\|"feather"\|"blur"\|"invert", amount? }`. Reversible. |
| `get_selection` | read | yes | Returns the active selection metadata. Optional `include_mask: true` to also fetch the mask bytes. |

#### 3.3.5 Generation (3 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `generate_image` | job | no (different seeds → different results unless seed fixed) | Submits a generation job. Resolves verb (Generate / Refine / Fill + sub-mode) from inputs. Returns a job handle. **Minimum invocation: `{ "prompt": "..." }`** (FR-41). |
| `cancel_job` | write | yes | Cancels a running job. |
| `get_job_status` | read | yes | Returns job state, progress percentage, ETA. |

> List as resource: `diffusecraft://jobs/list`.

`generate_image` input schema (informative summary; full schema in `design.md`):
- `prompt`: string (English, per P23)
- `negative_prompt?`: string
- `strength`: number (0–100)
- `selection?`: { rect?, mask? } — when present, output is constrained to selection
- `selection_mode?`: one of `Fill`, `Expand`, `AddContent`, `RemoveContent`, `ReplaceBackground` — required when selection is present
- `seed?`: integer | "random"
- `preset?`: string (preset name) — bundles model + sampler + LoRAs
- `model?`: string — overrides preset's model
- `control_layer_ids?`: string[] — control layers to include
- `region_ids?`: string[] — when set, only these regions apply
- `batch_size?`: integer (default 1, max from server config)

Output: `{ job_id: string, resolved_verb: "generate" | "refine" | "fill" | "constrained_variation", batch_size: integer }`.

#### 3.3.6 Generation history (3 tools, preview-then-apply per P8)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `get_history_item` | read | yes | Returns a single history item with metadata + thumbnail ref. Full image fetched via `get_image({ scope: "history_item", id })`. |
| `apply_history_item` | write | no | Applies a preview as a new layer in the active document. Reversible. **Minimum invocation: `{ "history_item_id": "..." }`** (FR-42). |
| `discard_history_item` | write | yes | Removes from history (already-applied layers untouched). |

> List as resource: `diffusecraft://history/list`.

#### 3.3.7 Control layers (2 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `add_control_layer` | write | no | Adds a control layer (`type: "reference"\|"style"\|"composition"\|"face"\|"scribble"\|"line_art"\|"soft_edge"\|"canny"\|"depth"\|"normal"\|"pose"\|"segmentation"\|"unblur"\|"stencil"`). Reversible. |
| `remove_control_layer` | write | yes | Removes a control layer by id. Reversible. |

> Updates collapsed: change weight/image/scope by `remove + add` (cost is one extra round-trip; saves a tool). List as resource: `diffusecraft://control-layers/list`.

#### 3.3.8 Regions (2 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `define_region` | write | no | Creates a region linked to a paint layer's opacity with a per-region prompt. Reversible. |
| `remove_region` | write | yes | Removes a region. Reversible. |

> Updates collapsed: replace via `remove + define`. List as resource: `diffusecraft://regions/list`.

#### 3.3.9 Workspaces

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `set_workspace` | write | yes | Sets active workspace: `Generate`, `Inpaint`, `Upscale`, `Live`, `CustomGraph`, `Animation` |
| `get_workspace` | read | yes | Returns current workspace |

#### 3.3.10 Upscale (1 tool)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `upscale_image` | job | no | Submits a tile-based upscale job. Returns a job handle. |

#### 3.3.11 Live mode (deferred to v0.2)

Tools for `Live` workspace (`start_live_session`, `update_live_input`, `stop_live_session`) are **deferred from v1**. The Live workspace is announced in `set_workspace` but the tools to drive it ship in a later catalog version.

#### 3.3.12 Models and presets (4 tools)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `download_model` | job | yes (no-op if present) | Downloads a model. Id format: `<registry>:<repo-or-id>` (e.g., `hf:Stability-AI/sdxl-base-1.0`, `civitai:dreamshaper`). |
| `delete_model` | write | yes | Deletes a model file from disk. |
| `set_preset` | write | yes | Upsert. Creates if `id` absent, updates if present. |
| `delete_preset` | write | yes | Deletes a preset by id. |

> Lists as resources: `diffusecraft://models/list`, `diffusecraft://presets/list`. `create_preset`+`update_preset` collapsed to `set_preset` (upsert).

#### 3.3.13 Speech and prompt enhancement

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `transcribe_audio` | job | no | Transcribes audio to text using server-side Whisper (optional path; OS-native STT preferred when available). |
| `enhance_prompt` | job | no | Rewrites a prompt to model-ready English using MCP sampling against the calling agent. Independent of `transcribe_audio` per P24. |

#### 3.3.14 Undo / redo (2 tools, P27)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `undo` | write | yes | Reverts the calling client's last reversible operation in the active document. |
| `redo` | write | yes | Re-applies the calling client's most recently undone operation. |

> Stacks as resources: `diffusecraft://undo-stack/<document-id>`, `diffusecraft://redo-stack/<document-id>`. `clear_undo_stack` removed from v1 (rare; can be done via `set_active_document` with a fresh open).

#### 3.3.15 Export (1 tool)

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `export_image` | write | no | Exports the active document (or specified layers) as image bytes (returns envelope) or to a server-side file path. |

> Import absorbed into `add_layer({ kind: "paint", content })` with image envelope.

#### 3.3.16 Image data access (read) — full agent visibility

The MCP catalog grants agents **pixel-level read access** to the canvas, every layer, the current selection, and arbitrary regions. Collapsed to a single polymorphic tool + a sampling tool per MCP optimization (§3.9).

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `get_image` | read | yes | Returns image data for any addressable scope. Input: `{ scope: "document" \| "layer" \| "selection" \| "region" \| "history_item" \| "thumbnail", id?, alpha_only?, region?, format?, max_dimension? }`. Returns the standard image envelope (`inline` or `ref`). One tool covers composite document, individual layers, selection content, selection mask (`scope:"selection", alpha_only: true`), region content, history previews, and downscaled thumbnails. |
| `get_pixel` | read | yes | Returns RGBA at `(x, y)` of a target (`scope`, `id?`). For sparse color sampling without a full image transfer. |

**Image transfer model.** All image-returning tools return a structured response:
```typescript
{
  format: "png" | "jpeg" | "webp",
  width: number,
  height: number,
  // exactly one of:
  inline?: { encoding: "base64", data: string },        // for ≤256 KB images
  ref?: { uri: "diffusecraft://blob/<ulid>", expires_at: ISO8601 }   // for larger images
}
```

The choice of `inline` vs `ref` is determined by the server based on size and the client's declared transport capabilities (declared at handshake). Agents fetch `ref` URIs via standard MCP `resources/read`. Blob URIs are short-lived (default 5 minutes) and signed against the calling token.

#### 3.3.17 Image data editing (3 tools in v1, more deferred)

Agents can mutate pixels. All are **reversible** and register Commands with the undo/redo system per P27.

| Tool | Category | Idempotent | Purpose |
|---|---|---|---|
| `paint_strokes` | write | no | Applies a sequence of brush strokes to a paint layer or mask. `{ layer_id, strokes: { points, pressure[], color, brush_id, size }[], blend_mode? }`. Reversible. |
| `paint_area` | write | no | Floods or clears a region. `{ layer_id, mode: "fill" \| "erase" \| "color_replace", target: selection \| rect \| mask, content: color \| gradient \| image_ref }`. Replaces fill_area + erase_area + color-replace. Reversible. |
| `upload_blob` | write | no | Returns a blob ULID after the agent uploads image bytes. Subsequent tools reference the ULID instead of inlining bytes. |

**Deferred to v0.x (post-v1):** `replace_layer_image`, `composite_image_into_layer`, `apply_filter`, `transform_layer`, `merge_layers`, `duplicate_layer`. Each gets its own feature spec when prioritized. v1 covers: brush input + region fill/erase + AI-generated layer apply (`apply_history_item`), which is sufficient for the AI-driven workflow.

**Input image transfer.** Tools that accept image bytes (`replace_layer_image`, `composite_image_into_layer`, `import_image`) take the same envelope as image-returning tools, but client → server:
```typescript
{
  format: "png" | "jpeg" | "webp",
  width: number,
  height: number,
  // exactly one of:
  inline?: { encoding: "base64", data: string },
  ref?: { uri: "diffusecraft://blob/<ulid>" }      // client uploaded a blob first via upload_blob tool
}
```

For larger uploads, agents use `upload_blob` (write, no — returns a blob ULID) and then reference that ULID in subsequent tool calls.

#### 3.3.18 Selection-aware editing

Selections gate edits at the tool level — `paint_strokes`, `fill_area`, `erase_area`, `apply_filter`, `composite_image_into_layer`, `transform_layer` all SHALL respect the active selection automatically when present, restricting the edit to selected pixels. This matches krita-ai-diffusion's mental model: a selection is a constraint on subsequent operations.

When a tool needs to **bypass** the active selection (rare, advanced), it accepts an optional `ignore_selection: true` flag.

#### 3.3.19 v1 catalog baseline (this spec)

This spec defines a **38-tool baseline** for v1. Descendant specs (transform-tools, mask-system, etc.) extend the catalog; §3.3.21 tracks all additions.

| Domain | Tools | Count |
|---|---|---|
| Server / session | `get_server_info`, `revoke_token`, `get_audit_log` | 3 |
| Documents | `create_document`, `set_active_document`, `get_document_state` | 3 |
| Layers | `add_layer`, `remove_layer`, `update_layer` | 3 |
| Selection | `set_selection`, `get_selection` | 2 |
| Generation | `generate_image`, `cancel_job`, `get_job_status` | 3 |
| History | `get_history_item`, `apply_history_item`, `discard_history_item` | 3 |
| Control layers | `add_control_layer`, `remove_control_layer` | 2 |
| Regions | `define_region`, `remove_region` | 2 |
| Workspaces | `set_workspace` (`reversible: false`), `get_workspace` | 2 |
| Upscale | `upscale_image` | 1 |
| Models / presets | `download_model`, `delete_model`, `set_preset`, `delete_preset` | 4 |
| Speech / enhance | `transcribe_audio`, `enhance_prompt` | 2 |
| Undo / redo | `undo`, `redo` | 2 |
| Image read | `get_image`, `get_pixel` | 2 |
| Image edit | `paint_strokes`, `paint_area`, `upload_blob` | 3 |
| Export | `export_image` | 1 |
| **Baseline total** | | **38** |

**List operations are NOT tools.** Lists are exposed only as MCP resources (`diffusecraft://<domain>/list`), saving ~10 tool slots and freeing context for agents.

#### 3.3.21 Catalog tracking — tools added by descendant specs

| # | Spec | Tools added | After this spec | Cap at the time |
|---|---|---|---|---|
| 0 | mcp-tool-catalog (baseline) | 38 baseline | **38** | 40 |
| 1 | transform-tools | `transform_layer` (1) | **39** | 40 |
| 2 | mask-system | `refine_mask`, `invert_mask`, `clear_mask`, `fill_mask`, `selection_to_mask`, `mask_to_selection`, `bake_mask` (7) | **46** | 50 (raised here) |
| 3 | selection-tools | `invert_selection`, `select_all`, `refine_selection`, `auto_select_subject`, `select_by_prompt` (5) | **51** | 55 (raised here) |
| 4 | script-execution | `apply_script` (1) | **52** | 55 |
| 5 | brush-system | `import_brush`, `delete_brush` (2) | **54** | 55 |
| 6 | control-layers | `regenerate_control_preprocess` (1) | **55** | 55 |
| 7 | regions | `update_region`, `set_root_prompt` (2) | **57** | 60 (raised here) |
| 8 | external-agent-integration | `send_chat_message`, `get_chat_history`, `clear_chat` (3) | **60** | 65 (raised here) |
| **v1 final** | | **22 added** | **60 total** | **65** |

This table is the **canonical running tally**. When a future spec adds tools, append a row. Footprint NFR-3 (≤100 KB compiled) remains the hard gate; the cap is a soft guard against bloat that triggers a re-review when crossed.

#### 3.3.20 Tool subset used by the tablet app (`apps/mobile`)

Per P2 (Human UX is built on top of the agent API), the app calls the same catalog. Below is which tools the app **invokes** vs **observes via resources/events**.

**Invoked actively by the user via the GUI (every paired user can perform these):**
- All Documents tools (3)
- All Layers tools (3)
- All Selection tools (2)
- All Generation tools (3)
- All History tools (3)
- All Control-layer tools (2)
- All Region tools (2)
- All Workspace tools (2)
- `upscale_image`
- `transcribe_audio`, `enhance_prompt`
- All Undo/redo tools (2)
- All Image read tools (2)
- All Image edit tools (3)
- `export_image`

→ **27 tools directly bound to GUI actions.**

**Indirectly invoked or rarely:**
- `download_model`, `delete_model`, `set_preset`, `delete_preset` — exposed in a "Models & Presets" settings screen, not core flow.
- `get_server_info`, `get_audit_log`, `revoke_token` — exposed in a "Server & Devices" admin screen.
- `cancel_job` — automatically called when the user taps a "Cancel" indicator on a running job.

→ **8 tools in admin/settings screens.**

**Observed via resources / events (not directly invoked):**
- `diffusecraft://*/list` resources — read on screen mounts to populate UI.
- `job.progress`, `job.completed`, `document.changed`, `model.download.progress`, `audit.entry` — subscribed; UI updates reactively.

**Tools the app does NOT use** (agent-only or post-v1 deferred):
- None in v1: every tool in the v1 catalog is reachable from some screen of the app, because the app must validate that the catalog is complete for human flows (P2).

**Bundled flows the app composes:**
- "Generate" button → `set_workspace("Generate")` (if not already) + `generate_image(prompt)`
- "Refine" gesture → `generate_image(prompt, strength: 70)`
- "Inpaint selection" → `generate_image(prompt, strength: 100, selection: <current>, selection_mode: "Fill")`
- "Apply preview" tap → `apply_history_item(id)`
- "Undo" two-finger tap → `undo()`
- Voice input → `transcribe_audio(audio_blob)` then optionally `enhance_prompt(text)`
- Pair new device → server emits pairing-request event; admin user taps "Approve" — no MCP tool, internal pairing protocol path.

### 3.4 Events (typed channel for long-running ops, per P7)

**FR-11 (Event-driven).** WHEN a job's progress changes, THE system SHALL emit `job.progress` with `{ job_id, percent, eta_seconds, stage }`.

**FR-12 (Event-driven).** WHEN a job completes, THE system SHALL emit `job.completed` with `{ job_id, outcome: "success" | "failure" | "cancelled", history_item_id?, error? }`.

**FR-13 (Event-driven).** WHEN any client mutates document state, THE system SHALL emit `document.changed` with `{ document_id, change_summary, originating_token_name }` to all paired clients.

**FR-14 (Event-driven).** WHEN a model download progresses, THE system SHALL emit `model.download.progress` with `{ model_id, percent, bytes_done, bytes_total }`.

**FR-15 (Event-driven).** WHEN the audit log records a new entry, THE system MAY emit `audit.entry` for clients subscribed (typically only the GUI).

### 3.5 Side effects, idempotency, reversibility (P6, P27)

**FR-16 (Ubiquitous).** Every tool SHALL declare a `reversible: true | false` field in metadata. Reversible operations SHALL register a `Command` with the undo/redo system upon completion.

**FR-17 (Ubiquitous).** Tools that submit jobs SHALL return immediately with a `job_id`; SHALL NOT block until completion.

**FR-18 (Ubiquitous).** Tools marked `idempotent: true` SHALL produce the same outcome (or be a no-op) when invoked multiple times with identical inputs.

**FR-19 (Unwanted behavior).** IF a tool invocation arrives for a non-existent document or layer, THE system SHALL respond with error code `NOT_FOUND` and SHALL NOT mutate any state.

**FR-20 (Unwanted behavior).** IF a `job` tool is invoked when the queue is full, THE system SHALL respond with error `QUEUE_FULL` and SHALL NOT enqueue.

**FR-20-bis (Unwanted behavior).** IF a state-mutating tool is invoked against a document currently held by a host pipeline lock (e.g., MeshCraft phase in progress per `meshcraft-integration` Q3), THE system SHALL respond with error `DOCUMENT_LOCKED { document_id, holder_token_name, until?: ISO8601 }`. Read tools (resources, `get_image`, `get_document_state`) remain allowed.

**FR-20-ter (Ubiquitous).** The full `ErrorCode` enum is defined in `design.md` §3.1 (`shared/errors.ts`) and includes at minimum: `NOT_FOUND`, `INVALID_INPUT`, `QUEUE_FULL`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_CATALOG_VERSION`, `UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION`, `COMFYUI_DISCONNECTED`, `MODEL_NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`, `VERSION_MISMATCH`, `DOCUMENT_LOCKED`, `RESOURCE_GONE`, `TOOL_NOT_AVAILABLE_IN_WORKSPACE`, `WORKSPACE_NOT_AVAILABLE`, `INPAINT_REQUIRES_SELECTION`, `BRUSH_NOT_FOUND`, `REGION_ALREADY_EXISTS`, `TOO_MANY_REGIONS`, `TOO_MANY_CONTROL_LAYERS`, `SCRIPT_DISALLOWED_IMPORT`, `SCRIPT_FORBIDDEN_CALL`, `SCRIPT_OOM`, `SCRIPT_TIMEOUT`, `SCRIPT_EXCEPTION`, `SCRIPT_INVALID_OUTPUT`, `SCRIPT_EXECUTION_NOT_AVAILABLE`, `SAMPLING_NOT_SUPPORTED`, `ENHANCEMENT_RESPONSE_INVALID`, `ENHANCEMENT_TIMEOUT`, `ENHANCEMENT_REFUSED`, `PAIRING_WINDOW_CLOSED`, `INTERNET_PAIRING_NOT_SUPPORTED`, `PAIRING_REJECTED`, `PAIRING_TOKEN_ALREADY_CLAIMED`, `TOKEN_REVOKED`, `UPSCALE_VRAM_EXHAUSTED`, `LOST_DURING_RESTART`. New specs adding error codes update both this list and `design.md` §3.1.

### 3.6 Multi-client coordination (per P27 multi-client model)

**FR-21 (Ubiquitous).** Each tool invocation SHALL include the calling client's `token_name` in audit log entries and in `document.changed` events.

**FR-22 (Ubiquitous).** The undo and redo stacks SHALL be **per-client per-document**; a client's `undo` SHALL revert only the calling client's last operation on that document.

**FR-23 (Event-driven).** WHEN two clients perform operations that overlap (touch the same layer pixels or modify the same property), the system SHALL apply them in arrival order (last-write-wins), SHALL emit `document.changed` with a `conflict: true` flag, and SHALL keep both operations in the originating clients' undo stacks.

### 3.7 Privacy and proxy (per P19)

**FR-24 (Ubiquitous).** No tool in the catalog SHALL forward a raw ComfyUI graph submission from the client. ComfyUI graphs are constructed server-side from typed tool inputs.

**FR-25 (Ubiquitous).** The `CustomGraph` workspace MAY allow advanced users to author graphs, but the resulting graphs SHALL still be submitted via DiffuseCraft tools (`submit_custom_graph`, defined in the `workspaces` spec) and audit-logged.

**FR-26 (Ubiquitous).** No tool SHALL accept or return any AI-provider API key. Where prompt enhancement is needed, MCP sampling against the calling agent SHALL be used per P4 and the architecture in `tech.md`.

### 3.8 Image data access and editing (per user requirement)

**FR-27 (Ubiquitous).** The catalog SHALL provide pixel-level **read** access to: the composited document, every individual layer (paint, mask, control, region), the active selection's content, the selection mask itself, and arbitrary rect or mask sub-regions of any layer.

**FR-28 (Ubiquitous).** The catalog SHALL provide pixel-level **write** access via reversible tools: stroke painting, area fill, area erase, layer-content replacement, image compositing, filter application, transform, merge, and duplicate.

**FR-29 (Ubiquitous).** Image data exchanged via tools SHALL use a structured envelope with either `inline: base64` (small) or `ref: diffusecraft://blob/<ulid>` (large) content. The server selects the encoding based on size and client capability. Blob refs SHALL be short-lived (≤5 min default), token-scoped, and fetchable via standard MCP `resources/read`.

**FR-30 (Ubiquitous).** Edit tools (`paint_strokes`, `fill_area`, `erase_area`, `apply_filter`, `composite_image_into_layer`, `transform_layer`) SHALL respect the active selection automatically when one is present, restricting the edit to selected pixels. An optional `ignore_selection: true` flag SHALL allow explicit bypass.

**FR-31 (Ubiquitous).** Every state-mutating image tool SHALL register a reversible Command with the undo/redo system per P27. Reverting a paint operation SHALL restore the affected pixels to their prior state (snapshot-based for non-trivial regions, command-based for minor strokes — exact strategy in `design.md`).

**FR-32 (Event-driven).** WHEN an image-mutating tool completes, THE system SHALL emit `document.changed` with `change_summary` describing the affected layers and approximate region (bounding box). Other paired clients SHALL refresh visible content as needed.

### 3.9 MCP optimization requirements (super-optimized for agent consumption)

These requirements are about making the catalog efficient on the wire and inside an agent's context window. The catalog is the most-loaded artifact of the system; bloat costs every agent every session.

#### 3.9.1 Catalog footprint

**FR-33 (Ubiquitous).** The compiled MCP catalog (full `tools/list` JSON output) SHALL be ≤ **100 KB** for the v1 minimum viable catalog. Every tool added must justify its byte cost.

**FR-34 (Ubiquitous).** Tool descriptions SHALL fit a tight budget: ≤ 200 words for non-obvious tools; ≤ 60 words for obvious read tools (`list_*`, `get_*`); examples SHALL be a single inline JSON snippet, not multiple variants.

**FR-35 (Ubiquitous).** Schema descriptions on individual fields SHALL be ≤ 15 words. Long explanations belong in the tool's main description, not on every field.

**FR-36 (Ubiquitous).** Tool count in the v1 catalog SHALL be ≤ **65 tools**. Current count after all v1 spec additions: **60 tools** (see §3.3.21). Cap evolved 40 → 50 (mask-system) → 55 (selection-tools) → 60 (regions) → 65 (external-agent-integration). Footprint NFR-3 (≤100 KB compiled) is the hard gate; the cap is a soft guard.

#### 3.9.2 Capability negotiation and lazy loading

**FR-37 (Ubiquitous).** During the MCP handshake, the client SHALL declare its capabilities: `accepts_lossy_images: bool`, `max_inline_image_kb: int`, `streaming_supported: bool`, `prefers_resources_over_tools: bool`. The server SHALL adapt responses accordingly.

**FR-38 (Ubiquitous).** The server SHALL support **catalog filtering by workspace**: when a client declares an active workspace, only tools relevant to that workspace are returned in `tools/list`. (Generate workspace omits `Animation`-only tools; Live mode omits batch upscale; etc.) Default is the full catalog.

**FR-39 (Ubiquitous).** All `list_*` tools SHALL paginate by default, returning at most 50 items per page with a `next_cursor`. Field selection (`fields: string[]`) MAY be specified to return only the named fields per item.

#### 3.9.3 Defaults and minimal happy path

**FR-40 (Ubiquitous).** Every tool SHALL have a **minimal happy-path invocation** documented in its description, using only required fields. Optional fields SHALL have sane defaults that work for >80% of cases.

**FR-41 (Ubiquitous).** `generate_image` minimum invocation SHALL be `{ "prompt": "..." }`. All other parameters resolve from server defaults: `strength=100`, `seed="random"`, `preset=server.default_preset`, `batch_size=1`, no selection, no control layers.

**FR-42 (Ubiquitous).** `apply_history_item` minimum invocation SHALL be `{ "history_item_id": "..." }`. Server resolves target document from session.

#### 3.9.4 MCP prompts (templates) for common multi-step flows

**FR-43 (Ubiquitous).** The catalog SHALL declare MCP-spec **prompts** (templated guidance) for at least these recurring flows: `generate-and-iterate` (generate → list_history → apply best), `inpaint-region` (set_selection → generate_image with Fill mode → apply), `refine-with-control` (add_control_layer → generate_image with strength<100 → apply), `batch-variations` (generate_image with batch_size + N seeds → list_history). Prompts encode the recommended tool sequence so agents need fewer round-trips for common patterns.

#### 3.9.5 Latency and round-trip economy

**FR-44 (Ubiquitous).** Tools that fetch state SHALL allow **bundled queries** where it makes sense. Example: `get_document_state` returns layers + selection + workspace + active region in one call rather than requiring four. New bundle tools MAY be added when a 3+ call sequence becomes a common pattern.

**FR-45 (Ubiquitous).** Server-emitted events SHALL include enough context to avoid follow-up reads. `job.completed` includes `history_item_id` AND a thumbnail ref, so agents can decide whether to fetch the full image based on the thumbnail.

**FR-46 (Ubiquitous).** Read tools MAY support a `since: ISO8601` parameter to return only entities changed after a given timestamp, supporting efficient delta sync for long-running agents.

#### 3.9.6 Schema validation performance

**FR-47 (Ubiquitous).** Zod schemas SHALL be defined once and reused across `mcp-tools` and `server`; validation SHALL NOT re-parse the same schema per request. The build emits compiled validators for hot paths.

**FR-48 (Ubiquitous).** Input validation SHALL fail fast on first error, returning a structured error with field path, expected type, and received value. The structured error SHALL be ≤ 1 KB.

#### 3.9.7 Image transfer optimization (already partially in §3.8)

**FR-49 (Ubiquitous).** `get_image` SHALL never return uncompressed bytes. PNG (lossless) is default; WEBP is preferred when `accepts_lossy_images: true` and the source has no alpha-critical content.

**FR-50 (Ubiquitous).** Thumbnails (`get_image` with `scope: "thumbnail"` or `max_dimension ≤ 512`) SHALL always be returned `inline`, never as `ref`. Thumbnails are by definition small.

**FR-51 (Ubiquitous).** Blob URIs SHALL support **HTTP Range requests** for partial fetch (e.g., agent only needs the top half). Resource read protocol layered over MCP supports this via `?range=bytes=0-N` query.

#### 3.9.8 Error model

**FR-52 (Ubiquitous).** Every error response SHALL include `code` (UPPER_SNAKE_CASE, stable), `message` (English, human-readable), and optionally `hint` (an actionable suggestion: "Available models: [...]"). Error codes are the stable contract; messages may evolve.

**FR-53 (Ubiquitous).** Errors due to client mistakes (invalid input, not found, version mismatch) SHALL be 4xx-equivalent and SHALL NOT trigger retries. Errors due to server-side conditions (queue full, comfyui disconnected) SHALL be 5xx-equivalent with explicit `retry_after_ms` when retry is sensible.

#### 3.9.9 Discoverability

**FR-54 (Ubiquitous).** The `get_server_info` tool SHALL include a `recommended_starting_workflow` field listing the prompts and tools an agent should consider first based on the active workspace, with one-line descriptions. Acts as a "you are here" map for fresh agents.

## 4. Non-functional requirements (EARS)

**NFR-1 (Ubiquitous).** The catalog manifest emitted by `@diffusecraft/mcp-tools` SHALL be valid JSON Schema 2020-12 and pass linting against the MCP spec.

**NFR-2 (Ubiquitous).** All tool descriptions SHALL be in English and SHALL be at least 50 words for non-trivial tools (read tools may be shorter when their purpose is obvious).

**NFR-3 (Ubiquitous).** Catalog total size (compiled JSON) SHALL be ≤ 200 KB. Larger catalogs degrade agent context budgets.

**NFR-4 (Ubiquitous).** The package `@diffusecraft/mcp-tools` SHALL have only `zod` as runtime dependency.

**NFR-5 (Ubiquitous).** Schema validation SHALL run in <5 ms per tool input on typical agent hardware (M-class CPU or equivalent).

**NFR-6 (Event-driven).** WHEN an agent calls `tools/list`, the response SHALL be deterministic for a given catalog version (no random ordering).

**NFR-7 (Ubiquitous).** Tool descriptions and schemas SHALL be versioned in source control alongside `mcp-tools`. Every schema change SHALL include a CHANGELOG entry.

## 5. Out of scope

Explicitly out of scope for this spec (each tracked elsewhere):

- **Handler implementations** — `server-architecture` and individual feature specs.
- **UI surfaces in `apps/mobile`** — feature-specific specs.
- **Pairing flow details** — `pairing-protocol` spec.
- **Auth token format and verification** — `auth-and-proxy` spec.
- **ComfyUI graph construction** — `comfyui-management` spec, `generation-workflow` spec.
- **Persistence (SQLite schemas, image storage)** — `server-architecture` spec.
- **MCP transport details** — `server-architecture` spec.
- **Internet-reachability tunnel mechanism** — deferred post-v1.
- **Compiled binary distribution** — `standalone-server-binary` spec, v2.

## 6. Acceptance criteria

This spec is APPROVED when:

1. **Coverage:** every operation listed in `principles.md` (P9 strength-driven verbs, P10 control layers, P11 regions, P12 workspaces, P13 resolution abstraction, P14 job queue, P27 undo/redo) maps to at least one tool in this catalog.
2. **Architecture seams:** every spec in `_backlog.md` can declare which tools from this catalog it owns the implementation of (no orphan tools, no spec without tool coverage).
3. **Krita parity:** every krita-ai-diffusion concept identified in `inspirations.md` has a corresponding tool, resource, or event in this catalog (allowing equivalence-class mapping; not strict 1:1).
4. **Schema testability:** for every tool, an example invocation in JSON validates against its `inputSchema`, and a sample output validates against `outputSchema`.
5. **Agent narrative:** the four user stories in §2 can be expressed end-to-end as sequences of catalog tool calls, with no missing capabilities. (Fictive scenarios written in `design.md` §"Agent walkthroughs".)

## 7. Open questions

These are questions that should be resolved before this spec is APPROVED. They represent real ambiguities, not intentional deferrals.

### Q1 — `current document` model
Should the catalog assume an implicit "current document" set via `set_active_document`, or should every document-touching tool require a `document_id` parameter explicitly?

- **Option A:** Implicit current document. Reduces input boilerplate. Requires server-side per-client session tracking. Familiar from REST APIs.
- **Option B:** Explicit `document_id` everywhere. More verbose but stateless and unambiguous; agent-friendly.
- **Option C:** Hybrid — implicit by default, explicit `document_id` overrides.

**Recommendation:** **B** for agent-friendliness (explicit > implicit), but provide a `set_active_document` for the GUI's convenience that just updates a per-client preference passed via header. Confirm in `design.md`.

### Q2 — Resource templates: stable URIs?
Resources like `diffusecraft://history/<id>` use opaque ids. Should ids be UUID, ULID, or sequential? UUID is canonical but verbose; ULID is sortable and shorter; sequential is human-readable but leaks info.

**Recommendation:** **ULID** for all DiffuseCraft-generated ids (jobs, history, layers, regions, control layers, presets). ULIDs are sortable by creation time, URL-safe, 26 chars. Confirm in `design.md`.

### Q3 — Tool naming for verb-resolution
`generate_image` resolves to Generate / Refine / Fill / constrained-variation based on inputs. Alternative: separate tools (`generate`, `refine`, `fill`) with distinct schemas.

**Recommendation:** **single `generate_image` with verb resolution** per P9. The output reports `resolved_verb` so callers can reason about what happened. Pros: matches krita-ai-diffusion's mental model; one tool, fewer concepts. Cons: input shape carries optional fields. Confirm.

### Q4 — `apply_history_item` insertion semantics
Does it insert as a new top layer? Or replace the current selection's content?

**Recommendation:** insert as a new layer **at the position determined by the original generation context** (i.e., if the generation was a Fill, the result layer goes above the inpainted content; if it was a Refine, the result layer is positioned to compose with the source). Specify exact rules in `design.md`.

### Q5 — Should resources be readable via tools too?
P10 of MCP says resources are read via `resources/read`. Some agents prefer tools-only orchestration. We've proposed parallel `get_*` tools (FR-10).

**Recommendation:** keep both. Parallel `get_*` tools (`get_document_state`, `get_history_item`, etc.) wrap the resource read for tools-first agents. Cost is negligible; benefit is full agent-agnosticism (P3).

### Q6 — Catalog version strategy on agent connection
If the agent is built against catalog `v1.2.0` and the server is `v1.3.0`, what happens?

**Recommendation:** server reports its supported range (`v1.2.0` to `v1.3.0` inclusive) in `server/info`; client SDK selects the highest version both support; tools added in `v1.3.0` simply aren't called. If an agent attempts a tool not in its version, error `UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION`. Confirm in `design.md`.

### Q7-bis — Pixel-edit performance budget and bandwidth

`paint_strokes` and `composite_image_into_layer` invoked by an agent in tight loops (e.g., a "fill background with this gradient" automation) could move large amounts of data. Should we impose limits?

**Recommendation:** rate-limit + payload-cap by token. Default: 50 image-mutating tool calls per minute per token; default per-call payload cap 16 MB (configurable in server config). Exceeding returns `RATE_LIMITED` or `PAYLOAD_TOO_LARGE`. Confirm in `design.md`.

### Q7-ter — Layer image format on `get_layer_image`

Lossless (PNG) is honest but fat. Should we default to PNG and let the agent ask for `webp` when bandwidth matters?

**Recommendation:** **PNG default for read, agents can request lossy via `format` param.** Server may return WEBP automatically if the agent declared `accepts_lossy: true` in handshake. Confirm.

### Q7 — `download_model` registry
Does the catalog tool encode which registries are supported (HuggingFace, Civitai)? Or is registry selection part of the model id (`hf:org/repo` vs `civitai:12345`)?

**Recommendation:** **prefixed model id** (e.g., `hf:Stability-AI/sdxl-base-1.0`, `civitai:dreamshaper`). Schema validates against known prefixes. Adding a registry is a minor catalog bump. Confirm.

---

## 8. Approval criteria

This `requirements.md` is approved when the user confirms:
- The user stories (§2) capture the four real client classes correctly.
- The functional requirement set (§3) is necessary and sufficient for v1.
- The minimum viable catalog (§3.3) is the right scope — nothing missing, nothing speculative.
- The non-functional requirements (§4) are realistic.
- The open questions (§7) are the right ones, and the recommendations are acceptable as a starting point for `design.md`.

If approved, `design.md` will define the concrete schemas, the JSON Schema emission pipeline, the registration handshake, the versioning semantics in code, and the agent walkthroughs.
