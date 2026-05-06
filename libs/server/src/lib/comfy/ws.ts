/**
 * ComfyUI WebSocket transport (B.2, FR-22, FR-23, NFR-3).
 *
 * Subscribes to `/ws` on ComfyUI, parses incoming messages, and re-emits
 * them as typed events on `ComfyEventEmitter`. Auto-reconnects on
 * disconnect with exponential backoff; on each successful re-attach,
 * publishes an `open` event so the surrounding code can run reconciliation
 * (`JobTracker.reconcileOnStartup` is the canonical reconciler).
 *
 * Internal: NOT exported from `libs/server/src/index.ts`.
 *
 * The dependency on `ws` is lazy-required in `start()` so the rest of the
 * server still works in environments where ComfyUI is unreachable (the
 * client surface is constructed up-front; only `start()` needs the dep).
 */

import type { Logger } from 'pino';
import type { ComfyEventEmitter } from './events.js';
import type { ComfyWsMessage } from './types.js';

interface WsClient {
  readyState: 0 | 1 | 2 | 3;
  on(event: 'message', listener: (data: unknown, isBinary?: boolean) => void): WsClient;
  on(event: 'open', listener: () => void): WsClient;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): WsClient;
  on(event: 'error', listener: (err: Error) => void): WsClient;
  close(code?: number, reason?: string): void;
}

type WsCtor = new (url: string, opts?: { headers?: Record<string, string> }) => WsClient;

export interface WsTransportOptions {
  /**
   * Maximum number of reconnect attempts (FR-23). After exhaustion the
   * transport stays disconnected; the next call to `start()` resets the
   * counter.
   */
  max_reconnect_attempts: number;
  /** Initial reconnect delay in ms (doubles each attempt, capped). */
  initial_backoff_ms: number;
  /** Cap on exponential backoff in ms. */
  max_backoff_ms: number;
}

export const DEFAULT_WS_OPTIONS: WsTransportOptions = {
  max_reconnect_attempts: 5,
  initial_backoff_ms: 500,
  max_backoff_ms: 10_000,
};

/**
 * Test seam: tests inject a mock WS class without touching the package
 * loader. Production paths leave this `null` so `lazyLoadWsCtor()` returns
 * the real `ws` module.
 */
let wsCtorOverride: WsCtor | null = null;

/** Test-only: override the `ws` constructor used by every new transport. */
export function __setWsCtorForTests(ctor: WsCtor | null): void {
  wsCtorOverride = ctor;
}

async function lazyLoadWsCtor(): Promise<WsCtor> {
  if (wsCtorOverride) return wsCtorOverride;
  const mod = (await import('ws')) as { default: WsCtor };
  return mod.default;
}

/**
 * Long-lived ComfyUI WebSocket subscription. Owns the reconnect loop.
 */
export class ComfyWsTransport {
  private ws: WsClient | null = null;
  private shouldRun = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly events: ComfyEventEmitter,
    private readonly logger: Logger,
    private readonly options: WsTransportOptions = DEFAULT_WS_OPTIONS,
  ) {}

  /**
   * Open the WebSocket and start the reconnect loop. Resolves once the
   * first connection completes (or rejects if the first attempt errors
   * synchronously). Subsequent reconnects happen in the background.
   */
  async start(): Promise<void> {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.reconnectAttempt = 0;
    await this.connect();
  }

  /** Stop the loop and close the underlying socket. Idempotent. */
  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && this.ws.readyState !== 3 /* CLOSED */) {
      try {
        this.ws.close(1000, 'shutdown');
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  /** True iff the underlying socket is in OPEN state. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
  }

  // ---- internal -----------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.shouldRun) return;
    const Ctor = await lazyLoadWsCtor();
    const ws = new Ctor(this.url);
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.events.emit('open', undefined as never);
    });
    ws.on('message', (raw: unknown) => this.onMessage(raw));
    ws.on('error', (err: Error) => {
      this.logger.warn({ err }, 'comfy ws error');
    });
    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason ? reason.toString('utf8') : undefined;
      this.events.emit('close', reasonStr === undefined ? { code } : { code, reason: reasonStr });
      this.ws = null;
      if (this.shouldRun) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.options.max_reconnect_attempts) {
      this.logger.error(
        { attempts: this.reconnectAttempt },
        'comfy ws: max reconnect attempts exhausted; giving up until next start()',
      );
      this.shouldRun = false;
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.options.initial_backoff_ms * 2 ** (this.reconnectAttempt - 1),
      this.options.max_backoff_ms,
    );
    this.events.emit('reconnecting', { attempt: this.reconnectAttempt, delay_ms: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => {
        this.logger.error({ err }, 'comfy ws: reconnect threw; will retry');
        this.scheduleReconnect();
      });
    }, delay);
    // Allow the process to exit even if the timer is still pending
    // (important when the server is shutting down during a reconnect wait).
    if (typeof (this.reconnectTimer as { unref?: () => void }).unref === 'function') {
      (this.reconnectTimer as { unref: () => void }).unref();
    }
  }

  private onMessage(raw: unknown): void {
    let parsed: ComfyWsMessage | null = null;
    try {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : null;
      if (!text) return; // binary frames are output images; we fetch via /view instead
      const obj = JSON.parse(text) as { type?: string; data?: unknown };
      parsed = this.normalize(obj);
    } catch (err) {
      this.logger.debug({ err }, 'comfy ws: failed to parse message');
      return;
    }
    if (!parsed) return;
    switch (parsed.type) {
      case 'progress':
        this.events.emit('progress', parsed.data);
        return;
      case 'executed':
        this.events.emit('executed', parsed.data);
        return;
      case 'executing':
        this.events.emit('executing', parsed.data);
        return;
      case 'execution_error':
        this.events.emit('execution_error', parsed.data);
        return;
      case 'execution_cached':
        this.events.emit('execution_cached', parsed.data);
        return;
      case 'status':
        this.events.emit('status', parsed.data);
        return;
    }
  }

  /**
   * Best-effort coercion of a raw WS payload into the typed
   * `ComfyWsMessage`. Returns `null` for unrecognised messages so the caller
   * drops them silently.
   */
  private normalize(obj: { type?: string; data?: unknown }): ComfyWsMessage | null {
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return null;
    const data = (obj.data ?? {}) as Record<string, unknown>;
    switch (obj.type) {
      case 'progress': {
        const prompt_id = String(data['prompt_id'] ?? '');
        if (!prompt_id) return null;
        const node_id = data['node'] !== undefined ? String(data['node']) : undefined;
        return {
          type: 'progress',
          data: {
            prompt_id,
            ...(node_id !== undefined ? { node_id } : {}),
            step: Number(data['value'] ?? 0),
            max_steps: Number(data['max'] ?? 0),
          },
        };
      }
      case 'executed': {
        const prompt_id = String(data['prompt_id'] ?? '');
        if (!prompt_id) return null;
        const outputs = (data['output'] ?? data['outputs'] ?? {}) as Record<string, unknown>;
        return { type: 'executed', data: { prompt_id, outputs } };
      }
      case 'executing': {
        const prompt_id = String(data['prompt_id'] ?? '');
        if (!prompt_id) return null;
        const node_raw = data['node'];
        const node_id = node_raw === null || node_raw === undefined ? null : String(node_raw);
        return { type: 'executing', data: { prompt_id, node_id } };
      }
      case 'execution_error': {
        const prompt_id = String(data['prompt_id'] ?? '');
        if (!prompt_id) return null;
        const message = String(data['exception_message'] ?? data['message'] ?? 'execution error');
        return {
          type: 'execution_error',
          data: { prompt_id, message, cause: data['exception_type'] ?? null },
        };
      }
      case 'execution_cached': {
        const prompt_id = String(data['prompt_id'] ?? '');
        if (!prompt_id) return null;
        const nodes = Array.isArray(data['nodes']) ? (data['nodes'] as unknown[]).map(String) : [];
        return { type: 'execution_cached', data: { prompt_id, nodes } };
      }
      case 'status': {
        const exec = (data['status'] as { exec_info?: { queue_remaining?: number } } | undefined)?.exec_info;
        return {
          type: 'status',
          data: { exec_info: { queue_remaining: Number(exec?.queue_remaining ?? 0) } },
        };
      }
      default:
        return null;
    }
  }
}
