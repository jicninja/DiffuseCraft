/**
 * Response parser (design.md §7).
 *
 * Validates a sampling-agent response and either:
 *   - extracts a clean rewritten prompt (`{ ok: true, refused: false, … }`);
 *   - flags a refusal (`{ ok: true, refused: true, message }`);
 *   - rejects the response as malformed (`{ ok: false, error }`).
 *
 * Rejection here is recoverable — the handler retries once with a stricter
 * system prompt before surfacing `ENHANCEMENT_RESPONSE_INVALID`.
 */

import { defaultLanguageAdapter, type LanguageDetectionAdapter } from './language-detection.js';

export type ParsedResponse =
  | { ok: true; refused: false; text: string; language: string }
  | { ok: true; refused: true; refused_message: string }
  | { ok: false; error: string };

/**
 * Patterns that mark agent refusals. Multilingual coverage is shallow —
 * most modern agents return English-language refusals regardless of the
 * input language; we still check a few common Spanish/Portuguese forms
 * so a Spanish-paired Codex doesn't get mis-classified.
 */
const REFUSAL_PATTERNS = [
  /\bi\s*can'?t\b/i,
  /\bi'?m\s+unable\b/i,
  /\bi\s+won'?t\b/i,
  /\bnot\s+appropriate\b/i,
  /\bcontent\s+polic/i,
  /\bsorry,?\s+(but\s+)?i\b/i,
  // Spanish
  /\bno\s+puedo\b/i,
  /\blo\s+siento,?\s+pero\s+no\b/i,
  // Portuguese
  /\bn[ãa]o\s+posso\b/i,
];

const PREAMBLE_PATTERNS = [
  /^here'?s\s+(your\s+|the\s+)?(rewritten\s+)?prompt:?/i,
  /^certainly[,!]?\s+/i,
  /^sure[,!]?\s+/i,
  /^of\s+course[,!]?\s+/i,
  /^okay[,!]?\s+/i,
  /^rewritten\s+prompt:?/i,
  /^enhanced\s+prompt:?/i,
];

const MAX_RESPONSE_LEN = 3_000;
const MIN_RESPONSE_LEN = 5;

export interface ParseOptions {
  /**
   * Language detector used to enforce "must be English" (FR-NFR-3).
   * Tests inject a stub that returns whatever language was provided.
   */
  language_adapter?: LanguageDetectionAdapter;
  /**
   * Whether to enforce English-only output. Defaults to `true`. The
   * generation pipeline calls the parser with this off when running
   * `translate_only` against an already-English prompt (vacuously valid).
   */
  require_english?: boolean;
}

/**
 * Parse a raw agent response. The function strips one layer of wrapping
 * quotes, peels off common preambles, and then validates length /
 * language / refusal markers.
 */
export function parseResponse(raw: string, opts: ParseOptions = {}): ParsedResponse {
  const adapter = opts.language_adapter ?? defaultLanguageAdapter;
  const requireEnglish = opts.require_english ?? true;

  if (typeof raw !== 'string') {
    return { ok: false, error: 'response was not a string' };
  }

  let text = raw.trim();
  if (text.length === 0) return { ok: false, error: 'empty response' };

  // Refusal check runs against the raw trimmed body so we don't strip a
  // refusal sentence as if it were a preamble.
  if (REFUSAL_PATTERNS.some((p) => p.test(text))) {
    return { ok: true, refused: true, refused_message: text };
  }

  // Strip outer quotes (single layer).
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  // Strip a single common preamble line if present.
  for (const p of PREAMBLE_PATTERNS) {
    if (p.test(text)) {
      text = text.replace(p, '').trim();
      // After stripping the preamble we may have a colon/newline left.
      text = text.replace(/^[:\-–—\s]+/, '').trim();
      break;
    }
  }

  // Strip wrapping markdown code fences (```...```).
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  if (text.length < MIN_RESPONSE_LEN) {
    return { ok: false, error: 'response empty or trivial' };
  }
  if (text.length > MAX_RESPONSE_LEN) {
    return { ok: false, error: 'response too long; suspected over-explanation' };
  }

  const language = adapter.detect(text);
  if (requireEnglish && language !== 'en') {
    return { ok: false, error: `output not in English (detected: ${language})` };
  }

  return { ok: true, refused: false, text, language };
}
