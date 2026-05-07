# selection-tools — Design

> **Companion to:** `requirements.md` (v0.2 — extended with §3.8 Edit scoping and §3.9 Tap-to-deselect). **References:** `mask-system`, `canvas-fundamentals`, `brush-system`, `brush-canvas-rendering`, `editor-canvas-integration`, `transform-tools`, `image-io`, `generation-workflow`, `comfyui-management`, `mcp-tool-catalog`.

## 0. Boundary commitments

**This spec owns:**
- Selection state model (`Selection` union) and its mutating operations (`set_selection`, `invert_selection`, `select_all`, `clear_selection`, `refine_selection`, `auto_select_subject`, `select_by_prompt`).
- The **selection-as-clip invariant** (FR-34..FR-39): the contract that every raster-write operation observes the active selection. The shared clip helper (§11) lives here and is consumed by all write-introducing specs.
- The **tap-to-deselect gesture** (FR-40..FR-46): the gesture-level state machine that converts a tap on canvas (in the right tool/mode) into `setSelection({ kind: "none" })`. Lives in the editor's gesture composition layer.
- Marching-ants overlay and protected-region overlay (FR-27, FR-28).
- The "Deselect" undo entry semantics (FR-46).

**Out of boundary:**
- The actual brush stroke compositor logic (`composeStrokeIntoRaster`) — owned by `brush-system`. This spec only adds an opt-in clip parameter; the compositor's stamp math is unchanged.
- Layer rasterization for transform commit — owned by `transform-tools`. This spec defines the contract that the transform commit MUST consume the clip helper.
- Mask layer storage and the `refine_mask` op — owned by `mask-system`.
- The Skia clip primitive — owned by `canvas-skia`. This spec consumes Skia's `clipPath` / `clipShader` API.

**Allowed dependencies (incoming → outgoing):**
- `selection-tools` MAY depend on: `canvas-fundamentals`, `mask-system` (for `selectionToMaskBytes`), `mcp-tool-catalog`, `server-architecture`.
- `selection-tools` MUST NOT depend on: `brush-system`, `transform-tools`, `image-io`, `generation-workflow` (those depend on this spec via the clip helper, not the other way).
- The clip helper module SHALL have zero dependencies beyond canvas-core types.

**Revalidation triggers:**
- A new write-introducing spec is added (must adopt the clip helper — this spec's invariant FR-38).
- The Skia or RNGH version bumps in a way that changes `clipShader` or `Gesture.Race` semantics (per memory: version-aware APIs).
- The selection state model gains a new `kind` (must add a `selectionToMaskBytes` branch).

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Dedicated `refine_selection` tool.** +1 to v1 catalog (~51 — within new cap of 50, may need re-trim or raise to 55). |
| Q2 | **`auto_select_subject` accepts optional `tap_point`;** absent = auto-detect salient subject. |
| Q3 | **AI segmentation as ComfyUI extensions.** Required-nodes list extends to optional Grounded-SAM / SAM nodes. |
| Q4 | **Magic wand samples active layer by default;** "Sample composite" toggle. |
| Q5 | **Polygonal lasso constrains to 45°** with Shift OR on-screen ring "↗" toggle. |
| Q6 | **Selection not persisted across reopen.** |
| Q7 | **Selection persists across active-layer changes.** Document-level state. |
| Q8 | **Tap thresholds: 4 pt translation, 250 ms duration.** Matches iOS HIG; encoded as constants `TAP_DESELECT_MAX_DISTANCE_PT` / `TAP_DESELECT_MAX_DURATION_MS` in `useToolGestures.ts`. Tunable but deliberately stable. |
| Q9 | **Tap in boolean Add/Subtract/Intersect = no-op.** Compound selections are expensive to rebuild; accidental loss is the worse failure mode. |
| Q10 | **AI inpaint composition clipped by active selection.** Final composition mask = `inpaint_mask × selection_mask` so a user-set selection further constrains generation. Implemented in `generation-workflow`'s composition step, consuming the same clip helper as brushes. |
| Q11 | **Tap-to-deselect coachmark deferred to follow-up.** First-time discovery hint (one-shot toast: "Tap empty canvas to clear selection") routed through `screens-implementation` after v1; not a v1 blocker. |

## 2. Module layout

```
libs/canvas-core/src/selection/
├── index.ts
├── types.ts                     # Selection union types
├── operations.ts                # boolean ops, refine, invert, select all
├── lasso.ts                     # path simplification (Ramer-Douglas-Peucker)
├── magic-wand.ts                # tolerance-based flood fill
└── render-helpers.ts            # marching-ants path computation, bounding-box

libs/server/src/lib/handlers/
├── set-selection.ts             # extended with op + polygon kind
├── invert-selection.ts
├── select-all.ts
├── refine-selection.ts
├── auto-select-subject.ts       # job
└── select-by-prompt.ts          # job

libs/server/src/lib/comfy/segmentation/
├── client.ts                    # wrapper invoking SAM/Grounded-SAM via ComfyUI
├── warm-pool.ts                 # keep model warm in VRAM
├── cache.ts                     # per-(layer-hash, model-id, point) cache
└── preprocessing.ts             # downscale + upscale-mask pipeline

libs/canvas-skia/src/overlay/
├── selection-marching-ants.ts
└── selection-protected-overlay.ts

libs/ui/src/selection/
├── SelectionToolbar.tsx         # tools + boolean op picker
├── tools/
│   ├── RectangleTool.tsx
│   ├── LassoTool.tsx
│   ├── PolygonalLassoTool.tsx
│   ├── MagicWandTool.tsx
│   ├── AutoSelectTool.tsx       # tier 2
│   └── PromptSelectTool.tsx     # tier 3
├── BooleanOpPicker.tsx
├── RefinePanel.tsx
└── PromptInput.tsx
```

## 3. Selection types & operations

```typescript
// libs/canvas-core/src/selection/types.ts
export type Selection =
  | { kind: "none" }
  | { kind: "rect"; rect: { x: number; y: number; w: number; h: number } }
  | { kind: "polygon"; points: Point[] }
  | { kind: "mask"; mask: ImageEnvelope };

export type SelectionOp = "replace" | "add" | "subtract" | "intersect";

// libs/canvas-core/src/selection/operations.ts
export function applyOp(current: Selection, incoming: Selection, op: SelectionOp): Selection {
  if (op === "replace") return incoming;
  // for add/subtract/intersect, convert both to mask, do binary op, return as mask kind
  const dims = /* document dims */;
  const a = selectionToMask(current, dims);
  const b = selectionToMask(incoming, dims);
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = op === "add" ? Math.max(a[i], b[i])
              : op === "subtract" ? Math.max(0, a[i] - b[i])
              : /* intersect */ Math.min(a[i], b[i]);
  }
  return { kind: "mask", mask: encodeAsPng(result, dims) };
}
```

## 4. Segmentation client (server-side, all via ComfyUI)

**Default Tier 2 model: MobileSAM** (9 MB, mature ComfyUI tooling). Tier 3 swaps to a heavier variant; Tier 4 (prompt-based) feeds VLM-derived bounding boxes from MCP sampling into the same SAM model.

```typescript
// libs/server/src/lib/comfy/segmentation/client.ts
export class SegmentationClient {
  constructor(
    private comfy: ComfyClient,
    private warmPool: WarmPool,
    private cache: SegmentationCache,
    private samplingForwarder: SamplingForwarder,    // for Tier 4
    private config: SegmentationConfig
  ) {}

  /** Tier 2 / Tier 3: tap-point-driven segmentation via SAM-class model. */
  async autoSelectSubject(opts: { layer_image: Uint8Array; tap_point?: Point; quality?: "fast" | "high" }): Promise<Uint8Array> {
    const modelId = opts.quality === "high" ? this.config.tier3_model : this.config.tier2_model;
    const cacheKey = computeKey(opts.layer_image, opts.tap_point, modelId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    await this.warmPool.ensureWarm(modelId);
    const downscaled = preprocess(opts.layer_image, 1024);
    const graph = buildSAMGraph({ image: downscaled, model: modelId, point: opts.tap_point });
    const { prompt_id } = await this.comfy.submitGraph(graph);
    const maskBytes = await this.waitForResult(prompt_id);
    const upscaled = upscaleMask(maskBytes, opts.layer_image);

    this.cache.set(cacheKey, upscaled);
    return upscaled;
  }

  /** Tier 4: prompt-based via VLM (MCP sampling) → bbox → SAM. */
  async selectByPrompt(opts: { layer_image: Uint8Array; prompt: string }, ctx: HandlerContext): Promise<Uint8Array> {
    // Step 1: ask the calling agent (via MCP sampling) for bounding boxes matching the prompt
    let boxes: BoundingBox[];
    try {
      const samplingResponse = await this.samplingForwarder.requestFromAgent({
        kind: "vision-grounding",
        image: opts.layer_image,
        prompt: opts.prompt,
        instruction: "Return one or more bounding boxes (normalized 0-1) for objects matching the prompt.",
      }, ctx.tokenId);
      boxes = parseBoundingBoxes(samplingResponse);
    } catch (err) {
      // Tier 4 unsupported or sampling failed → fall back to Tier 2 with a notice
      throw new ServerError({
        code: "SAMPLING_NOT_SUPPORTED",
        message: "Prompt-based selection requires an agent that supports MCP sampling (Claude, Codex, Gemini CLI). Connected agent does not.",
        hint: "Use auto_select_subject with a tap point as fallback.",
      });
    }

    // Step 2: feed each bbox into MobileSAM as a box prompt
    const modelId = this.config.tier2_model;
    await this.warmPool.ensureWarm(modelId);
    const downscaled = preprocess(opts.layer_image, 1024);
    const graph = buildSAMGraph({ image: downscaled, model: modelId, boxes });
    const { prompt_id } = await this.comfy.submitGraph(graph);
    const maskBytes = await this.waitForResult(prompt_id);
    return upscaleMask(maskBytes, opts.layer_image);
  }
}
```

The `SamplingForwarder` integrates with `client-sdk` MCP sampling (already specced) — the server raises a sampling request to the agent, agent answers with boxes, server uses them to drive SAM. **Vendor-neutral**: works with any agent that implements the standard MCP sampling protocol.

## 5. Warm pool

```typescript
// libs/server/src/lib/comfy/segmentation/warm-pool.ts
export class WarmPool {
  private warm = new Set<string>();

  async ensureWarm(modelId: string): Promise<void> {
    if (this.warm.has(modelId)) return;
    // submit a no-op graph that just loads the model
    await this.comfy.submitGraph(buildLoadOnlyGraph(modelId));
    this.warm.add(modelId);
  }

  // LRU eviction triggered on VRAM pressure (received via comfy events)
  evict(modelId: string): void {
    this.warm.delete(modelId);
  }
}
```

The pool ensures the **first call after server boot** triggers a load (~3 s cold), and **subsequent calls** within the warm window return ~800 ms.

## 6. Cache

```typescript
// libs/server/src/lib/comfy/segmentation/cache.ts
export class SegmentationCache {
  private map = new Map<string, { mask: Uint8Array; ts: number }>();
  private TTL = 60_000;

  get(key: string): Uint8Array | undefined {
    const entry = this.map.get(key);
    if (!entry || Date.now() - entry.ts > this.TTL) return undefined;
    return entry.mask;
  }
  set(key: string, mask: Uint8Array): void {
    this.map.set(key, { mask, ts: Date.now() });
  }
}

export function computeKey(imageBytes: Uint8Array, tap?: Point): string {
  const hash = sha256(imageBytes).slice(0, 16);
  const grid = tap ? `${Math.floor(tap.x / 32)}-${Math.floor(tap.y / 32)}` : "auto";
  return `${hash}:${grid}`;
}
```

## 7. Tablet selection toolbar

```typescript
// libs/ui/src/selection/SelectionToolbar.tsx
export const SelectionToolbar: React.FC = () => {
  const activeTool = useEditorStore((s) => s.active_tool);
  const op = useEditorStore((s) => s.selection_op);
  const setOp = useEditorStore((s) => s.setSelectionOp);
  const catalog = useMcpCatalogStore();

  return (
    <Toolbar>
      <ToolButton tool="rectangle" active={activeTool === "rectangle"} icon="□" />
      <ToolButton tool="lasso" active={activeTool === "lasso"} icon="〰" />
      <ToolButton tool="polygonal-lasso" active={activeTool === "polygonal-lasso"} icon="✦" />
      <ToolButton tool="magic-wand" active={activeTool === "magic-wand"} icon="🪄" />
      <Divider />
      {catalog.hasTool("auto_select_subject") && (
        <ToolButton tool="auto-select" active={activeTool === "auto-select"} icon="✨" />
      )}
      {catalog.hasTool("select_by_prompt") && (
        <ToolButton tool="prompt-select" active={activeTool === "prompt-select"} icon="🔮" />
      )}
      <Divider />
      <BooleanOpPicker value={op} onChange={setOp} />
      <Divider />
      <RefineButton />
      <InvertButton />
      <SelectAllButton />
      <ClearButton />
    </Toolbar>
  );
};
```

`hasTool(...)` checks the negotiated catalog (per `client-state-architecture` `mcpCatalogStore.hasTool`); AI-tool buttons gracefully hide when the underlying ComfyUI nodes aren't installed.

## 8. Lasso path → polygon

```typescript
// libs/canvas-core/src/selection/lasso.ts
export function simplifyLassoPath(rawPoints: Point[]): Point[] {
  // Ramer-Douglas-Peucker with epsilon 1px
  return rdp(rawPoints, 1.0);
}
```

## 9. Magic wand

```typescript
// libs/canvas-core/src/selection/magic-wand.ts
export function magicWandSelect(
  imageBytes: Uint8Array,    // active layer or composite
  dims: { w: number; h: number },
  tapPoint: Point,
  tolerance: number,
  contiguous: boolean
): Uint8Array {
  const sampleColor = sampleRGB(imageBytes, dims, tapPoint);
  const mask = new Uint8Array(dims.w * dims.h);
  if (contiguous) {
    floodFill(imageBytes, dims, tapPoint, sampleColor, tolerance, mask);
  } else {
    for (let i = 0, p = 0; i < imageBytes.length; i += 4, p++) {
      if (colorDistance(imageBytes.slice(i, i + 3), sampleColor) <= tolerance) mask[p] = 255;
    }
  }
  return mask;
}
```

## 10. Catalog impact summary

After `transform-tools` (+1) + `mask-system` (+7) + `selection-tools` (+5: invert_selection, select_all, refine_selection, auto_select_subject, select_by_prompt), v1 catalog reaches **~51 tools**.

**Action items for `mcp-tool-catalog`**:
- Cap raised again from 50 to **55** (we'll keep climbing as feature specs add tools — that's expected).
- Footprint NFR-3 (≤100 KB) remains the hard gate; trim descriptions if necessary.

## 11. Selection-as-clip pipeline (FR-34..FR-39)

**Goal.** Make the active selection a hard, declarative clip on every raster write — server compositor (`paint_strokes`, transform commit, paste, AI inpaint composition) AND client preview (Skia stamp pipeline) — without forking each call site.

### 11.1 Shared clip helper

```
libs/canvas-core/src/composite/
├── index.ts
├── selection-clip.ts            # NEW: SelectionClip type + capture + sample
└── selection-clip.test.ts       # disabled until v1 (per testing memory)
```

```typescript
// libs/canvas-core/src/composite/selection-clip.ts
import { selectionToMaskBytes } from '../mask/selection-mask';
import type { Selection } from '../document/selection';
import type { MaskDims } from '../mask/selection-mask';
import type { LayerId } from '../shared/ids';

/**
 * Frozen snapshot of the active selection rasterized to a clip mask.
 * Captured at the *start* of a write operation (FR-39) and held immutable
 * until the operation commits. Subsequent selection mutations do not
 * affect the in-flight op.
 */
export interface SelectionClip {
  readonly kind: 'none' | 'mask';
  readonly bytes: Uint8Array | null;     // null when kind === 'none'
  readonly dims: MaskDims;
}

export function captureSelectionClip(
  selection: Selection,
  dims: MaskDims,
  resolveMask?: (id: LayerId) => Uint8Array | undefined,
): SelectionClip {
  if (selection.kind === 'none') {
    return { kind: 'none', bytes: null, dims };
  }
  const bytes = selectionToMaskBytes(selection, dims, resolveMask);
  // FR-34: empty mask (all zeros) is observationally equivalent to 'none'.
  if (!bytes.some((b) => b !== 0)) {
    return { kind: 'none', bytes: null, dims };
  }
  return { kind: 'mask', bytes, dims };
}

/**
 * Sample the clip alpha at integer pixel (px, py). Returns 1.0 (full pass)
 * when the clip is `none`, otherwise `bytes[py * width + px] / 255`.
 *
 * Out-of-bounds → 0 (clipped). Used by both the brush compositor (FR-37
 * per-pixel alpha multiplication) and the AI composition step (Q10).
 */
export function sampleClipAt(
  clip: SelectionClip,
  px: number,
  py: number,
): number {
  if (clip.kind === 'none') return 1;
  const { bytes, dims } = clip;
  if (bytes === null) return 1;
  if (px < 0 || py < 0 || px >= dims.width || py >= dims.height) return 0;
  return bytes[py * dims.width + px]! / 255;
}
```

### 11.2 Brush compositor extension (server side)

`composeStrokeIntoRaster` in `libs/canvas-core/src/brush/compose-stroke.ts` gains an optional `clip?: SelectionClip` parameter. When present, the stamp coverage at each pixel is multiplied by `sampleClipAt(clip, px, py)` *before* the existing alpha math. When absent (or `clip.kind === 'none'`), behavior is bit-identical to today (zero-overhead path).

```typescript
// extension to existing libs/canvas-core/src/brush/compose-stroke.ts

export interface ComposeStrokeOptions {
  readonly color?: BrushColor;
  readonly maskOnly?: boolean;
  readonly clip?: SelectionClip;          // NEW
}

// Inside the per-pixel loop:
//   const cov = stampCoverage(...);
//   if (cov <= 0) continue;
//   const clipAlpha = options.clip ? sampleClipAt(options.clip, px, py) : 1;
//   if (clipAlpha <= 0) continue;
//   const sa = cov * stamp.opacity * clipAlpha;        // FR-37
```

The `if (clipAlpha <= 0) continue;` short-circuit keeps outside-selection pixels bit-identical (FR-34).

### 11.3 Server handler integration

```typescript
// libs/server/src/lib/handlers/paint-strokes.ts (extension)
//
// At the top of the handler — before the per-stroke loop:
const clip = captureSelectionClip(
  doc.selection,
  { width: doc.width, height: doc.height },
  (id) => maskStore.getBytes(id),
);
//
// In the inner loop:
raster = composeStrokeIntoRaster(raster, scaledStamps, {
  color, maskOnly, clip,            // NEW: pass the captured clip
});
```

The capture happens **once per handler invocation**, not per stroke. The reversible-command middleware already snapshots `doc.selection` at op-begin; the captured clip is therefore immutable for the operation's lifetime → FR-39 is satisfied without additional locking.

The same pattern applies to:
- `transform-tools` commit handler (rasterize transformed layer → compose into base → clip).
- `image-io` paste handler (rasterize incoming bytes → compose into target → clip).
- `generation-workflow` AI composition step (clip the inpaint result before merging into the layer; Q10).
- `mask-system` `refine_mask` when called against a layer's pixels (versus a standalone mask buffer).

### 11.4 Client preview (Skia)

The tablet preview path already uses Skia primitives in `libs/canvas-skia/src/CanvasView.tsx`. We add a declarative `<SelectionClipBoundary>` wrapper:

```
libs/canvas-skia/src/clip/
├── SelectionClipBoundary.tsx    # NEW: <Group> with Skia clipPath / clipShader
└── selection-clip-skia.ts       # NEW: build Skia.Path from Selection
```

```typescript
// libs/canvas-skia/src/clip/SelectionClipBoundary.tsx (sketch)
//
// <Group clipPath={selectionPath}>
//   { /* brush preview, transform preview, paste preview, etc. */ }
// </Group>
//
// For lasso/rect: build a single Skia.Path from the polygon/rect.
// For mask kind: use Skia.Shader.MakeImage(maskAsAlphaImage) with
//   blend-mode `dstIn` (simulates a soft clip honoring per-pixel alpha;
//   FR-37 visual parity with server).
```

The brush preview component renders inside `<SelectionClipBoundary>`; outside-selection pixels are clipped by Skia natively. Marching-ants overlay (FR-27) and protected-region overlay (FR-28) render outside the boundary so they remain visible.

### 11.5 Cross-spec contract

| Spec | Owner of the write | Contract change |
|---|---|---|
| `brush-system` | `paint_strokes` handler + `composeStrokeIntoRaster` | Adds `clip` parameter (additive, opt-in). |
| `brush-canvas-rendering` | Skia stamp render component | Wrap in `<SelectionClipBoundary>`. |
| `transform-tools` | Transform commit handler | Capture clip at op-begin; clip rasterized output. |
| `image-io` | Paste handler | Capture clip at op-begin; clip pasted output. |
| `mask-system` | `refine_mask` (when target = layer pixels) | Capture clip; clip refinement. |
| `generation-workflow` | Inpaint composition | Capture clip; multiply into final composition mask (Q10). |

Each owner spec links to §11 and adopts the clip in its own implementation tasks. This spec exposes the helper; consumers integrate.

## 12. Tap-to-deselect gesture composition (FR-40..FR-46)

**Goal.** Compose `Gesture.Tap()` into the existing tool gesture builders so a quick tap (no drag) on the canvas, while a Tier 1 area-selection tool is active in `Replace` mode, calls `setSelection({ kind: "none" })`. Magic-wand, auto-select, and polygonal-lasso construction stay tap-native.

### 12.1 Constants

```typescript
// apps/mobile/src/screens/Editor/useToolGestures.ts (new constants near the top)
const TAP_DESELECT_MAX_DISTANCE_PT = 4;     // FR-45
const TAP_DESELECT_MAX_DURATION_MS = 250;   // FR-45
```

### 12.2 Tap-to-deselect gesture builder

```typescript
// apps/mobile/src/screens/Editor/useToolGestures.ts (new helper)
//
// Returns a Gesture.Tap that, when it fires, reads the current boolean op
// and either clears the selection (Replace) or no-ops (Add/Subtract/Intersect).
// FR-40, FR-41, FR-46.
const buildSelectionTapDeselectGesture = useCallback((): GestureType => {
  return Gesture.Tap()
    .runOnJS(true)
    .maxDuration(TAP_DESELECT_MAX_DURATION_MS)
    .maxDistance(TAP_DESELECT_MAX_DISTANCE_PT)
    .onEnd(() => {
      const state = editorStore.getState();
      if (state.selection_op !== 'replace') return;     // FR-41
      if (state.selection.kind === 'none') return;       // already empty — silent
      state.setSelection({ kind: 'none' });              // FR-40
      // FR-46: undo entry labeled "Deselect" — reversible-command middleware
      // assigns the label from the calling action.
    });
}, [editorStore]);
```

Per the saved RNGH/Skia version-aware-API memory: confirm `.runOnJS(true)` is required for the installed RNGH version before commit; the existing builders in this file already use that pattern, so we follow suit.

### 12.3 Per-tool composition

| Tool | Gesture composition | Rationale |
|---|---|---|
| `lasso` | `Gesture.Race(buildSelectionTapDeselectGesture(), buildLassoGesture())` | Tap (no drag) deselects; pan starts a lasso path. |
| `rect-select` | `Gesture.Race(buildSelectionTapDeselectGesture(), buildRectSelectGesture())` | Same shape. |
| `polygonal-lasso` | Custom: tap adds a vertex while polygon is mid-construction; once closed, swap to `Race(tap-deselect, polygon-builder)` | FR-44 state-dependent behavior. |
| `magic-wand` | (unchanged: tap-only sampling) | FR-42 — tap means sample. |
| `auto-select` | (unchanged: tap-only segmentation prompt) | FR-43 — tap means segment. |
| `brush` / `eraser` / `transform` / etc. | (unchanged) | Tap-to-deselect is a selection-tool feature only. |

`Gesture.Race` is the right primitive: whichever gesture recognizes first wins. Because `Gesture.Tap()` recognizes only when the gesture *ends* within the distance/duration budget, and `Gesture.Pan()` recognizes the moment translation exceeds the activation threshold (typically ~2 pt by default in RNGH), a slow drag of even a few pixels will activate Pan first; a clean tap will activate Tap. The 4 pt / 250 ms cap on the Tap gesture protects against deliberately fast lasso starts being misclassified.

### 12.4 Polygonal lasso state machine (FR-44)

The polygonal-lasso has two sub-states; tap semantics differ:

```
              ┌──────────────┐  tap (close polygon)   ┌────────────┐
   tool ───►  │ idle (no     │ ────────────────────►  │ closed     │
   active     │ vertices)    │                        │ (selection │
              └──────┬───────┘                        │ active)    │
                     │ tap                            └─────┬──────┘
                     ▼                                      │ tap (FR-40)
              ┌──────────────┐  tap on first vertex          ▼
              │ constructing │ ─────────────────►   selection = none
              │ (≥1 vertex,  │
              │  not closed) │
              └──────┬───────┘
                     │ tap (add vertex, FR-5)
                     └──► loop
```

Implementation: in the polygonal-lasso builder, track `verticesRef.current.length` and the polygon-closed flag. Compose `Gesture.Tap()` whose `onEnd` branches on state:
1. `verticesRef.length === 0 && selection.kind === 'none'` → first vertex
2. `verticesRef.length >= 1` and tap on first vertex → close polygon, set selection
3. `verticesRef.length >= 1` and tap elsewhere → add vertex
4. `verticesRef.length === 0 && selection.kind !== 'none'` → tap-to-deselect (FR-40)

This single Tap gesture covers all four cases; the Pan gesture is not used for polygonal lasso.

### 12.5 In-progress write protection (FR-39)

If a brush stroke is in flight when the user taps to deselect, the stroke's clip was captured at op-begin (§11.3). The selection mutation that the tap triggers takes effect immediately on `editorStore`, but it does NOT mutate the in-flight clip. The next operation observes the new (empty) selection. No additional locking required.

### 12.6 File touch list

| Path | Change |
|---|---|
| `apps/mobile/src/screens/Editor/useToolGestures.ts` | Add `TAP_DESELECT_*` constants; add `buildSelectionTapDeselectGesture`; wrap `buildLassoGesture` and `buildRectSelectGesture` in `Gesture.Race(...)`; rewrite polygonal-lasso to use the state-machine Tap. |
| `apps/mobile/src/screens/Editor/useGestureCompositor.ts` | No change — composition tree remains the same; tap-deselect lives inside the per-tool gesture, not at the compositor level. |
| `libs/core/src/stores/editor/selection-slice.ts` | Verify `setSelection({ kind: 'none' })` produces a labeled undo entry "Deselect" (FR-46); add label if missing. |

## 13. File Structure Plan

```
libs/canvas-core/src/composite/                 [NEW]
├── index.ts                                    # exports SelectionClip, capture, sample
├── selection-clip.ts                           # §11.1 — SelectionClip + helpers
└── selection-clip.test.ts                      # disabled (testing memory)

libs/canvas-core/src/brush/compose-stroke.ts    [MODIFY]
└── add `clip?: SelectionClip` to ComposeStrokeOptions; multiply coverage by sampleClipAt

libs/canvas-skia/src/clip/                      [NEW]
├── index.ts
├── SelectionClipBoundary.tsx                   # §11.4 — <Group clipPath/clipShader>
└── selection-clip-skia.ts                      # build Skia.Path from Selection

libs/canvas-skia/src/CanvasView.tsx             [MODIFY]
└── wrap brush/transform/paste preview layers in <SelectionClipBoundary>

libs/server/src/lib/handlers/paint-strokes.ts   [MODIFY]
└── captureSelectionClip at handler start; pass clip into composeStrokeIntoRaster

libs/server/src/lib/handlers/transform-commit.ts (or equivalent) [MODIFY]
└── same pattern: capture clip; clip rasterized output

libs/server/src/lib/handlers/paste.ts (image-io) [MODIFY]
└── same pattern

libs/server/src/lib/comfy/composition.ts (generation-workflow) [MODIFY]
└── multiply selection clip into inpaint composition mask (Q10)

apps/mobile/src/screens/Editor/useToolGestures.ts [MODIFY]
└── §12 — TAP_DESELECT_* constants, buildSelectionTapDeselectGesture,
      Race wrapping for lasso/rect, polygonal-lasso state machine

libs/core/src/stores/editor/selection-slice.ts  [VERIFY/MODIFY]
└── ensure setSelection({ kind: 'none' }) emits "Deselect" undo label
```

## 14. Testing Strategy

Per the saved testing-disabled memory (`feedback_testing_disabled.md`), automated tests are archived under `.kiro/tests-backup/` until end of v1; this section is the **manual verification protocol** the implementer SHALL execute on real hardware.

| Coverage area | Manual check | Requirement |
|---|---|---|
| Brush respects rect selection | Rect-select a region, paint outside — outside pixels unchanged after stroke commit. | FR-34 |
| Brush respects lasso selection (soft edge) | Lasso a region, paint near edge — visible alpha falloff matching lasso anti-aliasing. | FR-37 |
| Eyedropper unaffected by selection | Selection active, sample a color outside it — color picked correctly. | FR-35 |
| `select_all` ≡ `none` for writes | Compare two strokes (same input): one with no selection, one with `select_all`. Pixel diff = 0. | FR-36 |
| Mid-stroke selection change | Begin stroke, mid-stroke clear selection — stroke completes within original clip. | FR-39 |
| Tap-to-deselect (lasso, Replace) | Lasso a region, tap empty canvas — selection cleared, undo restores. | FR-40, FR-46 |
| Tap-no-op (lasso, Add mode) | Lasso a region in Add mode, tap — selection unchanged. | FR-41 |
| Magic wand tap = sample | Wand tool active with selection, tap a colored pixel — new selection by tolerance. | FR-42 |
| Auto-select tap = segment | Auto-select tool active with selection, tap subject — segmentation runs. | FR-43 |
| Polygonal lasso construction | Tap to add vertices, double-tap or first-vertex tap to close, then tap empty canvas to deselect. | FR-44 |
| Tap threshold | Quick stylus down→up at fixed point < 250 ms registers as tap; slow drag does not. | FR-45 |
| AI inpaint clipped by selection | Set selection, run inpaint without explicit mask — output bounded by selection. | Q10 |

## 15. Acceptance criteria

1. Tier 1 selections all work touch-first.
2. Boolean ops compose cleanly via `applyOp`.
3. AI tier 2 + 3 are functional with lightweight models, sub-second after warm.
4. Pre-warming + cache deliver responsive UX after first cold call.
5. Catalog cap raised; footprint asserted.
6. AI tools gracefully hidden when nodes unsupported.
7. **§11 selection-as-clip pipeline:** every raster-write call site (`paint_strokes`, transform commit, paste, AI inpaint composition) captures `SelectionClip` at op-begin and routes writes through it; outside-selection pixels are bit-identical for any operation.
8. **§12 tap-to-deselect:** lasso/rect/polygonal-lasso (closed) in `Replace` mode dismiss the selection on a tap meeting the FR-45 thresholds; magic-wand and auto-select tap remain tool-native; polygonal-lasso construction tap remains vertex-add.
9. **Cross-cutting invariant FR-38:** any future write-introducing spec consumes `captureSelectionClip` + `sampleClipAt` (review-time gate during `/kiro-review` and `/kiro-validate-impl`).
