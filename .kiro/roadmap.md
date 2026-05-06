# DiffuseCraft project roadmap

> Top-level roadmap. The UI implementation pass has its own focused sub-roadmap at `.kiro/specs/_ui-implementation-roadmap.md`.

## Active streams

### UI implementation (chrome from `untitled.pen`) ✅
- See `.kiro/specs/_ui-implementation-roadmap.md`.
- 5 specs: `design-system-foundation`, `ui-component-library`, `app-shell-navigation`, `screens-implementation`, `visual-verification`.
- Status: 5/5 implemented.

### Pairing & client state ✅ (Wave 3)
- `pairing-protocol` ✅ (mDNS + QR + numeric + manual + bootstrap admin token; 28/28 tests).
- `client-state-architecture` ✅ (6 Zustand stores + provider + hooks; 30/30 tests; replaces connectionStore stub).

### Canvas & ComfyUI ✅ (Wave 4)
- `canvas-fundamentals` ✅ (canvas-core + canvas-skia adapter; 51/51 tests; `<CanvasView />` ready for apps-mobile-integration).
- `comfyui-management` ✅ (HTTP+WS client, managed/external modes, validateInstall, OutputFetcher seam, 4 graph builders; 27/27 tests).

### Generation core ✅ (Wave 5)
- `generation-workflow` ✅ (verb dispatcher, sub-mode wiring, presets, cancel_job idempotent; 28/28 tests).
- `generation-history` ✅ (preview-then-apply, GC, batch persistence, URI matcher; 27/27 tests).
- `prompt-enhancement` ✅ (MCP sampling primary, language detection EN/ES/CJK/Cyrillic/Arabic+4-latin, response parser w/ refusal detection, agent-keyed cache; 50/50 tests).

### Canvas tools ✅ (Wave 6)
- `selection-tools` ✅ (rect/lasso/magic-wand pure canvas-core; 5 server handlers + 2 AI tier stubs; 39+25 tests).
- `transform-tools` ✅ (matrix decomp, snap targets, 16px grid, 15° rotation snap; migration 004; 22+11 tests).
- `mask-system` ✅ (krita-style two-mask split, 7 reversible handlers, comfy graph helper wired; migration 005; 23+13 tests).
- `brush-system` ✅ (5 fixed presets v1, pure-TS stroke geometry, injectable PixelCodec; 17+13 tests).

### Undo/Redo (Wave 7) ✅
- `undo-redo-system` ✅ (Phases A–H + J landed; testing tasks + I deferred per `.kiro/steering/testing.md`).
  - A: `Command<R>` + `ClientDocumentStack` + `UndoRedoManager` (execute/undo/redo/discardForToken/discardAll/onTokenDisconnect/onTokenReconnect) + snapshot capture every N ops + disconnect grace timer.
  - B: `EvictionPolicy` (30 s tick) — snapshot-first then deepest-stack-oldest, floor 5, emits `undo.eviction`.
  - C: `undo`/`redo` handlers (idempotent wire shape `{reverted|reapplied, command_description?}`).
  - D: `diffusecraft://undo-stack/<doc>` + `redo-stack/<doc>` resources (paginated `CommandSummary`, `fields` projection).
  - E: `recentEvents` ring buffer + conflict detection inlined into `execute` (`affected_layer_ids` overlap → `conflict: true`, FR-15 last-write-wins).
  - F: 4 handlers migrated (`apply_history_item`, `set_selection`, `paint_strokes`, `transform_layer`) + `_template.ts` + `assertUndoRedoConformance` (10-handler legacy allowlist tracked for owning-spec migration).
  - G: lifecycle wired (start/stop/discardAll, `auth.token-revoked` subscription, `ConnectionTracker` ref-counting on HTTP `/mcp`).
  - H: `useUndoRedo` hook in `@diffusecraft/core` + `registerUndoToastAdapter` (1500 ms FR-31) + `LeftToolRail` wiring; gestures pending `canvas-fundamentals` I.5/I.6.
  - J: README at `libs/server/src/lib/undo-redo/README.md` + P27 v1-implementation appendix.

### Server library (`@diffusecraft/server`) ✅
- Spec implemented: `server-architecture`.
- Status: foundation complete (3 transports mounted, 9-stage middleware, SQLite migrations, asset store, mDNS placeholder). Streamable-HTTP framing + ComfyUI client deferred to specs that own them.

### MCP catalog (`@diffusecraft/mcp-tools`) ✅
- Spec implemented: `mcp-tool-catalog`.
- Status: 38 tools across 16 domains, 16 resources, 5 events, 4 prompts. `dist/catalog.json` byte-stable. 19/19 conformance tests pass. Server consumes the manifest directly.

### Canvas (the actual image editing surface)
- Specs authored: `canvas-fundamentals`, `selection-tools`, `transform-tools`, `mask-system`, `brush-system`, `regions`, `control-layers`.
- Status: not implemented; will replace Editor's CanvasPlaceholder.

### AI orchestration (Comfy + agents)
- Specs authored: `comfyui-management`, `generation-workflow`, `generation-history`, `prompt-enhancement`, `external-agent-integration`.
- Status: not implemented.

## Implementation order (suggested)

1. **UI chrome pass** (current) — finish `screens-implementation` Wave 3 + convergence + visual-verification.
2. **Server skeleton** — `server-architecture` + `mcp-tool-catalog` end-to-end.
3. **Pairing flow** — `pairing-protocol` (replaces `connectionStore.stub.ts` mock).
4. **Canvas** — `canvas-fundamentals` + `selection-tools` + `transform-tools` (replaces Editor's CanvasPlaceholder).
5. **AI workflow** — `comfyui-management` + `generation-workflow` (Generate / Inpaint / Upscale wired end-to-end).
6. **Live + Chat panels** — `external-agent-integration` + workspace `Live` mode.

## Specs not yet implemented

| Slug | Phase status | Notes |
|---|---|---|
| `pairing-protocol` | proposed | replaces connectionStore stub |
| `canvas-fundamentals` | proposed | hero of the app |
| `client-state-architecture` | proposed | Zustand stores beyond stub |
| `client-sdk` | proposed | `@diffusecraft/diffusion-client` |
| `mcp-tool-catalog` | proposed | `@diffusecraft/mcp-tools` |
| `server-architecture` | proposed | `@diffusecraft/server` |
| `comfyui-management` | proposed | embedded in server |
| `generation-workflow` | proposed | Generate/Refine/Fill/Upscale |
| `generation-history` | proposed | preview-then-apply |
| `selection-tools` | proposed | lasso/rect/magic |
| `transform-tools` | proposed | move/scale/rotate |
| `mask-system` | proposed | inpaint masks |
| `brush-system` | proposed | 4–6 fixed presets v1 |
| `regions` | proposed | per-area prompts |
| `control-layers` | proposed | Reference + Structural |
| `prompt-enhancement` | proposed | MCP sampling |
| `speech-to-text` | proposed | OS-native + Whisper |
| `external-agent-integration` | proposed | chat panel + agent registry |
| `meshcraft-integration` | proposed | contract-only spec |
| `script-execution` | proposed | sandboxed code on images |
| `undo-redo-system` | proposed | history stack |
| `upscale-and-tiling` | proposed | upscale workspace |
| `resolution-handling` | proposed | server-side scaling |
| `workspaces` | proposed | mode switching |
