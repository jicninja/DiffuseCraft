/**
 * Auto-context builder (design.md §5, FR-7..FR-9).
 *
 * Builds an `EnhancementContext` from session state when the caller
 * omits `context`. Sources (documents, layers, regions, workspaces) are
 * provided by other specs that haven't fully landed yet; this module
 * exposes a `ContextSources` interface so:
 *
 *   - The handler can be tested with stub sources today.
 *   - Each downstream spec wires its source as it ships
 *     (`documents`, `control-layers`, `regions`, `workspaces`).
 *
 * Context fields are size-capped at render time (FR-8) by truncating
 * region prompt excerpts and clipping the `existing_prompt`.
 */

import type { EnhancementContext } from './types.js';

export const CONTEXT_BUDGET_BYTES = 2_048;
const REGION_PROMPT_EXCERPT_CAP = 60;
const ROOT_PROMPT_CAP = 200;
const MAX_CONTROL_LAYERS = 5;
const MAX_REGIONS = 5;

/**
 * Sources the builder reads from. Every field is optional — when a
 * source is missing, the corresponding context field is omitted.
 *
 * TODO(prompt-enhancement): wire these to the actual `documents`,
 * `layers`, `regions`, and `workspaces` subsystems as those specs land.
 * For v1 the handler accepts pre-built context from the caller and the
 * auto-builder is exercised end-to-end via test stubs.
 */
export interface ContextSources {
  /** Resolve the active document id for the current handler call. */
  activeDocumentId?(): string | null | Promise<string | null>;
  /** Read a document's `width`, `height`, layer count. */
  getDocumentSummary?(
    documentId: string,
  ): Promise<{ width: number; height: number; layer_count: number } | null> | { width: number; height: number; layer_count: number } | null;
  /** Read the active workspace tag for the calling token. */
  getActiveWorkspace?(): Promise<EnhancementContext['active_workspace'] | undefined> | EnhancementContext['active_workspace'] | undefined;
  /** List active control layers for the document. */
  listControlLayers?(documentId: string): Promise<Array<{ type: string; name: string }>> | Array<{ type: string; name: string }>;
  /** List active regions with their prompt excerpts. */
  listRegions?(documentId: string): Promise<Array<{ name: string; prompt_excerpt: string }>> | Array<{ name: string; prompt_excerpt: string }>;
  /** Resolve the document's root prompt (if any). */
  getRootPrompt?(documentId: string): Promise<string | null> | string | null;
}

export async function buildContext(sources: ContextSources): Promise<EnhancementContext | undefined> {
  if (!sources.activeDocumentId) return undefined;
  const documentId = await sources.activeDocumentId();
  if (!documentId) return undefined;

  const ctx: EnhancementContext = { document_id: documentId as EnhancementContext['document_id'] };

  if (sources.getDocumentSummary) {
    const summary = await sources.getDocumentSummary(documentId);
    if (summary) ctx.canvas_summary = summary;
  }

  if (sources.getActiveWorkspace) {
    const ws = await sources.getActiveWorkspace();
    if (ws) ctx.active_workspace = ws;
  }

  if (sources.listControlLayers) {
    const all = await sources.listControlLayers(documentId);
    ctx.control_layer_summary = all.slice(0, MAX_CONTROL_LAYERS).map((c) => ({ type: c.type, name: c.name }));
  }

  if (sources.listRegions) {
    const all = await sources.listRegions(documentId);
    ctx.region_summary = all.slice(0, MAX_REGIONS).map((r) => ({
      name: r.name,
      prompt_excerpt: r.prompt_excerpt.slice(0, REGION_PROMPT_EXCERPT_CAP),
    }));
  }

  if (sources.getRootPrompt) {
    const root = await sources.getRootPrompt(documentId);
    if (root) ctx.existing_prompt = root.slice(0, ROOT_PROMPT_CAP);
  }

  return capContextToBudget(ctx);
}

/**
 * Hard-cap the rendered context to ≤ 2 KB (FR-8). When the JSON
 * representation exceeds the budget, we drop fields in priority order:
 *
 *   1. region_summary (lowest priority — variable-size, often largest)
 *   2. control_layer_summary
 *   3. existing_prompt
 *   4. canvas_summary (kept — cheap, always small)
 *   5. active_workspace + document_id (kept — single short tags)
 */
export function capContextToBudget(ctx: EnhancementContext): EnhancementContext {
  if (byteLength(ctx) <= CONTEXT_BUDGET_BYTES) return ctx;
  const trimmed: EnhancementContext = { ...ctx };
  if (trimmed.region_summary) {
    delete trimmed.region_summary;
    if (byteLength(trimmed) <= CONTEXT_BUDGET_BYTES) return trimmed;
  }
  if (trimmed.control_layer_summary) {
    delete trimmed.control_layer_summary;
    if (byteLength(trimmed) <= CONTEXT_BUDGET_BYTES) return trimmed;
  }
  if (trimmed.existing_prompt) {
    delete trimmed.existing_prompt;
  }
  return trimmed;
}

function byteLength(ctx: EnhancementContext): number {
  return Buffer.byteLength(JSON.stringify(ctx), 'utf8');
}
