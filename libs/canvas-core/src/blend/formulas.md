# Blend mode formulas

> **Companion to:** `formulas.ts`. Reference doc per FR-13.
> Every formula matches Photoshop / Procreate conventions for the standard
> set. Skia natively supports most of them; modes Skia lacks are emulated
> via custom shaders in `canvas-skia` (Phase F.4).

All inputs assume normalized 0..1 channels in straight-alpha order. `src`
is the foreground (top layer), `dst` is the background.

## Channel-level formulas

| Mode | Formula |
|---|---|
| `normal` | `result = src` |
| `multiply` | `src * dst` |
| `screen` | `1 - (1 - src) * (1 - dst)` |
| `overlay` | `dst < 0.5 ? 2*src*dst : 1 - 2*(1-src)*(1-dst)` |
| `darken` | `min(src, dst)` |
| `lighten` | `max(src, dst)` |
| `color_dodge` | `src >= 1 ? 1 : clamp(dst / (1 - src))` |
| `color_burn` | `src <= 0 ? 0 : clamp(1 - (1 - dst) / src)` |
| `hard_light` | inverse of `overlay`: `src < 0.5 ? 2*src*dst : 1 - 2*(1-src)*(1-dst)` |
| `soft_light` | Photoshop variant: `(1 - 2*src) * dst^2 + 2*src*dst` |
| `difference` | `abs(src - dst)` |
| `exclusion` | `src + dst - 2*src*dst` |
| `linear_burn` | `clamp(src + dst - 1)` |
| `linear_dodge` | `clamp(src + dst)` |
| `linear_light` | `clamp(dst + 2*src - 1)` |
| `pin_light` | `src < 0.5 ? min(dst, 2*src) : max(dst, 2*src - 1)` |

## HSL-space formulas

These four require full RGB context and operate on color triplets. The
auxiliary functions `lum(c)`, `sat(c)`, `setLum(c, l)`, `setSat(c, s)`
follow the Adobe / W3C non-separable blend definition.

| Mode | Formula |
|---|---|
| `hue` | `setLum(setSat(src, sat(dst)), lum(dst))` |
| `saturation` | `setLum(setSat(dst, sat(src)), lum(dst))` |
| `color` | `setLum(src, lum(dst))` |
| `luminosity` | `setLum(dst, lum(src))` |

Where:

- `lum(c) = 0.3*c.r + 0.59*c.g + 0.11*c.b`
- `sat(c) = max(c.r, c.g, c.b) - min(c.r, c.g, c.b)`
- `setLum`, `setSat` clip channels back into `[0, 1]` while preserving the
  target luminance / saturation, per the W3C compositing spec.

## Alpha compositing

After channel blending, the source-over formula combines blended source
with destination using straight-alpha:

```
outA = srcA + dstA * (1 - srcA)
mixA = srcA / outA              // when outA > 0
outRGB = blended * mixA + dst * (1 - mixA)
```

Global layer opacity multiplies `srcA` before this step. Group composition
isolates the children into a buffer, then composites that buffer onto the
parent with the group's blend mode + opacity.
