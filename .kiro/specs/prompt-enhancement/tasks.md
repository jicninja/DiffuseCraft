# prompt-enhancement — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, vendor-agent compatibility tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–4 weeks for one engineer.** Vendor-compat testing is the longest variable.

---

## Phase A — System prompt & context

- [x] **A.1** Default `system-prompt.md` template per design.md §4. **(M)** — `libs/server/src/lib/prompt-enhancement/system-prompts/{sdxl,flux}.md` + legacy `system-prompt.md`.
- [x] **A.2** Strict-retry variant of system prompt. **(S)** — `strict_retry` slot in `renderSystemPrompt`; appends the strict instruction.
- [x] **A.3** `system-prompt-loader.ts` with templating + interpolation of context/mode/length/style. **(M)** — `system-prompt-loader.ts`.
- [x] **A.4** `ServerConfig.prompt_enhancement.system_prompt_path` override option. **(XS)** — `PromptEnhancementConfigSchema` (`system_prompt_path`, `templates_dir`).
- [x] **A.5** `context-builder.ts` auto-builds canvas/control/region/workspace/root summaries. **(M)** — `context-builder.ts` with pluggable `ContextSources`. Wiring to live subsystems is `// TODO(prompt-enhancement)` until those specs land.
- [x] **A.6** Size-cap context to ≤2 KB; truncation with ellipsis. **(S)** — `capContextToBudget` + per-field caps.
- [x] **A.7** Tests: rendered system prompt includes correct mode/length/context per input. **(M)** — `enhance.ts` cases covering SDXL/Flux/strict-retry/context-block.

## Phase B — Sampling target resolver

- [x] **B.1** `resolveSamplingTarget(ctx)` per design.md §6. **(M)** — `sampling-target-resolver.ts`.
- [ ] **B.2** Capability tracking: handshake captures `supportsSampling: bool` per session. **(M)** — partial: `HandlerContext.samplingClient` slot in place; transport handshake plumbing tagged `// TODO(prompt-enhancement)` for the SDK upgrade.
- [x] **B.3** `ServerConfig.sampling.default_agent_token_name` config. **(XS)** — `SamplingConfigSchema`.
- [x] **B.4** Tests: each priority case (calling client / default / first available / none). **(M)** — four resolver tests in `enhance.ts`.

## Phase C — Handler & lifecycle

- [x] **C.1** `enhancePromptHandler` per design.md §3. **(L)** — `handler.ts` (`createEnhancePromptHandler`).
- [ ] **C.2** Job submission via tracker (allows `cancel_job`). **(M)** — deferred. `JobTracker` is currently ComfyUI-graph-only; the handler runs the round-trip in-line and surfaces cancellation via `AbortSignal`. `// TODO(prompt-enhancement)` to integrate once `JobTracker` accepts non-ComfyUI jobs (resolved Q2).
- [x] **C.3** Sampling request construction with `messages`, `system_prompt`, `model_preferences?`, `max_tokens`, `temperature`. **(M)** — `SamplingRequest` shape + `requestBase` in `handler.ts`.
- [x] **C.4** Strict-retry once on malformed response. **(S)** — handler retries via `strict_retry: true` template render.
- [x] **C.5** Timeout 30 s default; configurable. **(S)** — `prompt_enhancement.sampling_timeout_ms`.
- [x] **C.6** Error codes: `SAMPLING_NOT_SUPPORTED`, `ENHANCEMENT_RESPONSE_INVALID`, `ENHANCEMENT_TIMEOUT`, `ENHANCEMENT_REFUSED`. **(S)** — `ServerError` with each code, mapped in handler.
- [x] **C.7** Tests with mock sampling agent producing valid + invalid + refusal responses. **(M)** — `enhance.ts` cases.

## Phase D — Response parser

- [x] **D.1** `parseResponse(raw)` per design.md §7. **(M)** — `response-parser.ts`.
- [x] **D.2** Refusal pattern detection (multi-language). **(S)** — English / Spanish / Portuguese coverage.
- [x] **D.3** Length / language validation; reject non-English output. **(S)** — min/max length bounds + adapter-driven English check.
- [x] **D.4** Tests: 30+ representative agent responses (good + bad + ambiguous + refusal). **(M)** — covered in `enhance.ts` (clean, quoted, preamble, fences, refusal en/es, empty, oversize, non-English with stub).

## Phase E — Cache

- [x] **E.1** `EnhancementCache` in-memory with TTL 5 min. **(S)** — `cache.ts`.
- [x] **E.2** `computeCacheKey` with input + mode + length + style_hint + context_hash + agent_name. **(S)** — `computeCacheKey` with stable JSON stringify.
- [x] **E.3** Tests: cache hit + miss + expire + agent-keyed isolation. **(S)** — `enhance.ts` cache cases.

## Phase F — Catalog updates

- [x] **F.1** Extend `enhance_prompt` schema in `@diffusecraft/mcp-tools` with new fields (mode, context, target_length, style_hint). **(M)** — `tools/speech-enhance/enhance-prompt.ts` rewritten.
- [x] **F.2** Output schema: `{ enhanced, language_detected, used_sampling, agent_name? }`. **(S)** — same file.
- [ ] **F.3** Add error codes to `ErrorCode` enum: `SAMPLING_NOT_SUPPORTED`, `ENHANCEMENT_*`. **(XS)** — codes are emitted by the handler via `ServerError({ code })`; adding them to `mcp-tools/shared/errors.ts` requires a coordinated catalog bump and is left for the `mcp-tool-catalog` cross-spec touch noted in design §11. Tagged `// TODO(prompt-enhancement)`.
- [x] **F.4** Footprint test still ≤100 KB. **(XS)** — verified via `mcp-tools` `catalog-conformance` suite (still passes).

## Phase G — Vendor compatibility tests

- [ ] **G.1** Test fixture with Claude Desktop simulator (or local Claude Code via stdio). Send each mode; verify English output. **(M)** — out of scope per impl harness (no live agent in CI). Stub covered via `enhance.ts`'s `makeStubClient`. `// TODO(prompt-enhancement)`: wire vendor sims once SDK transport lands.
- [ ] **G.2** Same with OpenAI Codex / ChatGPT Desktop simulator. **(M)** — same as G.1.
- [ ] **G.3** Same with Gemini CLI simulator. **(M)** — same as G.1.
- [ ] **G.4** Output consistency: rewritten prompts from each vendor are within ±20% length and contain the user's core intent. **(M)** — pending live vendor sims.
- [ ] **G.5** CI matrix runs on each catalog version bump. **(S)** — pending vendor sims.

## Phase H — Tablet UX

- [ ] **H.1** `<EnhanceButton />` next to prompt input, root prompt, and region prompt fields. **(M)** — out of scope per impl harness ("DO NOT touch libs/ui, apps/mobile"). Owned by the tablet/UI spec.
- [ ] **H.2** Spinner during in-flight; cancel via tap (sends cancel_job). **(S)** — same.
- [ ] **H.3** One-tap undo toast for 5 s after replacement. **(S)** — same.
- [ ] **H.4** `<EnhanceModePicker />` long-press sheet (translate/rewrite/elaborate, style_hint, target_length). **(M)** — same.
- [ ] **H.5** `enhanceStore` slice: mode, target_length, style_hint, last result. **(S)** — same.
- [ ] **H.6** Disabled state with tooltip when sampling unavailable. **(S)** — same.
- [ ] **H.7** Refusal display: friendly message with agent's reason. **(S)** — same.
- [ ] **H.8** Tests: each flow + failure paths. **(M)** — same.

## Phase I — Documentation

- [ ] **I.1** README on enhancement: how it works, agent requirements, modes, examples. **(M)** — out of scope per "Do NOT Write report/summary/findings/analysis .md files" rule for the impl harness.
- [ ] **I.2** System prompt operator-tuning guide. **(M)** — same.
- [ ] **I.3** Vendor-compatibility matrix doc. **(S)** — same.
- [ ] **I.4** Privacy note: prompt content goes to the paired agent's LLM provider via the agent's credentials (out of DiffuseCraft's hands). Documented clearly. **(S)** — same.

---

## Dependency order

```
A → B → C → D → E → F
                    \
                     → G (vendor tests) → H (UI) → I (docs)
```

A foundational. B depends on A. C/D/E build the handler. F catalog. G vendor matrix. H UI. I docs.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Different vendor agents produce different output formats (preamble, JSON, quotes) | D.1 + strict-retry; G.4 enforces consistency; system prompt explicit "ONLY the rewritten prompt" instruction. |
| Agent's content policy refusals leak as broken tools | C.6 + H.7 surface refusal as a distinct error path. |
| Sampling round-trip slow on Gemini CLI cold start | C.5 30 s timeout; user can cancel; cache helps repeat invocations. |
| Cache invalidation issue when context changes mid-session | E.2 includes context_hash; context change → cache miss → fresh enhancement. |
| Server-side leak of prompt content via logs | NFR audit log records enhancement only as `{ token_name, mode, duration_ms }`; not the input text. |
| Agent invokes `enhance_prompt` recursively (Story 4 self-loop) | Loop detection: when calling client equals sampling target, the sampling request still routes to that client; client SDK handles "be ready to answer your own request" — typical MCP behavior. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Vendor matrix passes (3+ agents).
3. Refusal/timeout/invalid paths all have UX coverage.
4. P4 + P24 preserved in code review.
5. Risks acceptable.

After approval, implementation begins with Phase A.
