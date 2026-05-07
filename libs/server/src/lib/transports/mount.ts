/**
 * Transport orchestrator.
 *
 * Mounts every configured transport at start, in the order described in
 * design.md §4.1. The in-memory transport is constructed unconditionally;
 * stdio + HTTP are conditional on `ServerConfig.transports`.
 */

import type { Logger } from 'pino';
import type { Database as DB } from 'better-sqlite3';
import type { ServerConfig } from '../../types/config.js';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import type { PairingManager } from '../pairing/manager.js';
import type { MountedTransports } from '../../types/lifecycle.js';
import type { ConnectionTracker } from './connection-tracker.js';
import type { UndoRedoManagerLike } from '../../types/handler-context.js';
import type { CatalogManifest } from '../catalog/types.js';
import type { InMemorySamplingRegistry } from '../sampling/registry.js';
import { InMemoryTransport } from './in-memory.js';
import { StdioTransport } from './stdio.js';
import { HttpTransport } from './http.js';

export interface MountedTransportSet {
  inMemory: InMemoryTransport;
  stdio?: StdioTransport;
  http?: HttpTransport;
  describe(): MountedTransports;
}

export interface MountArgs {
  config: ServerConfig;
  db: DB;
  dispatcher: HandlerDispatcher;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  /**
   * Pairing manager used by the HTTP transport's anonymous `/pair` endpoint
   * (pairing-protocol C.1). Optional so existing tests that bypass pairing
   * can still mount the transport set.
   */
  pairing?: PairingManager;
  /**
   * Per-token session tracker (undo-redo-system A.5). When supplied, the
   * HTTP transport calls `acquire(token_id)` / `release(token_id)` around
   * each authenticated `POST /mcp` request so the {@link UndoRedoManager}'s
   * disconnect-grace timer arms / re-arms appropriately. Optional so
   * existing tests can mount transports without an undo manager.
   */
  connectionTracker?: ConnectionTracker;
  /**
   * Undo/redo manager facade (undo-redo-system FR-34). When supplied,
   * every transport stamps `ctx.undoRedo` with this reference so
   * reversible handlers can invoke `ctx.undoRedo.execute(...)`.
   * Optional so existing tests that mount transports without the full
   * server bootstrap keep working — handlers that don't touch the
   * field stay unaffected; reversible handlers that do touch it will
   * surface a clear error from the per-transport stub.
   */
  undoRedo?: UndoRedoManagerLike;
  /** Catalog used by the SDK transports for `tools/list` + `resources/list`. */
  catalog: CatalogManifest;
  /** Sampling registry — sampling-capable peers register here when they connect. */
  samplingRegistry?: InMemorySamplingRegistry;
  /** Server identity surfaced in MCP `initialize` responses. */
  serverInfo: { name: string; version: string };
}

export async function mountTransports(args: MountArgs): Promise<MountedTransportSet> {
  const {
    config,
    db,
    dispatcher,
    bus,
    audit,
    logger,
    pairing,
    connectionTracker,
    undoRedo,
    catalog,
    samplingRegistry,
    serverInfo,
  } = args;

  const inMemory = new InMemoryTransport(
    dispatcher,
    bus,
    audit,
    logger,
    {
      in_memory_token_name: config.in_memory_token_name,
      host_name: config.host_name,
    },
    undoRedo,
  );

  let stdio: StdioTransport | undefined;
  if (config.transports.stdio) {
    stdio = new StdioTransport({
      catalog,
      dispatcher,
      bus,
      audit,
      logger,
      resources: inMemory,
      serverInfo,
      ...(undoRedo ? { undoRedo } : {}),
      ...(samplingRegistry ? { samplingRegistry } : {}),
    });
    await stdio.start();
  }

  let http: HttpTransport | undefined;
  let httpUrl: string | undefined;
  if (config.transports.http) {
    http = new HttpTransport(db, dispatcher, bus, audit, logger, {
      host: config.transports.http.host,
      port: config.transports.http.port,
      body_limit_bytes: config.comfyui_proxy.rate_limits.max_payload_bytes,
      catalog,
      resources: inMemory,
      serverInfo,
      ...(pairing ? { pairing } : {}),
      ...(connectionTracker ? { connectionTracker } : {}),
      ...(undoRedo ? { undoRedo } : {}),
      ...(samplingRegistry ? { samplingRegistry } : {}),
    });
    const r = await http.start();
    httpUrl = r.url;
  }

  return {
    inMemory,
    ...(stdio ? { stdio } : {}),
    ...(http ? { http } : {}),
    describe(): MountedTransports {
      return {
        inMemory: true as const,
        stdio: !!stdio,
        ...(httpUrl ? { http: { url: httpUrl } } : {}),
      };
    },
  };
}

export async function unmountTransports(set: MountedTransportSet): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (set.http) tasks.push(set.http.stop());
  if (set.stdio) tasks.push(set.stdio.stop());
  await Promise.allSettled(tasks);
}
