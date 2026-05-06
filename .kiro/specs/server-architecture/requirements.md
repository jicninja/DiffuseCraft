# server-architecture — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (the canonical surface this server implements).
> **References:** P1, P2, P5, P6, P7, P16, P19, P20, P26 in `principles.md`.
> **Out of scope:** specific tool handler logic (lives in feature specs); ComfyUI lifecycle (lives in `comfyui-management`); pairing flow details (lives in `pairing-protocol`).

## 1. Purpose

This spec defines `@diffusecraft/server` — the **library** that hosts mount to expose DiffuseCraft as an MCP-first AI image platform. It is the runtime that:

- Registers handlers against the `mcp-tool-catalog`.
- Mounts three MCP transports simultaneously (stdio, Streamable HTTP, in-memory).
- Owns the job tracker (ComfyUI owns the actual queue per §3.10), SQLite persistence, audit log, and the authenticated proxy in front of ComfyUI.
- Exposes a programmatic interface (`createDiffuseCraftServer`) that the standalone binary, MeshCraft, and tests instantiate.

This spec defines the **shape** of the server: its public API, lifecycle, configuration surface, and how it organizes internal subsystems. It does not dictate handler logic for individual tools (that's per-feature specs) nor implementation details of ComfyUI integration (that's `comfyui-management`).

## 2. Stakeholders & user stories

### S1 — Standalone binary (`apps/server`, `npx @diffusecraft/server`)
A thin Node entrypoint that imports the library and starts a server with sensible defaults.

> **Story 1.** As `apps/server`, I import `createDiffuseCraftServer`, parse CLI flags into `ServerConfig`, call `server.start()`, and process exit signals to call `server.stop()`. The library does the work; the entrypoint is ~50 lines.

### S2 — MeshCraft (in-process host)
Electron app that embeds the server. Uses the in-memory transport for the Electron renderer to drive the pipeline; Streamable HTTP for the paired tablet.

> **Story 2.** As MeshCraft, I import `createDiffuseCraftServer`, mount it inside my Electron main process, expose its `mcp.invokeTool()` to the renderer via IPC, and let external tablets pair via HTTP on a chosen port. When MeshCraft quits, I call `server.stop()` and wait for in-flight jobs to drain.

### S3 — Tests & examples
Integration tests spin up a real server with a mocked ComfyUI.

> **Story 3.** As an integration test, I call `createDiffuseCraftServer({ comfyui: mockClient, persistence: ":memory:" })`, drive it via the in-memory transport invoking real handlers, and assert outcomes — without binding any port or writing any file.

### S4 — Future hosts (other Suquía Bytes products, third-party embedders)
Anyone embedding the library to add AI image generation to their product.

> **Story 4.** As a third-party embedder, I read the README, copy the canonical "embed" example, set my ComfyUI config, and have a working DiffuseCraft inside my app in <30 minutes.

## 3. Functional requirements (EARS)

### 3.1 Public API surface

**FR-1 (Ubiquitous).** The package SHALL export a single primary factory function `createDiffuseCraftServer(config: ServerConfig): DiffuseCraftServer`.

**FR-2 (Ubiquitous).** The returned `DiffuseCraftServer` instance SHALL expose at minimum: `start()`, `stop()`, `mcp` (programmatic in-memory MCP interface), `on(event, handler)` / `off(event, handler)` for lifecycle events, and `getStatus()`.

**FR-3 (Ubiquitous).** The package SHALL also export TypeScript types: `ServerConfig`, `DiffuseCraftServer`, `ServerStatus`, `ServerLifecycleEvent`, `EmbeddingContext`, plus re-exports of relevant types from `@diffusecraft/mcp-tools` for convenience.

**FR-4 (Ubiquitous).** The package SHALL NOT expose any internal subsystem (job tracker internals, SQLite handle, ComfyUI client) directly. Hosts that need extension points SHALL use the explicit hook surface (FR-12).

### 3.2 Configuration

**FR-5 (Ubiquitous).** `ServerConfig` SHALL be a Zod-validated object with the following top-level fields:

- `comfyui`: ComfyUI integration mode (managed/external local/external remote) + connection details.
- `persistence`: SQLite location (`":memory:"` for tests; absolute file path for production).
- `transports`: which transports to mount and on what addresses (`stdio?: boolean`, `http?: { host, port } | null`, `inMemory: true` always).
- `pairing`: pairing window seconds, mDNS service name, advertise on/off.
- `comfyui_proxy`: model directory paths, rate limits. (No `max_concurrent_jobs` — that's ComfyUI's setting, not ours.)
- `logging`: level, format (json/pretty), destination (stdout/file).
- `assets`: blob storage directory, max blob age, audit log retention.
- `bootstrap_admin`: behavior on first run (print token vs. emit event vs. silent).
- `host_name`: human-readable identifier shown in pairing UIs (default: OS hostname).

**FR-6 (Ubiquitous).** Every field in `ServerConfig` SHALL have a documented default. Constructing `createDiffuseCraftServer({})` (empty config) SHALL succeed and produce a server with sensible defaults for a single-user LAN scenario.

**FR-7 (Unwanted).** IF `ServerConfig` validation fails at `createDiffuseCraftServer` call time, THE function SHALL throw a `ConfigValidationError` with `field_path` and `message`, and SHALL NOT allocate resources, open ports, or touch disk.

### 3.3 Lifecycle

**FR-8 (Event-driven).** WHEN `start()` is called on an unstarted instance, THE server SHALL: (1) initialize SQLite + run migrations; (2) initialize the ComfyUI integration (validate custom nodes, attempt connection); (3) initialize the **job tracker** (which mirrors ComfyUI's queue rather than maintaining a parallel one — see §3.10); (4) register all handlers from the `mcp-tool-catalog` manifest; (5) mount the configured transports; (6) start mDNS advertisement (if enabled); (7) emit `lifecycle.started` and resolve.

**FR-9 (Unwanted).** IF any startup step fails, THE server SHALL emit `lifecycle.start-failed` with the specific error, roll back any partially-allocated resources, and reject the `start()` promise with the underlying error.

**FR-10 (Event-driven).** WHEN `stop()` is called, THE server SHALL: (1) stop accepting new requests on all transports; (2) cancel mDNS advertisement; (3) signal in-flight jobs to cancel and wait up to a configurable graceful-shutdown timeout (default 30s); (4) flush the audit log; (5) close transports; (6) close SQLite; (7) emit `lifecycle.stopped` and resolve.

**FR-11 (Ubiquitous).** Calling `stop()` while `start()` is in flight, or `start()` after `stop()`, SHALL be deterministic: `stop()` aborts startup; `start()` after `stop()` is a programming error and throws `IllegalLifecycleError`.

### 3.4 Embedding hooks

**FR-12 (Ubiquitous).** The server SHALL expose **embedding hooks** — typed callback registration points hosts can use to participate in lifecycle and request flow without monkey-patching internals. Required hooks for v1:

- `onPairingRequest(handler)`: called when a client attempts pairing; handler returns approve/reject. Hosts with UI (MeshCraft) show a prompt; the standalone binary auto-approves during a pairing window.
- `onAuditEntry(handler)`: called for every audit-log entry; hosts may forward to their own logging.
- `onJobLifecycle(handler)`: notification of job submitted/started/completed/cancelled. Read-only.
- `onLifecycle(handler)`: notification of server-level lifecycle events.
- `addCustomTool(toolDefinition, handler)`: hosts may register additional MCP tools. Tool name SHALL be prefixed with the host name (`meshcraft.start_3d_pipeline`) to avoid catalog collision. Reflected in `tools/list` for paired clients.

**FR-13 (Ubiquitous).** Hooks registered AFTER `start()` SHALL be honored for subsequent events; hooks registered BEFORE `start()` are guaranteed to receive events from startup onward.

### 3.5 Transports

**FR-14 (Ubiquitous).** The server SHALL mount the in-memory transport unconditionally; it cannot be disabled.

**FR-15 (Ubiquitous).** WHEN `config.transports.http` is non-null, THE server SHALL mount Streamable HTTP on the given host:port using Fastify, with bearer-token middleware authenticating against paired tokens.

**FR-16 (Ubiquitous).** WHEN `config.transports.stdio === true`, THE server SHALL mount stdio. Stdio is auth-trusted-by-process; no token check.

**FR-17 (Unwanted).** IF an HTTP request arrives without a valid pairing token, THE server SHALL respond 401 with error code `UNAUTHORIZED` and `WWW-Authenticate: Bearer realm="DiffuseCraft"`.

**FR-18 (Unwanted).** IF stdio is mounted in a host that is itself reachable on the network (e.g., MeshCraft Electron embedded as agent client), the host SHALL ensure stdio is bound to a private channel; the server itself does not enforce this and trusts the host.

### 3.6 Handler registration

**FR-19 (Ubiquitous).** AT STARTUP, THE server SHALL read the `mcp-tool-catalog` manifest and register a handler for every tool. Build SHALL fail (catalog conformance test) if a catalogued tool has no registered handler.

**FR-20 (Ubiquitous).** Handlers SHALL be registered via a typed `registerHandler<T extends ToolDefinition>(tool, handler)` API. The handler signature SHALL infer input/output from the tool's Zod schemas.

**FR-21 (Ubiquitous).** Common middleware SHALL apply uniformly to every handler: input validation (Zod), capability-aware response shaping (inline vs ref), audit-log write, error wrapping, undo/redo Command construction for reversible tools, rate-limit check, payload-size check.

**FR-22 (Event-driven).** WHEN a handler completes a `reversible` tool, THE server SHALL register the resulting `Command` with the per-client per-document undo stack.

**FR-23 (Unwanted).** IF a handler throws an unhandled error, THE server SHALL convert it to `INTERNAL_ERROR` (no stack trace leaked) and log the full trace at error level via the configured logger.

### 3.7 Resources

**FR-24 (Ubiquitous).** The server SHALL implement every resource URI in the `mcp-tool-catalog` resource manifest. Resource reads route to internal subsystems (DB queries, blob storage, in-memory state) without invoking handlers.

**FR-25 (Ubiquitous).** Resources SHALL support the `?since=ISO8601` and `?fields=` query params per FR-39 / FR-46 of `mcp-tool-catalog`.

### 3.8 Events

**FR-26 (Ubiquitous).** The server SHALL emit catalog events (`job.progress`, `job.completed`, `document.changed`, `model.download.progress`, `audit.entry`) per the schemas in `mcp-tool-catalog`. Subscriptions are per-transport; HTTP clients receive via the Streamable HTTP event channel; in-memory callers receive via `server.on(...)`.

**FR-27 (Ubiquitous).** Events SHALL be published to a typed in-process bus before dispatch to subscribers. Hosts (via `onJobLifecycle` and similar) tap the same bus.

### 3.9 Persistence

**FR-28 (Ubiquitous).** The server SHALL use a single SQLite database at the path configured in `ServerConfig.persistence`. Migrations SHALL run at startup; migration files live under `libs/server/src/lib/db/migrations/`.

**FR-29 (Ubiquitous).** Persisted entities (v1 minimum):
- Documents (id, name, dimensions, created_at, modified_at)
- Layers (id, document_id, kind, name, position, opacity, blend, visible, content_blob_id?)
- Selections (per-document active selection)
- Regions (id, document_id, paint_layer_id, prompt)
- Control layers (id, document_id, type, image_blob_id, weight, scope)
- Presets (id, name, model, sampler, loras, defaults_json)
- Models registry cache (id, name, type, file_path, size, integrity_hash)
- History items (id, document_id, job_id, prompt, parameters_json, image_blob_id, thumbnail_blob_id, applied_to_layer_id?, created_at)
- Jobs (id, kind, status, progress, parameters_json, created_at, started_at, completed_at, error?)
- Tokens (id, name, hash, created_at, last_used_at, revoked_at)
- Audit entries (id, token_id, operation, args_summary, timestamp, outcome)
- Pairing requests (id, candidate_name, requested_at, approved_at?, rejected_at?)

**FR-30 (Ubiquitous).** Image blobs (history previews, layer content, mask uploads) SHALL be stored in the filesystem under `assets/` with content-addressable filenames; SQLite stores the relative path + metadata. `assets/` is rotational with a configurable max size.

**FR-31 (Ubiquitous).** A garbage-collection process SHALL run periodically to remove orphan blobs (no SQLite reference) and expired transient blobs (5-min TTL refs).

### 3.10 Job tracking (ComfyUI owns the queue)

**Architectural fact:** ComfyUI owns the job queue. The server does NOT maintain a parallel queue. The server's role is **tracking**: mapping our ULID `job_id` ↔ ComfyUI's `prompt_id`, persisting our metadata (token_name, document_id, parameters_json, history_item_id), and translating ComfyUI events into the catalog's typed events.

**FR-32 (Ubiquitous).** The server SHALL maintain a `jobs` table in SQLite that mirrors every active and recent ComfyUI job, plus DiffuseCraft-specific metadata. Concurrency is determined by ComfyUI's configuration, not by the server.

**FR-33 (Event-driven).** WHEN `generate_image` (or other job tool) is invoked, THE server SHALL: (1) construct the ComfyUI graph from typed inputs (per `comfyui-management`); (2) submit to ComfyUI via `/prompt`; (3) receive `prompt_id`; (4) record `(job_id=<ulid>, prompt_id=<comfy>, status="queued"|"running")` in `jobs` table; (5) emit `job.progress { percent: 0, stage: "queued" | "running" }` based on ComfyUI's queue position.

**FR-34 (Event-driven).** WHEN ComfyUI emits a WebSocket progress event, THE server SHALL translate it to `job.progress` with our `job_id` and forward via the event bus.

**FR-35 (Ubiquitous).** Cancellation via `cancel_job` SHALL: (1) call ComfyUI `POST /interrupt` for the running job, or `DELETE /queue/{prompt_id}` for queued jobs; (2) update our `jobs.status = "cancelled"`; (3) emit `job.completed { outcome: "cancelled" }`.

**FR-36 (Event-driven).** WHEN ComfyUI reports a job error, THE server SHALL transition our row to `status="failed"` with structured error info and emit `job.completed { outcome: "failure", error }`. No automatic retry.

**FR-37 (Event-driven).** ON `start()`, THE server SHALL fetch ComfyUI's current queue (`GET /queue`), reconcile with our `jobs` table: any of our `running` rows that are no longer in ComfyUI's queue → mark `failed` with `error: "lost-during-restart"`; any of our `pending` rows still in ComfyUI's queue → adopt them and resume tracking.

### 3.11 Audit & rate limit

**FR-36 (Ubiquitous).** Every tool invocation SHALL produce an audit-log entry with `{ token_id, token_name, operation, args_summary, timestamp, outcome, latency_ms }`. The audit log is queryable via `get_audit_log` tool and resource. Retention is configurable (default 30 days).

**FR-37 (Ubiquitous).** Per-token rate limit (per `mcp-tool-catalog` Q7-bis): default 50 image-mutating tool calls per minute; default 16 MB max payload per call. Configurable in `ServerConfig.comfyui_proxy`. Exceeding returns `RATE_LIMITED` or `PAYLOAD_TOO_LARGE`.

### 3.12 Bootstrap

**FR-38 (Event-driven).** ON FIRST RUN with no paired tokens in the database, THE server SHALL automatically open a pairing window (default 120 s) on startup so that the first device can connect via mDNS or QR without manual intervention. The window emits `lifecycle.first-run-pairing-window-open` so hosts can display UX accordingly.

**FR-39 (Event-driven).** WHEN the bootstrap pairing window expires without a successful pairing, THE server SHALL emit `lifecycle.first-run-pairing-window-expired` and continue running in unpaired state — clients that arrive later need to trigger a pairing window via host action (CLI flag re-run, MeshCraft "Add device" button).

### 3.13 Logging

**FR-40 (Ubiquitous).** The server SHALL use `pino` for structured logging. Default level `info`; configurable. JSON output by default; pretty-printer optional for development.

**FR-41 (Ubiquitous).** No log line SHALL contain a token, password, blob byte content, or full base64 image payload. Tokens SHALL be referenced by id+name only. Image references SHALL log size + format only.

### 3.14 ComfyUI proxy

**FR-42 (Ubiquitous).** No client (HTTP, stdio, in-memory) SHALL be able to invoke ComfyUI HTTP/WS APIs directly. Per P19, the server is the only authorized ComfyUI client.

**FR-43 (Ubiquitous).** ComfyUI graph construction SHALL happen server-side from typed tool inputs. The catalog does not accept raw graphs from clients (Custom Graph workspace introduces a controlled exception in a later spec).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Cold start (call `createDiffuseCraftServer` to first `lifecycle.started` event) SHALL be ≤ 1.5 seconds on a developer laptop with SQLite migrations done and ComfyUI external-mode reachable.

**NFR-2 (Ubiquitous).** RAM footprint at idle (no jobs, no clients) SHALL be ≤ 128 MB.

**NFR-3 (Ubiquitous).** SQLite WAL mode SHALL be enabled to support concurrent reads during writes.

**NFR-4 (Ubiquitous).** The library SHALL run on Node.js 20+ LTS and 22+. No Bun-specific APIs (Bun-compile path may be added later as a build target).

**NFR-5 (Ubiquitous).** All public exports SHALL have TSDoc and pass `tsc --strict`.

**NFR-6 (Ubiquitous).** The library SHALL NOT depend on any GUI library, RN package, Skia, or platform-specific UI binding. Pure Node.

## 5. Out of scope

- **Specific tool handler logic** — feature specs (`generation-workflow`, `selection-tools`, etc.).
- **ComfyUI managed install lifecycle** — `comfyui-management` spec.
- **Pairing protocol details** (mDNS service record format, QR encoding, claim flow) — `pairing-protocol` spec.
- **Token issuance details (mDNS/QR/numeric/manual flow + claim semantics)** — `pairing-protocol` spec. Token verification middleware itself is part of this spec (§3.6 + design.md §4.2 `authMw`).
- **Compiled binary distribution** — `standalone-server-binary` spec.
- **Internet reachability via tunnel** — post-v1 deferred spec.
- **MeshCraft-specific embedding details** — `meshcraft-integration` spec (B1 contract-only).

## 6. Open questions

### Q1 — `mcp` namespace shape on the returned instance
Should `server.mcp.invokeTool(name, args)` accept an opaque tool name string, or a typed reference (`server.mcp.tools.generateImage(args)`)?

**Recommendation:** **both**. `invokeTool(name, args)` for dynamic call sites; typed accessors generated from the catalog manifest for compile-time safety in MeshCraft and tests. Implementation detail in `design.md`.

### Q2 — Hook execution semantics
If a host's `onPairingRequest` handler is slow (e.g., showing a UI prompt that takes 30s), does the server time out, queue, or block?

**Recommendation:** configurable per-hook timeout, default 60s. Beyond timeout, the server treats the request as rejected and continues. Slow hosts should explicitly raise their timeout.

### Q3 — Multi-document concurrency
Can two clients simultaneously mutate the same document? Per `mcp-tool-catalog` FR-23 (multi-client coordination), yes, with last-write-wins. But what about document-level locks for long jobs (e.g., upscaling)?

**Recommendation:** introduce a `DOCUMENT_LOCKED` error code (already in `mcp-tool-catalog` error model) returned for non-job mutations during long-running document-wide operations. Job submissions still queue. Confirm in `design.md`.

### Q4 — In-memory transport authentication
The in-memory transport is "trust-in-process" (P26). But MeshCraft is itself reachable on the network via the same server's HTTP transport. Should in-memory invocations be tagged with a synthetic token name for audit purposes?

**Recommendation:** yes. In-memory invocations log under a synthetic token name `_in_process_<host_name>`. Hosts can override via config. Confirm in `design.md`.

### Q5 — Graceful shutdown of in-flight jobs
Default 30s graceful timeout. After timeout, force-cancel ComfyUI requests? Or wait indefinitely?

**Recommendation:** configurable. Default behavior: signal cancellation, wait up to the timeout, then forcibly close transports and emit `lifecycle.stopped-with-orphan-jobs` with the list of still-running ComfyUI calls. The next start will reconcile.

### Q6 — Should the server expose its own HTTP REST API for the GUI alongside MCP, or is everything MCP?
Per P2 (Human UX is built on top of the agent API), the GUI calls the same surface as agents. But Streamable HTTP is for MCP specifically — should the GUI use it directly, or is there a parallel REST mirror?

**Recommendation:** **GUI uses Streamable HTTP MCP directly**, no parallel REST. The `diffusion-client` SDK abstracts the transport detail; from the app's view, it calls typed functions that map to MCP tool invocations. Confirm.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The four user stories (§2) can be fulfilled by the API surface defined in §3.1–§3.4.
2. Every tool in `mcp-tool-catalog` has a clear path to handler registration via the API in §3.6.
3. Lifecycle (§3.3) is unambiguous for all combinations of start/stop/start.
4. Embedding hooks (§3.4) cover the use cases of MeshCraft and the standalone binary without monkey-patching.
5. Persistence model (§3.9) covers every entity referenced by `mcp-tool-catalog` resources.
6. Open questions (§6) have recommendations acceptable as defaults for `design.md`.
