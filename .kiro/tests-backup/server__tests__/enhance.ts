#!/usr/bin/env tsx
/**
 * Prompt-enhancement unit tests
 * (`.kiro/specs/prompt-enhancement` — Phase A..F coverage).
 *
 * Exercises the orchestration primitives without standing up the full
 * server. The suite uses an in-process stub `SamplingClient` so we can
 * drive every branch (success, refusal, malformed-then-strict-retry,
 * timeout, sampling-not-supported, cache hit, cache miss, agent-keyed
 * isolation).
 *
 * Run: `pnpm --filter @diffusecraft/server exec tsx src/__tests__/enhance.ts`.
 */
import { strict as assert } from 'node:assert';
import { z } from 'zod';

import {
  EnhancementCache,
  computeCacheKey,
  ENHANCEMENT_CACHE_TTL_MS,
} from '../lib/prompt-enhancement/cache.js';
import {
  parseResponse,
  type ParsedResponse,
} from '../lib/prompt-enhancement/response-parser.js';
import {
  resolveSamplingTarget,
  type SamplingClientRegistry,
} from '../lib/prompt-enhancement/sampling-target-resolver.js';
import {
  buildContext,
  capContextToBudget,
  CONTEXT_BUDGET_BYTES,
  type ContextSources,
} from '../lib/prompt-enhancement/context-builder.js';
import {
  renderSystemPrompt,
  resolvePromptFamily,
} from '../lib/prompt-enhancement/system-prompt-loader.js';
import {
  HeuristicLanguageAdapter,
  type LanguageDetectionAdapter,
} from '../lib/prompt-enhancement/language-detection.js';
import { createEnhancePromptHandler } from '../lib/prompt-enhancement/handler.js';
import type {
  EnhanceInput,
  SamplingClient,
  SamplingRequest,
  SamplingResponse,
} from '../lib/prompt-enhancement/types.js';
import type { HandlerContext } from '../types/handler-context.js';
import type {
  PromptEnhancementConfig,
  SamplingConfig,
} from '../types/config.js';
import { ServerError } from '../types/errors.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeStubClient(opts: {
  agentName: string;
  supportsSampling?: boolean;
  // Sequence of responses; replayed in order. After the last is consumed,
  // requests throw `out-of-responses`.
  responses?: Array<SamplingResponse | Error>;
  // Hook fired with each request — useful for asserting system-prompt content.
  onRequest?: (req: SamplingRequest) => void;
}): { client: SamplingClient; calls: SamplingRequest[] } {
  const calls: SamplingRequest[] = [];
  const queue = [...(opts.responses ?? [])];
  const client: SamplingClient = {
    agentName: opts.agentName,
    supportsSampling: opts.supportsSampling ?? true,
    async request(req: SamplingRequest): Promise<SamplingResponse> {
      calls.push(req);
      opts.onRequest?.(req);
      const next = queue.shift();
      if (!next) throw new Error('out-of-responses (test-stub)');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

function makeCtx(samplingClient?: SamplingClient): HandlerContext {
  const ctx: HandlerContext = {
    request_id: 'test-req',
    transport: 'in-memory',
    token_id: null,
    token_name: 'tester',
    received_at: Date.now(),
    publish: () => {
      /* noop */
    },
    audit: () => {
      /* noop */
    },
    logger: {
      info: () => {
        /* noop */
      },
      error: () => {
        /* noop */
      },
    },
    ...(samplingClient !== undefined ? { samplingClient } : {}),
  };
  return ctx;
}

function defaultConfig(overrides: Partial<{
  sampling: SamplingConfig;
  prompt_enhancement: Partial<PromptEnhancementConfig>;
}> = {}): { sampling: SamplingConfig; prompt_enhancement: PromptEnhancementConfig } {
  return {
    sampling: overrides.sampling ?? {},
    prompt_enhancement: {
      auto_translate_enabled: true,
      sampling_timeout_ms: 30_000,
      max_output_tokens: 256,
      ...overrides.prompt_enhancement,
    },
  };
}

const baseInput: EnhanceInput = {
  input: 'una mujer joven en un campo de girasoles al atardecer',
  mode: 'rewrite',
  target_length: 'medium',
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => void | Promise<void>]> = [
  // ---- Cache (Phase E) -----------------------------------------------
  ['cache hit returns the stored value before TTL expiry', () => {
    const cache = new EnhancementCache();
    cache.set('k1', { enhanced: 'hello', language_detected: 'en', agent_name: 'a' });
    const hit = cache.get('k1');
    assert.deepEqual(hit, { enhanced: 'hello', language_detected: 'en', agent_name: 'a' });
  }],
  ['cache miss returns undefined for unknown keys', () => {
    const cache = new EnhancementCache();
    assert.equal(cache.get('missing'), undefined);
  }],
  ['cache expires entries past TTL', () => {
    const cache = new EnhancementCache(1); // 1 ms TTL
    cache.set('k', { enhanced: 'x', language_detected: 'en', agent_name: 'a' });
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        assert.equal(cache.get('k'), undefined);
        resolve();
      }, 5),
    );
  }],
  ['default TTL is 5 minutes', () => {
    assert.equal(ENHANCEMENT_CACHE_TTL_MS, 5 * 60 * 1_000);
  }],
  ['cache key differs across agents (FR-17 / Q6)', () => {
    const k1 = computeCacheKey(baseInput, undefined, 'claude');
    const k2 = computeCacheKey(baseInput, undefined, 'codex');
    assert.notEqual(k1, k2);
  }],
  ['cache key differs across modes', () => {
    const k1 = computeCacheKey({ ...baseInput, mode: 'translate_only' }, undefined, 'a');
    const k2 = computeCacheKey({ ...baseInput, mode: 'elaborate' }, undefined, 'a');
    assert.notEqual(k1, k2);
  }],
  ['cache key is stable across context-key reorderings', () => {
    const ctxA = { canvas_summary: { width: 1024, height: 1024, layer_count: 3 }, active_workspace: 'Generate' as const };
    const ctxB = { active_workspace: 'Generate' as const, canvas_summary: { width: 1024, height: 1024, layer_count: 3 } };
    const k1 = computeCacheKey(baseInput, ctxA, 'a');
    const k2 = computeCacheKey(baseInput, ctxB, 'a');
    assert.equal(k1, k2);
  }],

  // ---- Response parser (Phase D) -------------------------------------
  ['parser accepts a clean English rewrite', () => {
    const parsed = parseResponse('young woman in a sunflower field at golden hour, soft warm light, photographic, 8k') as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok && !parsed.refused) {
      assert.equal(parsed.language, 'en');
    }
  }],
  ['parser strips wrapping double quotes', () => {
    const parsed = parseResponse('"young woman in a sunflower field at golden hour"') as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok && !parsed.refused) {
      assert.equal(parsed.text.startsWith('"'), false);
      assert.equal(parsed.text.endsWith('"'), false);
    }
  }],
  ['parser strips a "Here is the prompt:" preamble', () => {
    const parsed = parseResponse("Here's your prompt: a young woman in a sunflower field at golden hour, soft warm light, 8k") as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok && !parsed.refused) {
      assert.match(parsed.text, /^a young woman/);
    }
  }],
  ['parser strips markdown code fences', () => {
    const parsed = parseResponse('```\nyoung woman in a sunflower field at golden hour, 8k\n```') as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok && !parsed.refused) {
      assert.match(parsed.text, /^young woman/);
    }
  }],
  ['parser flags a refusal', () => {
    const parsed = parseResponse("I can't help with that request.") as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.refused, true);
  }],
  ['parser flags Spanish refusal too', () => {
    const parsed = parseResponse('Lo siento, pero no puedo ayudar con eso.') as ParsedResponse;
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.refused, true);
  }],
  ['parser rejects empty body', () => {
    const parsed = parseResponse('   ') as ParsedResponse;
    assert.equal(parsed.ok, false);
  }],
  ['parser rejects too-long body (over-explanation)', () => {
    const long = 'a '.repeat(2_000);
    const parsed = parseResponse(long) as ParsedResponse;
    assert.equal(parsed.ok, false);
  }],
  ['parser rejects non-English output when require_english=true', () => {
    const stub: LanguageDetectionAdapter = {
      detect: () => 'es',
    };
    const parsed = parseResponse('un texto cualquiera con suficiente longitud para pasar el chequeo de tamaño', {
      language_adapter: stub,
    }) as ParsedResponse;
    assert.equal(parsed.ok, false);
  }],
  ['parser allows non-English output when require_english=false', () => {
    const stub: LanguageDetectionAdapter = {
      detect: () => 'es',
    };
    const parsed = parseResponse('un texto cualquiera con suficiente longitud para validar', {
      language_adapter: stub,
      require_english: false,
    }) as ParsedResponse;
    assert.equal(parsed.ok, true);
  }],

  // ---- Language detection -------------------------------------------
  ['HeuristicLanguageAdapter: short input → en', () => {
    const a = new HeuristicLanguageAdapter();
    assert.equal(a.detect('hi'), 'en');
  }],
  ['HeuristicLanguageAdapter: Spanish ñ → es', () => {
    const a = new HeuristicLanguageAdapter();
    assert.equal(a.detect('una niña en el campo'), 'es');
  }],
  ['HeuristicLanguageAdapter: Japanese hiragana → ja', () => {
    const a = new HeuristicLanguageAdapter();
    assert.equal(a.detect('ひらがなのテキスト'), 'ja');
  }],
  ['HeuristicLanguageAdapter: pure English → en', () => {
    const a = new HeuristicLanguageAdapter();
    assert.equal(a.detect('a young woman in a sunflower field'), 'en');
  }],

  // ---- Sampling-target resolver (Phase B) ----------------------------
  ['resolver picks calling client when it supports sampling (priority 1)', () => {
    const { client } = makeStubClient({ agentName: 'caller' });
    const ctx = makeCtx(client);
    const target = resolveSamplingTarget(ctx);
    assert.ok(target);
    assert.equal(target!.priority, 1);
    assert.equal(target!.agentName, 'caller');
  }],
  ['resolver falls through to default when calling client lacks sampling (priority 2)', () => {
    const { client: caller } = makeStubClient({ agentName: 'caller', supportsSampling: false });
    const { client: defaultAgent } = makeStubClient({ agentName: 'claude-desktop' });
    const ctx = makeCtx(caller);
    const registry: SamplingClientRegistry = {
      findByTokenName: (n) => (n === 'claude-desktop' ? defaultAgent : null),
      active: () => [defaultAgent],
    };
    const target = resolveSamplingTarget(ctx, {
      default_agent_token_name: 'claude-desktop',
      registry,
    });
    assert.ok(target);
    assert.equal(target!.priority, 2);
  }],
  ['resolver falls through to first available when no default (priority 3)', () => {
    const { client: someone } = makeStubClient({ agentName: 'someone' });
    const ctx = makeCtx(undefined);
    const registry: SamplingClientRegistry = {
      findByTokenName: () => null,
      active: () => [someone],
    };
    const target = resolveSamplingTarget(ctx, { registry });
    assert.ok(target);
    assert.equal(target!.priority, 3);
  }],
  ['resolver returns null when nothing supports sampling', () => {
    const ctx = makeCtx(undefined);
    const target = resolveSamplingTarget(ctx);
    assert.equal(target, null);
  }],

  // ---- Context builder (Phase A.5/6) ---------------------------------
  ['context builder returns undefined when no active document', async () => {
    const sources: ContextSources = {
      activeDocumentId: () => null,
    };
    const ctx = await buildContext(sources);
    assert.equal(ctx, undefined);
  }],
  ['context builder fills canvas summary from sources', async () => {
    const sources: ContextSources = {
      activeDocumentId: () => 'doc-1',
      getDocumentSummary: () => ({ width: 1024, height: 768, layer_count: 4 }),
    };
    const ctx = await buildContext(sources);
    assert.ok(ctx);
    assert.deepEqual(ctx!.canvas_summary, { width: 1024, height: 768, layer_count: 4 });
  }],
  ['context builder caps to ≤ 2 KB', async () => {
    const big = 'x'.repeat(300);
    const sources: ContextSources = {
      activeDocumentId: () => 'doc-1',
      getDocumentSummary: () => ({ width: 1024, height: 768, layer_count: 4 }),
      listRegions: () =>
        Array.from({ length: 10 }, (_v, i) => ({ name: `region-${i}`, prompt_excerpt: big })),
      listControlLayers: () =>
        Array.from({ length: 10 }, (_v, i) => ({ type: 'pose', name: `ctl-${i}` })),
      getRootPrompt: () => big.repeat(3),
    };
    const ctx = await buildContext(sources);
    assert.ok(ctx);
    assert.ok(Buffer.byteLength(JSON.stringify(ctx), 'utf8') <= CONTEXT_BUDGET_BYTES);
  }],
  ['capContextToBudget drops region_summary first', () => {
    const ctx = {
      canvas_summary: { width: 1024, height: 1024, layer_count: 1 },
      region_summary: Array.from({ length: 5 }, (_v, i) => ({
        name: `r${i}`,
        prompt_excerpt: 'x'.repeat(800),
      })),
    };
    const trimmed = capContextToBudget(ctx);
    assert.equal(trimmed.region_summary, undefined);
    assert.ok(trimmed.canvas_summary);
  }],

  // ---- System prompt rendering (Phase A.1..A.4) ----------------------
  ['resolvePromptFamily defaults to sdxl on unknown', () => {
    assert.equal(resolvePromptFamily(undefined), 'sdxl');
    assert.equal(resolvePromptFamily('mystery-model'), 'sdxl');
  }],
  ['resolvePromptFamily picks flux when id mentions flux', () => {
    assert.equal(resolvePromptFamily('flux.1-dev'), 'flux');
    assert.equal(resolvePromptFamily('civitai:flux-1-pro'), 'flux');
  }],
  ['renderSystemPrompt SDXL includes mode + length + style hint + input', () => {
    const out = renderSystemPrompt('sdxl', {
      input: 'a barn at dusk',
      mode: 'elaborate',
      target_length: 'long',
      style_hint: 'concept-art',
    });
    assert.match(out, /a barn at dusk/);
    assert.match(out, /elaborate/);
    assert.match(out, /long/);
    assert.match(out, /concept-art/);
    assert.match(out, /TAG-STYLE/);
  }],
  ['renderSystemPrompt Flux uses natural-language wording', () => {
    const out = renderSystemPrompt('flux', {
      input: 'a barn at dusk',
      mode: 'rewrite',
      target_length: 'medium',
    });
    assert.match(out, /NATURAL-LANGUAGE/);
  }],
  ['renderSystemPrompt with context block embeds canvas summary', () => {
    const out = renderSystemPrompt('sdxl', {
      input: 'a barn',
      mode: 'rewrite',
      target_length: 'medium',
      context: {
        canvas_summary: { width: 1024, height: 1024, layer_count: 3 },
        active_workspace: 'Generate',
      },
    });
    assert.match(out, /1024×1024/);
    assert.match(out, /Generate/);
  }],
  ['renderSystemPrompt strict_retry=true appends the strict instruction', () => {
    const out = renderSystemPrompt('sdxl', {
      input: 'a barn',
      mode: 'rewrite',
      target_length: 'medium',
      strict_retry: true,
    });
    assert.match(out, /STRICT RETRY/);
  }],
  ['renderSystemPrompt removes any unfilled placeholders', () => {
    const out = renderSystemPrompt('sdxl', {
      input: 'a barn',
      mode: 'rewrite',
      target_length: 'medium',
    });
    assert.equal(out.includes('{{'), false);
  }],

  // ---- Handler — full orchestration (Phase C) ------------------------
  ['handler returns SAMPLING_NOT_SUPPORTED when no agent supports sampling (FR-11)', async () => {
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await assert.rejects(
      () => handler(baseInput, makeCtx()),
      (err: unknown) =>
        err instanceof ServerError && (err as ServerError).code === 'SAMPLING_NOT_SUPPORTED',
    );
  }],
  ['handler returns clean output on a happy-path sampling response', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'claude-desktop',
      responses: [
        {
          text: 'young woman, sunflower field, golden hour, soft warm light, photographic, 8k',
        },
      ],
    });
    // Inject a stub language adapter so the test is deterministic: the
    // production heuristic is conservative on bare-Latin Spanish (no ñ /
    // accent markers), which is fine for the auto-translate decision but
    // makes assertions noisy. The test exercises the end-to-end shape.
    const stub: LanguageDetectionAdapter = {
      detect: (text) => (text.includes('mujer') ? 'es' : 'en'),
    };
    const handler = createEnhancePromptHandler({
      config: defaultConfig(),
      languageAdapter: stub,
    });
    const out = await handler(baseInput, makeCtx(client));
    assert.equal(out.used_sampling, true);
    assert.equal(out.agent_name, 'claude-desktop');
    assert.equal(out.language_detected, 'es');
    assert.match(out.enhanced, /young woman/);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.systemPrompt, /TAG-STYLE/);
  }],
  ['handler caches and returns used_sampling=false on the second identical call', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'claude-desktop',
      responses: [
        { text: 'young woman, sunflower field, golden hour, photographic, 8k' },
      ],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    const ctx = makeCtx(client);
    const a = await handler(baseInput, ctx);
    const b = await handler(baseInput, ctx);
    assert.equal(a.used_sampling, true);
    assert.equal(b.used_sampling, false);
    assert.equal(calls.length, 1);
    assert.equal(a.enhanced, b.enhanced);
  }],
  ['handler retries with strict prompt on malformed response, succeeds on retry (FR-19)', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'codex',
      responses: [
        // First attempt: agent over-explained (oversize) — parser rejects.
        { text: 'a '.repeat(2_000) },
        // Strict retry: clean English.
        { text: 'young woman in a sunflower field at golden hour, photographic, 8k' },
      ],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    const out = await handler(baseInput, makeCtx(client));
    assert.equal(out.used_sampling, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.systemPrompt, /STRICT RETRY/);
    assert.match(out.enhanced, /young woman/);
  }],
  ['handler surfaces ENHANCEMENT_RESPONSE_INVALID when both attempts fail', async () => {
    const { client } = makeStubClient({
      agentName: 'codex',
      responses: [
        { text: '' }, // empty
        { text: '' }, // still empty after strict retry
      ],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await assert.rejects(
      () => handler(baseInput, makeCtx(client)),
      (err: unknown) =>
        err instanceof ServerError &&
        (err as ServerError).code === 'ENHANCEMENT_RESPONSE_INVALID',
    );
  }],
  ['handler surfaces ENHANCEMENT_REFUSED when agent refuses', async () => {
    const { client } = makeStubClient({
      agentName: 'gemini',
      responses: [{ text: "I can't help with that prompt." }],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await assert.rejects(
      () => handler(baseInput, makeCtx(client)),
      (err: unknown) =>
        err instanceof ServerError && (err as ServerError).code === 'ENHANCEMENT_REFUSED',
    );
  }],
  ['handler surfaces ENHANCEMENT_TIMEOUT when sampling throws AbortError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const { client } = makeStubClient({
      agentName: 'flaky-agent',
      responses: [abortErr],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await assert.rejects(
      () => handler(baseInput, makeCtx(client)),
      (err: unknown) =>
        err instanceof ServerError && (err as ServerError).code === 'ENHANCEMENT_TIMEOUT',
    );
  }],
  ['handler picks the Flux template when target_model contains "flux"', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'claude-desktop',
      responses: [
        {
          text: 'A young woman in a sunflower field at golden hour, soft warm light, photographic.',
        },
      ],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    const out = await handler(
      { ...baseInput, target_model: 'flux.1-dev' },
      makeCtx(client),
    );
    assert.equal(out.used_sampling, true);
    assert.match(calls[0]!.systemPrompt, /NATURAL-LANGUAGE/);
  }],
  ['handler honors translate_only mode wording', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'claude-desktop',
      responses: [
        {
          text: 'a young woman in a sunflower field at sunset',
        },
      ],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await handler({ ...baseInput, mode: 'translate_only' }, makeCtx(client));
    assert.match(calls[0]!.systemPrompt, /Translate to English/);
  }],
  ['handler attaches user-provided context verbatim (FR-9)', async () => {
    const { client, calls } = makeStubClient({
      agentName: 'claude-desktop',
      responses: [{ text: 'red wooden barn at dusk, golden hour, cinematic, 8k' }],
    });
    const handler = createEnhancePromptHandler({ config: defaultConfig() });
    await handler(
      {
        input: 'barn at dusk',
        mode: 'elaborate',
        target_length: 'medium',
        context: {
          canvas_summary: { width: 1024, height: 768, layer_count: 2 },
          active_workspace: 'Generate',
          control_layer_summary: [{ type: 'pose', name: 'stick-figure' }],
        },
      },
      makeCtx(client),
    );
    assert.match(calls[0]!.systemPrompt, /Active control layers: pose\/stick-figure/);
    assert.match(calls[0]!.systemPrompt, /1024×768/);
  }],

  // ---- Catalog schema parity ----------------------------------------
  ['enhance_prompt schema accepts the new input shape', () => {
    // Imported lazily to avoid circular import surprises in the test harness.
    return import('@diffusecraft/mcp-tools').then(({ enhancePrompt }) => {
      const result = enhancePrompt.inputSchema.safeParse({
        input: 'a barn at dusk',
        mode: 'rewrite',
        target_length: 'medium',
        style_hint: 'concept-art',
      });
      assert.equal(result.success, true);
    });
  }],
  ['enhance_prompt schema rejects empty input', () => {
    return import('@diffusecraft/mcp-tools').then(({ enhancePrompt }) => {
      const result = enhancePrompt.inputSchema.safeParse({ input: '' });
      assert.equal(result.success, false);
    });
  }],
  ['enhance_prompt output schema mirrors handler output', () => {
    return import('@diffusecraft/mcp-tools').then(({ enhancePrompt }) => {
      const result = enhancePrompt.outputSchema.safeParse({
        enhanced: 'young woman, sunflower field, golden hour',
        language_detected: 'es',
        used_sampling: true,
        agent_name: 'claude-desktop',
      });
      assert.equal(result.success, true);
    });
  }],

  // ---- Type probe — schema generic plumbing -------------------------
  ['enhance_prompt schemas are zod types', () => {
    return import('@diffusecraft/mcp-tools').then(({ enhancePrompt }) => {
      assert.ok(enhancePrompt.inputSchema instanceof z.ZodType);
      assert.ok(enhancePrompt.outputSchema instanceof z.ZodType);
    });
  }],
];

(async () => {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).stack ?? (err as Error).message}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} enhance test(s) failed.`);
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${cases.length}/${cases.length} enhance test(s) passed.`);
  }
})();
