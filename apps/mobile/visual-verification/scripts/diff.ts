/**
 * diff.ts
 *
 * Single-screen diff routine. Invokes odiff (preferred — Rust binary, AA-aware)
 * and falls back to pixelmatch (pure JS) if odiff is unavailable on PATH or if
 * the operator forces it via DIFFUSECRAFT_DIFF_TOOL=pixelmatch.
 *
 * Outputs: `<reportDir>/<artboard>.diff.png` and `<artboard>.diff.json`.
 * Returns the structured JSON shape from requirements.md FR-4. Image / PNG
 * helpers live in `imageOps.ts` to keep this module under the 250-line cap.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

import { countDiffPixels, readPng, resample, writePng } from './imageOps';

// `require` shim: pixelmatch ships CJS, runDiff is sync, and tsx can resolve
// CJS deps from ESM via createRequire() without changing the module shape.
const require = createRequire(import.meta.url);

export interface DiffThresholds {
  warn: number;
  alert: number;
}

export type DiffStatus = 'ok' | 'warn' | 'alert';

export interface DiffOptions {
  artboard: string;
  referencePath: string;
  capturePath: string;
  outDir: string;
  thresholds: DiffThresholds;
  /** Force a tool: 'odiff' | 'pixelmatch' | 'auto' (default = read env). */
  tool?: 'odiff' | 'pixelmatch' | 'auto';
  refChanged?: boolean;
}

export interface DiffResult {
  artboard: string;
  reference: string;
  capture: string;
  diff: string;
  pixels_diff: number;
  total_pixels: number;
  ratio: number;
  threshold: DiffThresholds;
  passed: boolean;
  status: DiffStatus;
  no_reference: boolean;
  ref_changed: boolean;
  resampled: { reference: boolean; capture: boolean; target_size: [number, number] };
  tool: 'odiff' | 'pixelmatch' | 'none';
  tool_args: string[];
  error?: string;
}

let _odiffCache: boolean | null = null;
function odiffAvailable(): boolean {
  if (_odiffCache !== null) return _odiffCache;
  const probe = spawnSync('npx', ['--no-install', 'odiff-bin', '--version'], { stdio: 'ignore' });
  _odiffCache = probe.status === 0;
  return _odiffCache;
}

function selectTool(forced: DiffOptions['tool']): 'odiff' | 'pixelmatch' {
  if (forced === 'odiff' || forced === 'pixelmatch') return forced;
  const env = process.env.DIFFUSECRAFT_DIFF_TOOL?.toLowerCase();
  if (env === 'pixelmatch') return 'pixelmatch';
  if (env === 'odiff') return 'odiff';
  return odiffAvailable() ? 'odiff' : 'pixelmatch';
}

function statusFor(ratio: number, t: DiffThresholds): DiffStatus {
  if (ratio >= t.alert) return 'alert';
  if (ratio >= t.warn) return 'warn';
  return 'ok';
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function noReferenceResult(opts: DiffOptions, diffPng: string): DiffResult {
  const refMissing = !existsSync(opts.referencePath);
  return {
    artboard: opts.artboard, reference: opts.referencePath, capture: opts.capturePath, diff: diffPng,
    pixels_diff: 0, total_pixels: 0, ratio: 0, threshold: opts.thresholds, passed: false, status: 'alert',
    no_reference: refMissing, ref_changed: opts.refChanged ?? false,
    resampled: { reference: false, capture: false, target_size: [0, 0] },
    tool: 'none', tool_args: [],
    error: refMissing ? `reference missing: ${opts.referencePath}` : `capture missing: ${opts.capturePath}`,
  };
}

interface AlignedPair {
  ref: PNG;
  cap: PNG;
  refResampled: boolean;
  capResampled: boolean;
  width: number;
  height: number;
}

function alignToCommonSize(refPath: string, capPath: string): AlignedPair {
  const refPng = readPng(refPath);
  const capPng = readPng(capPath);
  const targetW = Math.min(refPng.width, capPng.width);
  const targetH = Math.min(refPng.height, capPng.height);
  return {
    ref: resample(refPng, targetW, targetH),
    cap: resample(capPng, targetW, targetH),
    refResampled: refPng.width !== targetW || refPng.height !== targetH,
    capResampled: capPng.width !== targetW || capPng.height !== targetH,
    width: targetW,
    height: targetH,
  };
}

function runOdiff(
  opts: DiffOptions,
  aligned: AlignedPair,
  diffPng: string,
): { pixelsDiff: number; toolArgs: string[] } {
  const tmpRef = resolve(opts.outDir, `${opts.artboard}.aligned.ref.png`);
  const tmpCap = resolve(opts.outDir, `${opts.artboard}.aligned.cap.png`);
  writePng(tmpRef, aligned.ref);
  writePng(tmpCap, aligned.cap);
  const toolArgs = ['--antialiasing', '--threshold=0.1'];
  const proc = spawnSync(
    'npx',
    ['--no-install', 'odiff-bin', tmpRef, tmpCap, diffPng, ...toolArgs],
    { encoding: 'utf8' },
  );
  // 0 = identical/within tolerance, 21 = diff found, else = tool error.
  if (proc.status !== 0 && proc.status !== 21) {
    throw new Error(`odiff failed (${proc.status}): ${proc.stderr ?? proc.stdout ?? ''}`);
  }
  const pixelsDiff = existsSync(diffPng) ? countDiffPixels(readPng(diffPng)) : 0;
  return { pixelsDiff, toolArgs };
}

function runPixelmatch(
  aligned: AlignedPair,
  diffPng: string,
): { pixelsDiff: number; toolArgs: string[] } {
  const pixelmatch = require('pixelmatch') as (
    a: Buffer | Uint8Array,
    b: Buffer | Uint8Array,
    out: Buffer | Uint8Array | null,
    w: number,
    h: number,
    opts?: { threshold?: number; includeAA?: boolean },
  ) => number;
  const out = new PNG({ width: aligned.width, height: aligned.height });
  const pixelsDiff = pixelmatch(
    aligned.ref.data,
    aligned.cap.data,
    out.data,
    aligned.width,
    aligned.height,
    { threshold: 0.1, includeAA: false },
  );
  writePng(diffPng, out);
  return { pixelsDiff, toolArgs: ['threshold=0.1', 'includeAA=false'] };
}

/**
 * Run the diff against a single screen. Writes the JSON sidecar and diff PNG
 * to `outDir` and returns the structured result.
 */
export function runDiff(opts: DiffOptions): DiffResult {
  const diffPng = resolve(opts.outDir, `${opts.artboard}.diff.png`);
  const diffJson = resolve(opts.outDir, `${opts.artboard}.diff.json`);
  mkdirSync(opts.outDir, { recursive: true });

  if (!existsSync(opts.referencePath) || !existsSync(opts.capturePath)) {
    const result = noReferenceResult(opts, diffPng);
    writeJson(diffJson, result);
    return result;
  }

  const tool = selectTool(opts.tool);
  const aligned = alignToCommonSize(opts.referencePath, opts.capturePath);
  const totalPixels = aligned.width * aligned.height;

  let pixelsDiff = 0;
  let toolArgs: string[] = [];
  try {
    const out = tool === 'odiff' ? runOdiff(opts, aligned, diffPng) : runPixelmatch(aligned, diffPng);
    pixelsDiff = out.pixelsDiff;
    toolArgs = out.toolArgs;
  } catch (e) {
    const result: DiffResult = {
      artboard: opts.artboard,
      reference: opts.referencePath,
      capture: opts.capturePath,
      diff: diffPng,
      pixels_diff: 0,
      total_pixels: totalPixels,
      ratio: 0,
      threshold: opts.thresholds,
      passed: false,
      status: 'alert',
      no_reference: false,
      ref_changed: opts.refChanged ?? false,
      resampled: {
        reference: aligned.refResampled,
        capture: aligned.capResampled,
        target_size: [aligned.width, aligned.height],
      },
      tool,
      tool_args: toolArgs,
      error: e instanceof Error ? e.message : String(e),
    };
    writeJson(diffJson, result);
    return result;
  }

  const ratio = totalPixels > 0 ? pixelsDiff / totalPixels : 0;
  const result: DiffResult = {
    artboard: opts.artboard,
    reference: opts.referencePath,
    capture: opts.capturePath,
    diff: diffPng,
    pixels_diff: pixelsDiff,
    total_pixels: totalPixels,
    ratio,
    threshold: opts.thresholds,
    passed: ratio < opts.thresholds.warn,
    status: statusFor(ratio, opts.thresholds),
    no_reference: false,
    ref_changed: opts.refChanged ?? false,
    resampled: {
      reference: aligned.refResampled,
      capture: aligned.capResampled,
      target_size: [aligned.width, aligned.height],
    },
    tool,
    tool_args: toolArgs,
  };
  writeJson(diffJson, result);
  return result;
}
