# selection-tools — Research Log

> **Scope:** v0.2 extension covering FR-34..FR-46 (§3.8 Edit scoping + §3.9 Tap-to-deselect). Discovery type: **light** (extension to an already-implemented spec).

## 1. Discovery scope

The v0.1 spec (status: `implementation: completed`, 2026-05-03) shipped Tier 1/2/3 selection tools but did NOT formalize two cross-cutting invariants:

1. **Selection-as-clip** — that any raster write (brush, fill, transform commit, paste, AI inpaint composition) must be confined to the active selection.
2. **Tap-to-deselect** — that a tap (no drag) on canvas in Tier 1 area-selection tools (`Replace` mode) must clear the active selection.

Codebase audit confirmed both invariants are absent today: `composeStrokeIntoRaster` does not consult the selection, and `useToolGestures.ts` only composes `Gesture.Pan()` for lasso/rect-select.

## 2. Investigations

### 2.1 Brush compositor seam — owns the per-pixel write loop

- **File:** `libs/canvas-core/src/brush/compose-stroke.ts:88-159`.
- **Finding:** `composeStrokeIntoRaster(target, stamps, options)` is the single seam where every brush stamp lands in pixel data. Pure function, returns a new buffer. Already handles paint/erase/maskOnly modes via the `options` bag.
- **Implication:** Adding `clip?: SelectionClip` to `ComposeStrokeOptions` is additive, opt-in, zero overhead when omitted. No fork required.
- **Caller:** `libs/server/src/lib/handlers/paint-strokes.ts:258` (the only production caller). Single integration point on the server.

### 2.2 Selection rasterization — already exists

- **File:** `libs/canvas-core/src/mask/selection-mask.ts` exports `selectionToMaskBytes(selection, dims, resolver?)` covering `rect`/`lasso`/`mask`/`none`.
- **Implication:** No new rasterization code. The clip helper composes `selectionToMaskBytes` + capture timing + sampling.

### 2.3 Skia clip primitive — natively supported

- **File:** `libs/canvas-skia/src/CanvasView.tsx:126,408` already has the skeleton for selection-aware overlays.
- **RN-Skia 2.x** supports `<Group clipPath={path}>` declaratively, plus `clipShader` for per-pixel alpha (FR-37 soft-edge requirement). Per saved Skia version-aware-API memory: confirm the installed version's `clipShader` signature before commit.
- **Implication:** Client-side preview clip is a thin Skia wrapper; no shader authoring required.

### 2.4 Gesture composition primitive — RNGH `Gesture.Race`

- **File:** `apps/mobile/src/screens/Editor/useToolGestures.ts:556` already uses `Gesture.Tap().runOnJS(true).onEnd(...)` for the eyedropper — establishes the pattern.
- **`Gesture.Race(tapDeselect, panLasso)`** is the standard RNGH primitive for "first to recognize wins." `Gesture.Tap().maxDistance(4).maxDuration(250)` recognizes only on clean tap; `Gesture.Pan()` activates on first ~2 pt translation. Mutually exclusive, no race conditions in practice.
- Per saved RNGH version-aware-API memory: `.runOnJS(true)` is required in the installed version; existing builders confirm the pattern.

### 2.5 Reversible-command middleware — gives FR-39 for free

- **File:** `libs/server/src/lib/middleware/reversible-command.ts` snapshots the document state at op-begin (including `doc.selection`).
- **Implication:** Capturing `SelectionClip` at the top of `paint_strokes` (and equivalents) means the captured clip is naturally immutable for the operation's lifetime. No additional locking. FR-39 (mid-stroke selection-change protection) holds without state-machine work.

### 2.6 Cross-spec write inventory

Specs that introduce raster writes and must adopt the clip helper:

| Spec | Handler / pipeline |
|---|---|
| `brush-system` | `paint_strokes` → `composeStrokeIntoRaster` |
| `brush-canvas-rendering` | Skia stamp render component (preview) |
| `transform-tools` | transform commit (rasterize transformed layer into base) |
| `image-io` | paste handler |
| `mask-system` | `refine_mask` when target = layer pixels (not standalone mask buffer) |
| `generation-workflow` | inpaint composition step (Q10: clip × inpaint mask) |

Each owner spec adds tasks linking to selection-tools §11 in its own implementation plan.

## 3. Architecture decisions

| Decision | Rationale |
|---|---|
| **Clip helper lives in `libs/canvas-core/src/composite/`, not in `selection/`** | The helper is consumed by write-introducing specs, not by selection-tools itself. Placing it in a neutral `composite/` module makes the dependency direction obvious (writers → composite, not writers → selection). |
| **`SelectionClip` is a frozen snapshot, not a live reference** | Decouples in-flight ops from selection mutations. FR-39 falls out of the data model rather than requiring per-handler locks. |
| **`captureSelectionClip` collapses empty masks to `kind: 'none'`** | Equivalence with FR-36 (`select_all` ≡ `none` for writes). Avoids "empty-but-non-none" edge cases polluting the call sites. |
| **Skia preview uses `<SelectionClipBoundary>` declarative wrapper** | Co-locates clip semantics with the render tree; brush/transform/paste preview components don't need to know about selection. |
| **Tap-to-deselect lives inside per-tool gesture builders, not at the compositor level** | Magic-wand and auto-select use tap as their tool-native action; per-tool composition keeps the rule local to tools that need it (lasso/rect/polygonal-lasso closed). |
| **Polygonal lasso uses a single state-aware Tap, no Pan** | Avoids the Race-vs-Race ambiguity when the polygon is mid-construction. Cleaner state machine. |

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **A future write-introducing spec forgets to call `captureSelectionClip`** (FR-38 violation) | Cross-spec acceptance criterion #9 in design §15. `/kiro-review` and `/kiro-validate-impl` check that any spec touching raster writes references `selection-tools/design.md#11`. |
| **Tap threshold misclassifies fast lasso starts as taps** (FR-45 false positive) | 4 pt / 250 ms thresholds are conservative; revisit if telemetry shows real-world misclassifications. Q8 documents the relaxation path ("tap = ANY pointer-up before any movement of meaningful magnitude"). |
| **Skia `clipShader` perf on large soft-edge masks** | RN-Skia handles via GPU; if measured FPS drops below NFR-3 (60 FPS on iPad Pro M-class), fall back to per-pixel alpha multiply on commit (server-side already does this). |
| **Existing implementation gap on server compositor** (no clip today) | Implementation tasks below explicitly retrofit `paint_strokes` first; transform/paste/AI follow. The order matters because brush is the most-exercised path. |
| **Undo entry label collision with `clear_selection`** (FR-46) | "Deselect" label distinct from "Clear selection" so the user can tell apart explicit-button vs gesture-driven. Verified at task-implementation time. |

## 5. Open follow-ups (not blocking design)

- **Coachmark for tap-to-deselect** (Q11): one-shot toast first time the user holds a selection > 30 s without editing. Routed through `screens-implementation` post-v1.
- **Per-client selection model** (existing FR-29 caveat): tap-to-deselect on client A still affects all paired clients. Acceptable for v1; revisit when per-client selection is in scope.
- **Telemetry for FR-45 thresholds**: post-v1 instrumentation to detect misclassifications.
