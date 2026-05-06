import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { WorkspaceTag } from "../../shared/capabilities";

/**
 * Per-spec context block (FR-7). Server auto-fills these fields from session
 * state when the caller omits `context`. Size-capped to ≤2 KB total at
 * handler-render time (FR-8); the schema is permissive but the
 * `context-builder` truncates strings.
 */
const EnhancementContext = z.object({
  document_id: DocumentId.optional(),
  active_workspace: WorkspaceTag.optional(),
  canvas_summary: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      layer_count: z.number().int().nonnegative().optional(),
    })
    .optional(),
  control_layer_summary: z
    .array(z.object({ type: z.string(), name: z.string() }))
    .max(8)
    .optional(),
  region_summary: z
    .array(
      z.object({
        name: z.string(),
        prompt_excerpt: z.string().max(200),
      }),
    )
    .max(8)
    .optional(),
  existing_prompt: z.string().max(400).optional(),
});

/**
 * `enhance_prompt` schema (prompt-enhancement requirements §3.1, FR-1, FR-2).
 *
 * - `input`: prompt text in any language.
 * - `mode`: translate_only | rewrite | elaborate (default `rewrite`).
 * - `context`: optional canvas/region/workspace metadata. Server auto-builds
 *   when omitted (FR-7). Provided verbatim if present (FR-9).
 * - `target_length`: hint to the agent. Default `medium`.
 * - `style_hint`: free-text steering ("photographic", "anime", "concept-art").
 * - `target_model`: model id; selects the per-family system-prompt template
 *   (FR-16-a/b). Server infers from the active preset when omitted (FR-16-c).
 */
const Input = z.object({
  input: z
    .string()
    .min(1)
    .max(4000)
    .describe("Prompt text in any language. Server picks the system prompt template per `target_model`."),
  mode: z
    .enum(["translate_only", "rewrite", "elaborate"])
    .default("rewrite")
    .describe(
      "translate_only — translate to English, minimal cleanup. rewrite (default) — translate + light polish. elaborate — translate + polish + add descriptive detail.",
    ),
  context: EnhancementContext.optional().describe(
    "Optional canvas/region/workspace metadata. When omitted, the server auto-builds it from session state (FR-7).",
  ),
  target_length: z
    .enum(["short", "medium", "long"])
    .default("medium")
    .describe("Hint to the agent. Default medium (~50–100 token equivalent)."),
  style_hint: z
    .string()
    .max(120)
    .optional()
    .describe("Free-text steering, e.g. 'photographic', 'anime', 'concept-art'."),
  target_model: z
    .string()
    .optional()
    .describe(
      "Model id (e.g. `civitai:dreamshaper`). Determines the prompt-style template family (SDXL=tag-style, Flux=natural-language).",
    ),
});

/**
 * Output (FR-2). Returned synchronously: the sampling round-trip is awaited
 * within the handler. The schema does not surface a `job_id` because the
 * server's job tracker is reserved for ComfyUI graphs; sampling
 * cancellation rides on the dispatcher's per-request abort surface.
 */
const Output = z.object({
  enhanced: z.string().min(1),
  language_detected: z
    .string()
    .min(2)
    .max(8)
    .describe("ISO-639-1 code of the original input language ('en', 'es', 'ja', ...)."),
  used_sampling: z
    .boolean()
    .describe("True when the rewrite came from a fresh MCP-sampling round-trip; false on cache hit."),
  agent_name: z
    .string()
    .optional()
    .describe("Human-readable name of the agent that performed the rewrite (audit display only)."),
});

export const enhancePrompt = defineTool({
  name: "enhance_prompt",
  title: "Enhance prompt",
  description:
    "Rewrites a prompt to model-ready English using **MCP sampling** against the calling agent (P4). The server holds no AI provider keys; the agent runs the LLM with its own credentials. Modes: `translate_only`, `rewrite` (default), `elaborate`. Independent of `transcribe_audio` (P24): operates on a string, returns a string. Errors: `SAMPLING_NOT_SUPPORTED`, `ENHANCEMENT_TIMEOUT`, `ENHANCEMENT_RESPONSE_INVALID`, `ENHANCEMENT_REFUSED`.",
  category: "job",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
