import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import {
  ControlLayerId,
  DocumentId,
  JobId,
  RegionId,
} from "../../shared/ids";
import { Selection } from "../../shared/envelope";
import { ModelId } from "../../shared/common";

/**
 * Selection sub-modes when a selection is present (Q3 in design.md §1).
 *
 * - Fill: classic inpaint, replace selection content guided by prompt.
 * - Expand: outpaint by extending content into the selection.
 * - AddContent: keep existing content, add prompt-guided elements.
 * - RemoveContent: erase prompt-described content while keeping context.
 * - ReplaceBackground: keep foreground; regenerate background only.
 */
export const SelectionMode = z.enum([
  "Fill",
  "Expand",
  "AddContent",
  "RemoveContent",
  "ReplaceBackground",
]);
export type SelectionMode = z.infer<typeof SelectionMode>;

export const ResolvedVerb = z.enum([
  "generate",
  "refine",
  "fill",
  "constrained_variation",
]);
export type ResolvedVerb = z.infer<typeof ResolvedVerb>;

const Input = z.object({
  document_id: DocumentId.optional()
    .describe("Defaults to active document from session header."),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe("English prompt (P23: prompts always English even when UI is multilingual)."),
  negative_prompt: z.string().max(2000).optional(),
  strength: z
    .number()
    .min(0)
    .max(100)
    .default(100)
    .describe(
      "100 = ignore canvas (pure generate); <100 = use canvas as starting point (refine).",
    ),
  selection: Selection.optional(),
  selection_mode: SelectionMode.optional()
    .describe("Required when `selection` is present. Determines fill semantics."),
  seed: z
    .union([z.number().int(), z.literal("random")])
    .default("random"),
  preset: z
    .string()
    .optional()
    .describe("Preset name. If omitted, server uses its default preset."),
  model: ModelId.optional()
    .describe("Override the preset's model. Format `<registry>:<id>`."),
  control_layer_ids: z.array(ControlLayerId).optional(),
  region_ids: z.array(RegionId).optional()
    .describe("If set, only these regions are honored. Else all regions in document."),
  batch_size: z.number().int().min(1).max(8).default(1),
});

const Output = z.object({
  job_id: JobId,
  resolved_verb: ResolvedVerb,
  batch_size: z.number().int().min(1).max(8),
});

export const generateImage = defineTool({
  name: "generate_image",
  title: "Generate / Refine / Fill image",
  description:
    "Submits an image-generation job. Verb resolution (Q3): strength=100 + no selection → 'generate'; strength<100 + no selection → 'refine'; strength=100 + selection → 'fill' (with `selection_mode` discriminator); strength<100 + selection → 'constrained_variation'. Returns a job handle immediately; subscribe to job.progress for progress and job.completed for the resulting `history_item_id`. Apply via apply_history_item. Minimum invocation: { prompt: \"...\" }; all other params take server defaults (FR-41).",
  category: "job",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { prompt: "a red barn at dusk", strength: 100, batch_size: 4 },
    output: {
      job_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      resolved_verb: "generate",
      batch_size: 4,
    },
  },
  since: "1.0.0",
  workspace: ["Generate", "Inpaint", "Live"],
});
