/**
 * `enhance_prompt` handler (design.md §3, FR-4..FR-21).
 *
 * Orchestrates the MCP-sampling round-trip:
 *
 *   1. Resolve the sampling target (calling client / configured default
 *      / first available). Returns `SAMPLING_NOT_SUPPORTED` if none.
 *   2. Build / accept the context block (auto-fill when omitted).
 *   3. Cache lookup.
 *   4. Render the per-family system prompt (SDXL tag-style by default;
 *      Flux natural-language when the active model is a Flux variant).
 *   5. Submit the sampling request with `max_tokens` + temperature.
 *   6. Parse the response; retry once with a stricter system prompt on
 *      malformed output (FR-19).
 *   7. Cache + return.
 *
 * The handler does NOT register a job with `JobTracker` — the tracker is
 * tied to ComfyUI graphs (`tracker.submit(GraphSpec, …)`) and the
 * sampling round-trip rides on the dispatcher's standard request scope.
 *
 * TODO(prompt-enhancement): once `JobTracker` is generalized to accept
 * non-ComfyUI jobs, re-route through it so `cancel_job` works against
 * sampling round-trips (Q2). Today, cancellation rides on the per-call
 * AbortSignal — sufficient for v1.
 */

import { ServerError } from '../../types/errors.js';
import type { ToolHandler } from '../../types/handler-context.js';
import type { enhancePrompt as enhancePromptTool } from '@diffusecraft/mcp-tools';
import type { PromptEnhancementConfig, SamplingConfig } from '../../types/config.js';
import { buildContext, type ContextSources } from './context-builder.js';
import { EnhancementCache, computeCacheKey } from './cache.js';
import { defaultLanguageAdapter, type LanguageDetectionAdapter } from './language-detection.js';
import { parseResponse } from './response-parser.js';
import { renderSystemPrompt, resolvePromptFamily } from './system-prompt-loader.js';
import {
  resolveSamplingTarget,
  type SamplingClientRegistry,
} from './sampling-target-resolver.js';
import type { EnhanceInput, EnhanceOutput, SamplingRequest, SamplingResponse } from './types.js';

const SYSTEM_USER_TEMPLATE = `Rewrite the user's prompt per the rules above. User prompt:\n"{{input}}"\n\nReturn ONLY the rewritten prompt.`;

export interface EnhancePromptHandlerDeps {
  config: {
    sampling: SamplingConfig;
    prompt_enhancement: PromptEnhancementConfig;
  };
  /** Sampling-capable session registry; optional — handler still works without it (calling client only). */
  samplingRegistry?: SamplingClientRegistry;
  /** Source of auto-context (canvas summary, control layers, regions). Optional. */
  contextSources?: ContextSources;
  /** Override the language adapter (tests). */
  languageAdapter?: LanguageDetectionAdapter;
  /** Pre-built cache; one is created if not supplied. */
  cache?: EnhancementCache;
}

/**
 * Build the registered `enhance_prompt` handler. Hosts call this once
 * at start-up and pass the result to `dispatcher.register(...)`.
 */
export function createEnhancePromptHandler(
  deps: EnhancePromptHandlerDeps,
): ToolHandler<typeof enhancePromptTool.inputSchema, typeof enhancePromptTool.outputSchema> {
  const cache = deps.cache ?? new EnhancementCache();
  const language = deps.languageAdapter ?? defaultLanguageAdapter;

  return async (input, ctx): Promise<EnhanceOutput> => {
    // 1. Resolve sampling target (FR-10/FR-11).
    const target = resolveSamplingTarget(ctx, {
      ...(deps.config.sampling.default_agent_token_name !== undefined
        ? { default_agent_token_name: deps.config.sampling.default_agent_token_name }
        : {}),
      ...(deps.samplingRegistry !== undefined ? { registry: deps.samplingRegistry } : {}),
    });
    if (!target) {
      throw new ServerError({
        code: 'SAMPLING_NOT_SUPPORTED',
        message: 'no sampling-capable agent paired',
        cause: {
          hint: 'Pair Claude Desktop, Claude Code, OpenAI Codex, or Gemini CLI to enable enhancement.',
        },
      });
    }

    // 2. Resolve context.
    const context = input.context ?? (deps.contextSources ? await buildContext(deps.contextSources) : undefined);

    // 3. Cache lookup.
    const cacheKey = computeCacheKey(input as EnhanceInput, context, target.agentName);
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        enhanced: cached.enhanced,
        language_detected: cached.language_detected,
        used_sampling: false,
        agent_name: cached.agent_name,
      };
    }

    // 4. Detect input language for the response payload.
    const inputLanguage = language.detect(input.input);

    // 5. Render the system prompt for the active model family.
    const family = resolvePromptFamily(input.target_model);
    const baseSystemPrompt = renderSystemPrompt(
      family,
      {
        input: input.input,
        mode: input.mode,
        target_length: input.target_length,
        ...(input.style_hint !== undefined ? { style_hint: input.style_hint } : {}),
        ...(context !== undefined ? { context } : {}),
      },
      {
        ...(deps.config.prompt_enhancement.templates_dir !== undefined
          ? { templates_dir: deps.config.prompt_enhancement.templates_dir }
          : {}),
        ...(deps.config.prompt_enhancement.system_prompt_path !== undefined
          ? { system_prompt_path: deps.config.prompt_enhancement.system_prompt_path }
          : {}),
      },
    );

    const requestBase: SamplingRequest = {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: SYSTEM_USER_TEMPLATE.replace('{{input}}', input.input) },
        },
      ],
      systemPrompt: baseSystemPrompt,
      maxTokens: deps.config.prompt_enhancement.max_output_tokens,
      temperature: 0.4,
    };

    // 6. Submit + parse.
    let response: SamplingResponse;
    try {
      response = await target.client.request(requestBase, {
        timeoutMs: deps.config.prompt_enhancement.sampling_timeout_ms,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'TIMEOUT' || code === 'ENHANCEMENT_TIMEOUT' || (err as Error).name === 'AbortError') {
        throw new ServerError({
          code: 'ENHANCEMENT_TIMEOUT',
          message: `sampling round-trip timed out (agent=${target.agentName})`,
          cause: err,
        });
      }
      throw new ServerError({
        code: 'ENHANCEMENT_TIMEOUT',
        message: `sampling round-trip failed (agent=${target.agentName})`,
        cause: err,
      });
    }

    let parsed = parseResponse(response.text, {
      language_adapter: language,
      // translate_only mode that returns "en" output is the goal; reject non-en still applies.
    });

    // Strict-retry once on malformed output (FR-19).
    if (!parsed.ok) {
      const stricterPrompt = renderSystemPrompt(
        family,
        {
          input: input.input,
          mode: input.mode,
          target_length: input.target_length,
          ...(input.style_hint !== undefined ? { style_hint: input.style_hint } : {}),
          ...(context !== undefined ? { context } : {}),
          strict_retry: true,
        },
        {
          ...(deps.config.prompt_enhancement.templates_dir !== undefined
            ? { templates_dir: deps.config.prompt_enhancement.templates_dir }
            : {}),
          ...(deps.config.prompt_enhancement.system_prompt_path !== undefined
            ? { system_prompt_path: deps.config.prompt_enhancement.system_prompt_path }
            : {}),
        },
      );
      const retryResponse = await target.client.request(
        { ...requestBase, systemPrompt: stricterPrompt },
        { timeoutMs: deps.config.prompt_enhancement.sampling_timeout_ms },
      );
      parsed = parseResponse(retryResponse.text, { language_adapter: language });
      if (!parsed.ok) {
        throw new ServerError({
          code: 'ENHANCEMENT_RESPONSE_INVALID',
          message: `agent response could not be parsed: ${parsed.error}`,
          cause: { agent_name: target.agentName, raw_excerpt: retryResponse.text.slice(0, 240) },
        });
      }
    }

    // Refusal path.
    if (parsed.refused) {
      throw new ServerError({
        code: 'ENHANCEMENT_REFUSED',
        message: parsed.refused_message,
        cause: { agent_name: target.agentName },
      });
    }

    const result: EnhanceOutput = {
      enhanced: parsed.text,
      language_detected: inputLanguage,
      used_sampling: true,
      agent_name: target.agentName,
    };
    cache.set(cacheKey, {
      enhanced: result.enhanced,
      language_detected: result.language_detected,
      agent_name: target.agentName,
    });
    return result;
  };
}

/**
 * Internal-translate entrypoint (design.md §4.3-ter, FR-29..FR-31).
 *
 * Used by `generate_image` and other prompt-consuming job tools to
 * translate non-English prompts before hitting the diffusion backend.
 * Bypasses the catalog interface but reuses the same orchestration.
 *
 * TODO(prompt-enhancement): wire from `generate_image` once the
 * generation handler lands its prompt-resolution path.
 */
export async function enhancePromptInternal(
  args: {
    prompt: string;
    target_model?: string;
  },
  ctx: Parameters<ToolHandler<typeof enhancePromptTool.inputSchema, typeof enhancePromptTool.outputSchema>>[1],
  deps: EnhancePromptHandlerDeps,
): Promise<{ enhanced: string; language_detected: string }> {
  const adapter = deps.languageAdapter ?? defaultLanguageAdapter;
  const detected = adapter.detect(args.prompt);
  if (detected === 'en') {
    return { enhanced: args.prompt, language_detected: 'en' };
  }
  const handler = createEnhancePromptHandler(deps);
  const result = await handler(
    {
      input: args.prompt,
      mode: 'translate_only',
      target_length: 'medium',
      ...(args.target_model !== undefined ? { target_model: args.target_model } : {}),
    },
    ctx,
  );
  return { enhanced: result.enhanced, language_detected: result.language_detected };
}
