# Product

## What it is

**DiffuseCraft** is a tablet-first, agent-agnostic image editor and AI image platform. It is a standalone, cross-platform reinterpretation of [krita-ai-diffusion](https://github.com/Acly/krita-ai-diffusion)'s UX and ComfyUI integration logic — extracted from the Krita plugin context, rebuilt as independent TypeScript libraries, and exposed simultaneously to humans (via a tablet app) and AI agents (via an MCP server).

It runs entirely on local hardware via [ComfyUI](https://github.com/comfyanonymous/ComfyUI). It requires no API keys from any AI provider.

## Vision

> An illustrator with a tablet sketches an idea, **dictates or types a rough prompt**, optionally **asks the connected agent to rewrite it**, fills in details, **chats with the agent on the side** ("now make this brighter, add a tree on the left") while the agent applies tools live, refines a region, swaps a face, and exports — without ever paying for a cloud API or surrendering their work to someone else's servers. The same operations are available to the human via touch and to the agent via MCP, because they are the same operations.

## Primary persona

**The AI-native illustrator on a tablet.**
- Owns an iPad (with Apple Pencil) or an Android tablet (with S-Pen or equivalent stylus).
- Lives inside a creative workflow where AI is a permanent collaborator, not an occasional filter.
- Routinely delegates generation to one or more AI agents (Claude Code, Codex, Gemini CLI, custom orchestrators) and uses the human UI to iterate, refine, and curate.
- Wants results to live on their hardware. Cares about privacy, ownership, and the absence of recurring per-call costs.
- Has a desktop or laptop somewhere on the same network capable of running ComfyUI on a local GPU. **Inference always runs there, never on the tablet.** The tablet pairs with that machine via QR (or mDNS auto-discovery) and uses it as its image-generation engine.

## Secondary personas

- **The phone-only user** (v1 fallback) — same codebase, degraded layout. Supported, not promoted.
- **The MeshCraft user** — gets DiffuseCraft as part of MeshCraft's desktop experience. MeshCraft embeds `@diffusecraft/server` in-process; the same server can also be paired by a tablet on the same network. DiffuseCraft does not ship its own desktop app; MeshCraft is the desktop host.
- **The developer** — consumes `@diffusecraft/server`, `@diffusecraft/diffusion-client`, or `@diffusecraft/mcp-tools` to embed image generation into another product (MeshCraft is the canonical first example).
- **The AI agent** — connects via MCP (stdio, Streamable HTTP, or in-memory). First-class citizen alongside humans, never a second-tier consumer.

## Value proposition

1. **Agent-agnostic from day one.** Works identically with Claude, OpenAI, Gemini, or any agent that speaks MCP. No vendor lock-in. No DiffuseCraft-required API key from any AI provider.
2. **Local inference, zero recurring cost.** ComfyUI on user-controlled hardware. No cloud calls. No per-generation pricing. No telemetry to a third party.
3. **Tablet-first creative experience.** Touch + stylus designed in, not bolted on. Apple Pencil and S-Pen as first-class inputs.
4. **Voice-first prompt input.** Dictate the prompt out loud — typing on a tablet during creative flow is friction. Speech-to-text is a peer to keyboard input, not a hidden alternative. Keyboard remains available; users choose per moment. **Independent of prompt enhancement** — dictating does not imply rewriting.
5. **Agent-powered prompt enhancement.** The paired agent (Claude, Codex, Gemini, custom) rewrites a prompt — in any language, with any phrasing — into a model-ready English prompt. **Independent of how the prompt was entered** — works equally on typed text and on dictated transcriptions. Optional: raw prompt generation works without it. The agent brings its own LLM credentials; DiffuseCraft never holds a provider API key.
   - The two features are orthogonal and composable: dictate-only, type-only, dictate-then-enhance, type-then-enhance, or dictate-then-edit-then-enhance — all valid flows. The user chooses per moment.
6. **The same operations everywhere.** What the human does with a button, the agent does with a tool. The MCP catalog is the canonical API; the GUI is a client of it.
7. **Built-in chat with your AI agent.** A persistent chat panel in the tablet talks to whichever agent the user has paired (Claude Code, Codex, Gemini, custom) — the agent reasons about the canvas and invokes tools to apply changes. Natural-language editing without ever leaving the app, without the tablet ever holding an API key. Voice input via STT works in the chat too.
8. **Reusable infrastructure.** The server library powers DiffuseCraft itself, MeshCraft, and any future product that needs AI image generation as a building block.

## What DiffuseCraft is NOT

- **Not a Photoshop replacement.** Editor scope is "just enough" for the AI workflow — selection, masking, layers, transform, basic brushes. Power editing stays in dedicated tools.
- **Not a Procreate full replacement.** Inspired by Procreate's UI/tools/gestures but **without Procreate's brush engine depth.** Brushes in v1 are 4–6 fixed presets (pen, pencil, marker, eraser, smooth); custom brush engine is post-v1. The editor's center of gravity is **layer + transform + mask** (load-bearing for collage and AI context construction), not brush authoring.
- **Not a photo retoucher.** No advanced filters, curves/levels, color-range selection, frequency separation, etc. Pixel-pushing is for sketching, masking, and collage — not retouching.
- **Not a Krita plugin.** Standalone. No Krita dependency.
- **Not a desktop app of its own.** Desktop experience is provided by MeshCraft (which embeds `@diffusecraft/server`). DiffuseCraft does not ship an Electron app — neither in v1 nor in any planned version.
- **Not a wrapper over cloud inference APIs.** No DALL-E, Imagen, Replicate, Stability cloud, OpenAI Images integration. Local ComfyUI only.
- **Not a generic ML platform.** Image generation specifically (txt2img, img2img, inpaint, outpaint, ControlNet, IP-Adapter, upscale). No video, no audio, no 3D, no LLM hosting.
- **Not multi-tenant SaaS.** Each server instance serves its paired devices and authorized agents. No "DiffuseCraft Cloud" in v1.
- **Not vendor-agent specific.** Does not privilege any AI agent vendor.
- **Not phone-first.** Phones are a degraded fallback in v1, not the primary surface.
- **Not on-device inference.** The tablet/phone never runs a diffusion model. All inference happens on a paired server (a PC, MeshCraft, or any host running `@diffusecraft/server`). The tablet is input + display only.
- **Not a vector editor.** The document is **raster-only, always.** No vector layer type, no SVG primitives, no resolution-independent shapes, no live filter graph. Vector-shaped operations (shape tools, text, SVG/PDF imports) rasterize on commit. See P28 (`principles.md`).

## Distribution model

Open-source across the board. Libraries MIT, server library and binary Apache-2.0. The platform exists to be embedded, extended, forked, and self-hosted. Suquía Bytes does not monetize DiffuseCraft directly; commercial cloud-hosted offerings are out of scope for v1.

## Glossary

Aligned with krita-ai-diffusion terminology where applicable. These terms appear in MCP tools, UI labels, and specs.

| Term | Meaning |
|---|---|
| **Strength** | A 0–100% slider that controls how much existing canvas content influences the result. 100% = ignore canvas; <100% = use canvas as starting point. |
| **Generate** | Create a new image from prompt + control inputs only. Implied when strength = 100% and no selection is active. |
| **Refine** | Apply changes to existing canvas as starting point. Implied when strength < 100% with no selection. |
| **Fill** | Replace selected area with generated content. Implied when strength = 100% and a selection is active. The generic inpainting verb. |
| **Selection mode** | Sub-verb when filling: `Fill` (general purpose), `Expand` (canvas extension / outpainting), `Add Content` (prompt-driven, free deviation), `Remove Content` (erase + continuation), `Replace Background` (preserve foreground subject). |
| **Apply** | Commit a generated preview to the canvas as a real layer. Generations live as previews until applied. |
| **Generation history** | Panel of recent previews available for inspection, reuse, or re-application. Source of truth for "what did the model produce." |
| **Control layer** | A layer type that contributes guidance to generation rather than visible pixels. Two kinds: **Reference** (creative — Reference, Style, Composition, Face — uses IP-Adapter) and **Structural** (per-pixel — Scribble, Line Art, Soft Edge, Canny, Depth, Normal, Pose, Segmentation, Unblur, Stencil — uses ControlNet). |
| **Region** | An area of the canvas tied to a paint layer's opacity, with its own prompt and optional reference-style control layers. The root prompt is concatenated with each region's prompt. |
| **Workspace** | A high-level mode of the app: `Generate`, `Inpaint`, `Upscale`, `Live`, `Custom Graph`, `Animation`. Determines which tools and panels are active. |
| **Live mode** | Workspace where the model continuously regenerates as the user paints, with a fixed seed so changes only come from user input. |
| **Resolution multiplier / max pixel count** | Server-side controls that scale generation relative to canvas size and cap total pixels — invisible to agents and casual users. |
| **Preset** | A named bundle of model + sampler + LoRAs + sane defaults. Presets hide complexity; users (and agents) reference them by name. |
| **Job** | A unit of asynchronous work (generate, refine, fill, upscale, model download). Has progress events, cancellation, and an outcome (preview or model file). |
| **Pairing** | Zero-config flow that introduces a client device or agent to a running server. The server displays a QR encoding `{ url, ip, port, token }`; whoever scans (or pastes the URL line) becomes paired. mDNS may auto-fill the URL for same-LAN scenarios. Same flow for humans and agents — no separate path. Single-tier access: every paired client has full capability; non-paired has none. |
| **Host** | A process that embeds `@diffusecraft/server`. Canonical examples: **MeshCraft** (Electron, the de facto desktop host) and the standalone `npx @diffusecraft/server` (for users without MeshCraft). DiffuseCraft itself does not ship a desktop host. |
| **Client** | A consumer of a host, talking via the host's transports. Examples: the DiffuseCraft tablet app, an external AI agent, MeshCraft acting as MCP client of its own embedded server. |
| **Agent** | An AI agent that speaks MCP. First-class client. Vendor-agnostic. |
| **Pairing token** | Single opaque string issued by the server during pairing. A paired client presents it on every request. There is one tier of access — paired = full, unpaired = none. Tokens are revocable and have an optional human-readable name for audit display. |
| **Local inference** | All model execution happens on hardware controlled by the user (tablet's paired desktop, MeshCraft host, or self-hosted server). DiffuseCraft never proxies generation to a cloud provider. |
| **Speech-to-text (STT)** | Dictation as input method for prompts, chat input, and other text fields. Equal-priority alternative to keyboard, not a hidden assist. Implementation may use OS-native speech APIs (iOS Speech Framework, Android SpeechRecognizer) and/or local Whisper running in or near the server. Decision deferred to `tech.md`. |
| **Chat panel** | A persistent panel in the tablet UI where the user converses (typed or dictated) with the paired agent. The agent reasons about the canvas, replies in text, and invokes DiffuseCraft tools to apply edits. Works whenever a sampling-capable agent is paired (Claude Desktop / Code, Codex, Gemini CLI, custom). |
| **Prompt enhancement** | The act of taking a user's rough or non-English prompt and rewriting it as a model-ready English prompt. Performed by the agent the user has paired with DiffuseCraft. Optional; raw prompt generation works without it. |
| **Paired agent** | An external AI agent (Claude, Codex, Gemini, custom) that the user has explicitly authorized to interact with their DiffuseCraft session. Used both as a *consumer* of DiffuseCraft tools (orchestrating workflows) and as a *service* DiffuseCraft can call back into (for prompt enhancement, suggestions). The agent always provides its own LLM credentials. |
| **Agent-mediated assistance** | Pattern where DiffuseCraft delegates an LLM-requiring task (prompt enhancement, prompt translation, parameter suggestion) to a paired agent rather than calling an LLM provider directly. Preserves the zero-API-key invariant. |

## TBD

- Specific tablet-app onboarding tutorial scope (covered in `pairing-protocol` spec).
- Whether MeshCraft remains the only canonical embedder example in v1 docs or whether a second public example is added (probably not in v1).
- **Architecture of agent-mediated enhancement** — two viable shapes, decision goes to `tech.md`:
  - **(a)** Client-direct: the tablet app holds its own MCP-client connection to the user's paired agent, calls it for enhancement, then calls the DiffuseCraft server with the rewritten prompt. Simpler; agent and DiffuseCraft are independent.
  - **(b)** Server-mediated via MCP sampling: the server exposes `enhance_prompt` as an MCP tool; when the human invokes it, the server uses MCP sampling to ask the calling agent to do the rewrite. Single round-trip; richer agent context (server can attach canvas state). Requires sampling support on both server and agent SDKs.
- **STT implementation choice** — OS-native (free, language-rich, online-or-offline depending on platform) vs local Whisper (uniform across platforms, costs server resources, language quality varies by model size). Likely both, with native as fast path and Whisper as opt-in higher-quality fallback — confirm in `tech.md`.
