# Principles

Non-negotiable design principles. Every spec, design decision, and PR is checked against these. When two principles tension, the order below is the tiebreaker.

Each principle is stated as **rule + rationale + reference**. References point to where the principle is applied or where it came from.

---

## P1 — Agent-first

**Rule.** Every meaningful operation is an MCP tool before it is a UI button. The MCP tool catalog (`@diffusecraft/mcp-tools`) is the canonical product surface; the GUI is a client of it.

**Rationale.** AI agents are first-class users from day one. If the operation only makes sense in a GUI context, it doesn't make sense at all. Designing tools-first forces the surface to be complete, typed, and observable — and the UI inherits that rigor for free.

**Reference.** `product.md` (vision), `tech.md` (MCP catalog as primary API), `mcp-tool-catalog` spec.

---

## P2 — Human UX is built on top of the agent API

**Rule.** Every user action in `apps/mobile` resolves, at most one layer down, to an MCP tool invocation. There is no privileged "internal API" reserved for the GUI. HTTP/WS endpoints exposed to the human client are a thin layer over the same handlers MCP uses.

**Rationale.** A second internal API would split the surface, hide state from agents, and let the GUI take shortcuts that erode the invariants below.

**Reference.** `tech.md` ("Server architecture"); enforced by code review.

---

## P3 — Agent-agnostic; agents are both clients and backends

**Rule.** Any client that speaks MCP standard is a first-class citizen. DiffuseCraft does not privilege Anthropic, OpenAI, Google, or any vendor. No vendor-specific shims, helpers, or extensions in `mcp-tools` or `server`. Conformance with the MCP spec is the only requirement.

**Dual role.** Agents are simultaneously **clients** of the server's MCP catalog (invoking tools to orchestrate workflows) AND **backends** the server depends on for LLM/VLM-class reasoning (via MCP sampling, for prompt enhancement, prompt-based selection, future caption/suggestion features). The same agent process plays both roles in a single session. The server never carries an AI provider key — credentials live with the agent.

**Rationale.** The user explicitly chose "agentic-free" to avoid lock-in. The agent ecosystem evolves fast; tying the platform to one vendor would shorten its useful life. Treating agents as both clients and backends lets DiffuseCraft be locally-hosted, zero-cost-per-call for image inference, and still reach frontier-LLM intelligence when the user pairs a capable agent.

**Reference.** `product.md` (value props); `tech.md` ("Backends model"); `external-agent-integration` spec covers Claude Desktop, Claude Code, OpenAI Codex / ChatGPT Desktop, Gemini CLI, custom agents — equally, in both roles.

---

## P4 — Local-only inference, zero AI provider API keys

**Rule.** All image generation runs on user-controlled hardware via ComfyUI. The server never proxies inference to a cloud provider. DiffuseCraft does not require any `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STABILITY_API_KEY`, `REPLICATE_TOKEN`, or equivalent. Features that require an LLM (prompt enhancement, suggestions) delegate to the user's paired agent via MCP sampling — the agent brings its own credentials.

**Rationale.** Privacy by architecture. No recurring per-call cost. No telemetry to third parties. No bandwidth dependency. No vendor lock-in for inference.

**Reference.** `product.md` ("What it is NOT"); `tech.md` (STT and prompt enhancement architecture).

---

## P5 — State is queryable

**Rule.** Any state an agent needs to reason about is reachable via MCP tools or resources. There is no hidden state visible only to the GUI. Canvas content, layers, selections, regions, control layers, history, queued jobs, available models, presets, current workspace — all queryable.

**Rationale.** An agent connecting fresh must be able to discover the world. If the agent can't read it, the agent can't act on it.

**Reference.** `mcp-tool-catalog` spec; `tech.md` (resources catalog).

---

## P6 — Idempotency and explicit side effects

**Rule.** Every MCP tool declares its category in metadata: `read` (no side effects), `write` (mutates state), or `job` (long-running, side effects on completion). Reads are reads; writes are writes; nothing is implicit. Tools that can be safely retried are marked idempotent; those that cannot are explicit about the consequences of retry.

**Rationale.** Agents need predictability. A tool that "sometimes mutates" is unusable in autonomous orchestration.

**Reference.** `mcp-tool-catalog` spec; `principles.md` cross-checked in every tool review.

---

## P7 — Long-running operations expose progress

**Rule.** Any operation that takes more than ~1 second emits progress events on a typed channel. Generations, downloads, upscales, batch jobs — all observable. Polling-only is forbidden as the primary feedback mechanism.

**Rationale.** Agents (and humans) need to know whether to wait or move on. Cancellation requires observability.

**Reference.** `job-queue` spec; `mcp-tool-catalog` events section.

---

## P8 — Preview-then-apply

**Rule.** Generated images are previews until explicitly applied. The model produces; the user (or agent) decides whether to commit. Multiple previews coexist in the generation history; users can mix them.

**Rationale.** Inherited from krita-ai-diffusion. Saves re-work, enables comparison, and gives agents a clean separation between "model produced X" and "X is now part of the canvas."

**Reference.** `generation-history` spec; `product.md` glossary (Apply, Generation history).

---

## P9 — Strength-driven verb switching

**Rule.** The same operation (`generate_image` MCP tool) carries different semantics based on `strength` and `selection`:
- `strength=100, no selection` → Generate (new image from prompt)
- `strength<100, no selection` → Refine (image-to-image)
- `strength=100, with selection` → Fill (inpaint), with selection sub-mode (`Fill` / `Expand` / `Add Content` / `Remove Content` / `Replace Background`)
- `strength<100, with selection` → constrained variation

The tool's response includes the resolved verb so callers can reason about what happened.

**Rationale.** Inherited from krita-ai-diffusion. One operation, one tool, contextual verb. Simpler surface, fewer false dichotomies for agents.

**Reference.** `generation-workflow` spec.

---

## P10 — Control-layers-as-layers

**Rule.** ControlNet inputs (Scribble, Line Art, Soft Edge, Canny, Depth, Normal, Pose, Segmentation, Unblur, Stencil) and IP-Adapter inputs (Reference, Style, Composition, Face) are first-class layer types in the canvas — not hidden settings. They are added, removed, reordered, and toggled like any layer.

**Rationale.** Inherited from krita-ai-diffusion. Putting them in the layer stack makes them visible, manipulable, and equally accessible to agents (which see the layer list as queryable state).

**Reference.** `control-layers` spec; `product.md` glossary.

---

## P11 — Regions-as-areas

**Rule.** Per-area prompts (Regions) are tied to paint layer opacity. Coverage is defined by the layer's pixels. Each region has its own prompt, optionally its own reference-style control layers. The root prompt is concatenated with each region's prompt during generation.

**Rationale.** Inherited from krita-ai-diffusion. Per-area control without a separate UI concept; the layer stack already tells you which region applies where.

**Reference.** `regions` spec.

---

## P12 — Workspaces-as-modes

**Rule.** The app has explicit modes: `Generate`, `Inpaint`, `Upscale`, `Live`, `Custom Graph`, `Animation`. Each mode determines which tools are active. Agents query and switch via `set_workspace` / `get_workspace`. UI panels and MCP tool availability change with workspace.

**Rationale.** Inherited from krita-ai-diffusion. Mode-as-state is more honest than feature flags everywhere.

**Reference.** `workspaces` spec.

---

## P13 — Resolution abstraction

**Rule.** The user (or agent) works at any canvas size. The server handles model native resolution requirements, hires-fix two-pass generation, multiples of 8/16/64, batch sizing, and tile-based upscale internally. Tools never expose model resolution constraints to callers.

**Rationale.** Inherited from krita-ai-diffusion. Model-specific quirks should not leak into the user's mental model — let alone an agent's.

**Reference.** `resolution-handling` spec; `upscale-and-tiling` spec.

---

## P14 — Job queue, non-blocking

**Rule.** Generation, refinement, fill, upscale, and model download are jobs. The server enqueues, tracks progress, and emits events. Tools that submit jobs return a job handle, not a blocking result. Cancellation is always available.

**Rationale.** Inherited from krita-ai-diffusion. Agents and humans need to fire-and-forget, observe, and cancel. Sync-blocking would deadlock multi-step workflows.

**Reference.** `job-queue` spec.

---

## P15 — Strong defaults, opt-in customization

**Rule.** Presets bundle model + sampler + LoRAs + sane defaults. Most users (and most agents) never touch raw parameters. Power users (and power agents) can drop down to full ComfyUI graph control via the `Custom Graph` workspace.

**Rationale.** Inherited from krita-ai-diffusion. Cognitive load is the enemy. Defaults that work for 80% of cases beat infinite knobs.

**Reference.** `presets-and-models` spec.

---

## P16 — Server-as-library

**Rule.** `@diffusecraft/server` is a library, not an app. Hosts (the standalone `npx @diffusecraft/server`, MeshCraft, future Suquía Bytes products) instantiate it. The library exposes the same MCP catalog, transports, and lifecycle hooks regardless of host.

**Rationale.** One implementation, many packagings. MeshCraft and the standalone binary differ only in how they wrap the library; they share zero divergent code paths.

**Reference.** `server-architecture` spec; `tech.md` (server architecture section).

---

## P17 — DiffuseCraft owns no desktop app

**Rule.** DiffuseCraft does not ship an Electron app — neither in v1 nor in any planned version. The desktop experience is provided by **MeshCraft** (`~/ia/CraftMesh/apps/desktop`) embedding `@diffusecraft/server`. Users who want DiffuseCraft on desktop install MeshCraft.

**Rationale.** MeshCraft already exists as Suquía Bytes' desktop product. Building a separate DiffuseCraft Electron app duplicates scope and forces DiffuseCraft to maintain a CanvasKit-in-Electron stack. By making MeshCraft the desktop host, both products win.

**Reference.** `product.md` ("What it is NOT"); `tech.md` (Cross-platform strategy).

---

## P18 — Zero-config pairing, single-tier access, LAN-first, mDNS-first

**Rule.** Pairing must succeed in under 30 seconds for the default flow. Onboarding methods, in priority order:

1. **mDNS auto-discovery + tap-to-pair (default).** The app scans the LAN, lists `DiffuseCraft on <server-name>`, the user taps; the server approves the request (auto during a pairing window for `npx @diffusecraft/server`; visual prompt in MeshCraft). Two taps total, zero typing, zero camera.
2. **QR code (fallback).** The server displays a QR encoding `{ url, ip, port, token, server_name }`; the tablet scans with its camera. Used when mDNS is blocked (corporate networks, multicast off) or the user cannot trigger an approve action on the server.
3. **Numeric 6-digit code (secondary fallback).** The server shows `123-456`; user types it on the tablet. Used when there's no camera or the QR cannot be seen.
4. **URL+token paste (hidden Advanced).** Manual fallback for debug or unusual scenarios.

All four methods produce the same outcome: the device receives a single opaque pairing token. No scopes, no roles. Server-side single-tier access remains.

**LAN-first.** v1 supports **only same-LAN connections** between client and server. The QR carries a local IP (e.g., `http://192.168.1.42:7860`). HTTP plain (no TLS) is acceptable inside the local network.

**Internet via tunnel only (post-v1).** When Internet reachability is added (post-v1), it must use a **tunnel** — never port-forwarding, public hostname binding, or direct exposure of the server to the open Internet. The specific tunnel mechanism (Tailscale-style mesh VPN, Cloudflare Tunnel, server-initiated tunnel to a relay) is a deferred decision tracked in `tech.md`. Rationale: tunnels keep the security baseline of "the server never has an open port on the public Internet" — the user's GPU and models are not advertised, scanned, or directly attackable.

**Single-tier access.** Every paired device or agent receives **the same level of access** — there are no scopes (no `read` / `generate` / `admin` distinction). A paired client can do everything; a non-paired client can do nothing. Tokens are revocable and have an optional human-readable name ("iPad de Igna", "Claude Desktop laptop") used for audit display only — never for authorization.

**Bootstrap.** On first run, the server prints/displays the QR (and a fallback URL+token line in the log). Whoever scans first becomes paired. No "admin" tier, no "first claim" privilege — the model is "you control the server hardware, you control the QR."

**Audit log still exists.** Every tool invocation is recorded with `{ token_name, operation, timestamp }`, queryable via tools like `get_audit_log`. The log is informational; it does not gate access.

**Rationale.** Onboarding friction kills tablet apps. The user's persona is an illustrator, not a network admin. Scoped tokens are valuable in multi-tenant SaaS; they are dead weight in a single-user, single-server, LAN-trust model. The previous "3 scopes (read/generate/admin)" plan was overengineered for the actual use case.

**Reference.** `pairing-protocol` spec; `auth-and-proxy` spec (which becomes a thin spec covering token verification + audit log only).

---

## P19 — ComfyUI is never exposed raw

**Rule.** ComfyUI's HTTP/WS API is reachable only by `@diffusecraft/server`. Clients (the tablet app, agents, MeshCraft as MCP client) never talk to ComfyUI directly. The server is an authenticated proxy with audit logging in front of every ComfyUI request.

**Rationale.** Security baseline. ComfyUI has no auth and runs arbitrary graphs (which can include filesystem and network nodes). Exposing it directly would be a foot-gun.

**Reference.** `auth-and-proxy` spec; `comfyui-management` spec.

---

## P20 — Library independence

**Rule.** Library boundaries are enforced architecturally:
- `canvas-core` and `canvas-skia` know nothing about AI.
- `diffusion-client` knows nothing about canvas.
- `server` knows nothing about canvas.
- `mcp-tools` is pure schema/contract; depends only on `zod`.
- `core` is leaf; depends on nothing but `zod`.

These rules are enforced by `@nx/enforce-module-boundaries` and fail CI on violation.

**Rationale.** Independence enables reuse and forces clarity. A library that "knows" about a sibling becomes a tangled coupling. Future hosts (MeshCraft now, others later) only consume what they need.

**Reference.** `structure.md` (Dependency rules).

---

## P21 — Stores are factories, not singletons

**Rule.** Zustand stores in `@diffusecraft/core` are exported as factory functions (`createEditorStore()`), never as module-level singletons. Apps instantiate them in a root provider.

**Rationale.** Singletons break: testing (impossible to isolate), multi-window scenarios (Electron v2 / future), SSR (not in scope but free if done right), and React StrictMode double-mount. Factories cost one extra line of provider code and prevent all of these.

**Reference.** `tech.md` (Client state); `client-state-architecture` spec.

---

## P22 — Mobile is the reference platform; tablet is the reference form factor

**Rule.** Every UX decision is validated on tablet first. If a layout, gesture, or control breaks on tablet, it gets reworked on tablet. Phone is a degraded-mode sibling on the same codebase. Desktop UX is MeshCraft's responsibility.

**Rationale.** v1's persona is an illustrator with a tablet + stylus. Designing for desktop and porting to tablet is the standard path that produces unusable tablet apps. Reversing the priority forces tablet-native decisions.

**Reference.** `product.md` (primary persona); `tech.md` (Cross-platform strategy).

---

## P23 — Diffusion prompts are always English; the SERVER enforces it

**Rule.** Prompts sent to ComfyUI for generation are always English, regardless of the user's UI language. **Enforcement is server-side, automatic, and mandatory** — the user never has to remember to translate manually. Whenever a non-English prompt reaches `generate_image` (or another job tool consuming a prompt), the server automatically calls `enhance_prompt({ mode: "translate_only", target_model })` via MCP sampling and uses the translated result. If sampling is unavailable, the server passes the raw prompt with a quality warning event.

**Model-aware formatting.** The translation/rewrite phase is also **model-aware**: SDXL-class models receive tag-style output (comma-separated descriptors); Flux-class models receive natural-language paragraphs. The system prompt template is selected per the target model family.

**Manual rewrite/elaborate is opt-in.** Phase 2 of enhancement (polish, elaborate, restyle via the ✨ button) is explicit and optional — auto-translate covers the language requirement transparently.

**Rationale.** Diffusion models are trained predominantly on English captions. Non-English prompts degrade quality significantly. This is a model-level constraint, not a user-experience preference. Putting enforcement on the server means the user can dictate in their native language and never think about it.

**Reference.** `product.md` (glossary, prompt enhancement); `tech.md` (STT and prompt enhancement architecture); `prompt-enhancement` spec FR-29..32 (auto-translate phase); `generation-workflow` FR-AT-1..4 (handler integration).

---

## P24 — STT and prompt enhancement are independent and composable

**Rule.** Speech-to-text and prompt enhancement are two orthogonal features. Each works alone. They compose freely (dictate-only, type-only, dictate-then-enhance, type-then-enhance, dictate-then-edit-then-enhance — all valid). Neither implies the other.

**Rationale.** Conflating them creates a coupled "AI prompt input" mode that hides the user's choice. Treating them as peers exposes the choice and lets users (and agents) compose flows naturally.

**Reference.** `product.md` (value props 4 and 5); `tech.md` (STT and prompt enhancement architecture).

---

## P25 — No half-finished implementations

**Rule.** No feature flags hiding partial work in the main branch. No mock handlers shipped behind "TODO real implementation". No `// removed` comments instead of deletion. No backwards-compatibility shims for unreleased APIs. If it ships, it works; if it doesn't work, it doesn't ship.

**Rationale.** Pre-1.0 we have the freedom to delete and rewrite. We use that freedom. Half-finished code rots and confuses future readers (human and agent).

**Reference.** `tasks.md` of every feature spec; PR review.

---

## P27 — Universal undo/redo

**Rule.** Every operation that mutates document state is **reversible**. Layers (add, remove, reorder, opacity, blend, visibility), masks (strokes, fill, clear, refine), selections, transforms, brush strokes, apply-history-item, control-layer add/update/remove, region define/update/remove — **all reversible** through a single undo/redo system. The capability is not optional, not a "nice-to-have", and not bolted on after specs land. It is load-bearing infrastructure that **every editor spec and every state-mutating MCP tool must wire into**.

**Scope.**
- **Versioned:** all document state — layers, masks, selections, control layers, regions, transforms, applied generations, document properties.
- **Not versioned:** connection state, tokens, workspace switching, job-queue state, server-side history (which is its own append-only log), per-user settings.

**Surface.**
- Tablet UI: dedicated buttons + standard tablet gestures (two-finger tap = undo, three-finger tap = redo on iPad).
- MCP tools: `undo`, `redo`, `get_undo_stack`, `get_redo_stack`, `clear_undo_stack`. Agent-first (P1) requires that an agent that mutates state can also revert. Without these tools, an agent has no recovery path.
- Per-document scope: each open document has its own stack. Closing a document discards in-memory stacks unless explicitly persisted.

**Multi-client model.** The tablet user and any active agent each have their own undo/redo stack on the same document. Operations are merged by the server in the order received. When a user undoes their last operation, only their last operation reverts — not the agent's. Conflicts (operations that overlap on the same region) resolve last-write-wins with a notification visible to both clients.

**Implementation pattern.** Command pattern with periodic snapshots:
- Each operation is a `Command` with `apply()` and `revert()` methods.
- Every N operations (default: 20) the system stores a full snapshot of document state to bound the cost of long undo sequences.
- Default stack size: 100 operations per client per document; configurable.

**Rationale.**
- Inherited expectation: every serious image editor has undo. Tablet illustrators rely on it constantly.
- Agent safety: an agent that makes a mistake must be able to revert. If the only path is "regenerate from scratch", agents become dangerous to use autonomously.
- Composability: complex flows (brush masks + apply + refine + control layer + new region) are exploratory by nature. Reversibility makes exploration cheap.
- Predictability: per-client stacks prevent "the agent undid my work" surprises.

**Reference.** `undo-redo-system` spec (P0, cross-cutting). Referenced by every editor spec (`canvas-fundamentals`, `selection-tools`, `mask-system`, `brush-system`, `transform-tools`, `control-layers`, `regions`, `generation-history`). **v1 implementation:** Phases A–H landed; module at `libs/server/src/lib/undo-redo/` (see its README). Tablet hook: `@diffusecraft/core`'s `useUndoRedo`. Conformance gate at `server.start()`.

---

## P26 — Inference is server-side only; the client never runs models

**Rule.** No model inference runs on the client device (tablet, phone). The client is strictly **input + display + UI**. ComfyUI, all model files, all GPU/CPU work, all VRAM allocation — happen on the server, which lives on a separate machine (a PC the user owns, MeshCraft on their laptop, or any other host running `@diffusecraft/server`). The client connects to the server via **pairing (QR + mDNS, with manual fallback)** and exchanges:

- *Client → Server*: prompts, control inputs, selections, masks, settings, pairing handshake, MCP tool calls.
- *Server → Client*: generated images (encoded), progress events, job results, history metadata.

**Rationale.** Tablets and phones lack the VRAM and sustained compute needed for SD/SDXL/Flux inference. Even iPad Pro M-class chips that could run small models would push the architecture toward a "lite mode" that splits product behavior across devices and breaks parity with what agents see. The illustrator's tablet pairs with their PC (or MeshCraft); that asymmetric split is the architecture, not an accident.

**Reference.** `tech.md` ("Cross-platform strategy", "Server architecture"); `pairing-protocol` spec.

---

## Tiebreaker order

When two principles conflict, the one with the lower number wins. Examples:
- P1 (agent-first) outranks P22 (tablet reference). If a tablet UX choice would prevent the operation from being a clean MCP tool, the MCP tool wins.
- P4 (local-only inference) outranks P15 (strong defaults). We do not default to a cloud-backed enhancement for "convenience".
- P20 (library independence) outranks P25 (no half-finished). If ripping a coupling out leaves a temporary gap, take the gap and finish next.

This ordering is itself non-negotiable. Reordering is a steering change, not a per-PR judgment call.

## Adding or changing principles

Steering changes (including this file) require:
1. PR with rationale.
2. Updates to all specs that referenced the old principle.
3. Updates to `MEMORY.md` index entries that referenced it.
4. CHANGELOG entry under `chore(steering)`.

Principles are durable. Expect them to outlive features.
