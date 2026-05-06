# prompt-enhancement — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`enhance_prompt` already in v1 catalog), `client-sdk` (MCP sampling forwarder), `server-architecture` (sampling integration), `tech.md` Backends model class 2 (Agent backend via MCP sampling), `speech-to-text` (sibling — orthogonal per P24).
> **References:** P3 (agent-agnostic; agents are clients AND backends), P4 (zero AI provider keys in server), P23 (diffusion prompts always English), P24 (STT and prompt enhancement independent and composable).

## 1. Purpose

Define the **prompt enhancement** capability with **two distinct phases**:

**Phase 1 — Auto-translate (mandatory, server-side, transparent)**
- Whenever a non-English prompt reaches `generate_image` (or related job tools), the server automatically translates it to English before submitting to the diffusion backend. P23 ("diffusion prompts always English") is enforced **server-side, not by the user**.
- This phase uses MCP sampling against the paired agent in `mode: "translate_only"`. **No user opt-in needed.**
- If no sampling-capable agent is paired, the server falls back to passing the raw prompt and emits a quality warning event.

**Phase 2 — Manual rewrite / elaborate (explicit, optional)**
- The user (or an agent) explicitly invokes `enhance_prompt` to polish, elaborate, or restyle a prompt. Surfaced as the ✨ button in the tablet UI. Optional — the user may bypass entirely.

Both phases use the **paired agent** via **MCP sampling** — the server holds no AI provider API keys (P4), but leverages the agent the user has already authorized (Claude / Claude Code / OpenAI Codex / Gemini CLI / custom).

Additionally, **the system prompt is model-aware**: SDXL-class models prefer tag-style (comma-separated descriptors); Flux prefers natural-language paragraphs. The server picks the right template per active model so the rewritten prompt fits the model's preferred input style.

This spec is **the canonical case** of the "agent-as-backend" pattern (`tech.md` Backends class 2). Implementation here sets the precedent for future MCP-sampling features (caption generation, style suggestion, etc.).

## 2. Stakeholders & user stories

### S1 — Spanish-speaking illustrator
> **Story 1.** As an illustrator, I dictate "una mujer joven sonriendo en un campo de flores al atardecer" via STT. The text lands in the prompt input in Spanish. I tap ✨ Enhance. The server uses MCP sampling to ask my paired Claude Desktop to rewrite. ~2 s later the field shows: `"young woman smiling in a sunflower field at golden hour, soft warm light, photorealistic, shallow depth of field"`. I tap Generate.

### S2 — English-speaking illustrator with rough prompt
> **Story 2.** As an illustrator, I type "barn at dusk". I tap Enhance. The server asks the agent to elaborate; result: `"red wooden barn at dusk, long shadows, golden hour lighting, cinematic atmosphere, 8k photo"`. I generate with the enriched prompt.

### S3 — Power user wanting context-aware enhancement
> **Story 3.** As a power user with active control layers (a Pose stick figure + a Style reference) and an existing canvas, I tap Enhance. The server attaches canvas context (current dims, active controls, regions) to the sampling request. The agent considers the controls and writes a prompt that complements them ("...in the pose shown, with [style] aesthetic..."). Result is contextually grounded.

### S4 — Agent invoking enhancement programmatically
> **Story 4.** As Claude Code orchestrating a series of generations, I `enhance_prompt({ input: "<rough idea>", context_hint: "concept-art" })` before `generate_image`. I receive the rewritten English. Note: in this case, **I (Claude Code) AM the agent the server samples from** — the server's sampling request goes to me, I respond. Self-referential loop is detected and handled (I respond as if it were a normal request).

### S5 — User without sampling-capable agent
> **Story 5.** As a user whose paired agent doesn't support MCP sampling, I tap Enhance. The server returns `SAMPLING_NOT_SUPPORTED` with a hint. The tablet shows a polite explanation: "Pair Claude Code, Codex, or Gemini CLI to enable enhancement." Generate still works without enhancement.

### S6 — Translation-only workflow
> **Story 6.** As a user who has a polished prompt in Spanish but doesn't want re-styling, I tap "Translate only" (sub-mode of enhance). The agent is asked to translate without rewriting. Faster, less invasive.

## 3. Functional requirements (EARS)

### 3.1 The MCP tool

**FR-1 (Ubiquitous).** `enhance_prompt({ input, mode?, context?, target_length?, style_hint?, target_model? })` (already in catalog from `mcp-tool-catalog` §3.3.13). Schema extensions in this spec:

- `input`: string (any language).
- `mode`: `"translate_only" | "rewrite" | "elaborate"` — default `"rewrite"`.
- `context`: optional `{ document_id?, canvas_summary?, control_layer_summary?, active_workspace? }` — server fills automatically when omitted, derived from current session state.
- `target_length`: `"short" | "medium" | "long"` — hint to the agent. Default `"medium"`.
- `style_hint`: optional free-text guidance ("photographic", "anime", "concept art").
- `target_model`: optional model id; determines which system prompt template (tag-style for SDXL, natural-language for Flux). Server infers from active preset if omitted.

**FR-2 (Ubiquitous).** Output: `{ enhanced: string, language_detected: string, used_sampling: boolean, agent_name?: string }`.

**FR-3 (Ubiquitous).** Tool category: `job` (sampling round-trip is multi-second). Reversibility: `false` (it returns a string; doesn't mutate document state).

### 3.2 MCP sampling flow

**FR-4 (Event-driven).** WHEN `enhance_prompt` is invoked, THE server SHALL:
1. Resolve `context` (auto-fill from session state if omitted).
2. Construct an MCP sampling request: `{ messages, system_prompt, model_preferences?, max_tokens, temperature }` per the MCP spec.
3. Send the request via the MCP sampling channel to the calling client (or to a configured "default agent" — see §3.4).
4. Wait for the response with timeout (default 30 s).
5. Parse the response; return as the tool's output.

**FR-5 (Ubiquitous).** The system prompt SHALL guide the agent to:
- Rewrite the input prompt to be **model-ready English**.
- Preserve user intent.
- Add appropriate descriptive detail (composition, lighting, style) if `mode === "elaborate"`.
- Translate without elaborating if `mode === "translate_only"`.
- Honor the `style_hint` if provided.
- Respect `target_length`.
- Return ONLY the rewritten prompt — no preamble, no explanation, no quotation marks.

**FR-6 (Ubiquitous).** Server SHALL provide a stable system prompt template in `libs/server/src/lib/prompt-enhancement/system-prompt.md`. Versioned alongside the spec.

### 3.3 Context attachment

**FR-7 (Ubiquitous).** When `context` is omitted, the server SHALL auto-attach:
- `canvas_summary`: `{ width, height, layer_count, active_workspace }` from the active document.
- `control_layer_summary`: list of `{ type, name }` for active control layers.
- `region_summary`: list of `{ name, prompt_excerpt }` for active regions.
- `active_workspace`: per `workspaces` spec.
- `existing_prompt`: the document's root prompt if any.

**FR-8 (Ubiquitous).** Context fields SHALL be size-capped to keep the sampling request small (≤ 2 KB total). Long region prompts truncated with ellipsis.

**FR-9 (Ubiquitous).** When `context` is explicitly provided, the server uses it verbatim and does NOT auto-attach.

### 3.4 Sampling target selection

**FR-10 (Ubiquitous).** v1 priority order for sampling target:
1. **Calling client itself** (the same agent invoking `enhance_prompt`). Most common and expected case (Story 4).
2. **A "default sampling agent"** configurable via `ServerConfig.sampling.default_agent_token_name`. Set when the user wants the tablet's enhance button to use a specific paired agent (e.g., "Claude Desktop on Igna's MacBook") even though tablet itself doesn't do sampling.
3. **Any active sampling-capable session** if the calling client doesn't support sampling and no default is set; first-found wins.

**FR-11 (Unwanted).** IF no sampling-capable session is available, THE server SHALL respond with `SAMPLING_NOT_SUPPORTED { hint }`. Hint lists: "Pair Claude Desktop, Claude Code, OpenAI Codex, or Gemini CLI to enable enhancement."

### 3.5 Independence from STT (P24)

**FR-12 (Ubiquitous).** Enhancement is invoked **explicitly** — never auto-triggered after STT. The tablet's mic button and enhance button are independent UI elements; user composes flows freely.

**FR-13 (Ubiquitous).** Server SHALL NOT auto-call `enhance_prompt` from `transcribe_audio` or any other tool. Composition is the caller's responsibility.

### 3.6 Modes

**FR-14 (Ubiquitous).** `mode === "translate_only"`: agent translates input to English with minimal stylistic changes. **This is the mode used by the auto-translate phase (FR-29..32) — invoked by the server transparently when generation is requested.**

**FR-15 (Ubiquitous).** `mode === "rewrite"` (default for explicit `enhance_prompt` calls): agent translates AND lightly polishes (cleanup, trim filler).

**FR-16 (Ubiquitous).** `mode === "elaborate"`: agent translates, polishes, AND adds descriptive detail (composition, lighting, style descriptors). For users who give terse prompts and want richness.

### 3.6-bis Model-aware system prompt

**FR-16-a (Ubiquitous).** The server SHALL select a system prompt template per the **active model family** of the upcoming or current generation:

| Model family | Output style | Example output |
|---|---|---|
| SDXL / SD 1.5 / Pony | **Tag-style** (comma-separated descriptors with weight prefixes optional) | `young woman, smiling, sunflower field, golden hour, soft warm light, photorealistic, shallow depth of field, 8k` |
| Flux | **Natural-language paragraph** | `A young woman smiling in a sunflower field at golden hour, soft warm light, photorealistic photograph with shallow depth of field.` |
| Future families | Defaults to tag-style; per-family overrides as added | — |

**FR-16-b (Ubiquitous).** The model family is determined from `MODEL_METADATA[input.model ?? preset.model].prompt_style`. Unknown models default to tag-style (most-compatible).

**FR-16-c (Ubiquitous).** The active model SHALL be either explicitly provided in `enhance_prompt` input (`target_model?`) OR inferred from the active document's preset / current generation context.

**FR-16-d (Ubiquitous).** Templates SHALL be configured in `libs/server/src/lib/prompt-enhancement/system-prompts/{sdxl,flux,...}.md`. Operators may override per family via `ServerConfig.prompt_enhancement.templates_dir`.

### 3.6-ter Auto-translate phase

**FR-29 (Event-driven).** WHEN `generate_image` (or another job tool that consumes a prompt) is invoked AND the prompt is not English, THE server SHALL:
1. Detect the language of the prompt (fast heuristic: `franc` library + character ranges).
2. Invoke `enhance_prompt({ input, mode: "translate_only", target_model: <active model> })` internally.
3. Use the result as the effective prompt sent to ComfyUI.
4. Record both raw and translated prompts in the `history_items` row's `parameters_json`.
5. Emit `prompt.translated { from_language, original_excerpt, translated_excerpt }` event so clients can show "translated from Spanish" hint.

**FR-30 (Event-driven).** WHEN auto-translate fails (sampling unsupported, agent timeout, etc.), THE server SHALL:
- Emit `prompt.translation_skipped { reason }` event.
- Pass the raw prompt to the diffusion model anyway (graceful degradation).
- Tablet UI surfaces a non-blocking warning: "Translation failed; using raw prompt — quality may drop."

**FR-31 (Ubiquitous).** Auto-translate runs **before** any explicit user `enhance_prompt` rewrites. If the user has already enhanced (which produces English output anyway), auto-translate is a no-op (detection returns "en" → skip).

**FR-32 (Ubiquitous).** Auto-translate is **mandatory** (cannot be disabled per-call) but operators MAY disable globally via `ServerConfig.prompt_enhancement.auto_translate_enabled: false` for testing or special cases.

### 3.7 Caching

**FR-17 (Ubiquitous).** Identical-input enhancement SHALL be cached: `(sha256(input), mode, context_hash, agent_name) → result`, TTL 5 minutes. Cache hit returns instantly without sampling round-trip.

**FR-18 (Ubiquitous).** Cache is in-memory per server session.

### 3.8 Error handling

**FR-19 (Unwanted).** IF the agent's response is malformed (empty, contains preamble, etc.), THE server SHALL retry once with a stricter system prompt; on second failure, return `ENHANCEMENT_RESPONSE_INVALID` with the agent's raw output for debugging.

**FR-20 (Unwanted).** IF the sampling round-trip times out (default 30 s), THE server SHALL return `ENHANCEMENT_TIMEOUT { agent_name }`.

**FR-21 (Unwanted).** IF the agent refuses (for content policy reasons or otherwise), THE server SHALL surface the refusal as `ENHANCEMENT_REFUSED { agent_message }`. Caller decides what to do (retry, fall back to raw, etc.).

### 3.9 Tablet UX

**FR-22 (Ubiquitous).** A ✨ enhance button next to every prompt input that supports it: main prompt, root prompt bar, region prompt input.

**FR-23 (Ubiquitous).** Tap ✨ → spinner appears; ~2 s later, the field updates with the enhanced text. **Original text preserved** (one-tap undo via "Undo enhancement" toast for ~5 s after).

**FR-24 (Ubiquitous).** Long-press ✨ → mode picker (Translate / Rewrite / Elaborate) + style hint input + length slider. Tap "Apply" to enhance with the chosen options. Settings persist for the session.

**FR-25 (Ubiquitous).** When sampling unavailable: ✨ button disabled with tooltip explaining how to pair an agent.

**FR-26 (Ubiquitous).** Enhancement-in-progress state: button disabled + spinner; user can cancel via tap (sends `cancel_job`).

### 3.10 Performance

**FR-27 (Ubiquitous).** End-to-end latency (tap → enhanced text in field):
- With Claude / Codex / Gemini paired: ≤ 2.5 s typical, ≤ 5 s worst case.
- With cache hit: ≤ 100 ms.

**FR-28 (Ubiquitous).** System prompt + context payload to agent: ≤ 4 KB total. Keeps the agent's input cheap.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Catalog impact: 0 new tools. `enhance_prompt` schema extended (input fields). Footprint stays ≤ 100 KB.

**NFR-2 (Ubiquitous).** Server NEVER caches the enhanced result with identifying user info beyond `token_id`. No cross-token cache leakage.

**NFR-3 (Ubiquitous).** System prompt is in English; agents may produce English output regardless of input language — that's the contract (P23).

**NFR-4 (Ubiquitous).** Agent-agnostic: tested matrix covers Claude Desktop, Claude Code, OpenAI Codex / ChatGPT Desktop, Gemini CLI; output format is consistent enough across vendors that the parser doesn't need vendor-specific paths.

## 5. Out of scope

- **Server-side LLM execution** (running a small LLM on the server for enhancement) — explicitly rejected per P4. Always via agent sampling.
- **Negative prompt enhancement** — v1 enhances positive prompt only. Negative prompt is a different art; v2.
- **Style transfer enhancement** (e.g., "rewrite this Renaissance prompt as cyberpunk"). Power case; user can include in `style_hint`.
- **Multi-prompt chaining** (rewriting a sequence of related prompts cohesively). Post-v1.
- **Automatic context summarization** that uses a separate LLM call. Context is built deterministically from state (FR-7).

## 6. Open questions

### Q1 — Should the system prompt be tuneable by operator?
Some teams want different defaults (e.g., always elaborate to long).

**Recommendation:** **yes, override via `ServerConfig.prompt_enhancement.system_prompt_path`**. Default ships with the server. Operator can replace.

### Q2 — Should enhancement run via `cancel_job`?
It's a multi-second op.

**Recommendation:** **yes**, treat as a job. Same cancellation path as other jobs (signal via `cancel_job`). Tablet shows a cancel button.

### Q3 — Should we add a "preview" view showing diff between original and enhanced?
UX nicety.

**Recommendation:** **post-v1.** v1: replace text directly with one-tap undo via toast. Diff view is more complex to render on tablet; deferred.

### Q4 — Should the server allow the agent to refuse with a clear message?
Sometimes the agent's policy refuses (e.g., the prompt is borderline).

**Recommendation:** **yes**, propagate the agent's message to the caller via `ENHANCEMENT_REFUSED`. Caller shows friendly message. Don't pretend the refusal is a server issue.

### Q5 — Translation-only mode: should the agent also clean up grammar?
Pure translation vs polish.

**Recommendation:** **minimal cleanup acceptable** (basic grammar, but no addition of new content). Documented in the system prompt.

### Q6 — Should the cache key include `agent_name`?
Different agents would produce different rewrites for the same input.

**Recommendation:** **yes** (FR-17). Same input from Claude Desktop and same from Codex → different cache entries; correct semantically.

### Q7 — Default `target_length`?
Short prompts (1 sentence) vs medium (2–3 sentences) vs long (paragraph).

**Recommendation:** **medium** — matches what diffusion models digest well (~50–100 tokens equivalent). Long can over-saturate; short under-specifies.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The six user stories (§2) are realized.
2. Sampling round-trip works against ≥3 vendor agents with consistent output parsing.
3. Context auto-attachment produces sensible enhancements for various canvas states.
4. Cache hits within latency budget; cache misses within sampling budget.
5. All three modes (translate_only / rewrite / elaborate) produce distinguishable output.
6. P4 preserved: server has no AI provider keys.
7. P24 preserved: STT and enhancement remain decoupled.
8. Open questions have acceptable recommendations.
