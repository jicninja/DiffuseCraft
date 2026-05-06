/**
 * Public surface of the prompt-enhancement module
 * (`.kiro/specs/prompt-enhancement`).
 *
 * Hosts wire `createEnhancePromptHandler(deps)` against the catalog's
 * `enhance_prompt` tool definition. Tests import the orchestration
 * primitives (cache, parser, resolver) directly to exercise edge cases.
 */

export {
  createEnhancePromptHandler,
  enhancePromptInternal,
  type EnhancePromptHandlerDeps,
} from './handler.js';

export {
  EnhancementCache,
  computeCacheKey,
  ENHANCEMENT_CACHE_TTL_MS,
} from './cache.js';

export {
  parseResponse,
  type ParsedResponse,
  type ParseOptions,
} from './response-parser.js';

export {
  resolveSamplingTarget,
  type SamplingClientRegistry,
  type ResolveOptions,
} from './sampling-target-resolver.js';

export {
  buildContext,
  capContextToBudget,
  CONTEXT_BUDGET_BYTES,
  type ContextSources,
} from './context-builder.js';

export {
  renderSystemPrompt,
  resolvePromptFamily,
  MODEL_METADATA,
  type PromptFamily,
  type TemplateSlots,
  type LoadOptions,
} from './system-prompt-loader.js';

export {
  defaultLanguageAdapter,
  HeuristicLanguageAdapter,
  type LanguageDetectionAdapter,
  type LanguageCode,
} from './language-detection.js';

export type {
  EnhanceInput,
  EnhanceOutput,
  EnhancementContext,
  EnhancementMode,
  EnhancementTargetLength,
  SamplingClient,
  SamplingMessage,
  SamplingRequest,
  SamplingResponse,
  SamplingTarget,
  CachedEnhancement,
} from './types.js';
