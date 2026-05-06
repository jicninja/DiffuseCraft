# server-architecture — Design

> **Companion to:** `requirements.md` of this spec.
> **References:** `mcp-tool-catalog/design.md`, `tech.md` (Server architecture), P16, P19, P26.

## 1. Resolved decisions (closing requirements §6)

| ID | Decision | Rationale |
|---|---|---|
| Q1 | **Both interfaces.** `server.mcp.invokeTool(name, args)` for dynamic call sites and `server.mcp.tools.generateImage(args)` typed accessors generated from the manifest. | Dynamic for tests/scripts; typed for hosts that get IntelliSense. |
| Q2 | **Configurable per-hook timeout, default 60s.** Beyond timeout, the request is treated as rejected, server continues. | Slow UI shouldn't deadlock the server; hosts can raise the timeout if they need longer. |
| Q3 | **Document-level locks for long-running operations.** Mutations during a server-wide lock return `DOCUMENT_LOCKED`; jobs queue normally. | Predictable for agents; matches the error code already in the catalog. |
| Q4 | **In-memory invocations tagged `_in_process_<host_name>` in audit log.** Hosts may override via `ServerConfig.in_memory_token_name`. | Audit always knows who; hosts get override for clarity. |
| Q5 | **Graceful shutdown configurable, default 30s, then force-close + emit `stopped-with-orphan-jobs`.** Next start reconciles via job state in SQLite. | Safety + observability without indefinite hang. |
| Q6 | **GUI uses Streamable HTTP MCP directly.** No parallel REST. `diffusion-client` SDK abstracts transport. | One surface, no drift, P2 honored. |

## 2. Top-level architecture

```
                           ┌────────────────────────────────────┐
                           │   Host (apps/server | MeshCraft |  │
                           │   tests | future hosts)            │
                           └────────────────┬───────────────────┘
                                            │ createDiffuseCraftServer(config)
                                            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    @diffusecraft/server                         │
   │                                                                 │
   │  ┌────────────────┐   ┌────────────────┐   ┌───────────────┐    │
   │  │   Transports   │   │   Handlers     │   │  Hooks        │    │
   │  │  - stdio       │──►│  registered    │   │  - pairing    │    │
   │  │  - HTTP (Fast  │   │  from catalog  │   │  - audit      │    │
   │  │     ify)       │   │  manifest      │   │  - jobs       │    │
   │  │  - in-memory   │   │                │   │  - lifecycle  │    │
   │  └────────┬───────┘   └────────┬───────┘   │  - custom_tool│    │
   │           │                    │            └───────────────┘    │
   │           ▼                    ▼                                 │
   │  ┌────────────────────────────────────────────────────────────┐  │
   │  │                    Middleware pipeline                     │  │
   │  │  auth → rate-limit → input-validate → handler → audit →    │  │
   │  │  capability-shape → response-encode                        │  │
   │  └────────────────────────────────────────────────────────────┘  │
   │           │                    │                    │            │
   │           ▼                    ▼                    ▼            │
   │  ┌──────────────┐    ┌────────────────┐    ┌─────────────────┐   │
   │  │ Job queue    │    │ Comfy client   │    │ Persistence     │   │
   │  │ (SQLite-     │    │ (HTTP+WS proxy)│    │ (SQLite + WAL)  │   │
   │  │ backed)      │    │                │    │ + asset store   │   │
   │  └──────────────┘    └────────────────┘    └─────────────────┘   │
   │                                                                 │
   │   Event bus (typed) ── publishes events to all transports/hooks │
   │                                                                 │
   │   Undo/redo manager (per-client per-document command stacks)    │
   │                                                                 │
   │   mDNS advertiser (Bonjour-service)                             │
   └─────────────────────────────────────────────────────────────────┘
```

## 3. Public API (TypeScript)

```typescript
// libs/server/src/index.ts
import type {
  ToolDefinition,
  ResourceURI,
  EventName,
  CatalogManifest,
} from "@diffusecraft/mcp-tools";

export type ServerConfig = {
  comfyui: ComfyConfig;                       // see §4
  persistence: ":memory:" | string;           // SQLite location
  transports: {
    stdio?: boolean;
    http?: { host: string; port: number } | null;
    inMemory?: true;                          // forced true; field present for type completeness
  };
  pairing: {
    window_seconds: number;                   // default 120
    mdns_service_name: string;                // default "diffusecraft._tcp"
    mdns_advertise: boolean;                  // default true
    qr_fallback_enabled: boolean;             // default true
  };
  comfyui_proxy: {
    max_concurrent_jobs: number;              // default 1
    queue_depth: number;                      // default 50
    rate_limits: {
      mutating_per_minute: number;            // default 50
      max_payload_bytes: number;              // default 16 * 1024 * 1024
    };
  };
  logging: {
    level: "trace" | "debug" | "info" | "warn" | "error";
    pretty: boolean;
    destination: "stdout" | { file: string };
  };
  assets: {
    directory: string;                        // default OS-appropriate (xdg-data on linux, etc.)
    blob_ttl_seconds: number;                 // default 300 for transient
    audit_retention_days: number;             // default 30
    max_directory_bytes: number;              // default 5 GB
  };
  bootstrap_admin: "print" | "event" | "silent";   // default "print"
  in_memory_token_name: string;               // default "_in_process_<host_name>"
  host_name: string;                          // default OS hostname
  custom_tools?: ToolDefinition<any, any>[];  // hosts can preload custom tools at construction
};

export type ServerStatus =
  | { phase: "constructed" }
  | { phase: "starting" }
  | { phase: "running"; mounted: { stdio: boolean; http?: { url: string }; inMemory: true } }
  | { phase: "stopping" }
  | { phase: "stopped" }
  | { phase: "error"; error: Error };

export type ServerLifecycleEvent =
  | { kind: "lifecycle.started"; status: ServerStatus }
  | { kind: "lifecycle.start-failed"; error: Error }
  | { kind: "lifecycle.stopped" }
  | { kind: "lifecycle.stopped-with-orphan-jobs"; orphan_job_ids: string[] }
  | { kind: "lifecycle.first-run-pairing-window-open"; expires_at: string }
  | { kind: "lifecycle.first-run-pairing-window-expired" };

export interface DiffuseCraftServer {
  start(): Promise<ServerStatus>;
  stop(opts?: { graceful_timeout_ms?: number }): Promise<void>;
  getStatus(): ServerStatus;

  /** Programmatic MCP interface. Used by in-process hosts and tests. */
  mcp: {
    invokeTool(name: string, args: unknown): Promise<unknown>;
    /** Generated typed accessors: server.mcp.tools.generateImage(args), etc. */
    tools: TypedToolAccessors;
    readResource(uri: string): Promise<unknown>;
  };

  on<E extends ServerLifecycleEvent["kind"]>(event: E, handler: (event: Extract<ServerLifecycleEvent, { kind: E }>) => void): void;
  off<E extends ServerLifecycleEvent["kind"]>(event: E, handler: Function): void;

  /** Embedding hooks. */
  hooks: {
    onPairingRequest(handler: PairingRequestHandler, opts?: { timeout_ms?: number }): Unsubscribe;
    onAuditEntry(handler: (entry: AuditEntry) => void): Unsubscribe;
    onJobLifecycle(handler: (event: JobLifecycleEvent) => void): Unsubscribe;
    addCustomTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
      tool: ToolDefinition<I, O>,
      handler: (input: z.infer<I>, ctx: HandlerContext) => Promise<z.infer<O>>
    ): Unsubscribe;
  };
}

export function createDiffuseCraftServer(config: Partial<ServerConfig>): DiffuseCraftServer;
```

## 4. Subsystems

### 4.1 Transport mounter

```typescript
// libs/server/src/lib/transports/mount.ts
class TransportMount {
  constructor(private mcpServer: MCPServer, private logger: Logger) {}

  mount(config: ServerConfig["transports"], auth: AuthMiddleware) {
    if (config.stdio) this.mountStdio();
    if (config.http) this.mountHttp(config.http, auth);
    this.mountInMemory();   // always
  }
}
```

- **stdio:** uses `@modelcontextprotocol/sdk/server/stdio`. No auth.
- **HTTP:** Fastify route at `POST /mcp` per Streamable HTTP spec. Bearer-token middleware. Long-lived event channel via Fastify's SSE/WebSocket support (precise mechanism in Streamable HTTP spec — implementer's task).
- **In-memory:** direct method calls; same handler dispatcher.

All three transports flow into the same handler dispatcher.

### 4.2 Handler dispatcher & middleware

```typescript
// libs/server/src/lib/dispatcher.ts
class HandlerDispatcher {
  private handlers = new Map<string, RegisteredHandler>();

  register<T extends ToolDefinition<any, any>>(tool: T, handler: (input, ctx) => Promise<any>) {
    this.handlers.set(tool.name, { tool, handler });
  }

  async dispatch(toolName: string, args: unknown, ctx: RequestContext): Promise<unknown> {
    const reg = this.handlers.get(toolName);
    if (!reg) throw new ToolNotFound(toolName);
    return runMiddlewareChain(reg, args, ctx, [
      authMw,
      rateLimitMw,
      payloadSizeMw,
      versionCompatMw,
      validateInputMw,
      executeMw,
      reversibleCommandMw,
      auditMw,
      capabilityShapeMw,
    ]);
  }
}
```

Middleware order:
1. `authMw` — verify token, inject `tokenName` into ctx.
2. `rateLimitMw` — token bucket per token id.
3. `payloadSizeMw` — reject pre-validation if input bytes > 16 MB.
4. `versionCompatMw` — reject if tool's `since` > negotiated catalog version.
5. `validateInputMw` — Zod parse; structured error on failure.
6. `executeMw` — run handler.
7. `reversibleCommandMw` — if tool is reversible, register Command with undo manager.
8. `auditMw` — write audit-log entry, emit `audit.entry`.
9. `capabilityShapeMw` — adapt response (inline vs ref, png vs webp) per client capabilities.

### 4.3 Event bus

```typescript
// libs/server/src/lib/events/bus.ts
class EventBus {
  private subscribers = new Map<string, Set<Handler>>();

  publish(event: CatalogEvent): void {
    const subs = this.subscribers.get(event.name);
    subs?.forEach((h) => h(event.payload));
    this.relayToTransports(event);  // HTTP SSE, in-memory listeners, etc.
  }

  subscribe(name: string, handler: Handler): Unsubscribe;
}
```

The bus is the single emission point. Subsystems (job queue, ComfyUI client, document service) publish; transports + hooks subscribe.

### 4.4 Job tracker (ComfyUI owns the queue)

The server tracks ComfyUI jobs; it does **not** queue them. ComfyUI's `/prompt` endpoint accepts the graph; ComfyUI's internal queue handles concurrency; ComfyUI's WebSocket emits progress.

```typescript
// libs/server/src/lib/jobs/tracker.ts
class JobTracker {
  constructor(
    private db: SQLite,
    private comfy: ComfyClient,
    private bus: EventBus
  ) {
    this.comfy.events.on("progress", (e) => this.onComfyProgress(e));
    this.comfy.events.on("executed", (e) => this.onComfyExecuted(e));
    this.comfy.events.on("execution_error", (e) => this.onComfyError(e));
  }

  async submit(graphSpec: GraphSpec, metadata: JobMetadata): Promise<JobId> {
    const job_id = ulid();
    const { prompt_id, queue_position } = await this.comfy.submitGraph(graphSpec);
    this.db.exec("INSERT INTO jobs ...", {
      id: job_id, prompt_id, status: queue_position === 0 ? "running" : "queued",
      ...metadata,
    });
    this.bus.publish({
      name: "job.progress",
      payload: { job_id, percent: 0, stage: queue_position === 0 ? "running" : "queued" },
    });
    return job_id;
  }

  async cancel(job_id: string): Promise<void> {
    const row = this.db.queryRow("SELECT prompt_id, status FROM jobs WHERE id = ?", job_id);
    if (!row) throw new NotFoundError("job", job_id);
    if (row.status === "running") await this.comfy.interrupt(row.prompt_id);
    else if (row.status === "queued") await this.comfy.dequeue(row.prompt_id);
    this.db.exec("UPDATE jobs SET status='cancelled', completed_at=? WHERE id=?", now(), job_id);
    this.bus.publish({ name: "job.completed", payload: { job_id, outcome: "cancelled" } });
  }

  async reconcileOnStartup(): Promise<void> {
    const comfyQueue = await this.comfy.getQueue();
    const ourRunning = this.db.query("SELECT id, prompt_id FROM jobs WHERE status IN ('running','queued')");
    for (const row of ourRunning) {
      if (!comfyQueue.includes(row.prompt_id)) {
        this.db.exec("UPDATE jobs SET status='failed', error_json=? WHERE id=?",
          { code: "LOST_DURING_RESTART" }, row.id);
      }
    }
  }

  private onComfyProgress(e: ComfyProgressEvent) { /* translate to job.progress */ }
  private onComfyExecuted(e: ComfyExecutedEvent) { /* translate to job.completed success + create history_item */ }
  private onComfyError(e: ComfyErrorEvent) { /* translate to job.completed failure */ }
}
```

State transitions: `queued → running → (completed | failed | cancelled)`. Persisted in our `jobs` table; ComfyUI is source of truth for queue progress; we mirror.

### 4.5 ComfyUI client (proxy)

Wrapper around ComfyUI's HTTP + WebSocket APIs. Methods: `submitGraph(graph)`, `interrupt(promptId)`, `health()`, `listModels()`. Per FR-42, only this class talks to ComfyUI. Full lifecycle (managed install, custom-node validation) lives in `comfyui-management` spec.

### 4.6 Persistence

- SQLite via `better-sqlite3`. WAL mode enabled at startup.
- Migrations folder pattern: `libs/server/src/lib/db/migrations/{NNN}-{name}.ts`. Each is a default-export `up(db)` function. Migrations run in lexicographic order at startup.
- Asset store: filesystem `<assets.directory>/blobs/<ulid>`. Naming is content-addressable (SHA-256 of bytes) for dedup; the ULID is the lookup key.
- Garbage collection runs on a 1-hour interval.

Schema sketch (simplified; full DDL in `tasks.md` Phase B):
```sql
CREATE TABLE documents (id TEXT PRIMARY KEY, name TEXT, w INT, h INT, created_at TEXT, modified_at TEXT);
CREATE TABLE layers (id TEXT PRIMARY KEY, document_id TEXT, kind TEXT, name TEXT, position INT, opacity REAL, blend TEXT, visible INT, content_blob_id TEXT);
CREATE TABLE history_items (id TEXT PRIMARY KEY, document_id TEXT, job_id TEXT, prompt TEXT, parameters_json TEXT, image_blob_id TEXT, thumbnail_blob_id TEXT, applied_to_layer_id TEXT, created_at TEXT);
CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, status TEXT, progress INT, parameters_json TEXT, created_at TEXT, started_at TEXT, completed_at TEXT, error_json TEXT);
CREATE TABLE tokens (id TEXT PRIMARY KEY, name TEXT, hash TEXT, created_at TEXT, last_used_at TEXT, revoked_at TEXT);
CREATE TABLE audit (id TEXT PRIMARY KEY, token_id TEXT, operation TEXT, args_summary TEXT, ts TEXT, outcome TEXT, latency_ms INT);
-- indexes on hot paths
CREATE INDEX idx_history_doc ON history_items(document_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_audit_ts ON audit(ts);
```

### 4.7 Undo/redo manager

```typescript
// libs/server/src/lib/undo-redo/manager.ts
class UndoRedoManager {
  private stacks = new Map<string, ClientDocStack>();  // key: `${tokenName}:${documentId}`

  async execute(tokenName: string, documentId: string, command: Command): Promise<unknown> {
    const result = await command.apply();
    this.stack(tokenName, documentId).push(command);
    return result;
  }

  async undo(tokenName: string, documentId: string): Promise<void> {
    const cmd = this.stack(tokenName, documentId).pop();
    if (!cmd) throw new Error("nothing to undo");
    await cmd.revert();
    this.redoStack(tokenName, documentId).push(cmd);
  }

  // ... redo, snapshots every 20 ops, default depth 100
}
```

### 4.8 mDNS advertiser

`bonjour-service` package. Server publishes `_diffusecraft._tcp.local` with `name = config.host_name`, `port = config.transports.http.port`, `version = catalogVersion`. Stops on `stop()`.

### 4.9 Hook registry

```typescript
// libs/server/src/lib/hooks/registry.ts
class HookRegistry {
  private pairingHandlers: PairingRequestHandler[] = [];
  private auditHandlers: ((entry: AuditEntry) => void)[] = [];
  private jobLifecycleHandlers: ((e: JobLifecycleEvent) => void)[] = [];
  // etc.

  async dispatchPairingRequest(req: PairingRequest, timeoutMs = 60_000): Promise<PairingDecision> {
    if (this.pairingHandlers.length === 0) return { approved: true, reason: "no-handler-default-approve-during-window" };
    return await Promise.race([
      Promise.all(this.pairingHandlers.map(h => h(req))).then(results => collapse(results)),
      new Promise<PairingDecision>(r => setTimeout(() => r({ approved: false, reason: "timeout" }), timeoutMs)),
    ]);
  }
}
```

## 5. Lifecycle (sequence)

### 5.1 `start()` happy path

```
constructed → starting:
  1. Validate ServerConfig (Zod)
  2. Initialize logger
  3. Open SQLite + run migrations
  4. Load tokens, models, presets, document metadata into memory caches
  5. Initialize ComfyUI client (validate custom nodes; connect WS)
  6. Initialize job queue (resume any 'pending' jobs)
  7. Initialize undo/redo manager
  8. Build dispatcher; register every catalog handler
  9. Mount transports
  10. Start mDNS advertisement
  11. If no tokens exist → open first-run pairing window, emit lifecycle.first-run-pairing-window-open
  12. Emit lifecycle.started
starting → running
```

### 5.2 `stop()` happy path

```
running → stopping:
  1. Stop accepting new requests on all transports (return 503 / close stdio / refuse in-memory invocations)
  2. Stop mDNS advertisement
  3. Send cancel signal to all in-flight jobs
  4. Wait up to graceful_timeout_ms (default 30s) for jobs to complete
  5. After timeout → force-cancel + emit lifecycle.stopped-with-orphan-jobs
  6. Flush audit log
  7. Close transports
  8. Close ComfyUI client
  9. Close SQLite
  10. Emit lifecycle.stopped
stopping → stopped
```

### 5.3 First-run flow

```
1. createDiffuseCraftServer(config) → constructed
2. host calls start()
3. server: SQLite has no tokens → open first-run pairing window for 120s
4. emit lifecycle.first-run-pairing-window-open with expires_at
5. (host UI shows "Pair your tablet now")
6. tablet performs mDNS discovery, sends pair request
7. server invokes onPairingRequest hook (or auto-approves during window)
8. server issues token; tablet receives it
9. window closes (either explicit success or timeout)
```

## 6. Embedding examples

### 6.1 `apps/server` (standalone)

```typescript
// apps/server/src/main.ts
import { createDiffuseCraftServer } from "@diffusecraft/server";
import { parseArgs } from "node:util";

const args = parseArgs({ options: { port: { type: "string" }, comfyui: { type: "string" } } });

const server = createDiffuseCraftServer({
  transports: { http: { host: "0.0.0.0", port: Number(args.values.port ?? 7860) } },
  comfyui: { mode: "external", url: args.values.comfyui ?? "http://127.0.0.1:8188" },
  // all other defaults
});

server.on("lifecycle.first-run-pairing-window-open", ({ expires_at }) => {
  console.log(`First-run pairing window open until ${expires_at}.`);
  console.log("Scan the QR or use mDNS discovery from your tablet.");
});

await server.start();
process.on("SIGTERM", () => server.stop());
process.on("SIGINT", () => server.stop());
```

### 6.2 MeshCraft (in-process)

```typescript
// MeshCraft/main/diffusecraft.ts
import { createDiffuseCraftServer } from "@diffusecraft/server";
import { app } from "electron";
import { showPairingDialog } from "./ui/pairing-dialog";

const server = createDiffuseCraftServer({
  transports: { http: { host: "0.0.0.0", port: 7860 } },
  comfyui: { mode: "managed", install_dir: app.getPath("userData") + "/comfyui" },
  in_memory_token_name: "_in_process_meshcraft",
  host_name: "MeshCraft",
});

server.hooks.onPairingRequest(async (req) => {
  const decision = await showPairingDialog({ candidate: req.candidate_name });
  return { approved: decision === "approve" };
});

server.hooks.addCustomTool(meshcraftPipelineTool, meshcraftPipelineHandler);

await server.start();

// Renderer drives the pipeline via IPC bridged to server.mcp.invokeTool(...).
// External tablets pair via HTTP on port 7860 like any other client.
```

## 7. Cross-spec mapping

This server design implements:
- **Every tool** in `mcp-tool-catalog/design.md` via §4.2 dispatcher.
- **Every resource** via direct subsystem reads.
- **Every event** via §4.3 event bus.
- **Pairing flow** via §4.9 hooks (details in `pairing-protocol`).
- **Auth (token verification + audit + rate limit)** via §4.2 middleware. Token issuance details live in `pairing-protocol`.
- **ComfyUI proxy** semantics covered in `comfyui-management` (see below).
- **ComfyUI proxy** via §4.5 (details in `comfyui-management`).

## 8. Acceptance criteria for `design.md`

1. The public API in §3 covers all four user stories.
2. Subsystems in §4 each have a clear responsibility and a single owner; no overlapping concerns.
3. Lifecycle sequences in §5 are unambiguous.
4. Embedding examples in §6 work with the proposed API as written.
5. Cross-spec mapping in §7 demonstrates that this design implements `mcp-tool-catalog` end-to-end.
