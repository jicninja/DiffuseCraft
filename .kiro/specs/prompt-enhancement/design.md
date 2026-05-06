# prompt-enhancement — Design

> **Companion to:** `requirements.md`. **References:** `client-sdk` (SamplingForwarder), `server-architecture`, `tech.md` Backends class 2 (Agent), `selection-tools` Tier 4 (similar sampling pattern).

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **System prompt overrideable via config path.** Default ships. |
| Q2 | **Treat as job; `cancel_job` works.** |
| Q3 | **No diff view in v1.** Replace + one-tap undo toast. |
| Q4 | **Refusal propagated as `ENHANCEMENT_REFUSED { agent_message }`.** |
| Q5 | **Translation-only allows minor grammar cleanup**, no new content. |
| Q6 | **Cache key includes agent_name.** |
| Q7 | **Default `target_length` = medium.** |

## 2. Module layout

```
libs/server/src/lib/prompt-enhancement/
├── handler.ts                   # enhance_prompt handler
├── system-prompt.md             # default system prompt template (overrideable)
├── system-prompt-loader.ts      # loads + interpolates context fields
├── sampling-target-resolver.ts  # picks calling client / default agent / first available
├── response-parser.ts           # extracts the rewritten text; rejects malformed
├── context-builder.ts           # auto-builds canvas/control/region/workspace summaries
├── cache.ts                     # in-memory cache with TTL
└── retry-strict.ts              # second-attempt with stricter system prompt

libs/ui/src/prompt-enhancement/
├── EnhanceButton.tsx
├── EnhanceModePicker.tsx
└── enhance-store-slice.ts       # session prefs (mode, style_hint, length)
```

## 3. Handler shape

```typescript
// libs/server/src/lib/prompt-enhancement/handler.ts
export const enhancePromptHandler: Handler<typeof enhancePrompt> = async (input, ctx) => {
  // 1. Resolve sampling target
  const target = resolveSamplingTarget(ctx);
  if (!target) {
    throw new ServerError({
      code: "SAMPLING_NOT_SUPPORTED",
      message: "No sampling-capable agent paired.",
      hint: "Pair Claude Desktop, Claude Code, OpenAI Codex, or Gemini CLI.",
    });
  }

  // 2. Build / use context
  const context = input.context ?? await buildContext(ctx);

  // 3. Cache lookup
  const cacheKey = computeCacheKey(input, context, target.agent_name);
  const cached = ctx.enhancementCache.get(cacheKey);
  if (cached) return { ...cached, used_sampling: false };

  // 4. Submit as job (allows cancel_job)
  const job_id = await ctx.tracker.submit({
    kind: "enhance_prompt",
    spec: { input, context, target, mode: input.mode ?? "rewrite" },
  }, async (signal) => {
    // 5. Construct sampling request
    const samplingRequest = buildSamplingRequest({
      input: input.input,
      mode: input.mode ?? "rewrite",
      target_length: input.target_length ?? "medium",
      style_hint: input.style_hint,
      context,
      systemPromptPath: ctx.config.prompt_enhancement.system_prompt_path,
    });

    // 6. Send via sampling
    const response = await target.sampling.request(samplingRequest, { timeout_ms: 30_000, signal });

    // 7. Parse + validate
    let parsed = parseResponse(response);
    if (!parsed.ok) {
      // strict-retry once
      const stricter = buildSamplingRequest({ /* ... */, strict: true });
      const retryResp = await target.sampling.request(stricter, { timeout_ms: 30_000, signal });
      parsed = parseResponse(retryResp);
      if (!parsed.ok) throw new ServerError({ code: "ENHANCEMENT_RESPONSE_INVALID", message: parsed.error });
    }

    if (parsed.refused) {
      throw new ServerError({ code: "ENHANCEMENT_REFUSED", message: parsed.refused_message });
    }

    const result = {
      enhanced: parsed.text,
      language_detected: parsed.language ?? detectLanguage(input.input),
      used_sampling: true,
      agent_name: target.agent_name,
    };
    ctx.enhancementCache.set(cacheKey, result, 5 * 60 * 1000);
    return result;
  });

  return { job_id };
};
```

## 4. System prompt templates (model-aware)

The server picks the template per active model family:

```typescript
// libs/server/src/lib/prompt-enhancement/system-prompt-loader.ts
export function selectTemplate(model_id: string): string {
  const meta = MODEL_METADATA[model_id];
  const family = meta?.prompt_style ?? "tag-style";   // default for unknowns
  return loadTemplateFile(family);   // loads `system-prompts/{family}.md`
}
```

Templates live in `libs/server/src/lib/prompt-enhancement/system-prompts/`:
- `sdxl.md` — tag-style (used for SDXL, SD 1.5, Pony, and most fine-tunes)
- `flux.md` — natural-language paragraph (used for Flux family)
- Future families add their own files; `MODEL_METADATA` maps each model_id to a family

### 4.1 SDXL / tag-style template (default)

```markdown
# system-prompts/sdxl.md

You are a prompt rewriter for a Stable-Diffusion-class image generation system using TAG-STYLE prompts.

The user provides a prompt (which may be in any language). Rewrite it as a model-ready ENGLISH prompt in TAG-STYLE: comma-separated descriptors covering subject, composition, lighting, style, and quality.

Rules:
- Output ONLY the rewritten prompt. No preamble, no explanation, no quotes, no JSON.
- Always English, regardless of input language.
- Tag-style: comma-separated phrases. Subject first, then composition / lighting / style / quality tags.
- Preserve user's intent. Do not invent subjects not present.
- Keep length appropriate to "{{target_length}}" hint.
- {{#if style_hint}}Apply style hint: "{{style_hint}}"{{/if}}
- Mode: {{mode}}
  {{#if mode == "translate_only"}}- Translate to English in tag-style with minimal stylistic changes. Preserve user's tags as much as possible. Light cleanup OK.{{/if}}
  {{#if mode == "rewrite"}}- Translate AND lightly polish (cleanup, trim filler). Reorganize into tag-style structure if input wasn't already.{{/if}}
  {{#if mode == "elaborate"}}- Translate, polish, AND add descriptive tags (composition, lighting, style, quality).{{/if}}

{{#if context}}
Context (canvas being worked on):
- Dimensions: {{context.canvas_summary.width}}×{{context.canvas_summary.height}}
- Active workspace: {{context.active_workspace}}
- Active control layers: {{context.control_layer_summary}}
- Active regions: {{context.region_summary}}
- Existing root prompt: "{{context.existing_prompt}}"
Use the context to make the rewritten prompt complement the canvas state.
{{/if}}

User prompt: "{{input}}"

Rewritten English tag-style prompt:
```

Example output: `young woman, smiling, sunflower field, golden hour, soft warm light, photorealistic, shallow depth of field, 8k`

### 4.2 Flux / natural-language template

```markdown
# system-prompts/flux.md

You are a prompt rewriter for a Flux-class image generation system using NATURAL-LANGUAGE prompts.

The user provides a prompt (which may be in any language). Rewrite it as a model-ready ENGLISH prompt in NATURAL-LANGUAGE: one or two sentences describing the scene as a fluent paragraph.

Rules:
- Output ONLY the rewritten prompt. No preamble, no explanation, no quotes, no JSON.
- Always English, regardless of input language.
- Natural-language: complete sentences, no comma-separated tag list.
- Preserve user's intent. Do not invent subjects not present.
- Keep length appropriate to "{{target_length}}" hint.
- {{#if style_hint}}Reflect style hint naturally: "{{style_hint}}"{{/if}}
- Mode: {{mode}}
  {{#if mode == "translate_only"}}- Translate to English as a fluent sentence. Preserve all user-provided detail. Light cleanup only.{{/if}}
  {{#if mode == "rewrite"}}- Translate AND lightly polish (cleanup, trim filler), keeping natural-language form.{{/if}}
  {{#if mode == "elaborate"}}- Translate, polish, AND naturally weave in additional descriptive detail (composition, lighting, style).{{/if}}

{{#if context}}
Context (canvas being worked on):
- Dimensions: {{context.canvas_summary.width}}×{{context.canvas_summary.height}}
- Active workspace: {{context.active_workspace}}
- Active control layers: {{context.control_layer_summary}}
- Active regions: {{context.region_summary}}
- Existing root prompt: "{{context.existing_prompt}}"
Use the context to make the rewritten prompt complement the canvas state.
{{/if}}

User prompt: "{{input}}"

Rewritten English natural-language prompt:
```

Example output: `A young woman smiling in a sunflower field at golden hour, soft warm light, photorealistic photograph with shallow depth of field.`

### 4.3 Original system-prompt.md (legacy single-template, kept for reference but superseded)

```markdown
# system-prompt.md (deprecated — use {family}.md instead)

You are a prompt rewriter for a Stable-Diffusion-class image generation system.

The user provides a prompt (which may be in any language). Rewrite it as a model-ready ENGLISH prompt.

Rules:
- Output ONLY the rewritten prompt. No preamble, no explanation, no quotes, no JSON.
- Always English, regardless of input language.
- Preserve user's intent. Do not invent subjects not present.
- Keep length appropriate to "{{target_length}}" hint.
- {{#if style_hint}}Apply style hint: "{{style_hint}}"{{/if}}
- Mode: {{mode}}
  {{#if mode == "translate_only"}}- Translate to English with minimal stylistic changes. Light grammar cleanup OK.{{/if}}
  {{#if mode == "rewrite"}}- Translate AND lightly polish (cleanup, trim filler).{{/if}}
  {{#if mode == "elaborate"}}- Translate, polish, AND add descriptive detail (composition, lighting, style).{{/if}}

{{#if context}}
Context (the canvas being worked on):
- Dimensions: {{context.canvas_summary.width}}×{{context.canvas_summary.height}}
- Active workspace: {{context.active_workspace}}
- Active control layers: {{context.control_layer_summary}}
- Active regions: {{context.region_summary}}
- Existing root prompt: "{{context.existing_prompt}}"

Use the context to make the rewritten prompt complement the canvas state.
{{/if}}

User prompt: "{{input}}"

Rewritten English prompt:
```

The strict-retry variant adds: "If the previous output included anything but the rewritten prompt, output ONLY the rewritten prompt now. No quotes. No preamble."

## 4.3-bis Language detection adapter

```typescript
// libs/server/src/lib/prompt-enhancement/language-detection.ts
export interface LanguageDetectionAdapter {
  /** Detects the language of `text`. Returns ISO-639-1 code ("en", "es", "ja", etc.). Sub-millisecond budget. */
  detect(text: string): string;
}

export class FrancLanguageAdapter implements LanguageDetectionAdapter {
  detect(text: string): string {
    if (text.length < 8) return "en";   // too short to detect; assume English to skip translate
    return franc(text, { minLength: 8 });   // returns "und" if uncertain → treat as "en"
  }
}

export const defaultLanguageAdapter = new FrancLanguageAdapter();
```

Used by `generate_image` handler (per FR-29) to decide whether to fire auto-translate. Pure function, fast (~0.1 ms), no network. The handler holds the adapter; tests inject a stub.

## 4.3-ter Internal-translate entrypoint

The `generate_image` handler (and any future job tool consuming a prompt) calls `enhancePromptInternal` — a server-internal sibling of the `enhance_prompt` MCP tool that **bypasses caching and the catalog interface** for the auto-translate path:

```typescript
// libs/server/src/lib/prompt-enhancement/internal-translate.ts
export async function enhancePromptInternal(
  ctx: HandlerContext,
  input: { prompt: string; target_model: string }
): Promise<{ enhanced: string; language_detected: string }> {
  const detected = ctx.languageAdapter.detect(input.prompt);
  if (detected === "en") return { enhanced: input.prompt, language_detected: "en" };
  // Reuse the same orchestrator as enhance_prompt, mode=translate_only
  return await ctx.enhancementOrchestrator.run({
    input: input.prompt,
    mode: "translate_only",
    target_model: input.target_model,
    context: undefined,   // skip context attachment for fast translate
  });
}
```

Shared with `enhance_prompt` handler (which calls the orchestrator with whatever mode the user requested). This keeps a single sampling-target-resolver path.

## 4.4 Auto-translate hook in generation pipeline

```typescript
// libs/server/src/lib/handlers/generate-image.ts (extension)
async function generateImageHandler(input, ctx) {
  // ... resolve verb, preset, model, vram tier (from earlier specs)

  // AUTO-TRANSLATE PHASE (P23)
  const detectedLang = detectLanguage(input.prompt);
  let effectivePrompt = input.prompt;
  let translationMeta: TranslationMeta | undefined;

  if (detectedLang !== "en" && ctx.config.prompt_enhancement.auto_translate_enabled) {
    try {
      const translated = await ctx.enhancePromptInternal({
        input: input.prompt,
        mode: "translate_only",
        target_model: model.model_id,
        context: undefined,   // keep translate fast; no context attachment for translate_only
      });
      effectivePrompt = translated.enhanced;
      translationMeta = { from_language: detectedLang, original: input.prompt, translated: effectivePrompt };
      ctx.bus.publish({
        name: "prompt.translated",
        payload: {
          job_id: ctx.job_id,
          from_language: detectedLang,
          original_excerpt: input.prompt.slice(0, 80),
          translated_excerpt: effectivePrompt.slice(0, 80),
        },
      });
    } catch (err) {
      ctx.bus.publish({
        name: "prompt.translation_skipped",
        payload: { job_id: ctx.job_id, reason: err.code ?? "unknown" },
      });
      // Fall back to raw prompt; quality may drop
    }
  }

  // ... continue with build-graph using effectivePrompt
  // history_items.parameters_json includes both raw and translated:
  const persistedParams = { ...input, effective_prompt: effectivePrompt, translation: translationMeta };
}
```

## 5. Context builder

```typescript
// libs/server/src/lib/prompt-enhancement/context-builder.ts
export async function buildContext(ctx: HandlerContext): Promise<EnhancementContext> {
  const documentId = ctx.activeDocumentId;
  if (!documentId) return { canvas_summary: {}, control_layer_summary: [], region_summary: [], active_workspace: "Generate", existing_prompt: "" };

  const doc = await ctx.documents.get(documentId);
  const controls = await ctx.layers.listByKind(documentId, "control");
  const regions = await ctx.regions.listForDocument(documentId);
  const workspace = ctx.workspaceManager.get(ctx.tokenId);
  const root = await ctx.documents.getRootPrompt(documentId);

  return {
    canvas_summary: { width: doc.width, height: doc.height, layer_count: doc.layers.length },
    control_layer_summary: controls.map((c) => ({ type: c.type, name: c.name })).slice(0, 5),
    region_summary: regions.map((r) => ({ name: r.name, prompt_excerpt: r.prompt.slice(0, 60) })).slice(0, 5),
    active_workspace: workspace,
    existing_prompt: root.root_prompt.slice(0, 200),
  };
}
```

Output is size-capped to ≤ 2 KB per FR-8.

## 6. Sampling target resolver

```typescript
// libs/server/src/lib/prompt-enhancement/sampling-target-resolver.ts
export function resolveSamplingTarget(ctx: HandlerContext): SamplingTarget | null {
  // 1. Calling client itself
  if (ctx.client.supportsSampling) {
    return { agent_name: ctx.tokenName, sampling: ctx.client.sampling };
  }
  // 2. Configured default
  const defaultName = ctx.config.sampling.default_agent_token_name;
  if (defaultName) {
    const sess = ctx.sessions.findByTokenName(defaultName);
    if (sess && sess.supportsSampling) return { agent_name: defaultName, sampling: sess.sampling };
  }
  // 3. First active sampling-capable session
  for (const sess of ctx.sessions.active()) {
    if (sess.supportsSampling) return { agent_name: sess.tokenName, sampling: sess.sampling };
  }
  return null;
}
```

The `client.supportsSampling` flag is determined at handshake (per `client-sdk` capability negotiation).

## 7. Response parser

```typescript
// libs/server/src/lib/prompt-enhancement/response-parser.ts
export function parseResponse(raw: string): ParsedResponse {
  const trimmed = raw.trim();
  // Strip surrounding quotes if any
  let text = trimmed.replace(/^["']+|["']+$/g, "");
  // Reject if it looks like a refusal
  const refusalPatterns = [/i can'?t/i, /i'm unable/i, /i won'?t/i, /not appropriate/i, /content polic/i];
  if (refusalPatterns.some((p) => p.test(text))) {
    return { ok: true, refused: true, refused_message: text };
  }
  // Reject if too long (>3 KB) — likely the agent over-explained
  if (text.length > 3000) return { ok: false, error: "Response too long; suspected over-explanation" };
  // Reject if too short
  if (text.length < 5) return { ok: false, error: "Response empty or trivial" };
  // Detect language
  const language = detectLanguage(text);   // expect "en"
  if (language !== "en") return { ok: false, error: `Output not in English (detected: ${language})` };
  return { ok: true, text, language, refused: false };
}
```

## 8. Cache

```typescript
// libs/server/src/lib/prompt-enhancement/cache.ts
export class EnhancementCache {
  private map = new Map<string, { result: EnhanceResult; ts: number }>();
  get(key: string): EnhanceResult | undefined {
    const e = this.map.get(key);
    if (!e || Date.now() - e.ts > 5 * 60 * 1000) return undefined;
    return e.result;
  }
  set(key: string, result: EnhanceResult, ttl_ms: number): void {
    this.map.set(key, { result, ts: Date.now() });
  }
}

export function computeCacheKey(input: EnhanceInput, context: EnhancementContext, agent_name: string): string {
  return sha256Hex(JSON.stringify({ input: input.input, mode: input.mode, target_length: input.target_length, style_hint: input.style_hint, context_hash: sha256Hex(JSON.stringify(context)), agent_name }));
}
```

## 9. Tablet UX

```typescript
// libs/ui/src/prompt-enhancement/EnhanceButton.tsx
export const EnhanceButton: React.FC<{ field: TextField; promptValue: string; onResult: (text: string) => void }> = ({ field, promptValue, onResult }) => {
  const mode = useEnhanceStore((s) => s.mode);
  const target_length = useEnhanceStore((s) => s.target_length);
  const style_hint = useEnhanceStore((s) => s.style_hint);
  const [running, setRunning] = useState(false);
  const [previousValue, setPreviousValue] = useState<string | null>(null);

  const onTap = async () => {
    if (running) return;
    setRunning(true);
    setPreviousValue(promptValue);
    try {
      const job = await client.tools.enhancePrompt({ input: promptValue, mode, target_length, style_hint });
      const completion = await waitForJob(job.job_id);
      if (completion.outcome === "success") {
        onResult(completion.enhanced);
        showUndoToast("Enhancement applied", () => onResult(previousValue!), 5_000);
      } else if (completion.error.code === "SAMPLING_NOT_SUPPORTED") {
        showInfoToast("Pair Claude Code, Codex, or Gemini CLI to enable enhancement.");
      } else {
        showErrorToast(completion.error.message);
      }
    } finally {
      setRunning(false);
    }
  };

  const onLongPress = () => openModePicker();

  return (
    <Pressable onPress={onTap} onLongPress={onLongPress} disabled={!isAvailable}>
      <SparkleIcon spinning={running} />
    </Pressable>
  );
};
```

`<EnhanceModePicker />` is a long-press sheet with mode radio (translate / rewrite / elaborate), `style_hint` text input, and `target_length` segmented picker.

## 10. Catalog impact

**0 new tools.** `enhance_prompt` already in v1 catalog. This spec extends its schema (mode, context, target_length, style_hint) and output (used_sampling, agent_name). Catalog stays at ~57 (cap 60). Footprint unchanged after description tightening.

## 11. Cross-spec touches

- **`mcp-tool-catalog`**: extend `enhance_prompt` schema; add `ENHANCEMENT_*` error codes (REFUSED, RESPONSE_INVALID, TIMEOUT, NOT_SUPPORTED).
- **`client-sdk`**: `SamplingForwarder` already specced; this spec is its first major consumer.
- **`server-architecture`**: handshake captures `supportsSampling` capability; sessions table tracks it.
- **`tech.md` Backends model class 2**: this spec is the canonical implementation of "agent as backend".
- **`speech-to-text`**: orthogonal (P24); never auto-invoked from STT.
- **`selection-tools`** Tier 4 (`select_by_prompt`) uses the same `SamplingForwarder` pattern — they share the resolver.

## 12. Acceptance criteria

1. The six user stories execute end-to-end.
2. Sampling target resolver handles all three priority cases.
3. System prompt produces consistent output across vendor agents.
4. Cache hit/miss/expire behaves correctly.
5. Refusal propagates with clear UX.
6. Tablet UX: enhance button, mode picker long-press, undo toast.
7. P4 + P24 preserved.
