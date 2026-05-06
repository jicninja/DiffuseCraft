/**
 * emulator.ts
 *
 * Emulator detection + determinism knobs (FR-13). Split out from run.ts to
 * keep the orchestrator under the 250-line cap.
 */

import { spawnSync } from 'node:child_process';

export interface EmulatorContext {
  platform: 'android' | 'ios';
}

const ANDROID_PACKAGE = 'art.suquia.diffusecraft';
const FIXED_EMULATOR_DATE = '2026-01-15T12:00:00Z';

function detectAndroid(): boolean {
  const proc = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (proc.status !== 0 || !proc.stdout) return false;
  const lines = proc.stdout.split('\n').slice(1);
  return lines.some((l) => /\bdevice\b/.test(l));
}

function detectIos(): boolean {
  const proc = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8' });
  if (proc.status !== 0 || !proc.stdout) return false;
  return /Booted/.test(proc.stdout);
}

/**
 * Detect a single booted emulator. Returns null when nothing is up; the
 * orchestrator treats null as "skip Maestro phase, still render the report
 * with error rows".
 */
export function detectEmulator(log: (m: string) => void): EmulatorContext | null {
  if (detectAndroid()) {
    log('emulator: Android device detected via adb.');
    return { platform: 'android' };
  }
  if (detectIos()) {
    log('emulator: iOS booted simulator detected via xcrun.');
    return { platform: 'ios' };
  }
  return null;
}

/**
 * Best-effort determinism knobs (FR-13). Each shell-out is wrapped so a
 * single unsupported setting doesn't abort the run; the pipeline is
 * non-gating. iOS knobs are documented in README and applied manually.
 */
export function primeDeterminism(ctx: EmulatorContext, log: (m: string) => void): void {
  if (ctx.platform !== 'android') {
    log('determinism: iOS knobs documented in README; skipping in run.ts (no-op).');
    return;
  }
  const cmds: Array<[string, string[]]> = [
    ['adb', ['shell', 'settings', 'put', 'global', 'animator_duration_scale', '0']],
    ['adb', ['shell', 'settings', 'put', 'global', 'window_animation_scale', '0']],
    ['adb', ['shell', 'settings', 'put', 'global', 'transition_animation_scale', '0']],
    ['adb', ['shell', 'settings', 'put', 'system', 'show_touches', '0']],
    ['adb', ['shell', 'setprop', 'persist.sys.locale', 'en-US']],
    ['adb', ['shell', 'date', '-u', FIXED_EMULATOR_DATE]],
    ['adb', ['shell', 'pm', 'clear', ANDROID_PACKAGE]],
  ];
  for (const [cmd, args] of cmds) {
    const proc = spawnSync(cmd, args, { encoding: 'utf8' });
    if (proc.status !== 0) {
      log(`determinism: \`${cmd} ${args.join(' ')}\` returned ${proc.status} (continuing).`);
    }
  }
}
