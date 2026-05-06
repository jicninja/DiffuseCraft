/**
 * System-prompt loader + interpolator (design.md §4).
 *
 * Picks a per-family template (`sdxl.md`, `flux.md`, …), interpolates the
 * `{{placeholder}}` slots with the runtime values from the handler call,
 * and returns the fully-rendered system prompt.
 *
 * The default templates ship inside this package
 * (`./system-prompts/{family}.md`); operators may override the directory
 * via `ServerConfig.prompt_enhancement.templates_dir` (FR-16-d) or supply
 * a single override file via `ServerConfig.prompt_enhancement.system_prompt_path`
 * (Q1).
 *
 * Templating is deliberately simple — no Handlebars dependency. We
 * support a flat set of `{{key}}` placeholders and one block helper
 * (`{{strict_retry_block}}`) that is filled when the strict-retry path
 * is exercised. Anything more elaborate would push the spec into a real
 * templating engine; the design (§4) does not warrant it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import type { EnhancementContext, EnhancementMode, EnhancementTargetLength } from './types.js';

/** Family alias for system-prompt selection. Used by `MODEL_METADATA`. */
export type PromptFamily = 'sdxl' | 'flux' | string;

/**
 * Bundled `MODEL_METADATA` mapping known model ids to their prompt
 * family (FR-16-b). Unknowns default to tag-style (`sdxl`) per the
 * "most-compatible" rule.
 *
 * The list is intentionally narrow — production deployments add models
 * via custom config; the catalog stays small.
 */
export const MODEL_METADATA: Record<string, { prompt_style: PromptFamily }> = {
  // Stable Diffusion family
  'sdxl-base-1.0': { prompt_style: 'sdxl' },
  'sd-1.5': { prompt_style: 'sdxl' },
  'pony-diffusion': { prompt_style: 'sdxl' },
  // Flux family
  'flux.1-dev': { prompt_style: 'flux' },
  'flux.1-schnell': { prompt_style: 'flux' },
  'flux.1-pro': { prompt_style: 'flux' },
};

/** Resolve a model id to its prompt family. Defaults to `sdxl` (tag-style). */
export function resolvePromptFamily(modelId: string | undefined): PromptFamily {
  if (!modelId) return 'sdxl';
  // Match exact id first; then check substring (e.g., `civitai:flux-1-dev`).
  const exact = MODEL_METADATA[modelId];
  if (exact) return exact.prompt_style;
  const lower = modelId.toLowerCase();
  if (lower.includes('flux')) return 'flux';
  if (lower.includes('sdxl') || lower.includes('sd-1.5') || lower.includes('pony')) return 'sdxl';
  return 'sdxl';
}

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Bundled templates directory. Falls back to the source-tree location
 * when running un-built (smoke / integration tests) and to a `dist`
 * sibling when bundled.
 */
const BUNDLED_TEMPLATES_DIR = path.resolve(__dirname, 'system-prompts');

/** Interpolation slots. Mirrors the placeholders in the .md templates. */
export interface TemplateSlots {
  input: string;
  mode: EnhancementMode;
  target_length: EnhancementTargetLength;
  style_hint?: string | undefined;
  context?: EnhancementContext | undefined;
  /** When true, append the strict-retry preamble (FR-19, design §4 retry). */
  strict_retry?: boolean;
}

export interface LoadOptions {
  /** Per-family templates dir; overrides bundled defaults (FR-16-d). */
  templates_dir?: string | undefined;
  /** Single-file system-prompt override (Q1). When set, used regardless of family. */
  system_prompt_path?: string | undefined;
}

/**
 * Load + render the system prompt for `family` with the given slots.
 *
 * @throws when neither the family-specific file nor the legacy
 * `system-prompt.md` fallback exists in the configured directory.
 */
export function renderSystemPrompt(
  family: PromptFamily,
  slots: TemplateSlots,
  opts: LoadOptions = {},
): string {
  const raw = loadTemplate(family, opts);
  return interpolate(raw, slots);
}

function loadTemplate(family: PromptFamily, opts: LoadOptions): string {
  if (opts.system_prompt_path) {
    return fs.readFileSync(opts.system_prompt_path, 'utf8');
  }
  const dir = opts.templates_dir ?? BUNDLED_TEMPLATES_DIR;
  const familyFile = path.join(dir, `${family}.md`);
  if (fs.existsSync(familyFile)) return fs.readFileSync(familyFile, 'utf8');
  // Legacy single-template fallback (design §4.3 reference).
  const legacy = path.join(dir, 'system-prompt.md');
  if (fs.existsSync(legacy)) return fs.readFileSync(legacy, 'utf8');
  // Final fallback: the bundled SDXL template (we always ship one).
  const bundledSdxl = path.join(BUNDLED_TEMPLATES_DIR, 'sdxl.md');
  return fs.readFileSync(bundledSdxl, 'utf8');
}

const MODE_INSTRUCTIONS: Record<EnhancementMode, string> = {
  translate_only:
    "  - Translate to English with minimal stylistic changes. Preserve user's tags and detail. Light grammar cleanup OK; do not add new content.",
  rewrite:
    '  - Translate AND lightly polish (cleanup, trim filler). Reorganize into the target prompt style if input is loose.',
  elaborate:
    '  - Translate, polish, AND add descriptive detail (composition, lighting, style, quality). Stay faithful to the user-provided subject.',
};

function interpolate(template: string, slots: TemplateSlots): string {
  const styleLine = slots.style_hint
    ? `- Apply style hint: "${slots.style_hint}"`
    : '';
  const modeInstructions = MODE_INSTRUCTIONS[slots.mode] ?? '';
  const contextBlock = renderContextBlock(slots.context);
  const strictRetry = slots.strict_retry
    ? '\n\nSTRICT RETRY: If your previous output included anything but the rewritten prompt, output ONLY the rewritten prompt now. No quotes. No preamble. No explanation.'
    : '';

  const replacements: Record<string, string> = {
    input: escapeForTemplate(slots.input),
    mode: slots.mode,
    target_length: slots.target_length,
    style_hint: slots.style_hint ?? '',
    style_hint_line: styleLine,
    mode_instructions: modeInstructions,
    context_block: contextBlock,
    strict_retry_block: strictRetry,
  };

  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
  }
  // Drop any remaining unfilled placeholders so the agent never sees raw braces.
  out = out.replace(/{{\s*[a-zA-Z0-9_.]+\s*}}/g, '');
  // Append the strict-retry block if the placeholder was missing in the template.
  if (slots.strict_retry && !out.includes(strictRetry)) {
    out += strictRetry;
  }
  return out;
}

function renderContextBlock(context: EnhancementContext | undefined): string {
  if (!context) return '';
  const lines: string[] = ['Context (canvas being worked on):'];
  if (context.canvas_summary) {
    const cs = context.canvas_summary;
    const dims = `${cs.width}×${cs.height}`;
    const layers = cs.layer_count !== undefined ? `, ${cs.layer_count} layers` : '';
    lines.push(`- Dimensions: ${dims}${layers}`);
  }
  if (context.active_workspace) lines.push(`- Active workspace: ${context.active_workspace}`);
  if (context.control_layer_summary && context.control_layer_summary.length > 0) {
    const items = context.control_layer_summary
      .map((c) => `${c.type}/${c.name}`)
      .join(', ');
    lines.push(`- Active control layers: ${items}`);
  }
  if (context.region_summary && context.region_summary.length > 0) {
    const items = context.region_summary
      .map((r) => `"${r.name}" → ${r.prompt_excerpt}`)
      .join('; ');
    lines.push(`- Active regions: ${items}`);
  }
  if (context.existing_prompt) {
    lines.push(`- Existing root prompt: "${context.existing_prompt}"`);
  }
  if (lines.length === 1) return ''; // header only — no real context
  lines.push('Use the context to make the rewritten prompt complement the canvas state.');
  return lines.join('\n');
}

function escapeForTemplate(value: string): string {
  // Keep it simple — we don't need full HTML escaping; we only need to
  // ensure the user's input doesn't break the template's own quoted
  // delimiters. The template wraps `input` in double-quotes already.
  return value.replace(/"/g, '\\"');
}
