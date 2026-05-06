# comfyui-management — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog`, `server-architecture`.
> **References:** P19 (ComfyUI never raw), P26 (server-side inference), krita-ai-diffusion `ai_diffusion/server.py` and `ai_diffusion/comfy_*.py`.

## 1. Purpose

This spec defines how `@diffusecraft/server` integrates with [ComfyUI](https://github.com/comfyanonymous/ComfyUI):
- The three connection modes (managed local, external local, external remote).
- Lifecycle of the ComfyUI process when in managed mode.
- Custom-node validation and management.
- Model discovery via `extra_model_paths.yml`.
- Graph construction from typed tool inputs.
- WebSocket subscription for progress and completion events.
- Job tracking integration (per the decision "ComfyUI owns the queue").
- Health checks and reconnection.

This spec also explicitly **upholds** P19: clients (HTTP, stdio, in-memory) never reach ComfyUI directly. The server's `ComfyClient` is the only authorized HTTP/WS client.

## 2. Stakeholders & user stories

### S1 — End user setting up a fresh laptop with `npx @diffusecraft/server`
> **Story 1.** As a new user with no ComfyUI installed, I run `npx @diffusecraft/server`. The server downloads ComfyUI into a managed directory, installs the four required custom-node packages, downloads the default models, and starts running. I scan a QR from my tablet and start generating. **Total time before first generation: <15 minutes on a 50 Mbps connection.**

### S2 — Power user with an existing ComfyUI installation
> **Story 2.** As a developer who already has ComfyUI running with custom workflows, I run `npx @diffusecraft/server --comfyui-url http://localhost:8188`. The server validates that required custom nodes are installed, refuses to start with a clear error if not, and otherwise connects without touching my install.

### S3 — User running ComfyUI on a separate GPU machine
> **Story 3.** As a user with a NAS / dedicated GPU box on the LAN, I run `npx @diffusecraft/server --comfyui-url http://192.168.1.50:8188`. The server connects, validates, and serves my tablet — the GPU box does the inference, the laptop hosts DiffuseCraft.

### S4 — MeshCraft embedding
> **Story 4.** As MeshCraft, I configure the embedded server to use managed ComfyUI. The first launch installs everything in MeshCraft's `userData` directory; subsequent launches reuse it. MeshCraft's UI shows install progress.

## 3. Functional requirements (EARS)

### 3.1 Connection modes

**FR-1 (Ubiquitous).** The server SHALL support three connection modes, configurable via `ServerConfig.comfyui`:

```typescript
type ComfyConfig =
  | { mode: "managed"; install_dir: string; auto_install: boolean; comfyui_version?: string }
  | { mode: "external-local"; url: string }      // typically http://127.0.0.1:8188
  | { mode: "external-remote"; url: string };     // any reachable URL
```

**FR-2 (Ubiquitous).** Mode `external-local` and `external-remote` are functionally identical from the server's perspective; the distinction exists only for UI hints and logging.

### 3.2 Managed mode: install lifecycle

**FR-3 (Event-driven).** WHEN started in `managed` mode and `install_dir` does not contain a valid ComfyUI install, THE server SHALL: (1) emit `comfyui.install.starting`; (2) clone or download ComfyUI at the pinned version; (3) install Python deps in a managed venv; (4) install the four required custom-node packages (per FR-7); (5) download the default model set (per FR-15); (6) emit `comfyui.install.completed`.

**FR-4 (Event-driven).** WHEN install fails at any step, THE server SHALL emit `comfyui.install.failed` with structured error info, leave the partial install in place (no rollback), and refuse to start. User intervention required.

**FR-5 (Event-driven).** ON SUBSEQUENT STARTS in `managed` mode, THE server SHALL detect an existing install, validate version compatibility, optionally update if `comfyui_version` is newer than installed, and proceed.

**FR-6 (Ubiquitous).** ComfyUI SHALL run in managed mode as a child process supervised by the server. The server:
- Starts ComfyUI on `start()` with `--listen 127.0.0.1` (loopback only, never exposed) and a chosen port.
- Captures stdout/stderr to the server's log.
- Restarts on unexpected exit (max 3 attempts; then emits `comfyui.crashed-permanently` and refuses further jobs until next server restart).
- Sends SIGTERM on `stop()`, waits up to 10s, then SIGKILL.

### 3.3 Required custom nodes

**FR-7 (Ubiquitous).** The server SHALL require the following custom-node packages (per krita-ai-diffusion):
- ControlNet preprocessors (Fannovel16/comfyui_controlnet_aux)
- IP-Adapter (cubiq/ComfyUI_IPAdapter_plus)
- Inpaint nodes (Acly/comfyui-inpaint-nodes)
- External tooling nodes (Acly/comfyui-tooling-nodes)

Versions are pinned in `libs/server/src/lib/comfy/required-nodes.ts`.

**FR-8 (Event-driven).** ON STARTUP in any mode, THE server SHALL validate that all required nodes are installed (by querying ComfyUI's `/object_info`). Missing nodes SHALL: (a) in managed mode → trigger install; (b) in external modes → emit `comfyui.missing-required-nodes` and refuse to start with a clear error message naming each missing package.

**FR-9 (Optional).** Optional packages (GGUF support, Nunchaku) MAY be detected and exposed as feature flags but are not required for v1.

### 3.4 Model discovery and management

**FR-10 (Ubiquitous).** The server SHALL discover models via ComfyUI's `extra_model_paths.yml` by querying `/object_info` and mirroring the model lists into our SQLite cache.

**FR-11 (Ubiquitous).** Each model in the cache SHALL include: `id`, `name`, `type` (checkpoint, lora, controlnet, ip_adapter, vae, clip_vision, upscale, embedding), `file_path`, `file_size`, `integrity_hash`, `discovered_at`.

**FR-12 (Event-driven).** WHEN `download_model` is invoked, THE server SHALL: (1) parse the prefixed id (`hf:`, `civitai:`, `file:`); (2) resolve to a download URL; (3) stream to the appropriate model directory; (4) verify integrity via hash; (5) update SQLite cache; (6) emit `model.download.progress` / `model.download.completed` / `model.download.failed`.

**FR-13 (Ubiquitous).** Download is resumable across server restarts (HTTP Range requests, partial-file detection).

**FR-14 (Ubiquitous).** Model deletion via `delete_model` SHALL: (1) verify no in-flight job depends on it; (2) remove the file; (3) update cache; (4) emit `model.deleted`.

**FR-15 (Ubiquitous).** Default model set (managed mode auto-install): minimum SDXL base + a default upscaler + a default IP-Adapter checkpoint. List pinned in `libs/server/src/lib/comfy/default-models.ts`. Total size kept under ~10 GB to bound first-time install bandwidth.

### 3.5 Graph construction

**FR-16 (Ubiquitous).** ComfyUI graphs SHALL be constructed server-side from typed tool inputs. The server's `GraphBuilder` module owns this translation. Per P19, no client provides raw graphs.

**FR-17 (Ubiquitous).** Graph builders for v1 (one per resolved verb in `generate_image`):
- `buildGenerateGraph(input)` — txt2img with optional control layers and regions.
- `buildRefineGraph(input)` — img2img with `strength<100`.
- `buildFillGraph(input)` — inpaint with selection + selection_mode.
- `buildUpscaleGraph(input)` — tile-based upscale per `upscale-and-tiling` spec scope.

Each builder is a TypeScript function returning a JSON ComfyUI workflow.

**FR-18 (Ubiquitous).** Builders SHALL:
- Apply hires-fix (2-pass) when target size exceeds the model's native trained range.
- Round dimensions to multiples of the model's required factor (8/16/64).
- Honor `region_ids` by composing per-region prompts and masks per krita-ai-diffusion's region logic.
- Honor `control_layer_ids` by attaching the appropriate ControlNet/IP-Adapter nodes.
- Apply selection-aware blending masks (denoising mask + blend mask) for fill/refine modes.

**FR-19 (Ubiquitous).** The Custom Graph workspace (post-v1) introduces `submit_custom_graph` for advanced users; that tool will accept a graph payload but still go through audit/rate-limit middleware. Out of scope for v1 builders.

### 3.5-bis Graph helper ownership (cross-spec coordination)

**FR-19-bis (Ubiquitous).** Graph builders are composed from a small dispatcher (`buildGraph`) plus **per-feature helper modules** that live under `libs/server/src/lib/comfy/graph/helpers/`. Each downstream spec that contributes a helper SHALL:
- Define the helper's signature in its own `design.md` Module layout section.
- Reference the file path here in `comfyui-management` for cross-spec discoverability.
- Implement the file under `libs/server/src/lib/comfy/graph/helpers/<topic>.ts`.

**FR-19-ter (Ubiquitous).** v1 graph helpers (registry):

| Helper file | Owner spec | Purpose |
|---|---|---|
| `graph/builder.ts` | `comfyui-management` (this spec) | Dispatch by resolved verb |
| `graph/generate.ts`, `refine.ts`, `fill.ts`, `upscale.ts` | `comfyui-management` (this spec) + `generation-workflow` for verb resolution + `upscale-and-tiling` for upscale | Per-verb graphs |
| `graph/helpers/selection-masks.ts` | `mask-system` (two-mask split) | Denoising + blend mask construction |
| `graph/helpers/control-layers.ts` | `control-layers` (`attachControlLayers`) | Attach ControlNet/IP-Adapter nodes |
| `graph/helpers/regions.ts` | `regions` (`attachRegions`) | Per-region prompt + mask conditioning |
| `graph/helpers/resolution.ts` | `resolution-handling` (`planPasses`, `splitBatch`) | Hires-fix + multiples-of-N + cap |
| `graph/helpers/segmentation.ts` | `selection-tools` Tier 2/3 | MobileSAM / SAM2 invocation graph |
| `graph/helpers/grounding.ts` | `selection-tools` Tier 4 | VLM-bbox + SAM refinement (sampling-driven) |
| `graph/helpers/whisper.ts` | `speech-to-text` (server-side path) | Audio → text graph |
| `graph/helpers/upscale-tile.ts`, `diffusion-refine.ts` | `upscale-and-tiling` | Tile-based upscale + per-tile img2img |

**FR-19-quat (Ubiquitous).** Helpers SHALL NOT depend on each other except through pure data structures (image bytes, masks, conditioning refs). Cross-helper composition happens **only** in the verb-specific builders (`generate.ts`, `refine.ts`, `fill.ts`, `upscale.ts`), which orchestrate the helpers in the right order.

### 3.6 ComfyUI client (HTTP + WebSocket)

**FR-20 (Ubiquitous).** The `ComfyClient` class SHALL be the **only** code path that touches ComfyUI HTTP/WS. It SHALL be internal to `@diffusecraft/server` (not exported via `index.ts`).

**FR-21 (Ubiquitous).** `ComfyClient` methods:
- `submitGraph(graph): Promise<{ prompt_id, queue_position }>` — POST `/prompt`.
- `interrupt(prompt_id): Promise<void>` — POST `/interrupt`.
- `dequeue(prompt_id): Promise<void>` — POST `/queue` with delete payload.
- `getQueue(): Promise<QueueState>` — GET `/queue`.
- `getObjectInfo(): Promise<NodeCatalog>` — GET `/object_info`.
- `health(): Promise<HealthStatus>` — GET `/system_stats`.
- `events: ComfyEventEmitter` — typed wrapper over WebSocket `/ws`.

**FR-22 (Event-driven).** `ComfyEventEmitter` SHALL emit typed events: `progress`, `executed`, `executing`, `execution_error`, `execution_cached`, `status`. These map to ComfyUI WebSocket message types.

**FR-23 (Ubiquitous).** The WebSocket connection SHALL auto-reconnect on disconnect (exponential backoff, max 5 attempts). On reconnect, the server polls `/queue` to reconcile state.

### 3.7 Health checks

**FR-24 (Ubiquitous).** The server SHALL run a periodic health check (default: every 30 s) calling `comfy.health()`. Failure transitions ComfyUI status to `degraded` and surfaces in `get_server_info`.

**FR-25 (Ubiquitous).** Health failures SHALL NOT auto-restart ComfyUI in external modes (we don't own the process). In managed mode, the server's child-process supervisor restarts on exit, not on health-check failure.

### 3.8 Output assets

**FR-26 (Ubiquitous).** When ComfyUI completes a job, the server SHALL: (1) fetch the resulting image(s) via ComfyUI's `/view` endpoint or filesystem path (per ComfyUI version); (2) write to our blob store; (3) generate a thumbnail (max 256 px); (4) create a `history_items` row; (5) emit `job.completed { outcome: "success", history_item_id, thumbnail_ref }`.

**FR-27 (Ubiquitous).** ComfyUI's output directory SHALL be configurable (`comfyui.output_dir`); the server gracefully handles either inline file fetch via `/view` or direct filesystem read when colocated.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Managed install on a fresh machine SHALL complete in <15 min on 50 Mbps + reasonable CPU.

**NFR-2 (Ubiquitous).** Custom-node validation SHALL complete in <2 s on a typical install.

**NFR-3 (Ubiquitous).** ComfyUI WebSocket reconnection SHALL transparently resume tracking without losing in-flight job state in our DB.

**NFR-4 (Ubiquitous).** Graph builders SHALL produce valid ComfyUI graphs that pass ComfyUI's input validation 100% of the time for valid tool inputs (any production failure is a builder bug, fixed in builder, not in user).

## 5. Out of scope

- **Custom Graph workspace** — post-v1 spec.
- **Multi-GPU scheduling within ComfyUI** — ComfyUI's own concern.
- **Non-ComfyUI backends** (DALL-E, Replicate, etc.) — explicitly out of product scope per P4.
- **Animation workspace ComfyUI graphs** — post-v1.

## 6. Open questions

### Q1 — Pinned ComfyUI version vs. moving target?
ComfyUI evolves rapidly; pinning slows but avoids breakage.

**Recommendation:** **pin** to a known-good ComfyUI commit. Server config has `comfyui_version` overrideable. Maintain a "tested matrix" (DiffuseCraft version → tested ComfyUI commits). Bump deliberately.

### Q2 — Where to install in managed mode (default `install_dir`)?
- Linux: `$XDG_DATA_HOME/diffusecraft/comfyui` or `~/.local/share/diffusecraft/comfyui`
- macOS: `~/Library/Application Support/DiffuseCraft/comfyui`
- Windows: `%LOCALAPPDATA%\DiffuseCraft\comfyui`
- For MeshCraft: `app.getPath("userData") + "/comfyui"`

**Recommendation:** OS-appropriate defaults; configurable.

### Q3 — Python venv or system Python for managed mode?
System Python is fragile (user's Python version may break ComfyUI).

**Recommendation:** **managed venv** using `uv` or `python -m venv`. Server expects Python 3.10+ available; if absent, emit a clear error pointing to install instructions. Bundling Python is post-v1 (would balloon installer size).

### Q4 — How to handle ComfyUI breakage from required-node updates?
A custom-node author publishes a breaking change.

**Recommendation:** required nodes are **pinned by commit hash**, not version range. Updates are deliberate.

### Q5 — When external ComfyUI lacks required nodes, can the server install for the user?
Maybe — but the user's external install might be pip-managed, git-managed, etc.

**Recommendation:** **no auto-install in external modes.** Emit clear error with installation instructions for the missing packages and refuse to start. Documented in README. Auto-install only in managed mode.

### Q6 — Should we expose a `repair_comfyui` admin tool?
Useful for "my install broke; reinstall everything" scenarios.

**Recommendation:** **post-v1.** v1 keeps it simple: delete the install dir, restart, reinstall. Doc the path.

### Q7 — Output format from ComfyUI: PNG always, or honor model defaults?
ComfyUI saves PNG by default. Some users prefer WEBP for size.

**Recommendation:** **PNG default**, configurable per workspace. Server's blob store transcodes to other formats on `get_image` request when client declares `accepts_lossy_images: true`. ComfyUI internal save is PNG to preserve max quality.

## 7. Acceptance criteria

This spec is APPROVED when:
1. Four user stories (§2) are satisfied by the requirements.
2. The job-tracker decision (server doesn't queue; ComfyUI does) is fully reflected.
3. Graph construction surface is sufficient for v1 verbs (Generate / Refine / Fill / Upscale) and explicitly defers Custom Graph + Animation.
4. Open questions have acceptable recommendations.
