/**
 * Pure utility functions for color conversion and validation.
 *
 * HSB ↔ hex conversion, hex validation, token resolution, and value clamping.
 * Used by the brush settings UI components (ColorDisc, HexColorInput,
 * ColorSwatch, BrushSidebarSliders).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** HSB color representation. h: 0–360, s: 0–1, b: 0–1. */
export interface HSBColor {
  /** Hue in degrees, 0–360. */
  h: number;
  /** Saturation, 0–1. */
  s: number;
  /** Brightness (value), 0–1. */
  b: number;
}

// ---------------------------------------------------------------------------
// Token map (derived from libs/ui/src/theme/tokens.ts)
// ---------------------------------------------------------------------------

/**
 * Maps `token.*` identifiers used in BrushSlice.color to resolved hex values.
 *
 * The brush slice now defaults to `'#000000'` directly so strokes are visible
 * on the white paper. The `token.*` map is preserved for any caller that
 * passes a legacy token; we resolve it to black instead of the near-white
 * theme foreground that produced invisible strokes.
 */
const TOKEN_MAP: Record<string, string> = {
  'token.foreground': '#000000',
};

/** Fallback color when a token cannot be resolved or the value is unknown. */
const FALLBACK_HEX = '#000000';

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert an HSB color to a 6-character hex string (no `#` prefix).
 *
 * Algorithm: standard HSB-to-RGB sector mapping, then each channel is
 * quantized to 0–255 and formatted as two hex digits.
 */
export function hsbToHex(hsb: HSBColor): string {
  const { h, s, b } = hsb;
  const c = b * s;
  const hPrime = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = b - c;

  let r1: number;
  let g1: number;
  let b1: number;

  if (hPrime < 1) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hPrime < 2) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hPrime < 3) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hPrime < 4) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hPrime < 5) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  const toHex = (n: number): string =>
    Math.round(clampValue(n, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `${toHex(r1 + m)}${toHex(g1 + m)}${toHex(b1 + m)}`;
}

/**
 * Convert a 6-character hex string (without `#`) to an HSB color.
 *
 * Parses R, G, B channels from the hex string, converts to HSB using the
 * standard max/min algorithm.
 */
export function hexToHsb(hex: string): HSBColor {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  // Normalize hue to [0, 360)
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;

  return { h, s, b: max };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a hex string: exactly 6 hex digits, no prefix. */
export function isValidHex(hex: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(hex);
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a brush color value to a display hex string (with `#` prefix).
 *
 * - `'token.*'` → looked up in the token map; falls back to `FALLBACK_HEX`.
 * - `'#...'`    → returned as-is.
 * - Anything else → `FALLBACK_HEX`.
 */
export function resolveColorToHex(color: string): string {
  if (color.startsWith('token.')) {
    return TOKEN_MAP[color] ?? FALLBACK_HEX;
  }

  if (color.startsWith('#')) {
    return color;
  }

  return FALLBACK_HEX;
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/** Clamp a number to the inclusive range [min, max]. */
export function clampValue(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
