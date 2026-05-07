/**
 * Stroke compositor seam (brush-system server-side path).
 *
 * `composeStrokeIntoRaster` walks a list of `Stamp`s and applies each to an
 * RGBA `RasterBuffer` in straight-alpha format. The compositor is the seam
 * the server-side `paint_strokes` handler uses to materialize a stroke into
 * a layer's pixel data without a Skia runtime — production rendering on the
 * tablet still goes through `canvas-skia`.
 *
 * Behaviour:
 * - **Stamp shape**: a circular alpha disc with linear hardness falloff.
 *   `hardness=1` gives a solid disc; `hardness=0` gives a fully soft
 *   gradient. Implementation matches what a stroke will look like through
 *   the Skia stamp shader closely enough for server-side artifacts to be a
 *   faithful preview.
 * - **Paint mode** (`erase=false`): standard "source-over" composition with
 *   the brush color and per-stamp alpha (color × stamp coverage).
 * - **Erase mode** (`erase=true`): destination-out — multiplies destination
 *   alpha by `(1 - stamp coverage)`. Color channels are preserved (so undo
 *   restores cleanly via the snapshot path documented in the spec).
 *
 * The function is pure: it returns a new buffer rather than mutating
 * `target`. For large layers the caller should clip to the affected
 * bounding box (see `stampsBoundingBox`) before passing the buffer in.
 */

import type { RasterBuffer } from '../blend/compose';
import { sampleClipAt, type SelectionClip } from '../composite/selection-clip';

import type { Stamp } from './stamps';

export interface BrushColor {
  /** Red channel 0..1 (straight, non-premultiplied). */
  readonly r: number;
  /** Green channel 0..1. */
  readonly g: number;
  /** Blue channel 0..1. */
  readonly b: number;
}

export interface ComposeStrokeOptions {
  /** Brush color in straight-alpha 0..1 channels. Required for paint stamps. */
  readonly color?: BrushColor;
  /**
   * Mask-only mode: instead of writing color, write alpha-only. The stamp's
   * effective alpha is multiplied by the `color`'s luminance (0..1) when
   * provided so a "white" brush adds and a "black" brush subtracts (matches
   * `mask-system` FR-7). When `color` is omitted, luminance defaults to 1.
   */
  readonly maskOnly?: boolean;
  /**
   * Selection-as-clip snapshot (selection-tools FR-34/FR-37). When present,
   * each pixel's stamp coverage is multiplied by `sampleClipAt(clip, px, py)`
   * before the existing alpha math; outside-selection pixels remain
   * bit-identical (the per-pixel branch short-circuits when clip alpha is 0).
   * When omitted, behavior is bit-identical to the pre-clip pipeline.
   */
  readonly clip?: SelectionClip;
}

const u8 = (v: number): number =>
  Math.round(Math.max(0, Math.min(1, v)) * 255);

const luminance = (c: BrushColor): number =>
  // Rec. 601 weights — same approximation used elsewhere in canvas-core.
  0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

/**
 * Compute the stamp coverage at offset `(dx, dy)` from a stamp center, given
 * `radius` and `hardness`. Returns 0..1.
 *
 * - `dist <= radius * hardness` → full coverage (1).
 * - `dist >= radius`            → zero coverage.
 * - In between                  → linear falloff.
 */
const stampCoverage = (
  dx: number,
  dy: number,
  radius: number,
  hardness: number,
): number => {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= radius) return 0;
  const hardEdge = radius * hardness;
  if (d <= hardEdge) return 1;
  const span = radius - hardEdge;
  if (span <= 0) return 1;
  return Math.max(0, 1 - (d - hardEdge) / span);
};

/**
 * Apply `stamps` to a copy of `target` and return the new buffer.
 *
 * Coordinates are in the same space as `target` (top-left origin, +y down).
 * Stamps falling entirely outside the buffer contribute nothing.
 */
export const composeStrokeIntoRaster = (
  target: RasterBuffer,
  stamps: ReadonlyArray<Stamp>,
  options: ComposeStrokeOptions = {},
): RasterBuffer => {
  const out = new Uint8ClampedArray(target.data);
  const { width, height } = target;

  const color = options.color ?? null;
  const lum = options.maskOnly && color ? luminance(color) : 1;
  const clip = options.clip ?? null;

  for (const stamp of stamps) {
    const radius = stamp.size * 0.5;
    if (radius <= 0) continue;
    const minX = Math.max(0, Math.floor(stamp.x - radius));
    const minY = Math.max(0, Math.floor(stamp.y - radius));
    const maxX = Math.min(width - 1, Math.ceil(stamp.x + radius));
    const maxY = Math.min(height - 1, Math.ceil(stamp.y + radius));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cov = stampCoverage(px + 0.5 - stamp.x, py + 0.5 - stamp.y, radius, stamp.hardness);
        if (cov <= 0) continue;
        const clipAlpha = clip === null ? 1 : sampleClipAt(clip, px, py);
        if (clipAlpha <= 0) continue;
        const idx = (py * width + px) * 4;
        const sa = cov * stamp.opacity * clipAlpha;
        if (sa <= 0) continue;
        const dr = out[idx]! / 255;
        const dg = out[idx + 1]! / 255;
        const db = out[idx + 2]! / 255;
        const da = out[idx + 3]! / 255;

        if (stamp.erase) {
          // Destination-out: keep dst color, scale alpha by (1 - sa).
          const newA = da * (1 - sa);
          out[idx] = u8(dr);
          out[idx + 1] = u8(dg);
          out[idx + 2] = u8(db);
          out[idx + 3] = u8(newA);
          continue;
        }

        if (options.maskOnly) {
          // Alpha-only painting: ignore RGB; add (lum * sa) to dst alpha.
          const add = lum * sa;
          const newA = da + add * (1 - da);
          out[idx + 3] = u8(newA);
          continue;
        }

        if (!color) {
          // No color provided and not erase / mask: skip — the handler
          // shouldn't drive us here, but degrade gracefully.
          continue;
        }

        // Standard source-over with the brush color at coverage `sa`.
        const newA = sa + da * (1 - sa);
        if (newA <= 0) {
          out[idx + 3] = 0;
          continue;
        }
        const mixA = sa / newA;
        out[idx] = u8(color.r * mixA + dr * (1 - mixA));
        out[idx + 1] = u8(color.g * mixA + dg * (1 - mixA));
        out[idx + 2] = u8(color.b * mixA + db * (1 - mixA));
        out[idx + 3] = u8(newA);
      }
    }
  }

  return { width, height, data: out };
};

/**
 * Convenience: parse a `#rrggbb` or `#rrggbbaa` hex string into a `BrushColor`
 * (0..1 channels) plus an opacity multiplier (0..1, defaults to 1 if no
 * alpha component is present). Throws on malformed input.
 */
export const parseBrushColor = (
  hex: string,
): { color: BrushColor; opacity: number } => {
  const m = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/.exec(hex);
  if (!m) {
    throw new Error(`parseBrushColor: invalid color "${hex}"`);
  }
  const rgb = m[1]!;
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;
  const a = m[2] !== undefined ? parseInt(m[2], 16) / 255 : 1;
  return { color: { r, g, b }, opacity: a };
};
