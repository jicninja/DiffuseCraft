/**
 * `generate_image` handler (generation-workflow A.3 — A.6).
 *
 * Wires the verb dispatcher onto the MCP catalog tool:
 *   1. resolveVerb (A.1) — fail-fast on missing `selection_mode` (A.5).
 *   2. resolvePreset (B.2) — fall back to server default (FR-26).
 *   3. ensureModelPresent — `MODEL_NOT_FOUND` with hint (A.4).
 *   4. resolveDocumentContext — width × height + source-image blob.
 *   5. Empty-prompt + empty-canvas guard (A.6 / FR-23).
 *   6. buildGraph — delegated to `comfy/graph/builder.ts`.
 *   7. tracker.submit — yields `job_id`, emits `job.progress` (FR-22).
 *   8. Return `{ job_id, resolved_verb, batch_size }` (FR-3).
 *
 * Handler is constructed by `createGenerateImageHandler({...deps})` so the
 * server bootstrap can inject the live tracker / registry / model cache,
 * and tests can inject in-memory doubles. Returning a closure (rather than
 * a class) keeps the surface trivial to wrap with middleware.
 */

import type { Database as DB } from 'better-sqlite3';

import type { z } from 'zod';
import { generateImage } from '@diffusecraft/mcp-tools';
import { ServerError } from '../../../types/errors.js';
import type { ToolHandler } from '../../../types/handler-context.js';
import { buildGraph, type ResolvedVerb as BuilderVerb } from '../../comfy/graph/builder.js';
import type { BuilderInput, GraphContext } from '../../comfy/graph/types.js';
import type { ModelRegistry } from '../../comfy/models/registry.js';
import {
  PresetNotFoundError,
  PresetRegistry,
  resolvePreset,
} from '../../comfy/presets/registry.js';
import type { JobTracker } from '../../jobs/tracker.js';
import {
  DocumentNotFoundError,
  resolveDocumentContext,
  type ResolvedDocument,
} from './document-context.js';
import { resolveVerb, VerbResolutionError, type ResolvedVerbName } from './resolve-verb.js';
import type { SelectionSubMode } from '../../comfy/graph/fill-config.js';

export interface GenerateImageDeps {
  db: DB;
  tracker: JobTracker;
  presets: PresetRegistry;
  /**
   * Optional model registry. When supplied, the handler verifies the
   * resolved model exists locally and throws `MODEL_NOT_FOUND` otherwise
   * (FR-24). Hosts that always run with a populated ComfyUI may omit it.
   */
  models?: ModelRegistry;
  /**
   * When set, used as the default preset name when `input.preset` is
   * undefined. Falls back to the registry's `photographic` baseline.
   */
  default_preset?: string;
}

/** Map from MCP-tool input verb to graph builder dispatch verb. */
function toBuilderVerb(verb: ResolvedVerbName): BuilderVerb {
  switch (verb) {
    case 'generate':
      return 'generate';
    case 'refine':
      return 'refine';
    case 'fill':
      return 'fill';
    case 'constrained_variation':
      // Per builder.ts the dispatcher routes this to refine. Keep the
      // handler-level enum stable so the response field is faithful to
      // the spec (FR-3).
      return 'constrained_variation';
  }
}

type GenerateImageInput = z.infer<typeof generateImage.inputSchema>;
type GenerateImageOutput = z.infer<typeof generateImage.outputSchema>;

export function createGenerateImageHandler(
  deps: GenerateImageDeps,
): ToolHandler<typeof generateImage.inputSchema, typeof generateImage.outputSchema> {
  return (async (input: GenerateImageInput, ctx) => {
    // 1. Resolve verb. Throws VerbResolutionError → INVALID_INPUT (A.5).
    let resolved;
    try {
      resolved = resolveVerb({
        strength: input.strength,
        selection: input.selection,
        selection_mode: input.selection_mode as SelectionSubMode | undefined,
      });
    } catch (err) {
      if (err instanceof VerbResolutionError) {
        throw new ServerError({
          code: err.code,
          message: `${err.message} (${err.field_path}). ${err.hint}`,
        });
      }
      throw err;
    }

    // 2. Resolve preset. Throws PresetNotFoundError → INVALID_INPUT.
    let preset;
    try {
      preset = resolvePreset(deps.presets, input.preset, deps.default_preset);
    } catch (err) {
      if (err instanceof PresetNotFoundError) {
        throw new ServerError({
          code: 'INVALID_INPUT',
          message: `preset '${err.name_attempted}' not found; available: ${err.available.join(', ')}`,
        });
      }
      throw err;
    }

    // 3. Resolve effective model name (input override > preset).
    const modelName = stripModelRegistryPrefix(input.model) ?? preset.model;

    // 4. Ensure the model is present locally (FR-24, A.4).
    if (deps.models) {
      const found = deps.models.findByName(modelName);
      if (!found) {
        throw new ServerError({
          code: 'MODEL_NOT_FOUND',
          message: `model '${modelName}' is not present locally; call download_model first`,
        });
      }
    }

    // 5. Resolve document. The catalog tool input declares `document_id` as
    //    optional and inherits the active document from the request context
    //    when absent (per `mcp-tool-catalog` §3.3). For v1 the request
    //    context's active document is mandatory; transports stamp it via
    //    `request_id` headers.
    const document_id = input.document_id ?? ctx.document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: 'document_id missing from input and no active document on session',
      });
    }
    let document: ResolvedDocument;
    try {
      document = resolveDocumentContext(deps.db, document_id);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        throw new ServerError({ code: 'DOCUMENT_NOT_FOUND', message: err.message });
      }
      throw err;
    }

    // 6. Empty-prompt + empty-canvas guard (FR-23 / A.6).
    //    `generate` from absolutely nothing has no signal; reject early.
    const promptIsEmpty = input.prompt.trim().length === 0;
    if (resolved.verb === 'generate' && promptIsEmpty) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message:
          'provide either a prompt or canvas content with strength<100 (FR-23: cannot generate from empty prompt and empty canvas)',
      });
    }
    if ((resolved.verb === 'refine' || resolved.verb === 'constrained_variation') && !document.source_image_blob_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message:
          'refine/constrained_variation requires non-empty canvas content; the active document has no paint layer',
      });
    }

    // 7. Build graph.
    const builderInput: BuilderInput = {
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      strength: input.strength,
      seed: input.seed,
      batch_size: input.batch_size,
      control_layer_ids: input.control_layer_ids,
      region_ids: input.region_ids,
      ...(document.source_image_blob_id ? { source_image_blob_id: document.source_image_blob_id } : {}),
      ...(document.selection_blob_id ? { selection_id: document.selection_blob_id } : {}),
      ...(resolved.sub_mode ? { selection_mode: resolved.sub_mode } : {}),
    };
    const graphCtx: GraphContext = {
      job_id: ctx.request_id,
      document: { width: document.width, height: document.height },
      preset: { ...preset, model: modelName },
      logger: { info: ctx.logger.info, warn: ctx.logger.error },
    };
    const graph = buildGraph(toBuilderVerb(resolved.verb), builderInput, graphCtx);

    // 8. Submit through the JobTracker (which talks to ComfyUI).
    const parameters = {
      prompt: input.prompt,
      negative_prompt: input.negative_prompt ?? null,
      strength: input.strength,
      seed: input.seed,
      batch_size: input.batch_size,
      preset: preset.name,
      model: modelName,
      verb: resolved.verb,
      sub_mode: resolved.sub_mode ?? null,
      selection_mode: input.selection_mode ?? null,
      control_layer_ids: input.control_layer_ids ?? [],
      region_ids: input.region_ids ?? [],
    };
    const job_id = await deps.tracker.submit(graph, {
      kind: 'generate_image',
      token_id: ctx.token_id,
      token_name: ctx.token_name,
      document_id,
      parameters_json: JSON.stringify(parameters),
      verb: resolved.verb,
      ...(resolved.sub_mode ? { sub_mode: resolved.sub_mode } : {}),
      preset: preset.name,
    });

    // 9. Return the job handle. Progress streams over `job.progress`; when
    //    ComfyUI finishes, OutputFetcher fires `history.item-added` and
    //    `job.completed` with the resulting `history_item_id`.
    const out: GenerateImageOutput = {
      job_id: job_id as GenerateImageOutput['job_id'],
      resolved_verb: resolved.verb,
      batch_size: input.batch_size,
    };
    return out;
  }) as ToolHandler<typeof generateImage.inputSchema, typeof generateImage.outputSchema>;
}

/**
 * Catalog `ModelId` accepts `<registry>:<id>` strings (e.g.
 * `hf:owner/repo:weights.safetensors`); ComfyUI sees only the file basename.
 * The strip is a v1 convenience — the comfyui-management spec owns the
 * canonical translation table.
 */
function stripModelRegistryPrefix(model: string | undefined): string | undefined {
  if (!model) return undefined;
  // Common case: `hf:org/repo:filename.safetensors` → take the last colon-
  // delimited segment if it ends in a recognised model extension.
  const segs = model.split(':');
  const tail = segs[segs.length - 1] ?? '';
  if (/\.(safetensors|ckpt|pt|bin|gguf)$/i.test(tail)) return tail;
  return model;
}
