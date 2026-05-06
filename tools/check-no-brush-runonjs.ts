#!/usr/bin/env tsx
/**
 * tools/check-no-brush-runonjs.ts
 *
 * CI guard implementing brush-canvas-rendering Requirement 2.2 / 11.5:
 * the brush and eraser gesture builders must NOT use `.runOnJS(true)` on
 * `Gesture.Pan` (or equivalent gesture types). The brush hot path runs in
 * the UI thread (Reanimated worklet runtime) — `.runOnJS(true)` would
 * route every touch event through the JS bridge, breaking the latency
 * budget defined in Requirement 9.
 *
 * Why this exists: the prior implementation used `Gesture.Pan().runOnJS(true)`
 * for the brush gesture and the entire brush pipeline degenerated into
 * JS-thread work. This guard prevents the same regression from sneaking back
 * in via merges. Other gesture builders in the editor screen (lasso,
 * transform, tap) may still legitimately use `.runOnJS(true)` because they
 * are not on the per-touch latency hot path.
 *
 * Detection: the guard scans editor gesture files for function declarations
 * whose name matches /buildBrush|buildEraser/i and flags any occurrence of
 * `.runOnJS(true)` between that function's opening brace and the next
 * top-level function declaration.
 *
 * Exit codes: 0 = clean. 1 = offenders found (printed to stderr).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

const SCAN_ROOTS = [
  resolve(REPO_ROOT, 'apps/mobile/src/screens/Editor'),
];

const SCAN_EXTS = new Set(['.ts', '.tsx']);

const FORBIDDEN_RUNONJS = /\.runOnJS\s*\(\s*true\s*\)/;

/** Match the start of a brush or eraser gesture builder function. */
const GUARDED_BUILDER_DECL =
  /\b(?:const|let|var|function)\s+(buildBrushGesture|buildEraserGesture)\b/i;

/** Heuristic for "the next top-level function declaration starts here". */
const TOP_LEVEL_DECL = /^\s*(?:const|let|var|function|export)\s+\w/;

interface Offender {
  file: string;
  line: number;
  builder: string;
  text: string;
}

const offenders: Offender[] = [];

function scanFile(filePath: string): void {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  let activeBuilder: string | null = null;
  let activeBuilderStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const decl = line.match(GUARDED_BUILDER_DECL);
    if (decl) {
      activeBuilder = decl[1]!;
      activeBuilderStartLine = i + 1;
      continue;
    }
    if (activeBuilder !== null && i > activeBuilderStartLine && TOP_LEVEL_DECL.test(line)) {
      // Heuristic end of the builder body. Reset.
      activeBuilder = null;
    }
    if (activeBuilder !== null && FORBIDDEN_RUNONJS.test(line)) {
      offenders.push({
        file: relative(REPO_ROOT, filePath),
        line: i + 1,
        builder: activeBuilder,
        text: line.trim(),
      });
    }
  }
}

function scan(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = resolve(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      scan(full);
      continue;
    }
    if (!SCAN_EXTS.has(extname(name))) continue;
    scanFile(full);
  }
}

for (const root of SCAN_ROOTS) scan(root);

if (offenders.length > 0) {
  console.error(
    `\nbrush-canvas-rendering Requirement 2.2 violation: \`.runOnJS(true)\` is forbidden inside the brush/eraser gesture builders.\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  [in ${o.builder}]  ${o.text}`);
  }
  console.error(
    `\nThe brush hot path must run in the UI thread (Reanimated worklet runtime).\n` +
      `Remove the .runOnJS(true) chain and write the gesture body as a worklet that\n` +
      `reads event.stylusData and calls the brush pipeline directly.\n`,
  );
  process.exit(1);
}

console.log('check-no-brush-runonjs: OK (no forbidden .runOnJS(true) inside brush/eraser builders)');
process.exit(0);
