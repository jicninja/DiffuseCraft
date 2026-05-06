# transform-tools — Requirements

> **Status:** Draft v0.1.
> **Tier 1 — RICH.** Load-bearing for the collage workflow.
> **Depends on:** `canvas-fundamentals`, `undo-redo-system`, `mcp-tool-catalog` (`transform_layer` is in the deferred list — promoted to v1 by this spec given the editor philosophy).
> **References:** P22 (tablet reference + multitouch), P27 (reversibility), editor philosophy (collage-first).

## 1. Purpose

Transform is **the** primary interaction in DiffuseCraft's collage-driven editor. The user moves, scales, rotates, flips, skews, and distorts layers continuously to compose contexts that feed the AI. This spec defines:

- The transform operations and their parameters.
- **Touch-first input model**: multitouch is the primary design target. Mouse/keyboard support is automatic where iPadOS provides cursor (Magic Keyboard / trackpad) and reserved for future desktop hosts (MeshCraft, if it ever renders the DiffuseCraft canvas) — **not a v1 driver**.
- Handle / gizmo design that works equivalently with both input modes.
- Snapping behavior (grid, layer edges, canvas center).
- Group transforms (transform several layers as one composite).
- Modifier keys for constraints (preserve aspect, scale from center, distort, skew) — **for the keyboard-when-available case**, with on-screen equivalents for tablet-only use.
- Live preview during transform; commit on release.
- Tool integration: an explicit "Transform" tool mode + free-transform-on-tap on any selected layer.

This spec promotes `transform_layer` (deferred in `mcp-tool-catalog` §3.3.17) **into v1 catalog**. Reflected in §6 below.

**Input priority:** touch primary → Apple Pencil / S-Pen first-class equivalent → mouse / trackpad (when iPadOS cursor is present) → physical keyboard modifiers (when keyboard is connected). Every operation has a touch-only path; mouse/keyboard provide ergonomic alternatives, never required. Desktop-host scenarios (MeshCraft eventually) inherit this design without additional v1 work.

## 2. Stakeholders & user stories

### S1 — Tablet illustrator collaging references
> **Story 1.** As an illustrator, I drop three reference images into my canvas. Each is 1024×1024 (the import resolution). I tap the first → transform handles appear. I pinch to scale to 50%, two-finger rotate to 15°, drag to position. I tap the second, repeat. They sit naturally where I want.

### S2 — iPad user with Magic Keyboard trackpad
> **Story 2.** As an illustrator using my iPad with Magic Keyboard, I select a layer with the trackpad. Bounding box appears with 8 handles (corners + edges) + rotation handle. I drag a corner with the cursor → scales preserving aspect when Shift held; from center when Option held. I drag the rotation handle → rotates with degree readout.

### S3 — Free-transform precision
> **Story 3.** As an illustrator needing exact alignment, I open the transform sub-panel. I see numeric inputs: X, Y, Width, Height, Rotation, Skew-X, Skew-Y, Flip-H, Flip-V. I type 50% width, the layer scales precisely. I commit with Enter.

### S4 — Multi-layer transform (group)
> **Story 4.** As an illustrator, I select three layers via the layer panel (cmd-tap or long-press multi-select). I tap "Transform" → a single bounding box encompasses all three. I scale and rotate them as one; they preserve relative positions.

### S5 — Distort for perspective
> **Story 5.** As an illustrator placing a poster image onto a wall in my collage, I select the layer, switch to "Distort" sub-mode. Each corner becomes independently draggable. I drag to fit the wall's perspective. Result is reversible.

### S6 — Snap to align
> **Story 6.** As an illustrator, I drag a layer near another layer's edge. A guide line appears, the layer snaps to align. I drag past, it un-snaps. Tap a "no-snap" toggle to disable temporarily.

### S7 — Agent transforming a layer
> **Story 7.** As Claude Code, I `transform_layer({ layer_id, translate: { dx, dy }, scale: { sx, sy }, rotate_deg })` to position a layer programmatically. The change is reversible via `undo`.

## 3. Functional requirements (EARS)

### 3.1 Transform operations

**FR-1 (Ubiquitous).** A layer's `transform` SHALL be representable as a 3×3 affine matrix applied at render time. Internally stored as decomposed: `{ tx, ty, sx, sy, rotation_deg, skew_x_deg, skew_y_deg, flip_h, flip_v, anchor: { x, y } }` for round-trip clarity.

**FR-2 (Ubiquitous).** Operations supported (all reversible per P27):
- **Translate** (move): drag.
- **Scale** (uniform / non-uniform): pinch / corner-handle / edge-handle.
- **Rotate**: two-finger rotate / rotation-handle.
- **Flip** horizontal / vertical: button or sub-menu.
- **Skew**: edge-handle with modifier (Cmd / Ctrl).
- **Free transform**: combination of above, single gesture.
- **Distort** (perspective / per-corner): sub-mode, each corner draggable independently.

**FR-3 (Ubiquitous).** Distort SHALL produce a true perspective transform (not just per-corner translation), implemented as a 4-point projective mapping. Reverse is exact (perspective transforms are invertible).

### 3.2 Input model (touch-first; mouse/keyboard supported when present)

**Priority:** touch is designed first. Mouse cursor (iPadOS Magic Keyboard trackpad already today; Electron-host desktop in the future via MeshCraft) is supported as a parallel path with functional parity, never as the primary design target. Keyboard modifiers are optional shortcuts — every constraint reachable via on-screen tablet UI.

**FR-4 (Ubiquitous).** **Multitouch (primary)**:
- Tap on layer (when not in another tool) → enter transform on that layer.
- Drag → translate.
- Pinch → scale.
- Two-finger rotate → rotate.
- Three-finger drag (within transform mode) → reset transform.
- Two-finger tap → undo (passes through; transform mode doesn't intercept).

**FR-5 (Ubiquitous).** **Mouse / trackpad cursor**:
- Click on layer → enter transform.
- Bounding box renders with 8 handles + rotation handle visible:
  - 4 corner handles (square): scale 2D, default preserves aspect.
  - 4 edge handles (square): scale 1D.
  - 1 rotation handle (above bounding box, circle): rotate.
  - 1 anchor point (center, configurable): pivot.
- Drag a handle → matching transform.
- Right-click → context menu (Reset, Flip H, Flip V, Distort, Skew, Numeric input).

**FR-6 (Ubiquitous).** **Apple Pencil / S-Pen**:
- Tap on layer → enter transform.
- Pencil tap on a handle behaves like mouse click on that handle.
- Drag works the same as a finger drag would.
- Pencil-only mode (Pencil-only-Apple-Pencil for canvas) does not change transform behavior.

**FR-7 (Ubiquitous).** **Modifier keys (when keyboard present)**:
- `Shift` held during scale → preserve aspect ratio.
- `Option/Alt` held during scale → scale from center anchor (symmetrical).
- `Shift+Option` → both.
- `Cmd/Ctrl` held while dragging an edge handle → skew on that axis.
- `Cmd/Ctrl` held while dragging a corner → distort that corner only (free-form per-corner movement, **not** projective).
- `Esc` → cancel current transform (revert to pre-gesture state).
- `Enter / Return` → commit current transform.

**FR-8 (Ubiquitous).** **Tablet without keyboard (no modifiers)**:
- A floating modifier ring (small palette near transform) provides tap-equivalents for `Shift`, `Option`, `Cmd`. Active modifier is highlighted.
- Default behaviors are tuned for "no modifier needed": corner handles preserve aspect by default, edge handles non-uniform.
- Long-press any handle to toggle "from center" mode for that drag.

### 3.3 Visual feedback

**FR-9 (Ubiquitous).** Transform mode displays:
- A bounding box around the layer (or grouped layers).
- 8 corner/edge handles + 1 rotation handle.
- Anchor point (drag-able for setting pivot).
- Live readout overlay during gesture: dimensions in px, rotation in degrees, scale percentage.

**FR-10 (Ubiquitous).** During gesture, the layer renders with **lower-quality preview** (nearest-neighbor or bilinear) for responsiveness; on commit, re-renders with full quality.

**FR-11 (Ubiquitous).** Visual feedback rate: ≥ 60 FPS on iPad Pro M-class for a single 1024×1024 layer transform.

### 3.4 Snapping

**FR-12 (Ubiquitous).** Snap targets in v1:
- **Canvas edges** (top, bottom, left, right).
- **Canvas center** (horizontal + vertical center lines).
- **Other layer edges** (any non-active layer's bounding-box edges).
- **Other layer centers**.
- **Grid** (toggleable; default off; 16 px in v1).

**FR-13 (Ubiquitous).** Snap distance threshold: 6 viewport pixels (configurable). When the dragged feature is within threshold, snap engages and a **guide line** renders at the snap point.

**FR-14 (Ubiquitous).** Snap can be temporarily disabled by holding `Cmd/Ctrl` (mouse) or by toggling a "free move" button on the floating ring (tablet).

**FR-15 (Ubiquitous).** Rotation snap: snaps to multiples of 15° (0°, 15°, 30°, ..., 345°) within ~3° of the snap angle. Disable by same modifier.

### 3.5 Group transforms

**FR-16 (Ubiquitous).** When multiple layers are selected (via panel multi-select or via a `group_id`), transforming SHALL apply to all selected layers as one rigid composite, preserving their relative offsets, scales, and rotations.

**FR-17 (Ubiquitous).** A single Command for a group transform SHALL revert all child layers' transforms in one undo step (per `undo-redo-system` Q6).

### 3.6 Free-transform tool vs. always-on transform

**FR-18 (Ubiquitous).** v1 SHALL support **two modes**:
- **Quick transform** (default): tapping any layer when no other tool is active enters transform on that layer.
- **Transform tool** (explicit): selectable in the tool palette; clicking any non-tool area clears the active layer's transform handles (which would otherwise remain).

**FR-19 (Ubiquitous).** When a paint/mask brush is active, transform handles do not appear on tap (taps go to brush). Switch to a non-paint tool or the explicit Transform tool to access handles.

### 3.7 Numeric input panel

**FR-20 (Ubiquitous).** A "Transform" sub-panel SHALL provide numeric inputs: `X`, `Y` (in canvas px), `W`, `H` (px or %), `Rotation` (degrees, ±360), `Skew X`, `Skew Y`, `Flip H`, `Flip V`. Plus reset buttons per axis.

**FR-21 (Ubiquitous).** Editing a numeric value applies on Enter or focus-loss; constraint to canvas bounds is informational only (allow negative coords for off-canvas placement).

### 3.8 MCP tool

**FR-22 (Ubiquitous).** `transform_layer({ layer_id, transform: TransformMatrix | TransformDecomposed, anchor?, document_id? })` is **promoted into v1 catalog** by this spec. It is `write, reversible`.

**FR-23 (Ubiquitous).** Input accepts EITHER a 3×3 matrix OR the decomposed form. Server stores decomposed form internally for round-tripping.

**FR-24 (Ubiquitous).** Output: `{ layer_id, transform: TransformDecomposed }` reflecting the new state.

**FR-25 (Ubiquitous).** When applied to a group, the input field `target` is the group_id; revert reapplies the inverse to all children (Command stores their pre-transform state).

### 3.9 Performance targets

**FR-26 (Ubiquitous).** Single-layer transform interaction (drag a corner handle continuously): ≥ 60 FPS at 1024×1024 layer; ≥ 30 FPS at 4096×4096 layer.

**FR-27 (Ubiquitous).** Group transform with 5 layers: ≥ 60 FPS during interaction.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Handle hit-test SHALL be in viewport space, not canvas space (handle hit zones don't shrink when zooming out).

**NFR-2 (Ubiquitous).** Handle hit zone SHALL be ≥ 32×32 pt for touch (Apple HIG); ≥ 8×8 pt for mouse (visible 6×6 with extra hit zone padding).

**NFR-3 (Ubiquitous).** Numeric inputs SHALL accept arithmetic expressions (e.g., `512 / 2` evaluates to `256`).

**NFR-4 (Ubiquitous).** All transform operations SHALL be reversible exactly (no floating-point drift on reverts).

## 5. Out of scope

- **Warp / mesh deformation** beyond 4-point projective. Mesh warp is post-v1.
- **Path-based transforms** (e.g., bend along a curve). Post-v1.
- **3D transforms** (rotation in Z). Post-v1.
- **Animation timeline of transforms**. Post-v1.

## 6. Open questions

### Q1 — Default behavior of corner handles: preserve aspect or free?
Procreate: corners free unless toggled. Photoshop: corners free (Shift = preserve). Figma: corners preserve (Shift = free).

**Recommendation:** **preserve aspect by default; Shift to free**. Aligns with what an illustrator typically wants (uniformly scale a reference image), and matches Figma which is the recent UX standard. Configurable via user pref.

### Q2 — Should transform tool show handles for **multiple selected layers**?
Yes, but bounding box around all is one composite.

**Recommendation:** **yes**. A single composite bounding box; transform applies as one rigid op. Per FR-16/17.

### Q3 — Anchor point: stay at layer center or layer-content centroid?
Some images have visual centers off-center.

**Recommendation:** **layer's bounding-box center by default**, draggable to any point. User-set anchor persists for the duration of the transform session and resets on commit.

### Q4 — Should Distort be its own tool or sub-mode?
Sub-mode (toggle) inside Transform vs. separate tool.

**Recommendation:** **sub-mode toggle** in the floating ring: Transform / Distort / Skew. Cleaner than three separate tools.

### Q5 — Snap to non-axis-aligned guides (e.g., other layer's rotated edge)?
Complex; visual debt high.

**Recommendation:** **no in v1.** Snap targets are axis-aligned only (canvas edges, layer bounding-box edges in their non-rotated form). Rotated-layer edge snap is post-v1.

### Q6 — Live preview quality vs. responsiveness tradeoff
Bilinear during gesture, full quality on commit.

**Recommendation:** **bilinear during gesture, full Skia rendering on commit.** Acceptable visual lag; responsiveness wins.

### Q7 — Should `transform_layer` accept partial inputs (e.g., only `translate` field)?
Or always full transform?

**Recommendation:** **partial inputs**. Each provided field updates that aspect; missing fields preserve current value. Easier for agents (just translate without computing full matrix).

## 7. Acceptance criteria

This spec is APPROVED when:

1. The seven user stories (§2) are realized by the FRs.
2. Multitouch and mouse have **functional parity** — every operation possible by one is possible by the other.
3. Modifier keys + tablet floating ring give equivalent expressive power.
4. Group transforms work as a single reversible Command.
5. Snapping covers axis-aligned cases without UI clutter.
6. `transform_layer` tool is added to the v1 catalog (FR-22).
7. Performance targets are met on iPad Pro M-class.
8. Open questions have acceptable recommendations.
