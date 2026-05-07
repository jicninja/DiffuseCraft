/**
 * `createDiffuseCraftServer` — the public factory.
 *
 * Wires every subsystem (DB, event bus, dispatcher, transports, hooks) and
 * implements the lifecycle described in design.md §5.
 *
 * The library shape is deliberately complete; deeper handler logic lives in
 * downstream specs (`generation-workflow`, `selection-tools`,
 * `comfyui-management`, `pairing-protocol`, `undo-redo-system`). The
 * skeleton here provides the SHAPE so those specs can register handlers
 * incrementally without having to rewrite the host.
 */

import type { Database as DB } from 'better-sqlite3';
import type { Logger } from 'pino';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ServerConfig } from '../types/config.js';
import { parseServerConfig } from '../types/config.js';
import type {
  ServerStatus,
  ServerLifecycleEvent,
  ServerLifecycleEventKind,
  Unsubscribe,
} from '../types/lifecycle.js';
import { IllegalLifecycleError } from '../types/errors.js';

import { openDb } from './db/open.js';
import { Migrator } from './db/migrator.js';
import { MIGRATIONS } from './db/migrations/index.js';
import { AssetStore } from './assets/store.js';
import { BlobGc } from './assets/gc.js';
import { AuditLog, type AuditEntry } from './audit/log.js';
import { EventBus } from './events/bus.js';
import { HandlerDispatcher } from './dispatcher.js';
import { authMw } from './middleware/auth.js';
import { createRateLimitMw } from './middleware/rate-limit.js';
import { createPayloadSizeMw } from './middleware/payload-size.js';
import { createVersionCompatMw } from './middleware/version-compat.js';
import { validateInputMw } from './middleware/validate-input.js';
import { createExecuteMw, type RegisteredHandlerFn } from './middleware/execute.js';
import { createReversibleCommandMw } from './middleware/reversible-command.js';
import { createAuditMw } from './middleware/audit.js';
import { capabilityShapeMw } from './middleware/capability-shape.js';
import { mountTransports, unmountTransports, type MountedTransportSet } from './transports/mount.js';
import { ConnectionTracker } from './transports/connection-tracker.js';
import { ComfyClient } from './comfy/client.js';
import { HealthMonitor } from './comfy/health.js';
import { OutputFetcher } from './comfy/output-fetcher.js';
import { JobTracker } from './jobs/tracker.js';
import { UndoRedoManager } from './undo-redo/manager.js';
import { createSqliteSnapshotProvider } from './undo-redo/snapshot.js';
import { MdnsAdvertiser } from './pairing/mdns.js';
import { PairingManager } from './pairing/manager.js';
import { createRevokeTokenHandler } from './handlers/revoke-token.js';
import { createGenerateImageHandler } from './handlers/generate-image/index.js';
import { createCancelJobHandler } from './handlers/cancel-job.js';
import { createGetHistoryItemHandler } from './handlers/get-history-item.js';
import { createApplyHistoryItemHandler } from './handlers/apply-history-item.js';
import { createDiscardHistoryItemHandler } from './handlers/discard-history-item.js';
import { createPaintStrokesHandler } from './handlers/paint-strokes.js';
import { createTransformLayerHandler } from './handlers/transform-layer.js';
import { createSetSelectionHandler } from './handlers/set-selection.js';
import { createGetSelectionHandler } from './handlers/get-selection.js';
import { createInvertSelectionHandler } from './handlers/invert-selection.js';
import { createSelectAllHandler } from './handlers/select-all.js';
import { createRefineSelectionHandler } from './handlers/refine-selection.js';
import { createAutoSelectSubjectHandler } from './handlers/auto-select-subject.js';
import { createSelectByPromptHandler } from './handlers/select-by-prompt.js';
import { createUndoHandler } from './handlers/undo.js';
import { createRedoHandler } from './handlers/redo.js';
import {
  createRefineMaskHandler,
  createInvertMaskHandler,
  createClearMaskHandler,
  createFillMaskHandler,
  createSelectionToMaskHandler,
  createMaskToSelectionHandler,
  createBakeMaskHandler,
} from './handlers/mask/index.js';
import { SelectionStore } from './selection/store.js';
import { HistoryStore } from './history/store.js';
import { HistoryGc } from './history/gc.js';
import { readHistoryList, readHistoryItem } from './resources/history-list.js';
import { readUndoStack } from './resources/undo-stack.js';
import { readRedoStack } from './resources/redo-stack.js';
import { readModelsList } from './resources/models-list.js';
import { readPresetsList } from './resources/presets-list.js';
import { readServerInfo } from './resources/server-info.js';
import { PresetRegistry } from './comfy/presets/registry.js';
import { ModelRegistry } from './comfy/models/registry.js';
import { HookRegistry } from './hooks/registry.js';
import { InMemorySamplingRegistry } from './sampling/registry.js';
import {
  applyHistoryItem as applyHistoryItemTool,
  cancelJob as cancelJobTool,
  discardHistoryItem as discardHistoryItemTool,
  enhancePrompt as enhancePromptTool,
  generateImage as generateImageTool,
  getHistoryItem as getHistoryItemTool,
  paintStrokes as paintStrokesTool,
  revokeToken as revokeTokenTool,
  setSelection as setSelectionTool,
  getSelection as getSelectionTool,
  invertSelection as invertSelectionTool,
  selectAll as selectAllTool,
  refineSelection as refineSelectionTool,
  autoSelectSubject as autoSelectSubjectTool,
  selectByPrompt as selectByPromptTool,
  transformLayer as transformLayerTool,
  refineMask as refineMaskTool,
  invertMask as invertMaskTool,
  clearMask as clearMaskTool,
  fillMask as fillMaskTool,
  selectionToMask as selectionToMaskTool,
  maskToSelection as maskToSelectionTool,
  bakeMask as bakeMaskTool,
  undo as undoTool,
  redo as redoTool,
  sendChatMessage as sendChatMessageTool,
  getChatHistory as getChatHistoryTool,
  type ServerCapabilities,
} from '@diffusecraft/mcp-tools';
import { createEnhancePromptHandler } from './prompt-enhancement/index.js';
import {
  InMemoryChatStore,
  createSendChatMessageHandler,
  createGetChatHistoryHandler,
} from './chat/index.js';
import { createLogger } from './logger.js';
import { assertCatalogConformance, DEFAULT_CATALOG } from './catalog/registry.js';
import { SUPPORTED_CATALOG_VERSION } from './catalog/types.js';
import type { CatalogManifest } from './catalog/types.js';
import { assertUndoRedoConformance } from './conformance/undo-redo-conformance.js';

import type {
  CapabilitiesInterface,
  DiffuseCraftServer,
  EventsInterface,
  McpInterface,
  PairingInterface,
  ServerHandshakeSnapshot,
} from '../public-api.js';
import { newId } from './id.js';

interface ServerInternals {
  db: DB;
  logger: Logger;
  bus: EventBus;
  dispatcher: HandlerDispatcher;
  audit: AuditLog;
  assets: AssetStore;
  blobGc: BlobGc;
  comfy: ComfyClient;
  jobs: JobTracker;
  health: HealthMonitor;
  outputs: OutputFetcher;
  history: HistoryStore;
  historyGc: HistoryGc;
  undo: UndoRedoManager;
  /**
   * Per-token session tracker (undo-redo-system A.5). Wired to the HTTP
   * transport's `/mcp` route so the {@link UndoRedoManager}'s
   * disconnect-grace timer arms / re-arms around bursts of activity
   * from a token.
   */
  connectionTracker: ConnectionTracker;
  /**
   * Unsubscribe handle for the `auth.token-revoked` bus subscription
   * (FR-25 line 135 — discard the token's stacks immediately on
   * revocation). Cleared during {@link DiffuseCraftServerImpl.stop} so
   * the manager doesn't leak listeners on a restart.
   */
  unsubscribeTokenRevoked: () => void;
  mdns: MdnsAdvertiser;
  pairing: PairingManager;
  hooks: HookRegistry;
  transports: MountedTransportSet;
  /** Sampling-capable MCP peers register here at handshake time. */
  samplingRegistry: InMemorySamplingRegistry;
  /** Per-document in-memory chat store (external-agent-integration MVP). */
  chatStore: InMemoryChatStore;
}

class DiffuseCraftServerImpl implements DiffuseCraftServer {
  private status: ServerStatus = { phase: 'constructed' };
  private internals: ServerInternals | null = null;
  private readonly emitter = new EventEmitter();
  public readonly hooks = new HookRegistry();

  constructor(
    private readonly config: ServerConfig,
    private readonly catalog: CatalogManifest,
  ) {}

  getStatus(): ServerStatus {
    return this.status;
  }

  on<E extends ServerLifecycleEventKind>(
    event: E,
    handler: (event: Extract<ServerLifecycleEvent, { kind: E }>) => void,
  ): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<E extends ServerLifecycleEventKind>(event: E, handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler);
  }

  // ---- Lifecycle -----------------------------------------------------------

  async start(): Promise<ServerStatus> {
    if (this.status.phase !== 'constructed' && this.status.phase !== 'stopped') {
      throw new IllegalLifecycleError(`cannot start from phase=${this.status.phase}`);
    }
    if (this.status.phase === 'stopped') {
      throw new IllegalLifecycleError('cannot start a stopped instance; create a new server');
    }
    this.status = { phase: 'starting' };
    try {
      this.internals = await this.bootstrap();
      const mounted = this.internals.transports.describe();
      this.status = { phase: 'running', mounted };

      // First-run pairing window + bootstrap admin token (CLAUDE.md +
      // pairing-protocol FR-5). Opening only happens when zero active
      // tokens exist; the bootstrap token is a 24h-TTL active token shown
      // in cleartext exactly once on stdout.
      const opened = this.internals.pairing.openOnFirstRun({
        duration_seconds: this.config.pairing.window_seconds,
      });
      if (opened) {
        const bootstrap = this.internals.pairing.issueBootstrapAdminToken();
        if (this.config.bootstrap_admin === 'print') {
          // eslint-disable-next-line no-console
          console.log(
            `[diffusecraft] bootstrap-admin token (24h TTL) — copy now, will not be shown again: ${bootstrap.token}`,
          );
          // eslint-disable-next-line no-console
          console.log(
            `[diffusecraft] first-run pairing window open for ${this.config.pairing.window_seconds}s ` +
              `(window_id=${opened.window_id}). Pair via mDNS, QR, code or manual URL.`,
          );
        }
        this.emit({
          kind: 'lifecycle.first-run-pairing-window-open',
          expires_at: opened.expires_at,
        });
      }

      this.emit({ kind: 'lifecycle.started', status: this.status });
      return this.status;
    } catch (err) {
      const error = err as Error;
      await this.rollback();
      this.status = { phase: 'error', error };
      this.emit({ kind: 'lifecycle.start-failed', error });
      throw error;
    }
  }

  async stop(opts?: { graceful_timeout_ms?: number }): Promise<void> {
    if (this.status.phase === 'stopped' || this.status.phase === 'constructed') return;
    if (this.status.phase === 'starting') {
      // Allow stop to abort an in-flight start; rollback handles it.
      await this.rollback();
      this.status = { phase: 'stopped' };
      this.emit({ kind: 'lifecycle.stopped' });
      return;
    }
    this.status = { phase: 'stopping' };
    const internals = this.internals;
    if (!internals) {
      this.status = { phase: 'stopped' };
      this.emit({ kind: 'lifecycle.stopped' });
      return;
    }

    const gracefulMs = opts?.graceful_timeout_ms ?? 30_000;
    // 1. Stop accepting new requests
    await unmountTransports(internals.transports);
    // 2. mDNS off
    internals.mdns.stop();
    // 3. Cancel + drain in-flight jobs (skeleton: just record the orphan list)
    const orphan = internals.db
      .prepare<[], { id: string }>("SELECT id FROM jobs WHERE status IN ('running','queued')")
      .all()
      .map((r) => r.id);
    if (orphan.length > 0) {
      // Drain wait — for the skeleton we do not actually wait.
      // TODO(comfyui-management): wait up to gracefulMs for ComfyUI to finish.
      void gracefulMs;
      this.emit({ kind: 'lifecycle.stopped-with-orphan-jobs', orphan_job_ids: orphan });
    }
    // 4. Stop comfy client + health monitor (F.1).
    internals.health.stop();
    await internals.comfy.stop();
    // 5. Stop GCs + close DB. History GC pauses (D.5 / FR Q6) so any
    // pinned blobs are safe across restart.
    internals.blobGc.stop();
    internals.historyGc.stop();
    internals.pairing.closeAllWindows('stopped');
    // Undo-redo (FR-25 line 137): discard every per-token stack and
    // cancel every pending disconnect-grace timer so the manager exits
    // cleanly with no in-flight setTimeout handles. Also drop the
    // `auth.token-revoked` subscription so a future `start()` doesn't
    // double-deliver.
    try {
      internals.unsubscribeTokenRevoked();
    } catch {
      /* defensive: subscription handle is best-effort */
    }
    internals.undo.discardAll();
    if (internals.db.open) internals.db.close();

    this.internals = null;
    this.status = { phase: 'stopped' };
    this.emit({ kind: 'lifecycle.stopped' });
  }

  // ---- pairing namespace ---------------------------------------------------

  get pairing(): PairingInterface {
    return {
      openWindow: (opts) => this.requireInternals().pairing.openWindow(opts ?? {}),
      listPairedDevices: () => this.requireInternals().pairing.listPairedDevices(),
      revokeToken: (token_id: string) => this.requireInternals().pairing.revokeToken(token_id),
    };
  }

  // ---- mcp namespace -------------------------------------------------------

  get mcp(): McpInterface {
    return {
      invokeTool: (name, args) => this.requireInternals().transports.inMemory.invokeTool(name, args),
      tools: new Proxy({} as Record<string, (args: unknown) => Promise<unknown>>, {
        get: (_target, name: string) => {
          return (args: unknown) => this.requireInternals().transports.inMemory.invokeTool(name, args);
        },
      }),
      readResource: (uri) => this.requireInternals().transports.inMemory.readResource(uri),
    };
  }

  // ---- capabilities namespace ----------------------------------------------

  /**
   * Live capability snapshot consumed by the SDK's in-memory transport in
   * `connect()` (`client-sdk` FR-9, design.md §4). Each call reads the
   * current state — `comfyui_status` reflects the health monitor's most
   * recent probe; `sampling_supported` is sourced from sampling forwarder
   * state (false until a sampling-capable agent is registered).
   */
  get capabilities(): CapabilitiesInterface {
    return {
      snapshot: (): ServerHandshakeSnapshot => {
        const internals = this.requireInternals();
        const comfyStatus = internals.health.getStatus();
        // Map the internal health-monitor enum → the catalog's
        // `comfyui_status` enum. `unreachable` collapses to
        // `disconnected` (the externally-visible failure mode).
        const comfyui_status: ServerCapabilities['comfyui_status'] =
          comfyStatus === 'healthy'
            ? 'ready'
            : comfyStatus === 'degraded' || comfyStatus === 'unreachable'
              ? 'disconnected'
              : 'unknown';
        const serverCapabilities: ServerCapabilities = {
          catalog_version_range: [SUPPORTED_CATALOG_VERSION, SUPPORTED_CATALOG_VERSION],
          comfyui_status,
          supported_workspaces: [
            'Generate',
            'Inpaint',
            'Upscale',
            'Live',
            'CustomGraph',
            'Animation',
          ],
          // Wired to false until a sampling-capable agent is registered.
          // The prompt-enhancement handler's resolver also surfaces this
          // dynamically per call; this snapshot reflects the boot-time
          // default for in-memory consumers.
          sampling_supported: false,
          audit_log_enabled: true,
        };
        return {
          serverCapabilities,
          protocolVersion: '1',
          serverName: this.config.host_name,
        };
      },
    };
  }

  // ---- events namespace ----------------------------------------------------

  /**
   * Public events surface (`client-sdk` FR-9). Delegates to the internal
   * {@link EventBus.subscribe} so in-process callers — the SDK's in-memory
   * transport, MeshCraft, integration tests — can attach handlers without
   * reaching into private internals.
   *
   * Subscriptions taken before {@link DiffuseCraftServerImpl.start} resolve
   * fail with the same `"server not started"` invariant that `mcp` uses,
   * because the event bus is constructed during bootstrap. Callers wire
   * subscriptions after `start()` returns.
   */
  get events(): EventsInterface {
    return {
      subscribe: <E extends string>(
        name: E,
        handler: (payload: unknown) => void,
      ): Unsubscribe => this.requireInternals().bus.subscribe(name, handler),
    };
  }

  // ---- Internal ------------------------------------------------------------

  private async bootstrap(): Promise<ServerInternals> {
    // 1. Logger
    const logger = createLogger(this.config.logging);

    // 2. Assets dir + DB
    if (this.config.persistence !== ':memory:') {
      const dir = path.dirname(this.config.persistence);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    }
    const db = openDb({ filename: this.config.persistence });
    new Migrator(db).apply(MIGRATIONS);

    // 3. Asset store + GC
    const assets = new AssetStore(db, this.config.assets.directory);
    if (this.config.persistence !== ':memory:') {
      await assets.init();
    }
    const blobGc = new BlobGc(db, {
      rootDir: this.config.assets.directory,
      minOrphanAgeSeconds: this.config.assets.blob_ttl_seconds,
    });
    blobGc.start();

    // 4. Event bus
    const bus = new EventBus({
      onSubscriberError: (event, error) => logger.error({ event, error }, 'event subscriber error'),
    });

    // 5. Audit log (with hook fan-out)
    const audit = new AuditLog(db, (entry: AuditEntry) => this.hooks.notifyAudit(entry));

    // 6. ComfyUI client + OutputFetcher + JobTracker + HealthMonitor.
    //    The fetcher is constructed without a `thumbnail` helper here; hosts
    //    that ship `sharp` (e.g. apps/server, MeshCraft) can override via
    //    a follow-up wiring once `generation-workflow` lands its preset
    //    plumbing. Without `thumbnail` configured, the history_item simply
    //    has `thumbnail_blob_id = null` and clients fall back to lazy
    //    thumbnailing. Health monitoring runs in all three modes (FR-24).
    const comfy = new ComfyClient(this.config.comfyui, logger);
    await comfy.start();
    // History store + per-completion fetcher hookup. The fetcher needs the
    // store so it can persist N rows per batch (FR-21) and emit
    // `history.item-created` events for the tablet's mirror.
    const history = new HistoryStore(db);
    const outputs = new OutputFetcher(db, comfy, assets, logger, { bus }, history);
    const jobs = new JobTracker(db, comfy, bus, { output_fetcher: outputs });
    // History GC — daily timer for retention + budget. Run a startup
    // orphan-blob check synchronously (FR Q6) so any item whose blob is
    // missing is degraded to discarded before the first read.
    const historyGc = new HistoryGc({ store: history, assets, bus });
    historyGc.runStartupCheck();
    historyGc.start();
    await jobs.reconcileOnStartup().catch((err) => {
      logger.warn({ err }, 'job reconciliation failed; continuing');
    });
    const health = new HealthMonitor(comfy, bus, logger);
    health.start();

    // 7. Dispatcher + middleware
    const dispatcher = new HandlerDispatcher();
    const undo = new UndoRedoManager({
      max_depth_per_client: this.config.undo.max_depth_per_client,
      snapshot_every_n: this.config.undo.snapshot_every_n,
      retain_after_disconnect_seconds: this.config.undo.retain_after_disconnect_seconds,
      max_total_memory_bytes: this.config.undo.max_total_memory_bytes,
      // Phase B floor (FR-27 implicit, design.md §6 line 250). The
      // eviction policy stops dropping ops from any stack at this
      // depth — recent undo is preserved even when total memory still
      // exceeds budget. Default 5.
      floor_ops_per_stack: this.config.undo.floor_ops_per_stack,
      // Phase E.2 conflict-detection window (FR-13, design.md §7).
      // The manager peeks at `document.changed` events on `bus` within
      // this window to decide whether the incoming Command overlaps a
      // prior client's edit. Default 1000 ms; the bus's recent-events
      // buffer retains entries for at least 5 s, so this is always
      // covered.
      conflict_window_ms: this.config.undo.conflict_window_ms,
      bus,
      // Snapshot capture (FR-10..FR-12): every `snapshot_every_n`
      // executes the manager asks the provider to dump the document's
      // structural state and anchors it on the triggering Command.
      snapshotProvider: createSqliteSnapshotProvider(db),
    });

    // 7-bis. Per-token connection tracker (undo-redo-system A.5). Drives
    // the manager's disconnect-grace timer from real transport sessions:
    // `acquire(token_id)` on session-open cancels any pending discard;
    // `release(token_id)` on session-close re-arms it for
    // `retain_after_disconnect_seconds`. The tracker is wired into the
    // HTTP transport's `/mcp` route below; stdio is single-eternal-session
    // and the in-memory transport is in-process, so neither uses it.
    const connectionTracker = new ConnectionTracker(undo);

    // 7-ter. Subscribe to `auth.token-revoked` so revocation immediately
    // discards the token's undo/redo stacks (FR-25 line 135). The bus
    // subscription captures every revocation path: the `revoke_token`
    // handler, direct `pairing.revokeToken` calls, and the implicit
    // window-claim revoke of pre-issued tokens.
    const unsubscribeTokenRevoked = bus.subscribe('auth.token-revoked', (payload) => {
      const tokenId = (payload as { token_id?: unknown } | null | undefined)?.token_id;
      if (typeof tokenId === 'string' && tokenId.length > 0) {
        undo.discardForToken(tokenId);
      }
    });

    const handlerLookup = (toolName: string): RegisteredHandlerFn | null => {
      const reg = dispatcher.getRegistration(toolName);
      if (!reg) return null;
      return (input, ctx) => reg.handler(input as never, ctx as never) as Promise<unknown>;
    };

    dispatcher.setChain([
      authMw,
      createRateLimitMw({
        rate_per_minute: this.config.comfyui_proxy.rate_limits.mutating_per_minute,
        // TODO(server-architecture): pass tool category lookup once the catalog
        // is materialized so reads are exempted (FR-37 nuance).
      }),
      createPayloadSizeMw(this.config.comfyui_proxy.rate_limits.max_payload_bytes),
      createVersionCompatMw(
        { getToolSince: (n) => dispatcher.getToolSince(n) },
        SUPPORTED_CATALOG_VERSION,
      ),
      validateInputMw,
      createReversibleCommandMw(undo),
      createExecuteMw(handlerLookup),
      createAuditMw(audit),
      capabilityShapeMw,
    ]);

    // 8. mDNS + PairingManager (constructed BEFORE handler registration so
    // the `revoke_token` handler can use it, and BEFORE transports so the
    // HTTP route for `POST /pair` can delegate to it).
    const mdns = new MdnsAdvertiser(logger);
    if (this.config.pairing.mdns_advertise && this.config.transports.http) {
      await mdns.start({
        service_name: this.config.pairing.mdns_service_name,
        host_name: this.config.host_name,
        port: this.config.transports.http.port,
        protocol_version: '1',
        catalog_version: SUPPORTED_CATALOG_VERSION,
        server_name: this.config.host_name,
        pairing_open: false,
      });
    }
    const pairing = new PairingManager({
      db,
      bus,
      hooks: this.hooks,
      mdns,
      audit,
      logger,
      catalog_version: SUPPORTED_CATALOG_VERSION,
      server_name: this.config.host_name,
      default_window_seconds: this.config.pairing.window_seconds,
      ...(this.config.transports.http
        ? {
            http_address: {
              ip: this.config.transports.http.host === '0.0.0.0' ? '127.0.0.1' : this.config.transports.http.host,
              port: this.config.transports.http.port,
            },
          }
        : {}),
    });

    // Re-emit lifecycle bus events through the EventEmitter for `server.on(...)`
    bus.subscribe('lifecycle.pairing-window-closed', (payload) => {
      const p = payload as { reason: 'expired' | 'claimed' | 'stopped' };
      if (p.reason === 'expired') {
        this.emit({ kind: 'lifecycle.first-run-pairing-window-expired' });
      }
    });

    // 9. Register catalogued handlers owned by pairing-protocol. Other
    // per-feature specs land their handlers incrementally; the conformance
    // check below stays lenient.
    dispatcher.register(revokeTokenTool, createRevokeTokenHandler(db, pairing));

    // 9-bis. Register `generate_image` + `cancel_job` (generation-workflow).
    // Models registry is omitted here — `comfyui-management` populates it at
    // boot when the install is validated, and the handler skips the
    // presence check when the registry is absent. Once the model registry
    // wiring lands in this bootstrap, swap to `models: registry` here.
    const presets = new PresetRegistry();
    // Model registry — populated from ComfyUI's `/object_info` once the
    // health monitor sees the upstream go ready. Until then the registry
    // is empty and `diffusecraft://models/list` returns an empty page,
    // which is the right answer (the agent shouldn't reference models
    // that aren't actually available locally).
    const models = new ModelRegistry(db);
    void this.refreshModelsWhenReady(models, comfy, logger);
    // Sampling-capable agents (paired MCP clients that declared
    // `sampling: {}` in `initialize`) register themselves here at handshake
    // time. The `enhance_prompt` handler resolves a target through this
    // registry; see `lib/sampling/registry.ts` and `mcp/server-factory.ts`.
    const samplingRegistry = new InMemorySamplingRegistry();
    dispatcher.register(
      generateImageTool,
      createGenerateImageHandler({ db, tracker: jobs, presets }),
    );
    dispatcher.register(cancelJobTool, createCancelJobHandler(jobs));

    // 9-bis-2. Register history-tools (generation-history). All three
    // share the HistoryStore; `apply_history_item` is reversible and
    // delegates command enrolment to the reversibleCommandMw via
    // `ctx.scratch.command`.
    dispatcher.register(
      getHistoryItemTool,
      createGetHistoryItemHandler(db, history),
    );
    dispatcher.register(
      applyHistoryItemTool,
      createApplyHistoryItemHandler(db, history),
    );
    dispatcher.register(
      discardHistoryItemTool,
      createDiscardHistoryItemHandler(history),
    );

    // 9-bis-3. Register `paint_strokes` (brush-system). The handler
    // materializes brush strokes into layer pixel data via canvas-core's
    // pure-TS compositor seam; the v1 path uses a raw-RGBA codec so it
    // doesn't pull a PNG dependency at the server boundary. Hosts that
    // already ship a PNG codec (`apps/server`, MeshCraft) inject one via
    // `createPaintStrokesHandler({ codec })` once their bootstrap wires it.
    dispatcher.register(
      paintStrokesTool,
      createPaintStrokesHandler({ db, assets }),
    );

    // 9-bis-4. Register selection-tools handlers. The Tier 1 handlers
    // (set/get/invert/select_all/refine) operate purely on the persisted
    // `selections` table via canvas-core geometry. Tiers 2 + 4
    // (auto_select_subject, select_by_prompt) ship as model-not-found /
    // sampling-not-supported stubs until comfyui-management wires
    // MobileSAM and the MCP-sampling forwarder into the segmentation
    // client (Phases C/D/E in selection-tools/tasks.md).
    const selectionStore = new SelectionStore(db);
    dispatcher.register(
      setSelectionTool,
      // B.6 magic-wand server-side: pass `assets` so the handler can
      // read layer RGBA blobs and persist composed masks. Without
      // `assets` magic_wand still degrades to `MAGIC_WAND_NOT_WIRED`
      // — every other shape kind keeps working.
      createSetSelectionHandler({ db, store: selectionStore, assets }),
    );
    dispatcher.register(
      getSelectionTool,
      createGetSelectionHandler(db, selectionStore),
    );
    dispatcher.register(
      invertSelectionTool,
      createInvertSelectionHandler(db, selectionStore),
    );
    dispatcher.register(
      selectAllTool,
      createSelectAllHandler(db, selectionStore),
    );
    dispatcher.register(
      refineSelectionTool,
      createRefineSelectionHandler(db, selectionStore),
    );
    dispatcher.register(autoSelectSubjectTool, createAutoSelectSubjectHandler());
    dispatcher.register(selectByPromptTool, createSelectByPromptHandler());

    // 9-quater. Register `transform_layer` (transform-tools Phase C). The
    // handler stores the decomposed transform on `layers.transform_json`
    // (migration 004) and emits `document.changed` with the affected layer
    // ids. Reversibility: the per-call Command captures every affected
    // layer's pre-state so revert restores them in one undo step.
    dispatcher.register(
      transformLayerTool,
      createTransformLayerHandler(db),
    );

    // 9-quinquies. Register mask-system handlers (mask-system Phase B).
    // All seven handlers share the `assets` and `db` deps; selection-↔-
    // mask conversion also needs the SelectionStore. Each handler reads
    // `layers.mask_data_json` (migration 005) and `layers.content_blob_id`
    // for painted-mask bytes; revert restores prior values in one Command.
    dispatcher.register(
      refineMaskTool,
      createRefineMaskHandler({ db, assets }),
    );
    dispatcher.register(
      invertMaskTool,
      createInvertMaskHandler({ db, assets }),
    );
    dispatcher.register(
      clearMaskTool,
      createClearMaskHandler({ db, assets }),
    );
    dispatcher.register(
      fillMaskTool,
      createFillMaskHandler({ db, assets }),
    );
    dispatcher.register(
      selectionToMaskTool,
      createSelectionToMaskHandler({ db, assets, selectionStore }),
    );
    dispatcher.register(
      maskToSelectionTool,
      createMaskToSelectionHandler({ db, assets, selectionStore }),
    );
    dispatcher.register(
      bakeMaskTool,
      createBakeMaskHandler({ db, assets }),
    );

    // 9-bis. Register `undo` / `redo` (undo-redo-system C.1 + C.2 + C.3).
    // Both handlers are non-reversible (idempotent thin wrappers around
    // the manager's parametric surface) and the manager itself publishes
    // `document.changed` on success, so no extra middleware wiring is
    // needed here.
    dispatcher.register(undoTool, createUndoHandler(undo));
    dispatcher.register(redoTool, createRedoHandler(undo));

    // 9-ter. Register `enhance_prompt` (prompt-enhancement). The handler
    // resolves a sampling target per request via `ctx.samplingClient`
    // (transport-supplied) plus an optional registry of other paired
    // sessions. Without any sampling-capable client the handler returns
    // `SAMPLING_NOT_SUPPORTED`; the tablet then surfaces the
    // "Pair an agent" UX. Auto-context (canvas summary, regions, etc.)
    // is wired by downstream specs as they land.
    dispatcher.register(
      enhancePromptTool,
      createEnhancePromptHandler({
        config: {
          sampling: this.config.sampling,
          prompt_enhancement: this.config.prompt_enhancement,
        },
        samplingRegistry,
      }),
    );

    // 9-sext. Chat handlers (external-agent-integration MVP, FR-30..FR-36).
    // Same sampling target resolution as `enhance_prompt` — chat shares
    // the configured default agent until `chat_agent_token_name` (FR-35)
    // is wired separately. In-memory store; SQLite persistence is a
    // post-MVP follow-up (tasks.md Phase C).
    const chatStore = new InMemoryChatStore();
    dispatcher.register(
      sendChatMessageTool,
      createSendChatMessageHandler({
        chatStore,
        samplingRegistry,
        ...(this.config.sampling.default_agent_token_name !== undefined
          ? { defaultAgentTokenName: this.config.sampling.default_agent_token_name }
          : {}),
      }),
    );
    dispatcher.register(
      getChatHistoryTool,
      createGetChatHistoryHandler({ chatStore }),
    );

    // 10. Register custom tools from config + hook registry.
    for (const reg of this.hooks.listCustomTools()) {
      dispatcher.register(reg.tool, reg.handler);
    }

    // 11. Catalog conformance check (D.12). Lenient during the skeleton phase:
    // the full mcp-tool-catalog manifest defaults in, but per-feature specs
    // (`generation-workflow`, `selection-tools`, etc.) ship handlers later.
    // Missing handlers are logged once at info level so the gap is visible.
    assertCatalogConformance(this.catalog, dispatcher, {
      strict: false,
      onMissing: (missing) => {
        logger.info(
          { missing_count: missing.length, total: this.catalog.tools.length },
          'catalog conformance: handlers pending; per-feature specs register them as they land',
        );
      },
    });

    // 11-bis. Undo/redo conformance check (undo-redo-system Phase F.9 +
    // FR-34, design.md §11). Every catalog tool flagged
    // `reversible: true` AND registered with the dispatcher must have
    // a handler that routes through `ctx.undoRedo.execute(...)`.
    // Handlers still on the legacy `ctx.scratch.command` bridge are
    // gated by the explicit allowlist in
    // `lib/conformance/undo-redo-conformance.ts` (mask suite +
    // selection helpers) — those are tracked under their owning
    // specs. Throws on violation.
    assertUndoRedoConformance(this.catalog.tools, dispatcher.list());

    // 12. Mount transports (HTTP route uses `pairing` for `POST /pair`).
    //     The HTTP transport also brackets each `POST /mcp` dispatch with
    //     `connectionTracker.acquire/release` so the undo manager's
    //     disconnect-grace timer arms / re-arms per FR-25.
    const transports = await mountTransports({
      config: this.config,
      db,
      dispatcher,
      bus,
      audit,
      logger,
      pairing,
      connectionTracker,
      // undo-redo-system Phase F: stamp `ctx.undoRedo` on every handler
      // ctx so reversible handlers route mutations through
      // `ctx.undoRedo.execute(...)` (FR-34, design.md §11).
      undoRedo: undo,
      // pairing-protocol / prompt-enhancement: stdio + HTTP register
      // sampling-capable MCP peers here when they advertise the
      // `sampling: {}` capability during `initialize`. The
      // `enhance_prompt` handler reads this registry via
      // {@link resolveSamplingTarget}.
      samplingRegistry,
      catalog: this.catalog,
      serverInfo: { name: this.config.host_name, version: SUPPORTED_CATALOG_VERSION },
    });

    // 12-bis. Register history resources on the in-memory transport
    // (`diffusecraft://history/list` + `diffusecraft://history/{id}`).
    // The HTTP/stdio transports proxy to the same dispatcher; resource
    // surfacing on those transports is downstream-spec work
    // (server-architecture FR-24). Tests + in-process callers (MeshCraft,
    // smoke tests) read via `mcp.readResource`.
    transports.inMemory.registerResource(
      'diffusecraft://history/list',
      (_uri, query) => {
        const applied =
          query['applied'] === 'true'
            ? true
            : query['applied'] === 'false'
              ? false
              : undefined;
        const fields = parseFieldsQuery(query['fields']);
        return readHistoryList(db, history, {
          ...(typeof query['document_id'] === 'string' ? { document_id: query['document_id'] } : {}),
          ...(applied !== undefined ? { applied } : {}),
          ...(typeof query['since'] === 'string' ? { since: query['since'] } : {}),
          ...(typeof query['cursor'] === 'string' ? { cursor: query['cursor'] } : {}),
          ...(typeof query['limit'] === 'string' ? { limit: Number(query['limit']) } : {}),
          ...(fields !== undefined ? { fields } : {}),
          ...(query['include_discarded'] === 'true' ? { include_discarded: true } : {}),
        });
      },
    );
    transports.inMemory.registerResource(
      'diffusecraft://history/{id}',
      (_uri, query) => {
        const id = (query['id'] as string) ?? '';
        const fields = parseFieldsQuery(query['fields']);
        return readHistoryItem(db, history, id, fields);
      },
    );

    // 12-bis-2. Models / presets / server-info resources. These are the
    // first reads a paired MCP agent makes — `models/list` and
    // `presets/list` to pick a checkpoint, `server/info` for the
    // "you-are-here" map (FR-54).
    transports.inMemory.registerResource(
      'diffusecraft://models/list',
      (_uri, query) => {
        const fields = parseFieldsQuery(query['fields']);
        return readModelsList(models, {
          ...(typeof query['kind'] === 'string' ? { kind: query['kind'] } : {}),
          ...(typeof query['cursor'] === 'string' ? { cursor: query['cursor'] } : {}),
          ...(typeof query['limit'] === 'string' ? { limit: Number(query['limit']) } : {}),
          ...(fields !== undefined ? { fields } : {}),
        });
      },
    );
    transports.inMemory.registerResource(
      'diffusecraft://presets/list',
      (_uri, query) => {
        const fields = parseFieldsQuery(query['fields']);
        return readPresetsList(presets, {
          ...(typeof query['cursor'] === 'string' ? { cursor: query['cursor'] } : {}),
          ...(typeof query['limit'] === 'string' ? { limit: Number(query['limit']) } : {}),
          ...(fields !== undefined ? { fields } : {}),
        });
      },
    );
    transports.inMemory.registerResource('diffusecraft://server/info', () =>
      readServerInfo({
        serverName: this.config.host_name,
        catalogVersionRange: [SUPPORTED_CATALOG_VERSION, SUPPORTED_CATALOG_VERSION],
        health,
        mountedTransports: transports.describe(),
        auditLogEnabled: true,
      }),
    );

    // 12-ter. Register undo-redo stack resources on the in-memory transport
    // (undo-redo-system D.1 / D.2 / D.3): `diffusecraft://undo-stack/{doc}`
    // and `diffusecraft://redo-stack/{doc}`. These resources are
    // per-(token_id, document_id) — they need the calling-token context
    // that the resolver's third arg now carries (see in-memory.ts
    // `ResourceContext`). HTTP/stdio resource surfacing is downstream-spec
    // work (server-architecture FR-24); for now only the in-memory
    // transport (used by MeshCraft + smoke tests via `mcp.readResource`)
    // exposes them. The catalog manifest at
    // `libs/mcp-tools/src/resources/manifest.ts:158-174` declares
    // `supports_since: false` and `supports_fields: true` for both — see
    // `./resources/undo-stack.ts` for the field-mapping rationale.
    transports.inMemory.registerResource(
      'diffusecraft://undo-stack/{document-id}',
      (_uri, query, ctx) => {
        const document_id = String(query['document-id'] ?? '');
        if (!document_id) return null;
        const limit =
          typeof query['limit'] === 'string' ? Number(query['limit']) : undefined;
        const cursor =
          typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
        const fields = parseFieldsQuery(query['fields']);
        return readUndoStack(undo, ctx, {
          document_id,
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(fields !== undefined ? { fields } : {}),
        });
      },
    );
    transports.inMemory.registerResource(
      'diffusecraft://redo-stack/{document-id}',
      (_uri, query, ctx) => {
        const document_id = String(query['document-id'] ?? '');
        if (!document_id) return null;
        const limit =
          typeof query['limit'] === 'string' ? Number(query['limit']) : undefined;
        const cursor =
          typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
        const fields = parseFieldsQuery(query['fields']);
        return readRedoStack(undo, ctx, {
          document_id,
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(fields !== undefined ? { fields } : {}),
        });
      },
    );

    // Generate a placeholder boot id for logs.
    logger.info({ boot_id: newId(), host: this.config.host_name }, 'server bootstrap complete');

    return {
      db,
      logger,
      bus,
      dispatcher,
      audit,
      assets,
      blobGc,
      comfy,
      jobs,
      history,
      historyGc,
      undo,
      connectionTracker,
      unsubscribeTokenRevoked,
      mdns,
      pairing,
      hooks: this.hooks,
      transports,
      health,
      outputs,
      samplingRegistry,
      chatStore,
    };
  }

  private async rollback(): Promise<void> {
    const i = this.internals;
    if (!i) return;
    try {
      await unmountTransports(i.transports);
    } catch {
      /* ignore */
    }
    try {
      i.pairing.closeAllWindows('stopped');
    } catch {
      /* ignore */
    }
    try {
      i.mdns.stop();
    } catch {
      /* ignore */
    }
    try {
      i.blobGc.stop();
    } catch {
      /* ignore */
    }
    try {
      i.historyGc.stop();
    } catch {
      /* ignore */
    }
    try {
      i.unsubscribeTokenRevoked();
    } catch {
      /* ignore */
    }
    try {
      i.undo.discardAll();
    } catch {
      /* ignore */
    }
    try {
      i.health.stop();
    } catch {
      /* ignore */
    }
    try {
      await i.comfy.stop();
    } catch {
      /* ignore */
    }
    try {
      if (i.db.open) i.db.close();
    } catch {
      /* ignore */
    }
    this.internals = null;
  }

  private requireInternals(): ServerInternals {
    if (!this.internals) {
      throw new Error('server not started; call start() first');
    }
    return this.internals;
  }

  /**
   * Background refresh: poll the comfy bus for the first `comfyui.status`
   * transition to `healthy`, then walk `/object_info` to populate the
   * model registry. Failures are logged and dropped so a missing ComfyUI
   * never gates server startup.
   */
  private refreshModelsWhenReady(
    models: ModelRegistry,
    comfy: ComfyClient,
    logger: Logger,
  ): Promise<void> {
    return models.refresh(comfy).catch((err: unknown) => {
      logger.info(
        { err: (err as Error).message },
        'model registry refresh deferred (ComfyUI not reachable yet)',
      );
    });
  }

  private emit(event: ServerLifecycleEvent): void {
    this.emitter.emit(event.kind, event);
  }
}

/**
 * Decode the `fields` query param shared by every resource that
 * supports field projection (`history/list`, `history/{id}`,
 * `undo-stack/{doc}`, `redo-stack/{doc}`). Accepts either a CSV string
 * (`?fields=a,b,c`) or a repeated-key form (`?fields=a&fields=b`) — the
 * `URLSearchParams`-derived `parseQuery` collapses the latter into
 * `string[]`. Empty / whitespace-only fields are dropped. Returns
 * `undefined` when no filter was supplied so callers can omit the key
 * from the resolver-input object (preserving exactOptionalPropertyTypes
 * compatibility).
 */
function parseFieldsQuery(
  raw: string | string[] | undefined,
): ReadonlyArray<string> | undefined {
  if (raw === undefined) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  const cleaned = parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Create a new server instance. Validates `config` before allocating any
 * resources; rejects with `ConfigValidationError` on malformed config (FR-7).
 */
export function createDiffuseCraftServer(
  config: Partial<ServerConfig> = {},
  options?: { catalog?: CatalogManifest },
): DiffuseCraftServer {
  const parsed = parseServerConfig(config);
  return new DiffuseCraftServerImpl(parsed, options?.catalog ?? DEFAULT_CATALOG);
}

export type { Unsubscribe };
