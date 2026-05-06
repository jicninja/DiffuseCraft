import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { Rect } from "../../shared/envelope";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.optional(),
  prompt: z
    .string()
    .min(1)
    .max(512)
    .describe(
      "English prompt for the object(s) to select (e.g., 'the tree on the left'). Multilingual input MUST be translated by the consumer SDK or via `enhance_prompt` first (P23).",
    ),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
  job_id: z.string().optional(),
});

export const selectByPrompt = defineTool({
  name: "select_by_prompt",
  title: "Select by prompt (Tier 4 — VLM-grounded SAM)",
  description:
    "Invokes a text-conditioned segmentation pipeline: the server raises an MCP-sampling request to the calling agent (Claude / Codex / Gemini CLI) asking for bounding boxes that match the prompt, then feeds those into MobileSAM for a precise mask. Job-style — `job_id` is emitted via `job.progress` events. Tool is unavailable when the connected agent does not support MCP sampling (returns `SAMPLING_NOT_SUPPORTED`); falls back to `auto_select_subject` is recommended. Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "job",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { prompt: "the dog on the left" },
    output: { active: true, bbox: { x: 64, y: 128, w: 320, h: 480 } },
  },
  since: "1.0.0",
});
