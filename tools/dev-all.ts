#!/usr/bin/env tsx
/**
 * Unified dev launcher.
 *
 * Spawns the DiffuseCraft Node server and the Expo Metro bundler / iOS
 * dev build side-by-side with prefixed log streams. ComfyUI itself is
 * NOT auto-started — it is an external Python process and the server
 * connects to whatever URL is configured (default `http://127.0.0.1:8188`).
 *
 * Behaviour:
 *   - Each child gets a colored `[server] ` / `[mobile]` prefix on every
 *     stdout/stderr line so interleaved logs stay readable.
 *   - Ctrl-C propagates SIGINT to both children before exiting.
 *   - If any child exits non-zero, the launcher kills the other and
 *     exits with the failing code.
 *
 * Default behaviour (no flags): server + iOS + web — i.e., everything.
 * For "just this one thing" use the dedicated npm scripts (`dev:server`,
 * `dev:web`, `dev:ios`, etc.) which spawn a single process directly,
 * without going through this launcher.
 *
 * Flags:
 *   --no-server   skip booting `apps/server`
 *   --no-mobile   skip booting the native mobile target (iOS/Android)
 *   --no-web      skip booting Expo Web (port 8082)
 *   --android     boot mobile via `expo run:android` instead of iOS
 *                 (replaces the native target; cannot combine with iOS)
 *   --fast        skip the native compile step — boot Metro only via
 *                 `expo start` (apps/mobile script `start`) instead of
 *                 `expo run:ios`/`expo run:android`. The dev client must
 *                 already be installed on the simulator/device. ~3s
 *                 boot vs minutes for a clean native rebuild.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { parseArgs } from 'node:util';

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

interface Child {
  name: string;
  color: keyof typeof COLORS;
  proc: ChildProcess;
}

function pipeWithPrefix(child: Child): void {
  const prefix = `${COLORS[child.color]}[${child.name}]${COLORS.reset} `;
  const onLine = (chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      process.stdout.write(`${prefix}${line}\n`);
    }
  };
  child.proc.stdout?.on('data', onLine);
  child.proc.stderr?.on('data', onLine);
}

function startServer(): Child {
  const proc = spawn('pnpm', ['--filter', '@diffusecraft/server-app', 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  return { name: 'server', color: 'cyan', proc };
}

type MobileTarget = 'ios' | 'android' | 'web' | 'start';

function startMobile(target: MobileTarget): Child {
  const proc = spawn('pnpm', ['--filter', '@diffusecraft/mobile', target], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const name = target === 'web' ? 'web' : 'mobile';
  const color: keyof typeof COLORS = target === 'web' ? 'blue' : 'magenta';
  return { name, color, proc };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'no-server': { type: 'boolean' },
      'no-mobile': { type: 'boolean' },
      'no-web': { type: 'boolean' },
      android: { type: 'boolean' },
      fast: { type: 'boolean' },
    },
    strict: false,
  });

  // Default: server + native mobile + web. Use --no-X to skip individual
  // pieces; for "just one thing" prefer the dedicated `dev:server` /
  // `dev:web` / `dev:ios` scripts (they spawn directly without the
  // launcher's prefixing/multiplexing overhead).
  // --fast: skip native compile, run Metro-only via `expo start`. Requires
  // the dev client to already be installed on the simulator/device.
  const nativeTarget: MobileTarget = values['fast']
    ? 'start'
    : values['android']
      ? 'android'
      : 'ios';

  const children: Child[] = [];
  if (!values['no-server']) children.push(startServer());
  if (!values['no-mobile']) children.push(startMobile(nativeTarget));
  if (!values['no-web']) children.push(startMobile('web'));

  if (children.length === 0) {
    process.stderr.write(
      'dev-all: nothing to start (--no-server, --no-mobile, --no-web all set)\n',
    );
    process.exit(2);
  }

  for (const c of children) pipeWithPrefix(c);

  process.stdout.write(
    `${COLORS.green}[dev-all]${COLORS.reset} started ${children.map((c) => c.name).join(' + ')} — Ctrl-C to stop all\n`,
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`${COLORS.yellow}[dev-all]${COLORS.reset} ${signal}; stopping children\n`);
    for (const c of children) {
      if (c.proc.exitCode === null && c.proc.signalCode === null) c.proc.kill(signal);
    }
    setTimeout(() => process.exit(exitCode), 1500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT', 130));
  process.on('SIGTERM', () => shutdown('SIGTERM', 143));

  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((resolve) => {
          c.proc.on('exit', (code, signal) => {
            const display = signal ? `signal ${signal}` : `code ${code ?? 'null'}`;
            const ok = code === 0 || (signal !== null && signal !== undefined);
            const color = ok ? COLORS.green : COLORS.red;
            process.stdout.write(`${color}[${c.name}]${COLORS.reset} exited (${display})\n`);
            if (!ok && !shuttingDown) {
              shutdown('SIGTERM', code ?? 1);
            }
            resolve();
          });
        }),
    ),
  );
}

void main();
