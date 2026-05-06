# brush-system — Design

> **Companion to:** `requirements.md`. **References:** `canvas-fundamentals`, `mask-system`, `mcp-tool-catalog`, `inspirations.md` (Procreate).

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Server-side brush registry** in SQLite (`brushes` table); tablet caches tip blobs. |
| Q2 | **`BRUSH_NOT_FOUND` error** when stroke references a deleted brush. No silent fallback. |
| Q3 | **Smudge in v1**, simplified (push-pull, paint-only, fallback for mask). |
| Q4 | **HSV default**; RGB / HSL toggle is post-v1. |
| Q5 | **Pixel size units.** Resize via pinch-and-drag gesture. |
| Q6 | **Fixed per-preset pressure curve in v1.** Long-press shows curve informationally. |
| Q7 | **Off by default; auto-on if Pencil detected.** |
| Q8 | **No agent-side pressure synthesis.** Agents provide explicit pressure arrays. |

## 2. Module layout

```
libs/canvas-core/src/brush/
├── index.ts
├── types.ts                     # BrushPreset, BrushParams, Stroke, StrokePoint
├── presets.ts                   # 6 built-in presets data
├── stroke-renderer.ts           # given a stroke + brush + canvas, produce a stamp pattern
├── pressure.ts                  # apply pressure curve to size/opacity
├── smudge.ts                    # smudge sample-and-paint logic
└── abr/
    ├── parser.ts                # parse Photoshop .abr binary
    ├── tip-extractor.ts         # extract brush tip alpha image
    └── feature-warner.ts        # detect ignored features and warn

libs/canvas-skia/src/brush/
├── stamp-renderer.ts            # Skia-based brush stamping with hardness/opacity shaders
├── tip-atlas.ts                 # cached tip-shape atlas for performance
└── pencil-input.ts              # Apple Pencil + S-Pen event integration

libs/server/src/lib/brushes/
├── registry.ts                  # CRUD on `brushes` table
├── import-abr.ts                # server-side ABR processing
├── handlers/
│   ├── import-brush.ts
│   └── delete-brush.ts
└── migrations/                  # SQLite migration adding `brushes` table

libs/ui/src/brush/
├── BrushPalette.tsx             # vertical thumbnail strip
├── BrushSettings.tsx            # long-press settings panel
├── ColorDisc.tsx                # HSV picker
├── BrushImportDialog.tsx        # ABR file upload UX
└── EraserToggle.tsx
```

## 3. Type model

```typescript
// libs/canvas-core/src/brush/types.ts
export interface BrushPreset {
  id: string;                                    // "pen" | "pencil" | ... | custom ULID
  name: string;
  kind: "builtin" | "custom";
  tip_blob_id: string;                            // alpha PNG tip
  default_size_px: number;
  min_size_px: number;
  max_size_px: number;
  default_hardness: number;                       // 0-1
  default_opacity: number;                        // 0-1
  default_flow: number;                           // 0-1
  spacing_pct: number;                            // % of size
  pressure_curve: BezierCurve;                    // 4 control points
  tilt_response: "none" | "angle" | "size";
  velocity_response: "none" | "size" | "opacity";
  mode_paint: boolean;                            // can target paint layers
  mode_mask: boolean;                             // can target mask layers
  smudge: boolean;                                // smudge brushes have special behavior
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;                               // 0-1
  tilt_x?: number;                                 // -1..1
  tilt_y?: number;
  velocity_pps?: number;                           // pixels per second
  ts: number;                                      // timestamp ms
}

export interface Stroke {
  brush_id: string;
  layer_id: LayerId;
  color?: { r: number; g: number; b: number };   // ignored on mask layers; greyscale used
  size_px?: number;                                // override default
  hardness?: number;
  opacity?: number;
  flow?: number;
  mode: "paint" | "erase";
  smoothing?: number;                              // 0-1
  points: StrokePoint[];
}
```

## 4. Built-in presets data

```typescript
// libs/canvas-core/src/brush/presets.ts
export const BUILTIN_PRESETS: BrushPreset[] = [
  {
    id: "pen", name: "Pen", kind: "builtin", tip_blob_id: "builtin:pen",
    default_size_px: 6, min_size_px: 1, max_size_px: 200,
    default_hardness: 0.98, default_opacity: 1, default_flow: 1,
    spacing_pct: 5, pressure_curve: linearCurve(),
    tilt_response: "none", velocity_response: "none",
    mode_paint: true, mode_mask: true, smudge: false,
  },
  {
    id: "pencil", name: "Pencil", kind: "builtin", tip_blob_id: "builtin:pencil",
    default_size_px: 4, min_size_px: 1, max_size_px: 80,
    default_hardness: 0.7, default_opacity: 0.9, default_flow: 0.85,
    spacing_pct: 4, pressure_curve: easedCurve(),
    tilt_response: "size", velocity_response: "opacity",
    mode_paint: true, mode_mask: true, smudge: false,
  },
  {
    id: "marker", name: "Marker", kind: "builtin", tip_blob_id: "builtin:marker-square",
    default_size_px: 24, min_size_px: 4, max_size_px: 400,
    default_hardness: 0.85, default_opacity: 0.7, default_flow: 1,
    spacing_pct: 8, pressure_curve: linearCurve(),
    tilt_response: "angle", velocity_response: "none",
    mode_paint: true, mode_mask: true, smudge: false,
  },
  {
    id: "airbrush", name: "Airbrush", kind: "builtin", tip_blob_id: "builtin:airbrush",
    default_size_px: 64, min_size_px: 16, max_size_px: 600,
    default_hardness: 0.2, default_opacity: 0.15, default_flow: 0.3,
    spacing_pct: 2, pressure_curve: easedCurve(),
    tilt_response: "none", velocity_response: "size",
    mode_paint: true, mode_mask: true, smudge: false,
  },
  {
    id: "smudge", name: "Smudge", kind: "builtin", tip_blob_id: "builtin:soft-round",
    default_size_px: 32, min_size_px: 8, max_size_px: 200,
    default_hardness: 0.5, default_opacity: 1, default_flow: 0.5,
    spacing_pct: 4, pressure_curve: linearCurve(),
    tilt_response: "none", velocity_response: "none",
    mode_paint: true, mode_mask: false, smudge: true,
  },
  // Eraser is not a separate preset — it's `mode: "erase"` on any other brush.
];
```

## 5. Stroke renderer (canvas-core, render-agnostic)

```typescript
// libs/canvas-core/src/brush/stroke-renderer.ts
export function expandStrokeToStamps(
  stroke: Stroke,
  brush: BrushPreset
): Stamp[] {
  const stamps: Stamp[] = [];
  const points = applySmoothing(stroke.points, stroke.smoothing ?? 0.3);
  const baseSize = stroke.size_px ?? brush.default_size_px;
  const baseOpacity = stroke.opacity ?? brush.default_opacity;
  const baseHardness = stroke.hardness ?? brush.default_hardness;
  const flow = stroke.flow ?? brush.default_flow;

  let lastStampPos: Point | null = null;
  for (const p of points) {
    const sizeMul = applyPressureCurve(p.pressure, brush.pressure_curve);
    const size = baseSize * sizeMul;
    const spacing = (size * brush.spacing_pct) / 100;

    if (lastStampPos === null || dist(p, lastStampPos) >= spacing) {
      stamps.push({
        x: p.x, y: p.y,
        size,
        opacity: baseOpacity * applyVelocityResponse(p.velocity_pps ?? 0, brush.velocity_response),
        hardness: baseHardness,
        angle: brush.tilt_response === "angle" ? Math.atan2(p.tilt_y ?? 0, p.tilt_x ?? 0) : 0,
        color: stroke.color,
        mode: stroke.mode,
        flow,
      });
      lastStampPos = p;
    }
  }
  return stamps;
}
```

The Skia adapter consumes `Stamp[]` and renders each via `drawImage(tipAtlas, ...)` with appropriate paint shaders.

## 6. Skia rendering

```typescript
// libs/canvas-skia/src/brush/stamp-renderer.ts
export class SkiaStampRenderer {
  constructor(private adapter: SkiaRenderAdapter, private atlas: TipAtlas) {}

  applyStrokeToLayer(stamps: Stamp[], target: Layer): void {
    const surface = this.adapter.getLayerSurface(target);
    const paint = Skia.Paint();
    for (const stamp of stamps) {
      const tip = this.atlas.getTip(stamp.brush_id);
      paint.setColor(stamp.color ? toSkColor(stamp.color, stamp.opacity * stamp.flow) : Skia.Color(0, 0, 0, stamp.opacity * stamp.flow));
      paint.setBlendMode(stamp.mode === "erase" ? BlendMode.DstOut : BlendMode.SrcOver);
      // hardness shader: stamp tip + radial-falloff via a custom SkShader
      paint.setShader(buildHardnessShader(tip, stamp.hardness));
      surface.canvas.save();
      surface.canvas.translate(stamp.x, stamp.y);
      surface.canvas.rotate(stamp.angle * 180 / Math.PI);
      surface.canvas.scale(stamp.size / tip.width, stamp.size / tip.height);
      surface.canvas.drawImage(tip, -tip.width / 2, -tip.height / 2, paint);
      surface.canvas.restore();
    }
  }
}
```

For **mask layers**, the renderer routes to a single-channel surface and converts color to luminance (`0.299*r + 0.587*g + 0.114*b`).

For **smudge**, instead of drawing the tip with a color, sample pixels at `(stamp.x - dir * push, stamp.y - dir * push)` and stamp them at `(stamp.x, stamp.y)` with the tip as alpha mask.

## 7. ABR import (server-side)

```typescript
// libs/server/src/lib/brushes/import-abr.ts
import { parseAbr } from "@diffusecraft/canvas-core/brush/abr/parser";

export async function importAbrHandler(input: { source: ImageEnvelope | FileEnvelope; name?: string }, ctx: HandlerContext) {
  const bytes = await ctx.client.image.fetch(input.source);
  const parsed = parseAbr(bytes);
  // parsed.brushes: array of { name, tip_alpha, spacing, hardness?, pressure_curve?, ignored_features }

  const ids: string[] = [];
  for (const b of parsed.brushes) {
    const tipBlobId = await ctx.assets.writeBlob(b.tip_alpha);
    const id = ulid();
    ctx.db.exec("INSERT INTO brushes (id, name, kind, tip_blob_id, params_json) VALUES (?,?,?,?,?)", {
      id, name: input.name ?? b.name, kind: "custom", tip_blob_id: tipBlobId,
      params_json: JSON.stringify({
        default_size_px: b.spacing.default_size_px ?? 32,
        spacing_pct: b.spacing.spacing_pct ?? 8,
        default_hardness: b.hardness ?? 0.7,
        pressure_curve: b.pressure_curve ?? linearCurve(),
        // ... defaults for missing fields
      }),
    });
    ids.push(id);
  }

  if (parsed.brushes.some(b => b.ignored_features.length > 0)) {
    ctx.notify({ kind: "warning", message: `Imported ${parsed.brushes.length} brushes; ignored advanced features: ${[...new Set(parsed.brushes.flatMap(b => b.ignored_features))].join(", ")}` });
  }

  return { brush_ids: ids };
}
```

The `parseAbr` reader walks the ABR binary format (which is a tagged-resource container similar to Photoshop's PSD). v1 reads:
- ABR version 1.x and 6.x (the most common formats).
- For each brush: tip image (sample data section), spacing (`Sps`), diameter, hardness if present, pressure dynamics if present.
- Ignores: dual-brush data, scattering data, texture data, color dynamics — listed in `ignored_features`.

## 8. Brush registry (SQLite)

```sql
-- libs/server/src/lib/db/migrations/00X-brushes.ts
CREATE TABLE brushes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,         -- "builtin" | "custom"
  tip_blob_id     TEXT NOT NULL,
  params_json     TEXT NOT NULL,
  imported_from   TEXT NULL,              -- "abr-v6" | "png" | null for builtins
  created_at      TEXT NOT NULL
);
```

Built-in presets are seeded on first migration; their `tip_blob_id` references bundled binary blobs.

## 9. Tablet UX

### 9.1 Brush palette

```typescript
// libs/ui/src/brush/BrushPalette.tsx
export const BrushPalette: React.FC = () => {
  const brushes = useBrushesStore((s) => s.brushes);          // built-in + custom
  const activeBrushId = useEditorStore((s) => s.active_brush_id);
  const eraseMode = useEditorStore((s) => s.erase_mode);

  return (
    <VerticalPalette>
      {brushes.filter(b => b.kind === "builtin").map(b => (
        <BrushThumb
          key={b.id}
          brush={b}
          active={b.id === activeBrushId}
          erase={b.id === activeBrushId && eraseMode}
          onTap={() => editorStore.setActiveBrush(b.id)}
          onLongPress={() => openSettings(b)}
        />
      ))}
      <Divider />
      {brushes.filter(b => b.kind === "custom").map(b => (
        <BrushThumb /* ... */ />
      ))}
      <ImportButton onPress={openImportDialog} />
    </VerticalPalette>
  );
};
```

### 9.2 Brush settings (long-press)

Sliders for size, hardness, opacity, flow, spacing. Pressure curve shown informationally (read-only in v1).

### 9.3 Color disc

HSV ring + square Procreate-style. Recent + favorite swatches row. Long-press canvas → eyedropper (already in canvas-fundamentals).

### 9.4 Pinch-and-drag size hot-gesture

While in brush mode: two-finger pinch on canvas adjusts `size_px` of the active brush in real time. On release, commit. Visible size indicator in the corner.

### 9.5 Eraser toggle

Two-finger long-press on canvas → toggles `erase_mode`. Visible badge on active brush thumbnail.

## 10. Cross-spec impact

This spec adds 2 tools (`import_brush`, `delete_brush`). After this, v1 catalog count is **~54 tools**, within cap of 55.

Full v1 catalog tally (running):
- Original `mcp-tool-catalog` baseline: ~38
- `transform-tools` adds: 1 → 39
- `mask-system` adds: 7 → 46
- `selection-tools` adds: 5 → 51
- `script-execution` adds: 1 → 52
- `brush-system` adds: 2 → **54**
- Cap: 55 (set in mask-system Q1)

If subsequent specs (workspaces, prompt-enhancement, etc.) push past 55, raise cap or trim. Footprint NFR-3 (≤100 KB) remains the hard gate.

## 11. Acceptance criteria

1. The 6 built-in presets render correctly per their dynamics.
2. Eraser mode works on every brush.
3. ABR import handles the 10+ test files in fixtures with graceful warnings for ignored features.
4. Mask layer painting writes alpha-only correctly.
5. Smudge brush produces visible push-pull on paint layers; falls back on mask.
6. Procreate-inspired UX (palette + color disc + pinch size + eraser toggle) is functional.
7. Stroke latency ≤30 ms on iPad.
