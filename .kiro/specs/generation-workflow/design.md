# generation-workflow — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `comfyui-management`, `client-state-architecture`, krita-ai-diffusion `model.py`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No auto-apply on batch_size=1** by default. User preference opt-in. P8 honored uniformly. |
| Q2 | **No warning on Generate over existing canvas.** Label is the contract. |
| Q3 | **Per-document persistence in `editorStore`.** Document load restores `strength` + `selection_mode`. |
| Q4 | **Layers panel only for control-layer toggles.** Action button stays uncluttered. |
| Q5 | **Explicit `enhance_prompt` only in v1.** Auto-enhance is post-v1 preference. |

## 2. Verb resolution

```typescript
// libs/server/src/lib/handlers/generate-image/resolve-verb.ts
export function resolveVerb(input: {
  strength: number;
  selection?: Selection;
  selection_mode?: SelectionSubMode;
}): { verb: ResolvedVerb; sub_mode?: SelectionSubMode } {
  const hasSelection = input.selection !== undefined && input.selection.kind !== "none";
  const fullStrength = input.strength === 100;

  if (!hasSelection && fullStrength) return { verb: "generate" };
  if (!hasSelection && !fullStrength) return { verb: "refine" };
  if (hasSelection && fullStrength) {
    if (!input.selection_mode) {
      throw new ValidationError({
        code: "INVALID_INPUT",
        field_path: "selection_mode",
        message: "selection_mode is required when strength=100 with selection",
        hint: "Valid sub-modes: Fill, Expand, AddContent, RemoveContent, ReplaceBackground",
      });
    }
    return { verb: "fill", sub_mode: input.selection_mode };
  }
  // hasSelection && !fullStrength
  return { verb: "constrained_variation", sub_mode: input.selection_mode ?? "Fill" };
}
```

## 3. `generate_image` handler skeleton

```typescript
// libs/server/src/lib/handlers/generate-image/index.ts
export const generateImageHandler: Handler<typeof generateImage> = async (input, ctx) => {
  // 1. Resolve verb
  const { verb, sub_mode } = resolveVerb(input);

  // 2. Resolve preset + model
  const preset = resolvePreset(input.preset, ctx);
  const model = input.model ?? preset.model;
  await ctx.models.ensurePresent(model);   // throws MODEL_NOT_FOUND

  // 3. Build the ComfyUI graph (delegated to comfyui-management)
  const graphCtx: GraphContext = {
    document: await ctx.documents.get(input.document_id ?? ctx.activeDocumentId),
    preset, model, verb, sub_mode,
    job_id: ctx.job_id,                    // synthesized by tracker
  };
  const graph = await buildGraph(verb, input, graphCtx);

  // 4. Submit via JobTracker (which submits to ComfyUI and returns our job_id)
  const job_id = await ctx.tracker.submit(graph, {
    document_id: graphCtx.document.id,
    token_name: ctx.tokenName,
    parameters: input,
    verb, sub_mode,
  });

  // 5. Return immediately with job handle + resolved verb
  return {
    job_id,
    resolved_verb: verb,
    batch_size: input.batch_size ?? 1,
  };
};
```

## 4. Sub-mode → graph configuration

```typescript
// libs/server/src/lib/comfy/graph/fill-config.ts
export const FILL_SUBMODE_CONFIG: Record<SelectionSubMode, FillBuilderConfig> = {
  Fill: {
    denoise_offset_px: 8,           // krita-ai-diffusion's "orange offset"
    blend_feather_pct: 10,
    prompt_weight: 1.0,
    bias_to_surroundings: 0.5,      // 0=ignore, 1=match-completely
    description: "General purpose inpaint balancing flexibility and blending",
  },
  Expand: {
    denoise_offset_px: 0,
    blend_feather_pct: 4,
    prompt_weight: 0.5,
    bias_to_surroundings: 0.9,      // strongly continue surrounding
    description: "Canvas extension; prefers continuations of existing content",
  },
  AddContent: {
    denoise_offset_px: 12,
    blend_feather_pct: 6,
    prompt_weight: 1.5,
    bias_to_surroundings: 0.2,      // weak; let prompt drive
    description: "Prompt-driven content; allows drastic deviation",
  },
  RemoveContent: {
    denoise_offset_px: 16,
    blend_feather_pct: 12,
    prompt_weight: 0.0,             // ignore prompt
    bias_to_surroundings: 1.0,      // pure continuation
    description: "Erase + fill from surroundings; prompt optional",
  },
  ReplaceBackground: {
    denoise_offset_px: 8,
    blend_feather_pct: 8,
    prompt_weight: 1.0,
    bias_to_surroundings: 0.0,
    foreground_preserve: true,      // requires pose/depth/segmentation reference
    description: "Preserve foreground subject (pose/depth detection); replace rest",
  },
};
```

`buildFillGraph` reads this config to set denoising-mask offsets, blend-mask sizing, conditioning weights, and node selection (e.g., ReplaceBackground attaches a segmentation-aware ControlNet).

## 5. Tablet UX dynamics

### 5.1 Action button label component

```typescript
// libs/ui/src/components/ActionButton.tsx
export const ActionButton: React.FC = () => {
  const strength = useEditorStore((s) => s.strength);
  const selectionPresent = useEditorStore((s) => s.selection.kind !== "none");
  const subMode = useEditorStore((s) => s.selection_mode);

  const label = useMemo(() => {
    if (!selectionPresent && strength === 100) return t("Generate");
    if (!selectionPresent && strength < 100) return t("Refine ({{strength}}%)", { strength });
    if (selectionPresent && strength === 100) return t(`fill.${subMode}`);
    if (selectionPresent && strength < 100) return t("Constrained variation ({{strength}}%)", { strength });
    return t("Generate");
  }, [strength, selectionPresent, subMode]);

  return <PrimaryButton onPress={handleGenerate}>{label}</PrimaryButton>;
};
```

### 5.2 Sub-mode picker

```typescript
// libs/ui/src/components/SelectionSubModePicker.tsx
export const SelectionSubModePicker: React.FC = () => {
  const selectionPresent = useEditorStore((s) => s.selection.kind !== "none");
  const strength = useEditorStore((s) => s.strength);
  const { selection_mode, setSelectionMode } = useEditorStore((s) => ({
    selection_mode: s.selection_mode,
    setSelectionMode: s.setSelectionMode,
  }));

  if (!selectionPresent || strength !== 100) return null;

  return (
    <SegmentedPicker value={selection_mode} onChange={setSelectionMode}>
      <Segment value="Fill" label={t("Fill")} />
      <Segment value="Expand" label={t("Expand")} />
      <Segment value="AddContent" label={t("Add")} />
      <Segment value="RemoveContent" label={t("Remove")} />
      <Segment value="ReplaceBackground" label={t("Background")} />
    </SegmentedPicker>
  );
};
```

### 5.3 In-progress indicator

```typescript
// libs/ui/src/components/GenerationProgress.tsx
export const GenerationProgress: React.FC = () => {
  const activeJob = useJobsStore((s) => s.active.size > 0 ? Array.from(s.active.values())[0] : null);
  if (!activeJob) return null;

  return (
    <FloatingIndicator
      onPress={() => client.tools.cancelJob({ job_id: activeJob.job_id })}
      progress={activeJob.percent}
      label={`${Math.round(activeJob.percent)}% — ${activeJob.stage}`}
    />
  );
};
```

## 6. Sequence diagrams

### 6.1 Generate flow

```
User                    Tablet UI                   Server                         ComfyUI
 │                          │                          │                              │
 │ types prompt             │                          │                              │
 │ taps "Generate"          │                          │                              │
 │ ──────────────────────► │                          │                              │
 │                          │ generate_image(...)      │                              │
 │                          │ ──────────────────────► │                              │
 │                          │                          │ resolveVerb → "generate"     │
 │                          │                          │ buildGenerateGraph(...)      │
 │                          │                          │ tracker.submit(graph, ...)   │
 │                          │                          │ ──────────────────────────► │
 │                          │                          │ ◄── { prompt_id, queue_pos } │
 │                          │ ◄── { job_id, "generate", batch_size: 1 }                 │
 │                          │ updates jobsStore                                          │
 │                          │ ◄── job.progress 5%, 10%, ..., 100% (via WS event relay)  │
 │                          │ ◄── job.completed { history_item_id }                     │
 │                          │ adds to historyStore                                       │
 │ taps preview                                                                         │
 │ ──────────────────────► │ apply_history_item(...)                                    │
 │                          │ ──────────────────────► │ creates layer in document      │
 │                          │ ◄── document.changed                                       │
 │                          │ editorStore reconciles                                     │
```

### 6.2 Fill flow

```
User                    Tablet UI                                       Server
 │ lassoes face area       │                                               │
 │ ──────────────────────► │ set_selection({ kind: "mask", mask })          │
 │                          │ ───────────────────────────────────────────►  │
 │                          │ ◄── { ok }                                     │
 │ Strength stays 100       │                                               │
 │ Sub-mode picker shows    │                                               │
 │ User picks "Fill"        │ (already default)                              │
 │ Types prompt             │                                               │
 │ Action button: "Fill"    │                                               │
 │ Taps                     │                                               │
 │ ──────────────────────► │ generate_image({ prompt, strength: 100,        │
 │                          │   selection: <current>, selection_mode: "Fill" })
 │                          │ ───────────────────────────────────────────►  │
 │                          │ ◄── { job_id, resolved_verb: "fill", ... }    │
 │ ... rest as Generate                                                     │
```

## 7. Per-document state in `editorStore`

```typescript
// libs/core/src/stores/editor/canvas-slice.ts (extended)
type CanvasSlice = {
  // ... existing fields
  strength: number;                       // 0-100, default 100
  selection_mode: SelectionSubMode;       // default "Fill"
  setStrength(value: number): void;
  setSelectionMode(mode: SelectionSubMode): void;
};
```

Persisted as part of the document's metadata when documents become persistable (post-v1 file format). For v1, ephemeral within the session.

## 8. Acceptance criteria for `design.md`

1. `resolveVerb` is a pure function with the table from `requirements.md` §3.1.
2. `FILL_SUBMODE_CONFIG` covers all five sub-modes with comments matching krita-ai-diffusion semantics.
3. The handler skeleton in §3 makes the integration with comfy graph builders + tracker explicit.
4. Tablet UI components in §5 honor the live-update timing (≤50 ms) and label rules.
5. Per-document state extension in §7 fits cleanly into existing editorStore.
