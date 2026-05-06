# brush-system — Requirements

> **Status:** Draft v0.1.
> **Tier 3 — SIMPLE.** Per editor philosophy: 4–6 fixed presets, **NO custom brush engine** in v1. Procreate-inspired UI but without Procreate's brush authoring depth.
> **Depends on:** `canvas-fundamentals` (paint/mask layers), `mask-system` (mask integration), `undo-redo-system` (P27), `mcp-tool-catalog` (`paint_strokes` already present).
> **References:** Editor philosophy memory ("AI-accelerated illustration; brushes minimal"), P22 (tablet reference), Procreate UX patterns.

## 1. Purpose

Define the v1 **brush system**: how the user sketches, masks, and erases on the canvas. The scope is **deliberately minimal** to keep DiffuseCraft focused on AI-driven illustration via collage rather than brush-engine authoring.

This spec defines:
- The 4–6 fixed v1 brush presets and their behaviors.
- Pressure / tilt / velocity inputs from Apple Pencil and S-Pen.
- Brush-color vs mask-alpha behaviors (different per target layer kind).
- Eraser as a brush variant.
- **Basic Photoshop ABR import** (brush tip shape + spacing + pressure curve only).
- Tablet UX for the brush picker.
- Integration with `paint_strokes` and `paint_area` MCP tools.

This spec does **NOT** define:
- A custom brush engine (post-v1).
- Procedural brushes / wet-edge / shape dynamics / scattering / dual brushes.
- Brush categories (oil, watercolor, gouache, etc. — fancy brushes deferred).

## 2. Stakeholders & user stories

### S1 — Illustrator sketching guidance for AI
> **Story 1.** As an illustrator preparing context for the AI, I tap the **Pen** brush. I sketch a rough silhouette on a paint layer over my reference photos. The sketch becomes a control input. AI generates with the sketch as a guide.

### S2 — Illustrator painting mask
> **Story 2.** As an illustrator, I select a mask layer, tap the **Marker** brush. I paint over the area I want the AI to fill. Brush ignores its color and writes alpha. Eraser subtracts.

### S3 — Illustrator with existing Photoshop brushes
> **Story 3.** As an illustrator with a custom `.abr` brush from Photoshop (a basic textured tip), I import the file via "Import brush". v1 reads the brush tip shape + spacing + pressure curve; ignores advanced features (texture, dual brush, scattering). The imported brush appears in my "Custom" preset slot. Quality is "good enough" for sketching.

### S4 — Illustrator quick-erasing
> **Story 4.** As an illustrator, I two-finger long-press the brush button → switches to Eraser. Same brush shape but alpha=0. I two-finger long-press again to revert.

### S5 — Apple Pencil pressure
> **Story 5.** As an illustrator with Apple Pencil, my pressure modulates brush size and opacity. Light tap = small + transparent; firm = large + opaque. Tilt may modulate angle for the Marker brush. S-Pen on Android: same pressure mapping.

### S6 — Agent painting programmatically
> **Story 6.** As Claude Code, I invoke `paint_strokes({ layer_id, strokes: [{ points, pressure, color, brush_id, size }] })` to drop a stroke on a layer. Brush behavior matches what a human gets with the same brush_id.

## 3. Functional requirements (EARS)

### 3.1 v1 brush presets (4 fixed brushes + eraser variant)

**FR-1 (Ubiquitous).** v1 SHALL ship the following fixed brush presets:

| ID | Name | Tip | Use case |
|---|---|---|---|
| `pen` | Pen | Hard round, ~98% hardness | Clean sketch lines, line art for control layers |
| `pencil` | Pencil | Soft round with subtle texture, ~70% hardness | Rough sketching, mask refinement |
| `marker` | Marker | Square-ish flat, edge anti-aliased | Mask painting, broad strokes |
| `airbrush` | Airbrush | Soft round with low hardness, builds opacity over time | Soft masks, gradient regions |
| `smudge` | Smudge | Push-pull tip; not a "paint" brush, blends pixels | Soft transitions on collaged content |
| `eraser` | Eraser | Mirror of any active brush; sets alpha=0 | Dual-mode of every other brush |

**FR-2 (Ubiquitous).** Each preset SHALL be defined by: `id`, `name`, `tip_shape` (alpha image), `default_size_px`, `min_size_px`, `max_size_px`, `default_hardness` (0–1), `default_opacity` (0–1), `default_flow` (0–1), `spacing` (% of size), `pressure_curve` (4-point Bezier), `tilt_response` ("none" | "angle" | "size"), `velocity_response` ("none" | "size" | "opacity").

**FR-3 (Ubiquitous).** Eraser SHALL NOT be a separate engine — it's any brush with `mode: "erase"`. Eraser uses the active brush's tip shape and dynamics, but writes alpha=0 (or subtracts from existing alpha).

### 3.2 Brush input modulation

**FR-4 (Ubiquitous).** Brush size SHALL be modulated by pressure with the preset's `pressure_curve`. Apple Pencil provides 0.0–1.0 pressure; finger touch defaults to a configurable mid-pressure (default 0.5).

**FR-5 (Ubiquitous).** Brush opacity SHALL be modulated by pressure for brushes with `velocity_response` or `pressure_curve` set to opacity. Hard brushes (Pen) default to constant opacity; soft brushes (Airbrush, Pencil) modulate.

**FR-6 (Ubiquitous).** Tilt SHALL be supported for Apple Pencil + S-Pen where reported. v1 use: Marker preset uses tilt to set stamp angle; other presets ignore tilt.

**FR-7 (Ubiquitous).** Velocity (stroke speed) MAY modulate size or opacity per preset. Pencil: faster = thinner. Marker: ignored.

**FR-8 (Ubiquitous).** Stroke smoothing: a configurable smoothing factor (default 0.3) applies a moving-average filter on the input points to reduce jitter. User-tunable per session.

### 3.3 Color vs alpha behavior

**FR-9 (Ubiquitous).** When the **target layer is a paint layer**, brush writes RGBA: color from the active brush color picker, alpha from pressure × opacity × flow.

**FR-10 (Ubiquitous).** When the **target layer is a mask layer (painted)**, brush writes alpha-only: brush color is converted to greyscale (luminance) and multiplied by pressure × opacity × flow. White brush = additive to mask; black = subtractive (or use Eraser explicitly). This matches `mask-system` FR-7.

**FR-11 (Ubiquitous).** When the **target layer is a control layer of subkind that accepts strokes** (Scribble, Line Art, Soft Edge), brush writes RGBA same as paint. Other control-layer subkinds (Reference, Style, Composition, Face) are not directly paintable — they accept whole images via `add_control_layer({ source_image })`.

### 3.4 Smudge brush behavior

**FR-12 (Ubiquitous).** Smudge brush SHALL push pixels along the stroke direction by sampling at `(stroke_pos - dir * push_distance)` and rendering at `stroke_pos`. Strength configurable (default 50%).

**FR-13 (Ubiquitous).** Smudge SHALL only operate on paint layers; on mask layers it falls back to Marker behavior with a warning toast.

### 3.5 Photoshop ABR import (basic)

**FR-14 (Ubiquitous).** v1 SHALL support importing Photoshop **`.abr` files** with the following minimal subset:
- Brush tip shape (sample image / alpha mask)
- Spacing
- Diameter / size range
- Hardness (if specified)
- Pressure-to-size curve (if specified)

**FR-15 (Ubiquitous).** v1 SHALL **ignore** the following ABR features:
- Texture
- Dual brush
- Scattering
- Color dynamics
- Transfer (advanced opacity dynamics)
- Brush pose
- Wet edges
- Build-up
- Smoothing
- Protect texture

**FR-16 (Ubiquitous).** ABR import SHALL be available via:
- Tablet UI: "Import brush" button in the brush settings panel.
- MCP tool: `import_brush({ source: ImageEnvelope_or_FileEnvelope, name? })` (write, not reversible — adds to brush registry).

**FR-17 (Ubiquitous).** Imported brushes SHALL appear in a "Custom" section of the brush picker, separate from the 6 built-in presets.

**FR-18 (Ubiquitous).** ABR file size cap: 16 MB (matches per-call payload cap). Larger files → `PAYLOAD_TOO_LARGE`.

**FR-19 (Ubiquitous).** Multi-brush ABRs (a single file with multiple brushes) SHALL import all brushes; user can rename each.

**FR-20 (Unwanted).** IF an ABR uses an unsupported version or proprietary extension, THE server SHALL import what it can and emit a warning listing skipped features.

### 3.6 MCP integration

**FR-21 (Ubiquitous).** `paint_strokes` (already in catalog) SHALL accept `brush_id` referencing either a built-in preset or an imported brush. Parameters override preset defaults when provided (size, hardness, opacity, flow).

**FR-22 (Ubiquitous).** New MCP tools added by this spec:
- `import_brush({ source, name? })` — adds a brush to the registry. Accepts ABR file via `source: { format: "abr", data: base64 | ref }` or simple PNG tip via `source: { format: "png", data, spacing? }`.
- `delete_brush({ brush_id })` — removes a custom brush. Built-in presets cannot be deleted.

**FR-23 (Ubiquitous).** Resource: `diffusecraft://brushes/list` returns built-in + custom brushes with their parameters and tip-shape thumbnails.

**FR-24 (Ubiquitous).** Catalog impact: 2 new tools (`import_brush`, `delete_brush`). v1 catalog now ~54 tools (within cap of 55).

### 3.7 Tablet UX

**FR-25 (Ubiquitous).** A **brush palette** (Procreate-inspired) is visible when a paint or mask layer is active and a brush tool is selected. Layout:
- Vertical row of preset thumbnails on the left edge (or bottom in landscape).
- Each thumbnail shows the brush tip + name + size badge.
- Tap to select; long-press to open settings panel (size, hardness, opacity, flow, spacing, pressure curve).
- "Custom" section below presets with imported brushes; "+" button → Import.

**FR-26 (Ubiquitous).** A **color disc** (Procreate-style) is reachable from the brush palette. Hue ring + saturation/value square. Quick-swatch row of recent + favorite colors.

**FR-27 (Ubiquitous).** **Eraser toggle**: two-finger long-press on the canvas (or a dedicated button) toggles Eraser mode for the active brush. Visual indicator on the brush thumbnail.

**FR-28 (Ubiquitous).** **Brush size hot-gesture**: two-finger pinch-and-drag on the canvas adjusts the active brush size in real time. Released → committed.

**FR-29 (Ubiquitous).** **Pencil-only mode** (Apple Pencil): when toggled, finger gestures don't paint (only navigate); only the Pencil paints. Default on for users who have a Pencil.

### 3.8 Performance

**FR-30 (Ubiquitous).** Stroke rendering latency (Pencil event → screen update): ≤ **30 ms** on iPad Pro M-class. Critical for "ink" feel.

**FR-31 (Ubiquitous).** Stroke commit (release → server `paint_strokes` round-trip): ≤ 200 ms for typical strokes (≤500 points) on local LAN.

**FR-32 (Ubiquitous).** Smudge brush: ≤ 50 ms per sample on 1024×1024 layer.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Brush rendering SHALL use Skia drawing primitives (atlasable stamps, shaders for hardness/opacity gradients) — not per-pixel calculation in JS.

**NFR-2 (Ubiquitous).** Brush data files (tip shapes, default presets) SHALL be ≤ 1 MB total in the bundle.

**NFR-3 (Ubiquitous).** Imported ABR brushes are stored server-side per `presets-and-models` pattern; tablet caches the tip image.

**NFR-4 (Ubiquitous).** Brushes SHALL NOT use procedural / GPU-shader-heavy effects in v1 (no wet-edge simulation, no fluid dynamics). Keep frame budget for rendering.

## 5. Out of scope

- **Custom brush authoring UI** (post-v1).
- **Procedural brushes** (wet edge, fluid sim, watercolor bleed).
- **Texture brushes** (post-v1 if scope allows).
- **Brush plugins** (post-v1 if at all).
- **Brush mixing palette** (Procreate-style swatch panel for color blending) — post-v1.
- **Animation of brush strokes** (replay / speed change).

## 6. Open questions

### Q1 — How is the brush registry persisted?
Built-in presets are bundled; custom (imported) brushes need persistence.

**Recommendation:** **server-side**, per `server-architecture` SQLite. New table `brushes` with `id`, `name`, `kind: "builtin" | "custom"`, `tip_blob_id`, `params_json`. Listed in `presets-and-models` spec scope.

### Q2 — What happens when user paints with a brush that's been deleted?
A `paint_strokes` call references a `brush_id` that no longer exists.

**Recommendation:** **error `BRUSH_NOT_FOUND`** with `hint: "Use one of: <list of available>". Don't auto-fallback silently.

### Q3 — Should the Smudge brush be in v1?
It's the most complex of the six (push-pull pixel sampling).

**Recommendation:** **yes, in v1**, simplified. Push-pull only on paint layers, fixed strength configurable via long-press settings. Skip on mask layers (FR-13 fallback). Acceptable scope for v1.

### Q4 — Color picker: HSV vs HSL vs RGB?
Procreate uses HSB (= HSV); pros use HSL.

**Recommendation:** **HSV (Procreate-style)** as default with a toggle to RGB or HSL for power users. v1 default HSV; alternative pickers are post-v1.

### Q5 — Brush size unit: pixels vs % of canvas?
Pixels are intuitive for small canvases but absolute; % of canvas is relative.

**Recommendation:** **pixels** (simpler). User can resize brush via pinch-and-drag gesture if scaling canvas; default size scales sensibly with document dimensions on creation.

### Q6 — Pressure curve UI
Editable curve for pro users vs fixed per-preset.

**Recommendation:** **fixed per preset in v1.** Long-press settings panel may show the curve as informational. Editable curves post-v1.

### Q7 — Pencil-only-mode default
On or off by default?

**Recommendation:** **off by default; on if Pencil detected**. User toggles in settings. Procreate's "Disable Touch Actions" approach.

### Q8 — Should the agent-driven `paint_strokes` simulate pressure for natural-looking strokes when no pressure provided?
A flat stroke from an agent would look mechanical.

**Recommendation:** **no synthesis in v1**. Agent provides explicit `pressure[]` array if it wants modulated strokes; else flat. Documented; agents that care provide arrays.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The six user stories (§2) are realized.
2. The 5 brush presets + eraser variant work end-to-end (paint + mask + erase modes).
3. ABR import handles a representative set of `.abr` files (10+ test cases) with graceful fallback for unsupported features.
4. Stroke latency ≤30 ms on iPad Pro.
5. Tablet UX (brush palette, color disc, gestures) honors Procreate-inspired patterns.
6. Catalog impact ≤55 tools.
7. Open questions have acceptable recommendations.
