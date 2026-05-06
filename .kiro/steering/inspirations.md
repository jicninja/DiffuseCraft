# Inspirations

What we take from prior art and where we deliberately diverge. Each section names the source, what we inherit, what we leave behind, and why.

---

## krita-ai-diffusion (Acly)

**Repo:** https://github.com/Acly/krita-ai-diffusion
**Docs:** https://docs.interstice.cloud
**Language:** Python, PyKrita plugin for Krita 5.2+

The single largest influence on DiffuseCraft. We treat krita-ai-diffusion as the canonical reference for the AI-assisted image-editing workflow.

### What we inherit

- **Strength slider semantics.** 100% = Generate, <100% = Refine, +selection = Fill. One operation, contextual verb. Captured as principle P9.
- **Selection sub-modes.** Fill / Expand / Add Content / Remove Content / Replace Background. Captured in `product.md` glossary; flow into `generation-workflow` spec.
- **Preview-then-apply.** Generations are previews until explicitly applied. Generation history is browsable and partial-applicable. Captured as P8.
- **Control layers as first-class layers.** ControlNet (Scribble, Line Art, Soft Edge, Canny, Depth, Normal, Pose, Segmentation, Unblur, Stencil) and IP-Adapter (Reference, Style, Composition, Face) live in the layer stack. Captured as P10.
- **Regions as per-area prompts** tied to layer opacity, with a root prompt concatenated to each region's prompt. Captured as P11.
- **Workspaces as modes.** Generate / Inpaint / Upscale / Live / Custom Graph / Animation. Captured as P12.
- **Live mode** with constant seed for real-time experimentation. Captured in glossary; flows into `live-mode` spec.
- **Resolution abstraction.** User works at any size; the system handles model native resolutions, hires-fix, multiples of 8/16/64, batch sizing. Captured as P13.
- **Tile-based upscaling** for ≥4K. Captured in `upscale-and-tiling` spec scope.
- **Strong defaults via presets.** Captured as P15.
- **Job queue with cancellation.** Captured as P14.
- **ComfyUI as backend with three connection modes** (managed local, external local, external remote). Captured in `comfyui-management` spec scope.
- **Required custom nodes pattern** (ControlNet preprocessors, IP-Adapter, inpaint nodes, external tooling). Server validates presence at startup.
- **Hardware breadth** (NVIDIA CUDA, AMD, Apple Silicon MPS, CPU). Captured as a server requirement.

### Where we diverge

| Aspect | krita-ai-diffusion | DiffuseCraft |
|---|---|---|
| Form factor | Krita plugin, desktop only | Standalone tablet app + agent-driven |
| Language | Python | TypeScript |
| UI runtime | PyQt | React Native (Expo) |
| Distribution | Krita extension | Mobile app stores + npm libs + npx server |
| Host model | Krita document | Server library embedded in any host |
| Agent surface | None | MCP catalog as primary API |
| State location | Krita document | DiffuseCraft server (SQLite + filesystem) |
| Pairing | N/A (single-process) | QR + mDNS for tablet/agent |
| Multilingual prompts | User-managed | Agent-mediated rewrite to English |
| Voice input | None | OS-native STT + optional server-side Whisper |

### Concrete code references we'll port

- `ai_diffusion/workflow.py` (ComfyUI graph builders for generate/refine/fill/upscale) → `libs/server/src/lib/comfy/workflows.ts`
- `ai_diffusion/control.py` (control-layer types and processing) → `libs/mcp-tools/src/tools/control-*.ts` schemas + `libs/server/src/lib/handlers/control-*.ts`
- `ai_diffusion/region.py` (regions logic) → same split as above
- `ai_diffusion/server.py` (managed ComfyUI install/lifecycle) → `libs/server/src/lib/comfy/managed.ts`

These ports are recorded in `tech.md` ("Krita-ai-diffusion module mapping"). Ports stay faithful to behavior but adopt TypeScript idioms and the agent-first surface.

---

## Pairing inspirations: WhatsApp Web, Plex, Spotify Connect

**What we take.** The "scan-a-QR-and-you're-paired" UX. A short-lived token shown on the host, claimed by the client, exchanged for a per-device long-lived token. No IP entry, no port forwarding, no router config in the default flow.

**WhatsApp Web** specifically: short-lived QR (regenerates every ~30s), server-side claim ledger, single-use semantics, push-based confirmation on the host side.

**Plex** specifically: works over LAN (mDNS) or relay (when no direct connection possible). The client does not care which path is used; the user does not see the difference.

**Spotify Connect** specifically: device-aware pairing — once paired, the client lists named hosts and switches between them. We adopt this for the multi-server scenario (tablet user with both `npx @diffusecraft/server` on a workstation and MeshCraft on a laptop).

**What we leave behind.** The proprietary back-channels these products use. Our pairing is open: any DiffuseCraft client can pair with any DiffuseCraft host because the protocol is documented in `pairing-protocol` spec.

**Where it shows up.** Captured as P18 (zero-config pairing), specced in `pairing-protocol`.

---

## Server-as-library inspirations: Ollama, Home Assistant

**Ollama** (https://ollama.com)
- The server is a library AND a binary. `ollama serve` is a thin wrapper around a Go library, and the Go library can be embedded in other Go programs.
- Models are managed locally; the server pulls from a registry and serves them via HTTP.
- No cloud calls in the inference path; user owns the hardware.
- One implementation, two packagings (lib + binary).

**Home Assistant** (https://www.home-assistant.io)
- Self-hosted infrastructure for home automation. Single Python library + bundled distribution.
- Ecosystem of community-contributed integrations, all consuming the same internal API.
- "Bring your own hardware" philosophy.

**What we take.** Both validate the server-as-library + standalone-binary pattern. Both prove that a single open-source Python/Go server can power both a CLI tool and a plurality of UI shells.

**What we leave behind.**
- Ollama's HTTP-only API (no MCP) — DiffuseCraft makes MCP the primary surface.
- Home Assistant's Python single-process model — our backend is Node, our hosts can include Electron and our own apps simultaneously.

**Where it shows up.** Captured as P16 (server-as-library); informs `server-architecture` spec.

---

## Model Context Protocol ecosystem

**Spec:** https://modelcontextprotocol.io
**SDK:** https://github.com/modelcontextprotocol/typescript-sdk
**Reference servers:** https://github.com/modelcontextprotocol/servers

We treat MCP as our agent-facing contract layer.

### What we take

- **Tools / Resources / Prompts taxonomy.** Tools are the operations agents invoke; resources are the queryable state; prompts are templated guidance. We use all three.
- **Transport plurality.** stdio (local agent spawn), Streamable HTTP (remote/multi-client), in-memory (host-embedded). All three live in v0.1.
- **Schema-first design.** Tools declare input/output schemas in JSON Schema (we author in Zod and emit JSON Schema). Agents discover the catalog via standard handshake.
- **Vendor-neutrality.** MCP is supported by Anthropic (Claude Desktop, Claude Code), Anthropic-compatible custom agents, and increasingly by OpenAI and Google ecosystems via clients. We lean fully into this neutrality (P3).

### Reference servers we mirror in style

- **Filesystem MCP server** — clear tool naming (`read_file`, `list_directory`), explicit side-effect labels, security boundaries.
- **GitHub MCP server** — rich tool catalog with composable verbs (`create_issue`, `list_pull_requests`, `merge_pull_request`).
- **Linear MCP server** — typed schemas with detailed `description` fields used in agent prompts.
- **Memory** (knowledge-graph reference server) — patterns for state that an agent reads and mutates over a session.

### What we leave behind

- **Resource-only servers** as an exclusive surface. DiffuseCraft is fundamentally about *acting*, so tools dominate; resources support state queries.
- **Vendor-specific extensions.** The temptation to add Anthropic-specific tool annotations or OpenAI function-calling wrappers — declined. P3.

**Where it shows up.** Captured as P1, P3, P5, P6. Specced fully in `mcp-tool-catalog`.

---

## ComfyUI

**Repo:** https://github.com/comfyanonymous/ComfyUI

The exclusive AI inference backend.

### What we take

- The graph-based generation model (we author graphs server-side, never expose graph editing to non-Custom-Graph workflows).
- The custom-node ecosystem — we depend on the same packages krita-ai-diffusion does (ControlNet preprocessors, IP-Adapter, inpaint nodes, external tooling).
- The HTTP + WebSocket API surface for orchestration and progress events.

### What we leave behind

- The default ComfyUI UI. DiffuseCraft never shows it to humans — and never exposes the underlying API to clients (P19).
- Direct, unauthenticated access. Our server is the only authorized client of ComfyUI; it proxies, audits, and restricts.

---

## Procreate (UI / UX / gesture inspiration — second-most-influential reference after krita-ai-diffusion)

**App:** https://procreate.com (iPad), https://procreate.com/pocket (iPhone)
**Why first-class.** Procreate is the gold standard of tablet-native illustration UX. DiffuseCraft inherits its gesture-driven canvas, panel ergonomics, and minimal-chrome aesthetic deliberately. Where krita-ai-diffusion gives us the AI workflow's mental model, **Procreate gives us how the tablet should feel**.

### What we inherit verbatim

- **Gesture-driven canvas (no chrome dependency).** Two-finger pinch zoom, two-finger pan, two-finger rotate, two-finger tap = undo, three-finger tap = redo, four-finger tap = toggle UI. Already captured as P22 + canvas-fundamentals FR-28.
- **Quick palette / tool wheel.** Most-used actions a tap away from anywhere on the canvas; long-press opens contextual menus.
- **Layer panel ergonomics.** Right-side floating panel, drag-to-reorder, swipe-to-delete, pinch-to-group. Captured in canvas-fundamentals §3.9.
- **Floating modifier ring** (our adaptation of Procreate's "Modify" palette) for keyboard-less tablet use during transform. Captured in transform-tools.
- **Stylus-first interactions.** Apple Pencil tap behavior, pressure as a first-class axis, palm rejection. Captured in canvas-skia FR-24.
- **Panel transitions.** Bottom sheets in portrait, side panels in landscape, smooth slide animations.
- **Color disc.** Touch-driven color picker; quick swatches. Used by brush-system.
- **Eyedropper as long-press**. Captured in canvas-fundamentals FR-28.

### Where we stop short

- **Procreate's brush engine.** We do **not** inherit Procreate's procedural brush authoring. v1 brushes are 4–6 fixed presets per `brush-system`. Custom brushes are post-v1 if at all.
- **Procreate's animation timeline.** Out of scope.
- **Procreate's QuickShape, Symmetry, Reference Companion.** Possible post-v1 if they fit the AI-collage workflow.
- **Procreate's filters.** AI replaces them; native filter palette is post-v1.

### Where we extend Procreate

- **AI history strip** (preview-then-apply) — Procreate has no analog because it has no AI workflow.
- **Region-based prompts** — DiffuseCraft-specific.
- **Control layers as layers** — DiffuseCraft-specific.
- **Multi-client awareness** — Procreate is single-user.
- **Agent-driven editing** — Procreate is human-only.

## Photoshop on iPad / Lightroom Mobile / Photoroom (secondary references)

Used when Procreate doesn't address a specific pattern.

- **Photoshop on iPad** — layer panel polish, contextual property panels (layer-specific tabs), modifier ring patterns.
- **Lightroom Mobile** — before/after toggles, tabbed editing modes, presets surfacing.
- **Photoroom** — AI-driven editing on tablet that doesn't feel "cheap"; quick-action presets; mask refinement UX.

### What we take

- Layer panel detail rows from Photoshop on iPad.
- Before/after compare slider from Lightroom (used in `generation-history` compare view).
- Quick-action chips for AI ops from Photoroom.

### What we leave behind

- Photoshop's adjustment layers + filter stack (post-v1).
- Lightroom's RAW pipeline and color management (out of scope — sRGB only).
- Photoroom's cloud-only model (we're local-first).

---

## What we are NOT inspired by (deliberately)

- **Cloud-first AI image platforms** (DALL-E, Midjourney, Imagen apps, Stability AI Cloud, Replicate frontends). They invert our core privacy and cost properties (P4). We are explicitly the alternative.
- **Closed ecosystems** that bundle a vendor's UI with a vendor's model (Adobe Firefly, Google AI Studio for images). We avoid the lock-in shape they encode.
- **General ML platforms** (Hugging Face Spaces, Gradio apps). DiffuseCraft is image-specific; treating it as a generic ML harness would dilute the surface.

---

## Reference order when designing

When working on a spec, this is the consultation order for prior art:

1. **krita-ai-diffusion** — for generation workflow, control layers, regions, workspaces, presets, ComfyUI integration.
2. **Procreate** — for tablet UI/UX, gestures, panel ergonomics, stylus interactions.
3. **MCP reference servers** — for tool catalog shape, schema descriptions, naming conventions.
4. **Pairing references (Plex, WhatsApp Web, Spotify Connect)** — for client-server onboarding flows.
5. **Ollama / Home Assistant** — for server-as-library packaging.
6. **Photoshop on iPad / Lightroom Mobile / Photoroom** — secondary tablet UX references when Procreate doesn't cover a pattern.

This ordering is not a strict tree but a default sequence for "where do I look first?" Procreate sits at #2 because for any tablet-native UX decision, it's the most-relevant reference — and DiffuseCraft is tablet-first.
