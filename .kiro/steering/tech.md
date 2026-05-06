# Tech

## Stack at a glance

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | Single language across client, server, agents, schemas |
| Monorepo | **Nx** (with pnpm workspaces underneath) | Plugin ecosystem for Expo/RN/Electron/Node; `nx affected`; module-boundary enforcement; generators for MCP catalog growth |
| Mobile runtime | **Expo SDK + React Native + react-native-skia (native)** | Native Skia performance on tablet; stylus support; OTA updates; familiar RN ergonomics. **The only client runtime DiffuseCraft owns.** |
| Desktop experience | **Provided by MeshCraft** (external host) at `~/ia/CraftMesh/apps/desktop`, embedding `@diffusecraft/server` and (optionally) `@diffusecraft/diffusion-client` and `@diffusecraft/ui` | DiffuseCraft does not ship a desktop app of its own. Users who want DiffuseCraft on desktop install MeshCraft. |
| Web runtime | **Excluded from product** | Not deferred — actively off-roadmap. |
| Server runtime | Node.js 20+ (LTS) | MCP SDK first-class support; ComfyUI HTTP/WS client; SQLite via `better-sqlite3` |
| Server framework | **Fastify** | Stable, performant, TypeScript-friendly, hooks-based middleware. Hono considered; rejected because Fastify's plugin ecosystem (auth, validation, multipart, websocket) is more mature for this use case |
| MCP SDK | `@modelcontextprotocol/sdk` (TypeScript) | Official, no vendor extensions, supports stdio + Streamable HTTP + in-memory transports |
| AI backend | ComfyUI (HTTP + WebSocket) | Local inference only; never proxied; lifecycle managed by `@diffusecraft/server` |
| Persistence (server) | SQLite via `better-sqlite3` | Single file, embedded, zero-config, perfect for self-hosted server with paired devices + audit log |
| State management (client) | **Zustand** with slices + factories | See "Client state" section |
| Styling (client) | **NativeWind v4** (Tailwind for RN) | Same Tailwind DX as MeshCraft; compiles to RN `StyleSheet`; works with Expo + native-only |
| Component library (client) | **react-native-reusables** (`rnr`) — shadcn-style, copy-paste, owned in-tree | shadcn mental model on RN; built on `@rn-primitives/*` (Radix-equivalent headless primitives); lightweight by construction (only the components we paste); native-only is fine |
| Icons (client) | **lucide-react-native** | Same icon set as MeshCraft for visual coherence |
| Bottom sheets / drawers (client) | **@gorhom/bottom-sheet** | Standard for tablet-grade sheets; `rnr` doesn't cover this surface well |
| Toasts (client) | **sonner-native** | Direct port of Sonner; matches MeshCraft's notification feel |
| Gestures (client) | **react-native-gesture-handler** + **react-native-reanimated** | Required for stylus, pan/zoom, Procreate-style multi-finger gestures; Reanimated also powers `rnr` animations |
| Form/schema validation | **Zod** | Same library used in `@diffusecraft/mcp-tools` for schemas; build pipeline emits JSON Schema for the MCP handshake |
| Standalone binary (v1) | `npx @diffusecraft/server` | Node script entry; full compiled binary (pkg/Bun compile) deferred to v2 |
| Standalone binary (v2) | `pkg` or `bun build --compile` | Single file distribution + service integration (systemd, launchd, Windows service) |

## Monorepo structure

Nx workspace, pnpm workspaces underneath. Single repo, multiple publishable packages, multiple apps.

### Internal packages (TS libraries, all under `@diffusecraft/`)

| Package | Purpose | Allowed dependencies |
|---|---|---|
| `core` | Shared types, events, contracts, store factories. Pure TS, no runtime side effects. | `zod` only |
| `mcp-tools` | Canonical MCP tool catalog: Zod schemas, descriptions, examples, tool metadata. Build emits JSON Schema. | `zod` only |
| `canvas-core` | Render-agnostic canvas logic: layers, selection, transform, history (in-memory), brush models. Knows nothing about AI. | `core` |
| `canvas-skia` | Render adapter for canvas-core using `react-native-skia` (native only in v1). | `core`, `canvas-core`, `react-native-skia` |
| `diffusion-client` | Client-side SDK: pairing, token storage, transport selection (stdio/HTTP/in-memory), tool invocation, event subscription. Knows nothing about canvas. | `core`, `mcp-tools`, `@modelcontextprotocol/sdk` |
| `server` | Backend library: ComfyUI lifecycle, job queue, pairing flow, auth proxy, presets/models registry, MCP server mounting on three transports. Knows nothing about canvas. | `core`, `mcp-tools`, `@modelcontextprotocol/sdk`, `fastify`, `better-sqlite3` |
| `ui` | Shared React Native components (NativeWind + react-native-reusables, copy-paste in-tree) used by `apps/mobile`. See "Client UI" section. | `core`, `canvas-skia`, `diffusion-client`, `nativewind`, `@rn-primitives/*`, `lucide-react-native`, `@gorhom/bottom-sheet`, `sonner-native`, `react-native-reanimated`, `react-native-gesture-handler` |

### Apps (hosts) — inside this monorepo

| App | Role | v1 scope |
|---|---|---|
| `apps/mobile` | Expo app, tablet-first, phone fallback | **Yes** |
| `apps/server` | Standalone host: a thin Node entrypoint that imports `@diffusecraft/server` and starts it with default config (CLI flags for port, ComfyUI path, etc.). Distributed as `npx @diffusecraft/server`. | **Yes** |

### External hosts (separate repos that consume DiffuseCraft via npm)

| Host | Repo | Consumes |
|---|---|---|
| **MeshCraft** | `~/ia/CraftMesh` | `@diffusecraft/server` (in-process), `@diffusecraft/diffusion-client` (when acting as MCP client of its own embedded server), optionally `@diffusecraft/ui` |
| Future Suquía Bytes products | TBD | Any subset of libs |
| Third-party agents / integrators | external | `@diffusecraft/mcp-tools` (schemas) and/or `@diffusecraft/diffusion-client` |

DiffuseCraft does not own a desktop app. The desktop experience is **MeshCraft's responsibility**. This decision keeps DiffuseCraft v1 focused on the tablet client + the server library, and avoids the CanvasKit-in-Electron stack entirely.

### Dependency rules (enforced via `@nx/enforce-module-boundaries`)

| Rule | Enforcement |
|---|---|
| `canvas-core` and `canvas-skia` must NOT import from `diffusion-client`, `server`, or `mcp-tools` | Tag-based: `scope:canvas` cannot depend on `scope:ai` |
| `server` must NOT import from `canvas-core`, `canvas-skia`, or `ui` | Tag-based: `scope:server` cannot depend on `scope:canvas` or `scope:client-ui` |
| `mcp-tools` must NOT import from anything except `zod` | Tag-based: `scope:contract` has zero project deps |
| `core` must NOT import from any other internal package | Tag-based: `scope:foundation` is leaf |
| Apps may import any internal package | No restriction |

## Cross-platform strategy

**DiffuseCraft client surface = Expo only.** One codebase, two form factors (tablet + phone) via responsive layout. Apple Pencil and S-Pen are first-class via `react-native-skia` pressure events. iOS Speech Framework + Android `SpeechRecognizer` for STT (free, OS-native, multilingual including Spanish).

**The client never runs models.** No diffusion model, ControlNet, IP-Adapter, VAE, or upscaler ever loads or executes on the tablet or phone. ComfyUI, model weights, GPU/CPU inference, and VRAM allocation all live on the **server**, which runs on a separate physical machine (a PC the user owns, a laptop running MeshCraft, or any host with `@diffusecraft/server`). The tablet connects to the server via pairing (QR scan + mDNS, with manual fallback) and exchanges only:

- Prompts, control inputs, selections, masks, settings, MCP tool calls (client → server)
- Generated images (encoded), progress events, history metadata, job results (server → client)

This is enforced by P26 in `principles.md` and is not negotiable for v1. There is no "lite mode" where the tablet runs small models locally.

**Desktop = via MeshCraft.** MeshCraft is the de facto desktop host. It embeds `@diffusecraft/server` in-process and exposes whatever subset of DiffuseCraft features its own UX needs (concept art generation, texture refinement, etc.). Users who want DiffuseCraft on desktop install MeshCraft. This means:

- DiffuseCraft does **not** ship its own Electron app — neither in v1 nor in any planned version.
- DiffuseCraft does **not** maintain a CanvasKit/web-Skia adapter in v1. `canvas-skia` is native-only.
- If MeshCraft (or any future host) ever needs canvas rendering in Electron, that host writes its own adapter against `canvas-core`. DiffuseCraft does not pre-build for hypothetical needs.
- The pairing flow is the **only** mechanism by which the tablet app reaches a server. The tablet pairs equally with `npx @diffusecraft/server`, MeshCraft's embedded server, or any other host running `@diffusecraft/server`.

**Web/PWA = excluded.** Not deferred — actively off-roadmap. Removes the entire CanvasKit-in-browser, service worker, IndexedDB, OffscreenCanvas, Safari API stack from concerns.

## External library API references

Treat the **installed version** as the source of truth, not training-data memory.

- **`@shopify/react-native-skia` (v2.x)** — verify Skia bindings against the [official docs site](https://shopify.github.io/react-native-skia/) and the package's `*.d.ts` typings before authoring or editing render code. JSI bindings in v2 differ from v1: several methods require all positional args (e.g. `canvas.rotate(degrees, px, py)` — passing only `degrees` raises `Value is an object, expected a number` because the missing args reach native as `undefined`). When in doubt, read `node_modules/@shopify/react-native-skia/lib/typescript/src/skia/types/Canvas.d.ts`.
- **`react-native-gesture-handler` (v2.x)** + **`react-native-reanimated` (v4.x)** — gesture callbacks default to running on the UI thread as worklets when Reanimated is installed. Any callback that touches Zustand stores, React state setters, or ordinary closures must be marked with `.runOnJS(true)` on the gesture builder.
- **Expo SDK / React Native** — when behavior diverges from training data, check the version pinned in `apps/mobile/package.json` first.

Rule of thumb: if a Skia or gesture API call crashes with a type-mismatch or "value is an object" error, the most likely cause is a JSI-binding signature drift between versions. Read the typings, don't guess.

## Backends model (three classes, all vendor-agnostic)

The server depends on and exposes **three distinct backend classes**:

### Backend class 1: ComfyUI (image inference)
- Local-only image generation, refinement, inpaint/fill, upscale, and AI-powered segmentation (MobileSAM, SAM 2, FastSAM, etc.).
- Three connection modes: managed local, external local, external remote.
- ComfyUI owns the queue; the server is a tracker (not a parallel queue manager).
- Never carries any AI provider API key (P4, P26).

### Backend class 2: Agent (LLM/VLM via MCP)
- The server **lifts its own MCP server** (stdio + Streamable HTTP + in-memory transports). Agents (Claude Desktop, Claude Code, OpenAI Codex / ChatGPT Desktop, Gemini CLI, custom orchestrators) connect to that MCP **as clients** — equivalent to how the tablet connects.
- **Simultaneously**, when the server needs LLM/VLM-class reasoning that doesn't belong in ComfyUI (prompt enhancement, prompt-based selection, future scene captioning, etc.), it uses **MCP sampling** to ask the connected agent to do the reasoning. The agent provides its own API credentials; the server never holds any.
- One agent process plays **both roles**: client of the server's MCP catalog (orchestrating workflows) AND backend the server falls back to for sampling.
- Agent-agnostic (P3): any MCP-conformant client works. No vendor-specific shims.

### Backend class 3: Scripting sandbox (user-supplied code on images)
- The server runs **user-supplied Python or JavaScript code** against image bytes in a **strictly sandboxed subprocess**. Use cases: custom filters, OpenCV operations, NumPy manipulations, ad-hoc transformations that don't fit a tool.
- **Sandbox guarantees:**
  - No network access (network namespace isolation on Linux; equivalent on macOS via `sandbox-exec`).
  - No filesystem write access outside a per-invocation scratch directory.
  - No filesystem read access outside the scratch + a whitelist of language stdlib paths.
  - Memory limit (default 1 GB per invocation, configurable).
  - CPU time limit (default 30 s per invocation, configurable).
  - Subprocess UID drop where supported.
  - Whitelisted import set (Python: `numpy`, `PIL`, `cv2`, `scipy`, `scikit-image`; JS: `sharp`, `jimp`). AST-level validation rejects `import socket`, `import os`, `subprocess`, `eval`, `exec`, etc.
- **I/O contract:** stdin = image bytes (PNG) + params (JSON header); stdout = image bytes (PNG); stderr = log messages.
- **Tool:** `apply_script({ language, code, target_layer_id?, params? })` — `job`, reversible. Result becomes a new layer or replaces the target.
- **Engines never see the script.** The handler spawns the subprocess, collects bytes, and converts the result to a layer via the same path as `add_layer({ kind: "paint", content })`. Scripts are isolated from `canvas-core` and never touch internal state.

This third backend class lets DiffuseCraft accept code-driven image processing without coupling to ComfyUI or LLMs — a critical extensibility surface for power users and agents that want to script transformations programmatically.

## Server architecture (high level)

`@diffusecraft/server` is a library, not an app. Hosts (the standalone binary, MeshCraft, etc.) instantiate it.

```typescript
// Conceptual signature
export const createDiffuseCraftServer = (config: ServerConfig) => {
  return {
    start(): Promise<{ httpUrl: string; stdioReady: boolean }>;
    stop(): Promise<void>;
    mcp: { invokeTool(name, args): Promise<unknown> }; // for in-memory transport
    on(event: string, handler: Function): void;
  };
};
```

**Transports mounted simultaneously:**
- **stdio**: only if process is started with `--stdio` flag (Claude Desktop spawn). Auth: trust-by-process.
- **Streamable HTTP**: always-on for tablet, remote agents, multi-client. Auth: bearer pairing token (single-tier, see below). Unpaired requests get 401.
- **In-memory**: always-on; in-process callers (MeshCraft, tests) use `mcp.invokeTool()` directly. Auth: trust-in-process.

**Pairing & auth model (simplified per P18):**
- One opaque token per paired device. Issued at pairing time. Stored hashed in SQLite.
- **No scopes, no roles, no tiers.** Paired = full access; unpaired = 401.
- **mDNS-first onboarding.** The server advertises itself via mDNS (`_diffusecraft._tcp.local`) with `name`, `port`, and `version` records. The tablet scans, lists discovered servers, user taps to pair. The server approves the request — auto during a configurable pairing window for `npx @diffusecraft/server` (`--allow-pairing-for=120s`); visual prompt in MeshCraft.
- **QR code fallback.** When mDNS isn't viable, the server can display a QR encoding `{ url, ip, port, token, server_name }`. Same outcome as mDNS path.
- **Numeric 6-digit code fallback.** When there's no camera. User types into the tablet.
- **URL+token paste fallback.** Hidden Advanced flow.
- Each token has an optional `name` (e.g., "iPad de Igna") shown in audit log only.
- Revocation: a row in SQLite marks `revoked_at`. Server checks on each request.
- Audit log records `{ token_name, operation, args_summary, timestamp, outcome }` for every MCP tool invocation, queryable via `get_audit_log`. Informational only.

**ComfyUI integration:**
- Three modes: managed local install, external local, external remote (matching krita-ai-diffusion).
- Server-managed install downloads ComfyUI + required custom nodes to a local directory and supervises lifecycle (start/stop/health).
- External modes accept a URL; server validates required custom nodes are present at startup (ControlNet preprocessors, IP-Adapter, inpaint nodes, external tooling).
- ComfyUI **never exposed to clients directly**. The server is the only authorized HTTP/WS client of ComfyUI.

**Persistence (SQLite):**
- Paired devices + tokens (with scope, expires_at, revoked_at)
- Audit log (token issuance, tool invocations with calling identity, revocations)
- Generation history metadata (jobs, outcomes, references to image files on disk)
- Presets and model registry cache

**Bootstrap admin token:** on first run with no admin tokens in DB, server prints a one-shot admin token (TTL 24h) to stdout. Used to pair the first device.

## MCP catalog as primary API

The canonical surface is the MCP tool catalog defined in `@diffusecraft/mcp-tools`.

- **`mcp-tools` is schema-only** (Zod definitions + TS types + descriptions/examples + a declarative catalog manifest).
- A build step in `mcp-tools` runs `zod-to-json-schema` to emit a `catalog.json` artifact for the MCP handshake.
- **`server` registers handlers** against those schemas; if a handler is missing for a catalogued tool, build fails.
- **`diffusion-client` consumes the same schemas** to type-check call sites and validate inputs before sending.
- Versioning: `mcp-tools` has its own semver. The server declares supported catalog version on handshake. Mismatched clients receive an explicit `unsupported_catalog_version` error.
- HTTP/WS endpoints exposed by `server` for the human client are a thin layer over the same handlers — the same operation invoked via HTTP from the tablet and via MCP from an agent runs the same code.

## Client UI: NativeWind + react-native-reusables

The tablet client uses a shadcn-equivalent stack adapted to React Native. This mirrors MeshCraft's Tailwind + shadcn approach so contributors moving between repos keep the same mental model.

### Stack

- **NativeWind v4** for styling — same Tailwind class syntax as MeshCraft. `tailwind.config.js` lives at the workspace root and is shared between `apps/mobile` and `@diffusecraft/ui`.
- **react-native-reusables (`rnr`)** as the component source — copy-paste, not a dependency. Components live in `@diffusecraft/ui/components/<name>.tsx` and we own every line.
- **`@rn-primitives/*`** as the headless layer underneath — Radix-equivalent for React Native (accessible, unstyled, gesture-aware). Pulled in transitively by the components we paste.
- **lucide-react-native** for icons — same set as MeshCraft.
- **@gorhom/bottom-sheet** for sheets and drawers — `rnr` does not cover tablet-grade sheets well.
- **sonner-native** for toasts.

### Rules

| Rule | Rationale |
|---|---|
| Components are **pasted into `@diffusecraft/ui`**, not imported from `react-native-reusables` as a runtime package | Owns the code; matches shadcn philosophy; lets us tune for tablet/stylus without forking |
| **No competing UI library** in the client (no NativeBase, Paper, UI Kitten, Tamagui, Gluestack) | Style coherence; bundle size; avoids two design systems competing |
| `apps/mobile` consumes UI **only** through `@diffusecraft/ui` — never imports `@rn-primitives/*` directly | Forces every primitive use to pass through a styled, themed wrapper |
| **Web variants of `rnr` components are dropped on paste** (we are native-only) | Removes dead code; aligns with the "Web/PWA excluded" stance |
| Tablet-specific surfaces not in `rnr` (split panes, floating panels, layer rail, brush picker, command palette) are **custom components in `@diffusecraft/ui`**, built on `@rn-primitives/*` + Reanimated + Gesture Handler | Procreate-style UX is intentionally outside any off-the-shelf kit |
| Theme tokens live in `tailwind.config.js` (colors, spacing, radii) — components read from Tailwind classes, never hardcoded hex | Single source of truth; swap-able later for light/dark/high-contrast |

### What this replaces

Previously the `ui` row in the package table said "RN ecosystem" without specifying the kit. This section is the canonical answer: **NativeWind + rnr + rn-primitives** is the kit. Any future steering or spec that references "the component library" means this.

## Client state (Zustand)

Hybrid granularity: one cohesive store for the editor; independent stores for orthogonal concerns.

| Store | Owns | Persisted? |
|---|---|---|
| `editorStore` (slices) | canvas, layers, selection, active tool, brush settings, transform state | **No** (ephemeral; documents persist via filesystem separately) |
| `connectionStore` | paired backends, current connection, tokens, user prefs | **Yes** (AsyncStorage on RN, electron-store on Electron v2) |
| `modelsStore` | mirror of server's models/presets registry | No (refreshed from server on connect/refresh) |
| `jobsStore` | active jobs, progress events, in-flight requests | No |
| `historyStore` | generation history (previews, metadata, references) | No (mirrored from server; server is source of truth) |
| `mcpCatalogStore` | tools available on current server, schemas | No (refreshed on handshake) |

**Rules:**
- All stores are exported from `@diffusecraft/core` as **factory functions** (`createEditorStore()`), never as module-level singletons. Apps instantiate them in a root provider.
- **No component invokes `diffusion-client` directly.** Components subscribe to stores; client-side actions dispatch to the SDK; server events are translated into store updates.
- **No TanStack Query.** DiffuseCraft is event-driven (server push), not REST-cache-friendly. Zustand handles all state.

## STT and prompt enhancement architecture

Two independent features. Each works alone; users compose freely.

### STT

- **Default**: OS-native (iOS Speech Framework, Android `SpeechRecognizer`). Free, multilingual, on-device or hybrid depending on platform setting.
- **Optional upgrade**: server-side Whisper (local, open-source) exposed as MCP tool `transcribe_audio`. Useful for higher quality, uniform behavior across platforms, and agent-driven flows.
- **Independence rule**: the prompt field receives the transcribed string and is then editable like any text. STT is **not** a flag on the prompt — it's an input method.

### Prompt enhancement

- **Architecture decision (resolved here):** **MCP sampling** is the primary mechanism, with **client-direct as opt-in fallback**.
- **Why MCP sampling** (server-mediated): the server exposes an MCP tool `enhance_prompt(input, context)`. When the human (via tablet) invokes "Enhance" in the UI, the tablet calls that tool. The server uses **MCP sampling** to ask the calling agent (or a pre-configured paired agent) to perform the rewrite using the agent's own LLM credentials. The server attaches contextual metadata (current canvas summary, active workspace, control layers in use, target model) so the rewrite is informed.
- **Why this shape**: preserves the zero-API-key invariant on the server; richer context than client-direct (server knows full state); works whether the human or an agent invokes it; only one round-trip from the tablet.
- **Client-direct fallback**: if MCP sampling is not supported by the user's paired agent, the tablet may call the agent directly via its MCP-client SDK and pass the result back. This is documented as a degraded path.
- **Independence rule**: enhancement always operates on a string and returns a string. It does not depend on STT. It does not modify any state other than returning the rewritten prompt to the caller. The caller (UI or agent) decides whether to accept.

### Composability

The five flows declared in `product.md` (dictate-only, type-only, dictate-then-enhance, type-then-enhance, dictate-then-edit-then-enhance) all reduce to two MCP tools (`transcribe_audio` and `enhance_prompt`) called in any order or skipped, with a plain string carrying state between them.

## Krita-ai-diffusion module mapping

How DiffuseCraft's TypeScript packages relate to krita-ai-diffusion's Python modules. This is a navigation aid for porting concepts; not all modules map 1:1.

| krita-ai-diffusion (Python) | DiffuseCraft (TypeScript) | Notes |
|---|---|---|
| `ai_diffusion/model.py` (state, jobs, history) | `core` (state types) + `server` (job queue, history persistence) + Zustand `historyStore`/`jobsStore` (client mirror) | Krita keeps state in a single Model class per document; we split into typed stores |
| `ai_diffusion/workflow.py` (ComfyUI graph builders) | `server/comfy/workflows.ts` (TS port of graph builders) | Generate / refine / fill / upscale graphs |
| `ai_diffusion/comfy_*.py` (ComfyUI client + wrappers) | `server/comfy/client.ts` (HTTP + WS client) | |
| `ai_diffusion/control.py` (control layers) | `mcp-tools` schemas + `core` types + `server` handlers | Reference vs Structural distinction preserved |
| `ai_diffusion/region.py` (regions) | `mcp-tools` schemas + `core` types + `server` handlers | Mask + per-region prompt + control layers per region |
| `ai_diffusion/style.py` (presets) | `server/presets/*` + `core` types | |
| `ai_diffusion/server.py` (managed local ComfyUI) | `server/comfy/managed.ts` | Install + supervise |
| `ai_diffusion/connection.py` (server selection) | `diffusion-client/connection.ts` (client-side) + `server/pairing.ts` (server-side) | |
| `ai_diffusion/document.py` (Krita document adapter) | N/A | Replaced by canvas-core abstraction |
| `ai_diffusion/ui/*` (PyQt UI) | `apps/mobile` + `ui` package (RN) | Full reimplementation in React Native; UX patterns preserved; tablet-first form factor |
| `ai_diffusion/eventloop.py` (Qt event loop bridge) | N/A | Native JS event loop |
| `ai_diffusion/jobs.py` (queue + progress) | `server/jobs/queue.ts` + MCP events | |

## Testing approach

| Layer | Strategy | Tool |
|---|---|---|
| `core`, `mcp-tools`, `canvas-core` | Unit tests (pure functions, no I/O) | Vitest |
| `server` handlers | Integration tests with in-memory ComfyUI mock | Vitest + custom mock |
| `diffusion-client` | Integration tests against in-memory server (same process, in-memory transport) | Vitest |
| Zustand stores | Unit tests via factory instantiation | Vitest |
| `apps/mobile` UI | Component tests + critical-path E2E | RN Testing Library + Maestro for E2E |
| Cross-cutting agent-driven E2E | Spin up server, invoke MCP tools as if we were Claude Code, verify outcomes | Vitest harness invoking `@modelcontextprotocol/sdk` client |
| MCP catalog conformance | Test that for every catalogued tool, server has a registered handler with matching schema | Vitest, generated test from `mcp-tools` manifest |
| MCP client compatibility matrix | Test against ≥3 client implementations (Claude Desktop simulator, Codex simulator, Gemini CLI simulator) | CI matrix |

## Decisions deferred

- **Nx Release vs Changesets** for coordinated package releases — both work, decided when first release is cut.
- **Monorepo `pnpm` vs `yarn` vs `bun`** — leaning pnpm for Nx compatibility and lockfile determinism. Confirm in `structure.md`.
- **Compiled binary tooling** for the standalone server (`pkg` vs `bun build --compile` vs `node --compile-single-executable`) — picked when the v2 binary effort starts; v1 stays with `npx`.
- **Whisper model size** for the optional server-side STT path — `large-v3` is the obvious choice but VRAM-heavy. Final selection in `server-architecture` spec.
- **Tunnel mechanism for post-v1 Internet reachability** — candidates: Tailscale-style mesh VPN, Cloudflare Tunnel (cloudflared), server-initiated relay tunnel, WireGuard self-hosted. **Never** port-forwarding or public hostname binding. Decision deferred to a post-v1 spec named `internet-reachability` (or similar) once v1 ships.
- **Scripting sandbox runtime choice** — for the `script-execution` backend, options: (a) Python via `python -E -I` subprocess with namespace/cgroup isolation; (b) Pyodide WASM (CPU-only, no native libs); (c) gVisor / nsjail wrapping a regular Python; (d) Deno for JS scripts (built-in permissions model). v1 default proposed: native Python subprocess + Linux namespace (or `sandbox-exec` on macOS) + AST whitelist; Pyodide as fallback for hosts without those primitives. Final selection in `script-execution` spec.
- **Agent registry mechanism** — should the server keep a list of "preferred paired agents" for MCP sampling fallback (e.g., "if no agent in current session, use this default")? Or always require a calling agent? Decided in `auth-and-proxy` spec.
- **MCP catalog versioning policy** — semver bumps that add tools = minor; remove = major; change schema = major. Confirm in `mcp-tool-catalog` spec.
- **Post-v1 extraction candidates** — `canvas-core` and `mcp-tools` are the most likely to graduate to their own repos if they attract independent contributors. `apps/mobile` could also be extracted once its API stabilizes. Reevaluated post-v1.
- **MeshCraft adapter for canvas-core** — if MeshCraft ever wants to render the DiffuseCraft canvas inside Electron (e.g., showing a layered preview of a texture being authored), MeshCraft would write its own CanvasKit adapter against `canvas-core`. Not DiffuseCraft's responsibility. Out of v1 scope.
