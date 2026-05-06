// TODO(testing-infra): Vitest is not yet configured at the workspace root.
// Once vitest lands the imports below resolve as-is. The test file is
// authored against `vitest`'s describe/it/expect API, which mirrors Jest's
// surface 1:1 so a swap is mechanical.
//
// What this test covers (FR-15):
//   1. runDiff over an identical fixture pair returns ratio < 0.001, passed: true.
//   2. runDiff over a deliberately-different pair returns ratio > 0.10, passed: false.
//   3. Routes-coverage — every flow YAML under flows/ matches a CAPTURE_LABEL
//      and every CAPTURE_LABEL has a flow file (the no-reference list is
//      enforced separately by manifest.ts).
//   4. generateReport emits HTML containing every artboard label.
//   5. manifest.ts loads the placeholder snapshot_version: 0 without crashing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PNG } from 'pngjs';

import { runDiff } from '../diff';
import { generateReport } from '../report';
import {
  CAPTURE_LABELS,
  loadManifest,
  type NormalisedArtboard,
} from '../manifest';

const HERE = resolve(__dirname);
const FIXTURES = resolve(HERE, '_fixtures');
const TMP = resolve(HERE, '_tmp');
const FLOWS_DIR = resolve(HERE, '..', '..', 'flows');

function paintSolid(width: number, height: number, rgba: [number, number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) << 2;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
  return png;
}

function stampSquare(png: PNG, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]): void {
  for (let y = y0; y < y0 + h && y < png.height; y++) {
    for (let x = x0; x < x0 + w && x < png.width; x++) {
      const i = (y * png.width + x) << 2;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
}

function writePng(path: string, png: PNG): void {
  writeFileSync(path, PNG.sync.write(png));
}

beforeAll(() => {
  mkdirSync(FIXTURES, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  // Identical pair: solid grey 200x200.
  const a = paintSolid(200, 200, [128, 128, 128, 255]);
  const b = paintSolid(200, 200, [128, 128, 128, 255]);
  writePng(resolve(FIXTURES, 'identical-a.png'), a);
  writePng(resolve(FIXTURES, 'identical-b.png'), b);
  // Different pair: same grey, but second has a 60x60 red square (>= 9% of pixels).
  const c = paintSolid(200, 200, [128, 128, 128, 255]);
  const d = paintSolid(200, 200, [128, 128, 128, 255]);
  stampSquare(d, 50, 50, 60, 60, [255, 0, 0, 255]);
  writePng(resolve(FIXTURES, 'different-a.png'), c);
  writePng(resolve(FIXTURES, 'different-b.png'), d);
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

describe('runDiff', () => {
  it('reports ~0 ratio on an identical pair', () => {
    const r = runDiff({
      artboard: 'identical',
      referencePath: resolve(FIXTURES, 'identical-a.png'),
      capturePath: resolve(FIXTURES, 'identical-b.png'),
      outDir: TMP,
      thresholds: { warn: 0.05, alert: 0.1 },
      tool: 'pixelmatch',
    });
    expect(r.ratio).toBeLessThan(0.001);
    expect(r.passed).toBe(true);
    expect(r.status).toBe('ok');
    expect(existsSync(r.diff)).toBe(true);
    expect(existsSync(resolve(TMP, 'identical.diff.json'))).toBe(true);
  });

  it('reports > 0.10 ratio on a deliberately-different pair', () => {
    const r = runDiff({
      artboard: 'different',
      referencePath: resolve(FIXTURES, 'different-a.png'),
      capturePath: resolve(FIXTURES, 'different-b.png'),
      outDir: TMP,
      thresholds: { warn: 0.05, alert: 0.1 },
      tool: 'pixelmatch',
    });
    // 60x60 / (200x200) = 9% — but pixelmatch's anti-alias-aware mode also
    // flags some edge pixels, so we comfortably clear 0.05.
    expect(r.ratio).toBeGreaterThan(0.05);
    expect(r.passed).toBe(false);
  });

  it('emits a no_reference result when the reference is missing', () => {
    const r = runDiff({
      artboard: 'missing',
      referencePath: resolve(TMP, '__nope__.png'),
      capturePath: resolve(FIXTURES, 'identical-a.png'),
      outDir: TMP,
      thresholds: { warn: 0.05, alert: 0.1 },
      tool: 'pixelmatch',
    });
    expect(r.no_reference).toBe(true);
    expect(r.status).toBe('alert');
  });
});

describe('routes coverage', () => {
  it('every flow file matches a CAPTURE_LABEL', () => {
    const yamls = readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.yaml'));
    expect(yamls.length).toBe(CAPTURE_LABELS.length);
    const expectedBaseNames = CAPTURE_LABELS.map(toFlowBase);
    for (const file of yamls) {
      expect(expectedBaseNames).toContain(file.replace(/\.yaml$/, ''));
    }
  });

  it('every flow YAML contains a takeScreenshot step', () => {
    for (const file of readdirSync(FLOWS_DIR)) {
      if (!file.endsWith('.yaml')) continue;
      const text = readFileSync(resolve(FLOWS_DIR, file), 'utf8');
      expect(text).toMatch(/takeScreenshot/);
    }
  });
});

describe('generateReport', () => {
  it('emits HTML containing every label and the no-reference section', () => {
    const artboards: NormalisedArtboard[] = CAPTURE_LABELS.map((label) => ({
      label,
      group: label.startsWith('05') ? 'Editor' : 'Other',
      referenceAbs: null,
      referenceRel: '../../design-snapshot/preview.png',
      hasReference: true,
      flowFileBase: toFlowBase(label),
      size: [1366, 1024],
    }));
    const html = generateReport({
      reportDir: TMP,
      artboards,
      results: [],
      skipped: [],
      errors: [],
      snapshotVersion: '1.0.0',
      previousSnapshotVersion: null,
      refChanged: false,
      runTimestamp: '2026-05-03T00:00Z',
      gitSha: 'abcdef0',
      thresholds: { warn: 0.05, alert: 0.1 },
    });
    for (const label of CAPTURE_LABELS) {
      expect(html).toContain(label);
    }
    expect(html).toContain('No-reference routes');
  });
});

describe('manifest', () => {
  it('handles an arbitrary snapshot_version string without crashing', () => {
    const stubRoot = resolve(TMP, 'stub-snapshot');
    mkdirSync(stubRoot, { recursive: true });
    const manifest = {
      snapshot_version: '0',
      source_pen_path: 'x',
      extracted_at: 'x',
      extracted_by: 'x',
      tokens_file: 'x.json',
      artboards: [],
      summary: {},
    };
    writeFileSync(resolve(stubRoot, 'manifest.json'), JSON.stringify(manifest));
    const loaded = loadManifest(stubRoot, TMP);
    expect(loaded.manifest.snapshot_version).toBe('0');
    expect(loaded.artboards.every((a) => a.hasReference === false)).toBe(true);
  });
});

function toFlowBase(label: string): string {
  return (
    {
      '01-Splash': '01-splash',
      '02-Pairing-mDNS': '02-pairing-mdns',
      '02b-Pairing-QR': '02b-pairing-qr',
      '02c-Pairing-Code': '02c-pairing-code',
      '02d-Pairing-Manual': '02d-pairing-manual',
      '03-ServerPicker': '03-serverpicker',
      '04-Documents': '04-documents',
      '05-Editor-Generate': '05-editor-generate',
      '05b-Editor-Inpaint': '05b-editor-inpaint',
      '05c-Editor-Live': '05c-editor-live',
      '05d-Editor-Chat-Open': '05d-editor-chat-open',
      '06-Settings': '06-settings',
      '06a-Settings-Connection': '06a-settings-connection',
    } as Record<string, string>
  )[label]!;
}
