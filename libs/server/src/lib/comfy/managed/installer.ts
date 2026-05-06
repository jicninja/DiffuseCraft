/**
 * Managed-mode installer (D.1, D.3, D.4, D.5, D.7, FR-3, FR-4, FR-5).
 *
 * Pipeline (design.md §4):
 *   1. Check `<install_dir>/.installed` marker.
 *   2. If missing or version mismatch:
 *        a. git clone ComfyUI at the pinned commit.
 *        b. Create venv + pip install requirements.txt.
 *        c. Clone each required custom-node at its pinned commit.
 *        d. pip install per-custom-node requirements.txt.
 *        e. Download default models (FR-15).
 *        f. Write `.installed` marker with version metadata.
 *   3. Emit `comfyui.install.starting` / `.completed` / `.failed`.
 *
 * `installer.ts` owns the orchestration; `venv.ts` does the Python side.
 * Default-models download is delegated to `models/downloader.ts` (Phase G).
 *
 * Test seam: `spawn` and `fetch` can be injected so the installer can be
 * unit-tested without actually shelling out to git / pip / huggingface.
 *
 * NOTE: bandwidth and install duration cannot be tested cheaply; the
 * integration suite for D.8 runs against a real machine.
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Logger } from 'pino';

import type { EventBus } from '../../events/bus.js';
import { ComfyError } from '../errors.js';
import { REQUIRED_NODES } from '../required-nodes.js';
import {
  PINNED_VERSIONS,
  isPinnedCommitPlaceholder,
} from '../required-versions.js';
import { createVenv, pipInstall } from './venv.js';

export interface InstallerOptions {
  install_dir: string;
  bus: EventBus;
  logger: Logger;
  /** Skip default-model download (FR-15 mitigation, `--no-default-models`). */
  skip_default_models?: boolean;
  /** Test seam: a `child_process.spawn` replacement. */
  spawn?: typeof child_process.spawn;
  /** Cancellation. */
  signal?: AbortSignal;
}

export interface InstallMarker {
  /** Pinned ComfyUI commit hash this install corresponds to. */
  comfyui_commit: string;
  /** Per-required-node pinned commit hashes (parallel array). */
  custom_nodes: ReadonlyArray<{ name: string; commit: string }>;
  /** Wall-clock UTC ISO of when the install completed. */
  installed_at: string;
}

const MARKER_FILE = '.installed';

/**
 * Run a fresh install (or a no-op fast path if `.installed` matches the
 * pinned versions). Idempotent on success.
 */
export async function ensureInstalled(opts: InstallerOptions): Promise<InstallMarker> {
  if (isPinnedCommitPlaceholder()) {
    throw new ComfyError(
      'managed-mode refused: PINNED_VERSIONS.comfyui_commit is the placeholder. ' +
        'A release captain must replace it with a real commit hash before managed mode can run.',
    );
  }

  const existing = await readMarker(opts.install_dir);
  if (existing && markerMatches(existing)) {
    opts.logger.info({ marker: existing }, 'comfy installer: marker matches; skipping install');
    return existing;
  }

  opts.bus.publish({ name: 'comfyui.install.starting', payload: { install_dir: opts.install_dir } });
  try {
    await fs.mkdir(opts.install_dir, { recursive: true });

    // Step 1 — clone ComfyUI at the pinned commit.
    await gitCloneAtCommit(
      PINNED_VERSIONS.comfyui_repo,
      PINNED_VERSIONS.comfyui_commit,
      opts.install_dir,
      opts,
    );

    // Step 2 — venv + pip install requirements.
    const { python } = await createVenv({
      install_dir: opts.install_dir,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.spawn ? { spawn: opts.spawn } : {}),
    });
    await pipInstall(python, [['-r', path.join(opts.install_dir, 'requirements.txt')]], {
      install_dir: opts.install_dir,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.spawn ? { spawn: opts.spawn } : {}),
    });

    // Step 3+4 — clone each required custom-node at its pinned commit + pip install its requirements.
    const customNodesDir = path.join(opts.install_dir, 'custom_nodes');
    await fs.mkdir(customNodesDir, { recursive: true });
    for (const node of REQUIRED_NODES) {
      const target = path.join(customNodesDir, slugify(node.name));
      await gitCloneAtCommit(node.repo, node.commit, target, opts);
      const reqFile = path.join(target, 'requirements.txt');
      try {
        await fs.access(reqFile);
        await pipInstall(python, [['-r', reqFile]], {
          install_dir: opts.install_dir,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.spawn ? { spawn: opts.spawn } : {}),
        });
      } catch {
        // Custom nodes without a requirements.txt are valid; skip silently.
      }
    }

    // Step 5 — default models (delegated to ModelDownloader; out of scope
    // for the installer surface to keep the dependency graph linear).
    // The supervisor invokes the downloader after `ensureInstalled` returns;
    // the marker is written before the downloads so a partial download does
    // not force a full reinstall on the next launch.
    void opts.skip_default_models;

    // Step 6 — write the marker.
    const marker: InstallMarker = {
      comfyui_commit: PINNED_VERSIONS.comfyui_commit,
      custom_nodes: REQUIRED_NODES.map((n) => ({ name: n.name, commit: n.commit })),
      installed_at: new Date().toISOString(),
    };
    await writeMarker(opts.install_dir, marker);

    opts.bus.publish({
      name: 'comfyui.install.completed',
      payload: { install_dir: opts.install_dir, marker },
    });
    return marker;
  } catch (err) {
    opts.bus.publish({
      name: 'comfyui.install.failed',
      payload: { install_dir: opts.install_dir, error: errorPayload(err) },
    });
    throw err instanceof ComfyError ? err : new ComfyError(`install failed: ${(err as Error).message}`, { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Internals (exported for tests where useful)
// ---------------------------------------------------------------------------

async function readMarker(installDir: string): Promise<InstallMarker | null> {
  try {
    const body = await fs.readFile(path.join(installDir, MARKER_FILE), 'utf8');
    return JSON.parse(body) as InstallMarker;
  } catch {
    return null;
  }
}

async function writeMarker(installDir: string, marker: InstallMarker): Promise<void> {
  await fs.writeFile(path.join(installDir, MARKER_FILE), JSON.stringify(marker, null, 2), 'utf8');
}

function markerMatches(marker: InstallMarker): boolean {
  if (marker.comfyui_commit !== PINNED_VERSIONS.comfyui_commit) return false;
  if (marker.custom_nodes.length !== REQUIRED_NODES.length) return false;
  for (const required of REQUIRED_NODES) {
    const recorded = marker.custom_nodes.find((c) => c.name === required.name);
    if (!recorded || recorded.commit !== required.commit) return false;
  }
  return true;
}

async function gitCloneAtCommit(
  repo: string,
  commit: string,
  target: string,
  opts: InstallerOptions,
): Promise<void> {
  const spawn = opts.spawn ?? child_process.spawn;
  // Clone (shallow + fetch the specific commit if shallow refuses → full clone).
  await runOrThrow(spawn, 'git', ['clone', repo, target], opts);
  await runOrThrow(spawn, 'git', ['-C', target, 'checkout', commit], opts);
}

async function runOrThrow(
  spawn: typeof child_process.spawn,
  exe: string,
  args: ReadonlyArray<string>,
  opts: InstallerOptions,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(exe, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const onAbort = (): void => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      reject(new ComfyError(`install operation aborted (${exe})`));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    proc.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new ComfyError(`install operation failed (${exe}): ${(err as Error).message}`, { cause: err }));
    });
    proc.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new ComfyError(`install operation exited with code ${code}\n${stderr.slice(0, 4_000)}`));
    });
  });
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function errorPayload(err: unknown): { message: string; cause?: unknown } {
  if (err instanceof Error) return { message: err.message, cause: (err as { cause?: unknown }).cause };
  return { message: String(err) };
}
