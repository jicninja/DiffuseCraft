#!/usr/bin/env tsx
/**
 * tools/check-no-raw-hex.ts
 *
 * CI guard implementing FR-8 ("raw-hex ban"): fails if any source file under
 * `apps/mobile/src/`, `apps/mobile/app/`, or `libs/ui/src/components/`
 * contains a raw hexadecimal colour literal.
 *
 * Allowed:
 *   - tailwind.config.js (the contract; hex values intentionally live here).
 *   - libs/ui/src/theme/tokens.ts (mirrors the contract for non-Tailwind code paths).
 *   - apps/mobile/design-snapshot/** (snapshot fixtures from the .pen).
 *   - Comments (lines whose first non-whitespace chars are //, *, or are inside /* ... *\/).
 *   - Test files (*.test.ts, *.test.tsx) when they assert hex values explicitly.
 *
 * Exit codes: 0 = clean. 1 = offenders found (printed to stderr).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

const SCAN_ROOTS = [
  resolve(REPO_ROOT, 'apps/mobile/src'),
  // Migration to expo-router (2026-05-03): App.tsx is gone; the route tree
  // under `app/` is now the runtime entry. Scan it just like `src/`.
  resolve(REPO_ROOT, 'apps/mobile/app'),
  resolve(REPO_ROOT, 'libs/ui/src/components'),
];

const ALLOW_FILES = new Set<string>([
  resolve(REPO_ROOT, 'tailwind.config.js'),
  resolve(REPO_ROOT, 'libs/ui/src/theme/tokens.ts'),
]);

const ALLOW_PATH_FRAGMENTS = [
  '/design-snapshot/',
  '/__snapshots__/',
  '/node_modules/',
  '/.expo/',
  '/dist/',
  '/build/',
];

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/;

interface Offender {
  file: string;
  line: number;
  text: string;
  match: string;
}

function isAllowed(absPath: string): boolean {
  if (ALLOW_FILES.has(absPath)) return true;
  for (const frag of ALLOW_PATH_FRAGMENTS) {
    if (absPath.includes(frag)) return true;
  }
  // Test files allowed: they may need to assert hex values.
  if (/\.test\.(ts|tsx|js|jsx)$/.test(absPath)) return true;
  return false;
}

function listFiles(root: string): string[] {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return [];
  }

  if (stat.isFile()) {
    return [root];
  }

  if (!stat.isDirectory()) return [];

  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = resolve(root, entry.name);
    if (isAllowed(full)) continue;
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function isCommentLine(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function checkFile(absPath: string): Offender[] {
  const offenders: Offender[] = [];
  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Track block-comment state at line granularity (good enough for this guard).
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.includes('/*') && !line.includes('*/')) {
      inBlockComment = true;
      continue;
    }

    if (isCommentLine(line)) continue;

    const m = HEX_RE.exec(line);
    if (m) {
      offenders.push({
        file: absPath,
        line: i + 1,
        text: line.trim(),
        match: m[0],
      });
    }
  }

  return offenders;
}

function main(): number {
  const files = SCAN_ROOTS.flatMap(listFiles);
  const offenders = files.flatMap(checkFile);

  if (offenders.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`check-no-raw-hex: clean (${files.length} files scanned).`);
    return 0;
  }

  // eslint-disable-next-line no-console
  console.error(
    `check-no-raw-hex: ${offenders.length} raw hex literal(s) found ` +
      `(${files.length} files scanned). Use a Tailwind class or read from useTheme()/tokens instead.\n`,
  );
  for (const o of offenders) {
    const rel = relative(REPO_ROOT, o.file);
    // eslint-disable-next-line no-console
    console.error(`  ${rel}:${o.line}  ${o.match}    | ${o.text}`);
  }
  return 1;
}

process.exit(main());
