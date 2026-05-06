#!/usr/bin/env tsx
/**
 * run.ts
 *
 * Orchestrator for the visual-verification pipeline. Sequence:
 *   1. Load `apps/mobile/design-snapshot/manifest.json` (manifest.ts).
 *   2. Detect a running emulator (emulator.ts); prime determinism knobs.
 *   3. For each artboard with `preview_status: 'ok'`, run its Maestro flow,
 *      rename `_latest.png` to `<run-timestamp>.png`, then call runDiff().
 *   4. Generate the aggregated HTML report (report.ts).
 *   5. Exit 0 always (informative only — FR-6).
 *
 * Flags: `--ci` (no auto-open), `--help`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDiff } from './diff';
import { detectEmulator, primeDeterminism, type EmulatorContext } from './emulator';
import {
  loadManifest,
  persistSnapshotVersion,
  type NormalisedArtboard,
} from './manifest';
import { generateReport } from './report';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const MOBILE_ROOT = resolve(REPO_ROOT, 'apps/mobile');
const SNAPSHOT_ROOT = resolve(MOBILE_ROOT, 'design-snapshot');
const VV_ROOT = resolve(MOBILE_ROOT, 'visual-verification');
const FLOWS_DIR = resolve(VV_ROOT, 'flows');
const CAPTURES_DIR = resolve(VV_ROOT, 'captures');
const REPORT_DIR = resolve(VV_ROOT, 'report');

const THRESHOLDS = { warn: 0.05, alert: 0.1 };

interface CliOpts {
  ci: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  return {
    ci: argv.includes('--ci'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: pnpm verify:visual [--ci]

Drives Maestro flows in apps/mobile/visual-verification/flows/ against a
running emulator, diffs each capture against apps/mobile/design-snapshot/,
and writes apps/mobile/visual-verification/report/index.html.

Flags:
  --ci    Structured stderr summary; do not auto-open the report.
  --help  Print this message.

Pre-requisites:
  - A booted Pixel Tablet API 34 Android emulator OR iPad Pro 12.9 simulator.
  - The DiffuseCraft Expo app installed on the emulator.
  - Maestro on PATH (https://maestro.mobile.dev).
`);
}

function nowStamp(): string {
  // Filesystem-safe ISO-8601: 2026-05-03T14-22-41Z
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/-(\d{3})Z$/, 'Z');
}

function tryGitSha(): string | null {
  const proc = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  if (proc.status === 0 && proc.stdout) return proc.stdout.trim();
  return null;
}

interface CaptureOutcome {
  artboard: string;
  capturePath: string | null;
  error?: string;
}

function runMaestroFlow(
  art: NormalisedArtboard,
  runTimestamp: string,
  log: (m: string) => void,
): CaptureOutcome {
  const flowFile = resolve(FLOWS_DIR, `${art.flowFileBase}.yaml`);
  if (!existsSync(flowFile)) {
    return { artboard: art.label, capturePath: null, error: `flow missing: ${flowFile}` };
  }
  const captureDir = resolve(CAPTURES_DIR, art.label);
  mkdirSync(captureDir, { recursive: true });
  const latest = resolve(captureDir, '_latest.png');
  if (existsSync(latest)) unlinkSync(latest);

  log(`maestro: ${art.label} -> ${flowFile}`);
  const proc = spawnSync('maestro', ['test', flowFile], { encoding: 'utf8' });
  if (proc.status !== 0) {
    return {
      artboard: art.label,
      capturePath: null,
      error: `maestro exit ${proc.status}: ${(proc.stderr || proc.stdout || '').slice(0, 400)}`,
    };
  }
  if (!existsSync(latest)) {
    const candidate = readdirSync(captureDir).find((n) => n.startsWith('_latest'));
    if (candidate) {
      renameSync(resolve(captureDir, candidate), latest);
    } else {
      return { artboard: art.label, capturePath: null, error: 'maestro produced no _latest.png' };
    }
  }
  const stamped = resolve(captureDir, `${runTimestamp}.png`);
  renameSync(latest, stamped);
  return { artboard: art.label, capturePath: stamped };
}

function openInBrowser(path: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(cmd, [path], { stdio: 'ignore', detached: true });
  child.unref();
}

function captureAll(
  artboards: NormalisedArtboard[],
  ctx: EmulatorContext | null,
  runTimestamp: string,
  log: (m: string) => void,
): { captures: Record<string, CaptureOutcome>; errors: Array<{ artboard: string; message: string }> } {
  const captures: Record<string, CaptureOutcome> = {};
  const errors: Array<{ artboard: string; message: string }> = [];
  for (const art of artboards) {
    if (ctx === null) {
      captures[art.label] = { artboard: art.label, capturePath: null, error: 'no emulator' };
      continue;
    }
    const outcome = runMaestroFlow(art, runTimestamp, log);
    captures[art.label] = outcome;
    if (outcome.error) errors.push({ artboard: art.label, message: outcome.error });
  }
  return { captures, errors };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return 0;
  }

  const log = (m: string) => {
    // eslint-disable-next-line no-console
    console.log(`[verify:visual] ${m}`);
  };

  log('starting visual-verification pipeline');
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(CAPTURES_DIR, { recursive: true });

  const loaded = loadManifest(SNAPSHOT_ROOT, REPORT_DIR);
  log(
    `manifest: snapshot_version=${loaded.manifest.snapshot_version}` +
      (loaded.refChanged ? ` (changed from ${loaded.previousSnapshotVersion})` : ''),
  );

  const runTimestamp = nowStamp();
  const gitSha = tryGitSha();
  const errors: Array<{ artboard: string; message: string }> = [];

  const ctx = detectEmulator(log);
  if (ctx === null) {
    log('emulator: none detected; skipping Maestro phase. Report still renders.');
    errors.push({ artboard: '(global)', message: 'no booted emulator detected; Maestro phase skipped' });
  } else {
    primeDeterminism(ctx, log);
  }

  const withRef = loaded.artboards.filter((a) => a.hasReference);
  const { captures, errors: captureErrors } = captureAll(withRef, ctx, runTimestamp, log);
  errors.push(...captureErrors);

  const results = withRef.map((art) => {
    const cap = captures[art.label];
    return runDiff({
      artboard: art.label,
      referencePath: art.referenceAbs ?? '',
      capturePath: cap?.capturePath ?? '/__missing__/_latest.png',
      outDir: REPORT_DIR,
      thresholds: THRESHOLDS,
      refChanged: loaded.refChanged,
    });
  });

  const skipped = loaded.artboards.filter((a) => !a.hasReference);
  for (const a of skipped) {
    log(`no-reference: ${a.label} (preview_status: export_failed) — skipped from diff phase.`);
  }

  generateReport({
    reportDir: REPORT_DIR,
    artboards: loaded.artboards,
    results,
    skipped,
    errors,
    snapshotVersion: loaded.manifest.snapshot_version,
    previousSnapshotVersion: loaded.previousSnapshotVersion,
    refChanged: loaded.refChanged,
    runTimestamp,
    gitSha,
    thresholds: THRESHOLDS,
  });
  persistSnapshotVersion(REPORT_DIR, loaded.manifest.snapshot_version);

  const indexPath = resolve(REPORT_DIR, 'index.html');
  log(`report written: ${indexPath}`);
  log(
    `summary: passed=${results.filter((r) => !r.error && !r.no_reference && r.status === 'ok').length} ` +
      `warn=${results.filter((r) => r.status === 'warn').length} ` +
      `alert=${results.filter((r) => r.status === 'alert').length} ` +
      `errors=${errors.length}`,
  );

  if (!opts.ci) openInBrowser(indexPath);

  // FR-6: exit 0 always. Diff outcomes do not gate; the report is the single
  // source of truth and is uploaded as a CI artifact regardless.
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // eslint-disable-next-line no-console
    console.error('[verify:visual] fatal:', err);
    // Per FR-6 we still exit 0; the report carries the failure record.
    process.exit(0);
  },
);
