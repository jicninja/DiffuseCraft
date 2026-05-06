/**
 * Periodic ComfyUI health checks (F.1, F.2, F.3, FR-24, FR-25).
 *
 * Every `interval_ms` (default 30 s) the monitor probes `/system_stats`. On
 * three consecutive failures the status flips from `healthy` → `degraded`;
 * a single success flips it back. Status is exposed by `get_server_info`
 * via `getStatus()` and never causes `comfy.start()` itself to abort.
 *
 * Per FR-25 health failures NEVER auto-restart ComfyUI in external modes
 * (we don't own the process). Managed mode's process supervisor restarts
 * on **exit**, not on health-check failure — the supervisor and the health
 * monitor are intentionally separate concerns.
 */

import type { Logger } from 'pino';

import type { EventBus } from '../events/bus.js';
import type { ComfyClient } from './client.js';
import type { ComfyStatus } from './types.js';

export interface HealthMonitorOptions {
  interval_ms?: number;
  /** Failures in a row before transitioning to `degraded`. */
  failure_threshold?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 3;

export class HealthMonitor {
  private status: ComfyStatus = 'unknown';
  private consecutiveFailures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly comfy: ComfyClient,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly options: HealthMonitorOptions = {},
  ) {}

  /** Start polling. Idempotent. */
  start(): void {
    if (this.timer) return;
    const interval = this.options.interval_ms ?? DEFAULT_INTERVAL_MS;
    // Run the first probe immediately so initial status reflects reality.
    void this.probe();
    this.timer = setInterval(() => {
      void this.probe();
    }, interval);
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Current status — used by `get_server_info` (FR-24). */
  getStatus(): ComfyStatus {
    return this.status;
  }

  /** Force an immediate probe; useful after a known-good state change. */
  async probe(): Promise<ComfyStatus> {
    try {
      await this.comfy.health();
      this.consecutiveFailures = 0;
      if (this.status !== 'healthy') {
        this.transition('healthy');
      }
      return 'healthy';
    } catch (err) {
      this.consecutiveFailures += 1;
      const threshold = this.options.failure_threshold ?? DEFAULT_FAILURE_THRESHOLD;
      if (this.consecutiveFailures >= threshold && this.status !== 'degraded') {
        this.logger.warn({ err, failures: this.consecutiveFailures }, 'comfy health: degraded');
        this.transition('degraded');
      }
      return this.status;
    }
  }

  private transition(next: ComfyStatus): void {
    this.status = next;
    this.bus.publish({ name: 'comfyui.status', payload: { status: next } });
  }
}
