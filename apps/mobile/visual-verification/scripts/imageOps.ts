/**
 * imageOps.ts
 *
 * PNG read/write + deterministic downscale resample. Split from diff.ts to
 * keep that module under the 250-line cap.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

export function readPng(path: string): PNG {
  const buf = readFileSync(path);
  return PNG.sync.read(buf);
}

export function writePng(path: string, png: PNG): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

/**
 * Deterministic nearest-down resample. RGBA. Used when the reference PNG
 * and the captured PNG are at different resolutions; we always downscale to
 * the smaller size (never upscale — upscaling smears AA and inflates diffs).
 */
export function resample(src: PNG, targetW: number, targetH: number): PNG {
  if (src.width === targetW && src.height === targetH) return src;
  const dst = new PNG({ width: targetW, height: targetH });
  const xRatio = src.width / targetW;
  const yRatio = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * xRatio));
      const sy = Math.min(src.height - 1, Math.floor(y * yRatio));
      const si = (sy * src.width + sx) << 2;
      const di = (y * targetW + x) << 2;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = src.data[si + 3]!;
    }
  }
  return dst;
}

/**
 * Count "different" pixels in a diff PNG: any non-fully-transparent,
 * non-near-white opaque pixel is counted. odiff's diff PNGs paint changed
 * regions red on a transparent background; pixelmatch's are similar.
 */
export function countDiffPixels(diff: PNG): number {
  let count = 0;
  const data = diff.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (!(r > 240 && g > 240 && b > 240)) count += 1;
  }
  return count;
}
