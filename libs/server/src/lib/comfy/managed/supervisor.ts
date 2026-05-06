/**
 * Managed-mode process supervisor (E.1–E.6, FR-6).
 *
 * Spawns the ComfyUI child process bound to `127.0.0.1` (loopback only —
 * the server is the *only* legal client; clients reach the server). Pipes
 * stdout / stderr into the host logger with a `comfy:` prefix. Restarts on
 * unexpected exit up to `MAX_RESTARTS`; exhausting the budget emits
 * `comfyui.crashed-permanently` and refuses to spawn again until the next
 * server restart.
 *
 * Lifecycle (design.md §4):
 *   - `start()` — spawn + wait for `/system_stats` to return 200.
 *   - `stop()`  — SIGTERM → wait 10 s → SIGKILL (FR-6).
 *
 * Test seam: `spawn` and a `healthProbe` callback can be injected so unit
 * tests can drive the supervisor with a mock child process and a mock
 * health endpoint.
 */

import * as child_process from 'node:child_process';
import * as path from 'node:path';

import type { Logger } from 'pino';

import type { EventBus } from '../../events/bus.js';
import { ComfyError } from '../errors.js';

export type HealthProbe = () => Promise<boolean>;

export interface SupervisorOptions {
  install_dir: string;
  port: number;
  bus: EventBus;
  logger: Logger;
  /** Probe returns `true` once ComfyUI's `/system_stats` is reachable. */
  health_probe: HealthProbe;
  /** Override the maximum restart budget (default 3, FR-6). */
  max_restarts?: number;
  /** Initial restart backoff in ms (linear: `attempt * backoff`). */
  restart_backoff_ms?: number;
  /** Timeout to wait for the health probe before declaring failure. */
  startup_health_timeout_ms?: number;
  /** Test seam. */
  spawn?: typeof child_process.spawn;
  /** SIGTERM grace period before SIGKILL (default 10_000 ms, FR-6). */
  shutdown_grace_ms?: number;
}

export class ComfySupervisor {
  private child: ReturnType<typeof child_process.spawn> | null = null;
  private restartAttempts = 0;
  private shouldRun = false;
  private permanentFailure = false;

  constructor(private readonly options: SupervisorOptions) {}

  /** True iff the supervisor exhausted its restart budget. */
  get crashedPermanently(): boolean {
    return this.permanentFailure;
  }

  /**
   * Spawn ComfyUI and wait for it to become healthy. Resolves once
   * `health_probe` returns `true` at least once. Restarts are scheduled
   * automatically on unexpected exit.
   */
  async start(): Promise<void> {
    if (this.permanentFailure) {
      throw new ComfyError('supervisor: refusing to start after permanent failure (restart server)');
    }
    if (this.child) return; // already running
    this.shouldRun = true;
    this.restartAttempts = 0;
    this.spawn();
    await this.waitForHealth();
  }

  /**
   * Stop the child gracefully. SIGTERM → wait `shutdown_grace_ms` →
   * SIGKILL. Idempotent.
   */
  async stop(): Promise<void> {
    this.shouldRun = false;
    const child = this.child;
    if (!child) return;
    const grace = this.options.shutdown_grace_ms ?? 10_000;
    return new Promise<void>((resolve) => {
      let resolved = false;
      const finish = (): void => {
        if (resolved) return;
        resolved = true;
        this.child = null;
        resolve();
      };
      child.once('exit', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        finish();
      }, grace);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
    });
  }

  // ---- internal -----------------------------------------------------------

  private spawn(): void {
    const spawn = this.options.spawn ?? child_process.spawn;
    const venvPython = process.platform === 'win32'
      ? path.join(this.options.install_dir, 'venv', 'Scripts', 'python.exe')
      : path.join(this.options.install_dir, 'venv', 'bin', 'python');
    const main = path.join(this.options.install_dir, 'main.py');
    const child = spawn(
      venvPython,
      [main, '--listen', '127.0.0.1', '--port', String(this.options.port)],
      { cwd: this.options.install_dir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      this.options.logger.info({ src: 'comfy.stdout' }, chunk.toString('utf8').trim());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.options.logger.warn({ src: 'comfy.stderr' }, chunk.toString('utf8').trim());
    });
    child.on('exit', (code, signal) => {
      this.child = null;
      if (!this.shouldRun) return; // graceful shutdown
      this.options.bus.publish({
        name: 'comfyui.process.exited',
        payload: { code, signal, attempt: this.restartAttempts },
      });
      this.maybeRestart();
    });
  }

  private maybeRestart(): void {
    const max = this.options.max_restarts ?? 3;
    if (this.restartAttempts >= max) {
      this.permanentFailure = true;
      this.shouldRun = false;
      this.options.bus.publish({
        name: 'comfyui.crashed-permanently',
        payload: { attempts: this.restartAttempts },
      });
      return;
    }
    this.restartAttempts += 1;
    const backoff = (this.options.restart_backoff_ms ?? 5_000) * this.restartAttempts;
    const timer = setTimeout(() => {
      if (!this.shouldRun) return;
      this.spawn();
    }, backoff);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  }

  private async waitForHealth(): Promise<void> {
    const timeout = this.options.startup_health_timeout_ms ?? 60_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.options.health_probe()) return;
      } catch {
        /* retry */
      }
      await sleep(500);
    }
    throw new ComfyError(`supervisor: ComfyUI did not become healthy within ${timeout}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
  });
}
