# server-architecture — Tasks

> **Companion to:** `requirements.md` and `design.md` of this spec.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~10–14 weeks for one engineer; can parallelize Phases B–F across 2–3 engineers down to ~5–7 weeks.**

---

## Phase A — Project scaffolding & types

- [ ] **A.1** Initialize `libs/server/` Nx project. Tags: `scope:server`, `type:lib`, `platform:node`. Dependencies: `@diffusecraft/core`, `@diffusecraft/mcp-tools`, `@modelcontextprotocol/sdk`, `fastify`, `better-sqlite3`, `pino`, `zod`, `bonjour-service`, `ulid`. **(S)**
- [ ] **A.2** Define `ServerConfig` Zod schema with all fields and defaults from `design.md` §3. **(M)**
- [ ] **A.3** Define `ServerStatus`, `ServerLifecycleEvent`, `EmbeddingContext`, `RequestContext`, `HandlerContext` types. **(S)**
- [ ] **A.4** `createDiffuseCraftServer(config)` skeleton — constructs subsystems but does not start. **(S)**
- [ ] **A.5** `getStatus()`, `on()`, `off()` event-emitter implementation. **(XS)**

## Phase B — Persistence

- [ ] **B.1** SQLite migration runner: lexicographic apply, version table, idempotent. **(M)**
- [ ] **B.2** Migration `001-initial-schema.ts`: documents, layers, regions, control_layers, presets, models, history_items, jobs, tokens, audit, pairing_requests, blobs (full DDL from `design.md` §4.6). **(M)**
- [ ] **B.3** WAL mode + busy_timeout configuration at open. **(XS)**
- [ ] **B.4** Asset store on filesystem: write/read/delete by ULID; directory layout. **(S)**
- [ ] **B.5** Blob garbage collection: hourly job that removes orphan blobs and expired refs. **(M)**
- [ ] **B.6** Persistence integration tests with `:memory:` SQLite. **(S)**

## Phase C — Event bus

- [ ] **C.1** Typed `EventBus` with publish/subscribe. **(S)**
- [ ] **C.2** Schema validation for events at publish time (catch wrong payloads in dev). **(S)**
- [ ] **C.3** Relay to transports (HTTP SSE, in-memory listeners). **(M)**
- [ ] **C.4** Tests: subscribers receive in order; errors in handlers don't block others. **(S)**

## Phase D — Handler dispatcher & middleware

- [ ] **D.1** `HandlerDispatcher` with `register<T>` typed against `ToolDefinition`. **(M)**
- [ ] **D.2** Middleware chain runner (composable, async-friendly). **(S)**
- [ ] **D.3** `authMw` — bearer token verification: hash incoming token, look up in `tokens` table, verify `revoked_at IS NULL`, extract `token_name` into ctx, update `last_used_at`. Returns 401 with `WWW-Authenticate: Bearer realm="DiffuseCraft"` on failure. **(S)**
- [ ] **D.4** `rateLimitMw` — token bucket per token id, configurable rates. **(M)**
- [ ] **D.5** `payloadSizeMw` — early reject if input bytes > config max. **(XS)**
- [ ] **D.6** `versionCompatMw` — reject if tool's `since` > negotiated catalog version. **(S)**
- [ ] **D.7** `validateInputMw` — Zod parse, structured error on fail. **(S)**
- [ ] **D.8** `executeMw` — invoke handler with HandlerContext. **(XS)**
- [ ] **D.9** `reversibleCommandMw` — for reversible tools, build Command and pass to UndoRedoManager. **(M)**
- [ ] **D.10** `auditMw` — write audit entry, emit `audit.entry`. **(S)**
- [ ] **D.11** `capabilityShapeMw` — adapt response per client capabilities (inline vs ref, png vs webp). **(M)**
- [ ] **D.12** Conformance test: every tool in `mcp-tool-catalog` has a registered handler at boot. Fails build if missing. **(S)**

## Phase E — Transports

- [ ] **E.1** In-memory transport: `mcp.invokeTool` and `mcp.tools.<name>` typed accessors generated from manifest. **(M)**
- [ ] **E.2** stdio transport: integrate `@modelcontextprotocol/sdk/server/stdio`; trust-by-process. **(S)**
- [ ] **E.3** Streamable HTTP transport: Fastify route at `POST /mcp`; Bearer auth middleware; SSE/long-lived event channel for events. **(L)**
- [ ] **E.4** Capability negotiation in handshake: read client capabilities, store per-session. **(M)**
- [ ] **E.5** Workspace-based catalog filtering at `tools/list`. **(S)**
- [ ] **E.6** Catalog version negotiation in handshake. **(S)**
- [ ] **E.7** Integration tests for each transport: round-trip a `get_server_info` invocation. **(M)**

## Phase F — Job tracker (ComfyUI owns the queue)

- [ ] **F.1** `JobTracker` class. Submits graphs to ComfyUI via `comfy.submitGraph`, records ULID job_id ↔ ComfyUI prompt_id mapping in SQLite. **(M)**
- [ ] **F.2** WebSocket subscription: translate ComfyUI progress/executed/error events to our `job.progress` / `job.completed`. **(M)**
- [ ] **F.3** Cancellation: calls `comfy.interrupt(prompt_id)` for running, `comfy.dequeue(prompt_id)` for queued. Updates row, emits `job.completed { outcome: "cancelled" }`. **(S)**
- [ ] **F.4** Startup reconciliation: read ComfyUI's `/queue`, mark our `running`/`queued` rows that aren't in it as `failed { code: "LOST_DURING_RESTART" }`. **(S)**
- [ ] **F.5** Failure handling: ComfyUI error events → `job.completed { outcome: "failure", error }`. No auto-retry. **(S)**
- [ ] **F.6** History item creation on success: when ComfyUI emits `executed`, fetch resulting image bytes via comfy client, persist as blob, create history_item row, emit `job.completed { outcome: "success", history_item_id, thumbnail_ref }`. **(M)**
- [ ] **F.7** Tests: submit/cancel/restart-reconcile/error path with mocked ComfyUI. **(M)**

## Phase G — ComfyUI client (proxy)

> **Detailed spec lives in `comfyui-management`.** This phase covers the proxy mechanics (single source of ComfyUI calls; clients never get raw access).

- [ ] **G.1** `ComfyClient` class with `submitGraph(graph)`, `interrupt(promptId)`, `health()`, `listModels()`. **(L)**
- [ ] **G.2** WebSocket subscription for ComfyUI events (per krita-ai-diffusion's pattern). **(M)**
- [ ] **G.3** Custom-node validation at startup; error if missing required nodes. **(S)**
- [ ] **G.4** Connection retry with backoff. **(S)**
- [ ] **G.5** No client-facing surface: `ComfyClient` is internal. Unit tests confirm it's not exported from `index.ts`. **(XS)**

## Phase H — Undo/redo manager

> **Detailed spec lives in `undo-redo-system`.** This phase covers the manager's integration into the dispatcher.

- [ ] **H.1** `UndoRedoManager` with per-`tokenName:documentId` stacks, default depth 100, snapshot every 20 ops. **(L)**
- [ ] **H.2** `Command` interface: `apply()`, `revert()`, optional snapshot reference. **(S)**
- [ ] **H.3** Multi-client merge semantics: per-client stacks, last-write-wins on conflict, `conflict: true` flag in `document.changed`. **(M)**
- [ ] **H.4** Resources: `diffusecraft://undo-stack/<doc-id>`, `redo-stack/<doc-id>`. **(S)**
- [ ] **H.5** Tools: `undo`, `redo` handlers. **(S)**
- [ ] **H.6** Tests: 100-op stack; concurrent two-client undo; snapshot recovery. **(M)**

## Phase I — Pairing & mDNS

> **Detailed spec lives in `pairing-protocol`.** This phase covers what the server hosts.

- [ ] **I.1** `bonjour-service` integration: advertise `_diffusecraft._tcp.local`. **(S)**
- [ ] **I.2** Pairing window timer + first-run open + state persistence. **(M)**
- [ ] **I.3** `onPairingRequest` hook with timeout; default-approve during window if no host handler. **(M)**
- [ ] **I.4** Token issuance after pairing approval; persisted in `tokens` table. **(S)**
- [ ] **I.5** QR code endpoint for fallback mode. **(S)**
- [ ] **I.6** Tests: end-to-end pairing via mDNS discovery (with stubbed mDNS); QR fallback path. **(M)**

## Phase J — Bootstrap & lifecycle

- [ ] **J.1** `start()` orchestration per `design.md` §5.1. **(M)**
- [ ] **J.2** `stop()` orchestration per `design.md` §5.2; graceful timeout configurable. **(M)**
- [ ] **J.3** First-run flow: detect no tokens → open pairing window → emit event. **(S)**
- [ ] **J.4** `IllegalLifecycleError` for invalid state transitions. **(XS)**
- [ ] **J.5** Tests: full lifecycle including failure rollback in start; orphan-jobs path in stop. **(M)**

## Phase K — Hooks

- [ ] **K.1** `HookRegistry` with `onPairingRequest`, `onAuditEntry`, `onJobLifecycle`, `addCustomTool`. **(M)**
- [ ] **K.2** Per-hook timeout enforcement. **(S)**
- [ ] **K.3** Custom tools: register at construction (via config) or at runtime; conflict check (no overriding catalog tools). **(M)**
- [ ] **K.4** Tests: hook registered before/after start; timeout behavior; custom tool round-trip. **(M)**

## Phase L — Logging

- [ ] **L.1** `pino` logger configuration from `ServerConfig.logging`. **(XS)**
- [ ] **L.2** Redaction patterns: token values, blob bytes, base64 payloads (FR-41). **(S)**
- [ ] **L.3** Structured logging conventions across all subsystems. **(S)**

## Phase M — Documentation & integration

- [ ] **M.1** README with three canonical examples: standalone, MeshCraft-style embed, test embed. **(M)**
- [ ] **M.2** TSDoc on all public exports of `index.ts`. **(M)**
- [ ] **M.3** Migration guide: how to upgrade `ServerConfig` between catalog major versions. **(S)**

## Phase N — Performance & validation

- [ ] **N.1** Cold-start benchmark: < 1.5s on dev laptop, asserted in CI. **(S)**
- [ ] **N.2** Idle RAM: < 128 MB, asserted via memory-usage check after 10s idle. **(S)**
- [ ] **N.3** Load test: 100 concurrent paired clients, mostly read-only ops, sustained 5 minutes. **(M)**
- [ ] **N.4** Catalog conformance test: every tool catalogued has a registered handler. **(S)** (overlap with D.12)

---

## Dependency order

```
A (scaffolding)
   │
   ▼
B (persistence) ─── C (event bus)
   │                   │
   ▼                   ▼
D (dispatcher) ── E (transports)
   │                   │
   ▼                   ▼
F (job queue) ── G (comfy proxy)
   │                   │
   ▼                   ▼
H (undo/redo) ── I (pairing/mDNS)
   │                   │
   ▼                   ▼
J (lifecycle) ── K (hooks)
   │                   │
   ▼                   ▼
L (logging) ─── M (docs)
                    │
                    ▼
                 N (perf)
```

A → B/C parallel → D/E parallel → F/G parallel → H/I parallel → J/K → L/M → N. With one engineer, sequential order is roughly Phase A → B → C → D → E → F → G → H → I → J → K → L → M → N.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ComfyUI integration brittleness (custom-node updates break us) | `comfyui-management` spec covers version pinning; G.3 validates required custom nodes at startup. |
| Streamable HTTP transport implementation gaps in MCP TypeScript SDK | E.3 includes a fallback to SSE long-poll if Streamable HTTP unavailable in our SDK version; revisit when SDK matures. |
| `better-sqlite3` native build issues across platforms | Document required native build deps in README; CI matrix covers macOS/Linux/Windows; Bun-compile path explores `node:sqlite` later. |
| Job queue restart-resume edge cases (jobs partially complete) | F.2 adds explicit reconciliation tests; status `running` with no live worker on startup → reset to `pending`. |
| Hook timeouts deadlock during pairing | K.2 enforces; default 60s; documented. |
| Capability-shape middleware chooses wrong format and breaks clients | E.4 negotiation is explicit; D.11 has unit tests per capability combination. |

---

## Approval

This `tasks.md` is approved when:
1. Every requirement in `requirements.md` has a path to one or more tasks here.
2. Dependency graph is correct.
3. Phases that depend on other specs (G, H, I) clearly mark the handoff point.
4. Risks are acceptable with stated mitigations.

After approval, implementation begins with Phase A.
