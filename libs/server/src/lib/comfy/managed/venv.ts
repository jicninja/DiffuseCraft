/**
 * Python venv management for managed-mode installs (D.2, FR-3, Q3).
 *
 * Per Q3 we use a managed venv (not the user's system Python) so a stale
 * `numpy` or a Python 3.13 default doesn't break ComfyUI silently. The
 * minimum supported Python is `3.10` (`required-versions.ts`).
 *
 * This module is a thin wrapper over `child_process.spawn` so the heavy
 * lifting (downloading wheels, resolving requirements) is delegated to
 * `python -m venv` + `pip` themselves. Everything is async + cancellable
 * via `AbortSignal`.
 *
 * Deferred: Windows install paths. macOS + Linux ship in v0.1; Windows
 * lands in v0.2 (D.8).
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ComfyError } from '../errors.js';
import { PINNED_VERSIONS } from '../required-versions.js';

export interface VenvOptions {
  /** Absolute path to the directory the venv should live in. */
  install_dir: string;
  /** Optional cancellation signal (e.g. server shutdown mid-install). */
  signal?: AbortSignal;
  /** Test seam: a `child_process.spawn` replacement. */
  spawn?: typeof child_process.spawn;
}

/**
 * Locate a Python interpreter on PATH that satisfies the minimum version.
 * Returns the executable path. Throws `ComfyError` with an actionable
 * message if no suitable interpreter is found.
 */
export async function findPython(opts?: { spawn?: typeof child_process.spawn }): Promise<string> {
  const spawn = opts?.spawn ?? child_process.spawn;
  const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3', 'python'];
  const [minMajor, minMinor] = PINNED_VERSIONS.python_min_version;
  for (const candidate of candidates) {
    const version = await tryGetPythonVersion(candidate, spawn);
    if (!version) continue;
    if (version[0] > minMajor || (version[0] === minMajor && version[1] >= minMinor)) {
      return candidate;
    }
  }
  throw new ComfyError(
    `Python ${minMajor}.${minMinor}+ not found on PATH. Install Python from https://www.python.org/downloads/ and retry. ` +
      `Bundling Python is post-v1; managed mode requires the user to provide an interpreter.`,
  );
}

async function tryGetPythonVersion(
  exe: string,
  spawn: typeof child_process.spawn,
): Promise<readonly [number, number] | null> {
  return await new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(exe, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const match = /Python\s+(\d+)\.(\d+)/.exec(out);
      if (!match) {
        resolve(null);
        return;
      }
      resolve([Number(match[1]), Number(match[2])] as const);
    });
  });
}

/**
 * Create a Python venv inside `install_dir/venv`. Idempotent: re-running
 * after a successful create is a fast no-op.
 */
export async function createVenv(options: VenvOptions): Promise<{ python: string }> {
  const venvDir = path.join(options.install_dir, 'venv');
  // If the venv already exists with a working interpreter, reuse it.
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  try {
    await fs.access(venvPython);
    return { python: venvPython };
  } catch {
    /* needs creation */
  }
  const sysPython = await findPython({ ...(options.spawn ? { spawn: options.spawn } : {}) });
  await fs.mkdir(options.install_dir, { recursive: true });
  await runOrThrow(sysPython, ['-m', 'venv', venvDir], options);
  return { python: venvPython };
}

/**
 * Install a list of `pip install` arguments inside the venv. Each argument
 * list is run as a separate `pip install` invocation so a single failure
 * is attributable.
 */
export async function pipInstall(
  venvPython: string,
  argsList: ReadonlyArray<ReadonlyArray<string>>,
  options: VenvOptions,
): Promise<void> {
  for (const args of argsList) {
    await runOrThrow(venvPython, ['-m', 'pip', 'install', ...args], options);
  }
}

async function runOrThrow(exe: string, args: ReadonlyArray<string>, options: VenvOptions): Promise<void> {
  const spawn = options.spawn ?? child_process.spawn;
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
      reject(new ComfyError('venv operation aborted'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    proc.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new ComfyError(`venv operation failed (${exe}): ${(err as Error).message}`, { cause: err }));
    });
    proc.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new ComfyError(`venv operation exited with code ${code}\n${stderr.slice(0, 4_000)}`));
    });
  });
}
