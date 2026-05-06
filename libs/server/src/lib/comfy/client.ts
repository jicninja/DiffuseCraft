/**
 * ComfyUI client (HTTP + WS) — internal only; never exposed to MCP clients
 * (P19, FR-20, B.4).
 *
 * The `ComfyClient` class is the **only** authorised HTTP / WebSocket peer
 * of ComfyUI in the entire codebase. Everything else (job tracker, output
 * fetcher, model registry, validation, graph builders) goes through this
 * single seam. The class is constructed once in `server.ts` and lives for
 * the lifetime of the host.
 *
 * Per FR-20 / B.4 this module is intentionally not re-exported from
 * `libs/server/src/index.ts`. The public-API surface stays tight; the only
 * way in is `createDiffuseCraftServer` / the in-memory MCP transport.
 *
 * Connection modes (FR-1 / FR-2):
 *   - `managed`        → URL is computed from the supervised child process.
 *   - `external-local` → fixed URL, typically `http://127.0.0.1:8188`.
 *   - `external-remote`→ fixed URL on the LAN.
 *
 * Modes are functionally identical from the client's perspective; managed
 * mode just adds lifecycle ownership (see `managed/supervisor.ts`).
 */

import type { Logger } from 'pino';

import type { ComfyConfig } from '../../types/config.js';
import { ComfyEventEmitter } from './events.js';
import { ComfyWsTransport, DEFAULT_WS_OPTIONS, type WsTransportOptions } from './ws.js';
import {
  ComfyError,
  ComfyUnreachableError,
  ComfyValidationError,
} from './errors.js';
import type {
  ComfyGraph,
  ComfySubmitResponse,
  HealthStatus,
  HistoryEntry,
  HistoryResponse,
  NodeCatalog,
  QueueState,
} from './types.js';

// ---------------------------------------------------------------------------
// Public type aliases used by JobTracker. These are kept stable to preserve
// the existing import sites in `lib/jobs/tracker.ts`.
// ---------------------------------------------------------------------------

/** Opaque graph specification produced by the per-verb builders in `graph/`. */
export type GraphSpec = ComfyGraph;

export interface ComfySubmitResult {
  prompt_id: string;
  /** 0 means immediately running; >0 is queue position. */
  queue_position: number;
}

export interface ComfyQueueEntry {
  prompt_id: string;
  position: number;
  status: 'queued' | 'running';
}

export interface ComfyClientOptions {
  /** Default request timeout for HTTP calls; per-call overrides allowed. */
  request_timeout_ms?: number;
  /** Override WebSocket reconnect parameters (test seam). */
  ws?: Partial<WsTransportOptions>;
  /**
   * Test seam: a custom `fetch` implementation. Production code uses the
   * built-in global `fetch` (Node 18+).
   */
  fetch?: typeof fetch;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the HTTP base URL for a given `ComfyConfig`. Managed mode is
 * routed to loopback; the supervisor publishes the actual port via this URL
 * once it has spawned ComfyUI.
 */
export function resolveHttpUrl(config: ComfyConfig, managedPort?: number): string {
  if (config.mode === 'managed') {
    const port = managedPort ?? 8188;
    return `http://127.0.0.1:${port}`;
  }
  return config.url.replace(/\/$/, '');
}

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws') + '/ws';
}

// ---------------------------------------------------------------------------
// ComfyClient
// ---------------------------------------------------------------------------

export class ComfyClient {
  /** Typed event emitter wrapping the ComfyUI WebSocket. */
  public readonly events: ComfyEventEmitter;

  private url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private ws: ComfyWsTransport | null = null;

  constructor(
    private readonly config: ComfyConfig,
    private readonly logger: Logger,
    private readonly options: ComfyClientOptions = {},
  ) {
    this.events = new ComfyEventEmitter();
    this.url = resolveHttpUrl(config);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMs = options.request_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * For managed mode: re-resolve the HTTP URL once the supervisor has
   * chosen a port. Safe to call before `start()`.
   */
  setManagedPort(port: number): void {
    if (this.config.mode === 'managed') {
      this.url = resolveHttpUrl(this.config, port);
    }
  }

  /** Active HTTP base URL (test convenience). */
  getUrl(): string {
    return this.url;
  }

  /**
   * Connect the WebSocket and subscribe to events. HTTP calls work without
   * `start()` — only the event stream needs an active connection.
   */
  async start(): Promise<void> {
    if (this.ws) return;
    this.ws = new ComfyWsTransport(toWsUrl(this.url), this.events, this.logger, {
      ...DEFAULT_WS_OPTIONS,
      ...this.options.ws,
    });
    try {
      await this.ws.start();
      this.logger.info({ url: this.url }, 'comfy client started');
    } catch (err) {
      this.logger.warn({ err }, 'comfy ws failed to attach; HTTP still usable');
    }
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.stop();
      this.ws = null;
    }
    this.events.removeAllListeners();
    this.logger.info('comfy client stopped');
  }

  // ---- HTTP surface (FR-21) ----------------------------------------------

  /**
   * POST `/prompt` — submit a graph for execution. ComfyUI returns the
   * `prompt_id` and a `number` (queue position). 4xx with `node_errors`
   * indicates validation rejection; we surface that as `ComfyValidationError`
   * so callers can distinguish it from network failure.
   */
  async submitGraph(graph: GraphSpec): Promise<ComfySubmitResult> {
    const body = JSON.stringify({ prompt: graph });
    const res = await this.request('/prompt', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    const text = await res.text();
    let parsed: Partial<ComfySubmitResponse>;
    try {
      parsed = JSON.parse(text) as Partial<ComfySubmitResponse>;
    } catch {
      throw new ComfyError(`comfy /prompt returned non-JSON body: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !parsed.prompt_id) {
      const node_errors = parsed.node_errors ?? {};
      throw new ComfyValidationError(node_errors as Record<string, unknown>, `comfy rejected graph (status=${res.status})`);
    }
    return {
      prompt_id: parsed.prompt_id,
      queue_position: typeof parsed.number === 'number' ? parsed.number : 0,
    };
  }

  /** POST `/interrupt` — cancel the **currently running** prompt. */
  async interrupt(_prompt_id: string): Promise<void> {
    // ComfyUI's /interrupt is global: it cancels whatever is running. The
    // tracker dispatches to either `interrupt` or `dequeue` based on status.
    void _prompt_id;
    await this.request('/interrupt', { method: 'POST' });
  }

  /** POST `/queue` with `delete: [prompt_id]` — remove a queued prompt. */
  async dequeue(prompt_id: string): Promise<void> {
    const body = JSON.stringify({ delete: [prompt_id] });
    await this.request('/queue', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  }

  /** GET `/queue` — return a flat list of running + queued entries. */
  async getQueue(): Promise<readonly ComfyQueueEntry[]> {
    const res = await this.request('/queue', { method: 'GET' });
    const json = (await res.json()) as Partial<QueueState>;
    const running = (json.queue_running ?? []) as ReadonlyArray<ReadonlyArray<unknown>>;
    const pending = (json.queue_pending ?? []) as ReadonlyArray<ReadonlyArray<unknown>>;
    const out: ComfyQueueEntry[] = [];
    for (const entry of running) {
      const [num, prompt_id] = entry as [number, string, ...unknown[]];
      out.push({ prompt_id, position: Number(num) || 0, status: 'running' });
    }
    pending.forEach((entry, idx) => {
      const [num, prompt_id] = entry as [number, string, ...unknown[]];
      out.push({ prompt_id, position: Number(num) || idx + 1, status: 'queued' });
    });
    return out;
  }

  /** GET `/object_info` — returns the full node-class catalog. */
  async getObjectInfo(): Promise<NodeCatalog> {
    const res = await this.request('/object_info', { method: 'GET' });
    return (await res.json()) as NodeCatalog;
  }

  /**
   * GET `/system_stats` — health probe (FR-24). Throws
   * `ComfyUnreachableError` on timeout / connection refused; throws
   * `ComfyError` on non-2xx responses.
   */
  async health(): Promise<HealthStatus> {
    let res: Response;
    try {
      res = await this.request('/system_stats', { method: 'GET' }, 2_000);
    } catch (err) {
      if (err instanceof ComfyError) throw err;
      throw new ComfyUnreachableError('comfy /system_stats unreachable', { cause: err });
    }
    if (!res.ok) throw new ComfyError(`comfy /system_stats returned ${res.status}`);
    return (await res.json()) as HealthStatus;
  }

  /**
   * GET `/history/<prompt_id>` — used by `output-fetcher` to discover the
   * filenames ComfyUI saved.
   */
  async getHistory(prompt_id: string): Promise<HistoryEntry | null> {
    const res = await this.request(`/history/${encodeURIComponent(prompt_id)}`, { method: 'GET' });
    if (!res.ok) return null;
    const json = (await res.json()) as HistoryResponse;
    return json[prompt_id] ?? null;
  }

  /**
   * GET `/view?filename=...&subfolder=...&type=output` — fetch a single
   * output image as bytes (for the colocated case the server can prefer a
   * filesystem read; the HTTP path is the cross-machine fallback).
   */
  async fetchOutput(args: { filename: string; subfolder?: string; type?: string }): Promise<Uint8Array> {
    const params = new URLSearchParams();
    params.set('filename', args.filename);
    if (args.subfolder !== undefined) params.set('subfolder', args.subfolder);
    params.set('type', args.type ?? 'output');
    const res = await this.request(`/view?${params.toString()}`, { method: 'GET' });
    if (!res.ok) throw new ComfyError(`comfy /view returned ${res.status} for ${args.filename}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  // Convenience kept for backward compat with handlers that listed models
  // through the client. The model-registry path uses `getObjectInfo()`
  // directly; this helper returns an empty list rather than failing.
  async listModels(): Promise<readonly { name: string; type: string; size: number }[]> {
    return [];
  }

  // ---- internal -----------------------------------------------------------

  /**
   * Issue an HTTP request with a timeout-aware abort signal. Wraps every
   * non-`ComfyError` failure in `ComfyUnreachableError` so callers can
   * branch reliably on transport vs application failures.
   */
  private async request(
    path: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<Response> {
    const ms = timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await this.fetchImpl(`${this.url}${path}`, { ...init, signal: controller.signal });
      return res;
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new ComfyUnreachableError(`comfy request timed out after ${ms}ms (${path})`, { cause: err });
      }
      throw new ComfyUnreachableError(`comfy request failed (${path})`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports kept for backward compat with existing import sites.
// ---------------------------------------------------------------------------

export type {
  ComfyExecutedEvent,
  ComfyExecutionErrorEvent as ComfyErrorEvent,
  ComfyProgressEvent,
} from './types.js';
