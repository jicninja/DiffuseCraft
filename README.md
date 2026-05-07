# DiffuseCraft

A tablet-first, agent-agnostic AI image editor. Local inference, no cloud,
no per-call pricing, no vendor lock-in.

DiffuseCraft is a standalone, cross-platform reinterpretation of
[krita-ai-diffusion](https://github.com/Acly/krita-ai-diffusion)'s UX and
ComfyUI integration logic — extracted from the Krita plugin, rebuilt as
independent TypeScript libraries, and exposed simultaneously to humans
(via a tablet app) and AI agents (via an MCP server).

> **Status:** pre-v1, in active development. The repository builds, the
> mobile app runs, and the pairing flow + editor canvas are largely wired
> end-to-end. Several specs are still in implementation. See
> `.kiro/specs/` for per-feature status.

---

## What it is

An illustrator with a tablet sketches an idea, dictates or types a rough
prompt, optionally asks a paired agent to rewrite it, fills in details,
chats with the agent on the side ("now make this brighter, add a tree on
the left") while the agent applies tools live, refines a region, swaps a
face, and exports — without ever paying for a cloud API or surrendering
their work to someone else's servers.

The same operations are available to the human via touch and to the
agent via MCP, because they are the same operations.

## What it is **not**

- **Not a Photoshop replacement.** The editor's center of gravity is
  layer + transform + mask (load-bearing for collage and AI context
  construction), not pixel retouching.
- **Not a Procreate replacement.** Inspired by Procreate's gestures and
  panels, but brushes in v1 are 4–6 fixed presets — no custom brush
  engine.
- **Not a Krita plugin.** Standalone.
- **Not a desktop app of its own.** Desktop is provided by
  [MeshCraft](https://github.com/your-org/meshcraft), which embeds
  `@diffusecraft/server` in-process. DiffuseCraft does not ship an
  Electron app — neither in v1 nor in any planned version.
- **Not a wrapper over cloud inference APIs.** No DALL-E, Imagen,
  Replicate, Stability cloud, OpenAI Images. Local ComfyUI only.
- **Not on-device inference.** The tablet/phone never runs a diffusion
  model. All inference happens on a paired server. The tablet is input
  and display only.
- **Not a vector editor.** The document is raster-only, always.
  Vector-shaped operations (shape tools, text, SVG/PDF imports) rasterize
  on commit.
- **Not vendor-agent specific.** Claude, OpenAI, Gemini, and any
  custom agent that speaks MCP are first-class, identically.
- **Not a web app.** Web/PWA is off-roadmap, not deferred.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Tablet (Expo + Skia)   │         │  Server (Node + Fastify)     │
│                         │         │  @diffusecraft/server        │
│  apps/mobile            │◄───────►│                              │
│                         │  HTTP / │  ┌────────────────────────┐  │
│  ┌───────────────────┐  │  WS /   │  │ MCP server             │  │
│  │ Editor (canvas-   │  │  MCP    │  │ (stdio + HTTP +        │  │
│  │ core + canvas-    │  │         │  │  in-memory transports) │  │
│  │ skia)             │  │         │  └────────────────────────┘  │
│  └───────────────────┘  │         │  ┌────────────────────────┐  │
│  ┌───────────────────┐  │         │  │ ComfyUI lifecycle      │  │
│  │ diffusion-client  │  │         │  │ (HTTP + WebSocket)     │  │
│  │ (pairing,         │  │         │  └────────┬───────────────┘  │
│  │  tool calls)      │  │         │           │                  │
│  └───────────────────┘  │         │  ┌────────▼───────────────┐  │
└─────────────────────────┘         │  │ ComfyUI (local GPU)    │  │
                                    │  └────────────────────────┘  │
┌─────────────────────────┐         │                              │
│  AI agent (Claude /     │◄───────►│  Same MCP server, same       │
│  Codex / Gemini /       │   MCP   │  tools, same auth as the     │
│  custom)                │         │  tablet — agents are         │
└─────────────────────────┘         │  first-class clients.        │
                                    └──────────────────────────────┘
```

- The **tablet** is input + display. No model ever runs there.
- The **server** is a TypeScript library, distributed as `npx
  @diffusecraft/server` (standalone) or embedded in another host
  (MeshCraft is the canonical desktop host).
- **Inference** lives in ComfyUI. The server manages its lifecycle,
  jobs, presets, model files, and progress events.
- **Pairing** is one flow for everyone: a paired client (tablet or
  agent) presents a single opaque token on every request. There is no
  "agent tier" vs "human tier" — paired = full, unpaired = none.

## Workspace layout

Nx monorepo, pnpm workspaces underneath.

```
DiffuseCraft/
├── .kiro/
│   ├── steering/              durable project rules (read these first)
│   │   ├── product.md         what DiffuseCraft is, personas, glossary
│   │   ├── tech.md            stack, dependency rules, version notes
│   │   ├── structure.md       repo layout, naming, commit conventions
│   │   ├── principles.md      load-bearing invariants (P1–P28)
│   │   ├── inspirations.md    what we borrow and what we don't
│   │   ├── security.md        threat model + security baseline
│   │   ├── agentic-sdlc.md    why the Kiro skill workflow exists
│   │   └── testing.md         tests are archived until end of v1
│   └── specs/                 one folder per feature spec
├── apps/
│   ├── mobile/                Expo app (tablet-first, phone fallback)
│   └── server/                npx entry — thin wrapper over @diffusecraft/server
├── libs/
│   ├── core/                  shared types, events, store factories (zod-only)
│   ├── mcp-tools/             canonical MCP tool catalog (schemas)
│   ├── canvas-core/           render-agnostic canvas logic
│   ├── canvas-skia/           react-native-skia render adapter
│   ├── diffusion-client/      client SDK: pairing, tool calls, events
│   ├── server/                Fastify + ComfyUI + MCP transports + SQLite
│   └── ui/                    NativeWind + react-native-reusables components
├── tools/                     Nx generators, dev scripts, CI helpers
├── nx.json
├── pnpm-workspace.yaml
└── tsconfig.base.json         path aliases for @diffusecraft/*
```

The dependency rules between libraries (enforced by
`@nx/enforce-module-boundaries`) are documented in
[`.kiro/steering/structure.md`](./.kiro/steering/structure.md). In short:
`core` and `mcp-tools` are leaves; `canvas-*` does not know about
`server` or `diffusion-client`; `server` does not know about `canvas-*`
or `ui`; apps may import anything.

## Quick start

Requirements: **Node 20.10+**, **pnpm 9.12+**, an iOS/Android device or
simulator, and a machine on the same LAN that can run ComfyUI on a GPU
(can be the same dev box as the server during development).

```bash
pnpm install
pnpm typecheck                # whole-monorepo type check (-b)

# Run the server library in dev mode (logs to /tmp/server.log)
pnpm dev:server

# Run the mobile app on iOS (logs Metro to /tmp/metro.log,
#                            device console to /tmp/device.log)
pnpm dev:ios

# Run everything together
pnpm dev
```

Once both are running, follow the in-app pairing flow on the tablet:

1. Open the mobile app — it lands at `/pair`.
2. Either let mDNS auto-discover the server, scan the QR the server
   prints to its console, type the 6-digit code, or paste the URL +
   token manually.
3. After pairing succeeds you're routed to the editor.

Pairing tokens are persisted in the OS keychain via
`expo-secure-store`. They do not survive reinstall by design.

## Project status

This is pre-v1 software. Some specs are completed and integrated end
to end; others are still in implementation. Per-feature status lives
in `.kiro/specs/<feature>/spec.json`.

A non-exhaustive snapshot:

| Area | Status |
|---|---|
| Pairing protocol (mDNS + QR + numeric code + manual URL) | ✅ implemented |
| App shell & navigation (expo-router) | ✅ implemented |
| MCP tool catalog | ✅ implemented |
| Server architecture | ✅ implemented |
| ComfyUI lifecycle management | ✅ implemented |
| Generation workflow | ✅ implemented |
| Image I/O (import / export) | 🚧 in progress |
| Editor canvas integration | 🚧 in progress |
| Selection tools | 🚧 partial |
| Brush canvas rendering | 🚧 in progress |
| Client SDK | 🚧 in progress |
| Web runtime | ❌ off-roadmap |
| Desktop app of our own | ❌ off-roadmap (MeshCraft hosts) |

Tests are intentionally archived to `.kiro/tests-backup/` until the end
of v1 to keep iteration speed up. See
[`.kiro/steering/testing.md`](./.kiro/steering/testing.md) for the
rationale and the unfreeze plan.

## Development workflow

DiffuseCraft uses **Kiro-style spec-driven development**:

```
discovery → requirements → design → tasks → implementation → review
```

Each phase has an explicit human-approval gate. The skills that drive
this workflow live in `.claude/skills/kiro-*/` and are invoked via slash
commands (`/kiro-spec-init`, `/kiro-spec-design`, `/kiro-impl`,
`/kiro-spec-status`, …). The rationale is documented in
[`.kiro/steering/agentic-sdlc.md`](./.kiro/steering/agentic-sdlc.md).

Conventional Commits, scoped by package: `feat(server)`, `fix(mobile)`,
`docs(steering)`, etc. See
[`.kiro/steering/structure.md`](./.kiro/steering/structure.md) for the
allowed scopes.

## License

Pre-v1, license to be finalized before publication. Libraries
(`@diffusecraft/core`, `mcp-tools`, `canvas-core`, `canvas-skia`,
`diffusion-client`, `ui`) will ship under MIT. The server library and
the standalone `npx @diffusecraft/server` binary will ship under
Apache-2.0.

## Further reading

- [`.kiro/steering/product.md`](./.kiro/steering/product.md) — what
  DiffuseCraft is, who it's for, and what it is explicitly **not**
- [`.kiro/steering/tech.md`](./.kiro/steering/tech.md) — stack,
  dependency rules, version-aware API notes
- [`.kiro/steering/principles.md`](./.kiro/steering/principles.md) —
  load-bearing invariants (P1–P28)
- [`.kiro/steering/inspirations.md`](./.kiro/steering/inspirations.md)
  — krita-ai-diffusion, Procreate, and what we borrow from each
- [`.kiro/steering/security.md`](./.kiro/steering/security.md) —
  threat model and security baseline
- [`CLAUDE.md`](./CLAUDE.md) — project instructions for Claude Code
  and the spec-driven workflow entry points
