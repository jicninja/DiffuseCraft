import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { Rect } from "../../shared/envelope";

const Point = z.object({ x: z.number(), y: z.number() });

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.optional(),
  tap_point: Point.optional().describe(
    "When provided, the segmentation model uses the point as a positive prompt and selects the subject containing it. When omitted, the salient foreground subject is auto-detected.",
  ),
  quality: z
    .enum(["fast", "high"])
    .default("fast")
    .describe(
      "`fast` uses the lightweight Tier 2 model (MobileSAM by default); `high` swaps to a heavier Tier 3 model when configured.",
    ),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
  job_id: z.string().optional(),
});

export const autoSelectSubject = defineTool({
  name: "auto_select_subject",
  title: "Auto-select subject (AI / SAM-class model)",
  description:
    "Invokes a server-side segmentation model (Tier 2 MobileSAM by default; Tier 3 heavier model when `quality: 'high'`) on the target layer. With `tap_point`, the model treats it as a positive prompt; without it, the salient foreground is selected. Returns a mask selection. Job-style — `job_id` is emitted via `job.progress` events. Tool is unavailable when the underlying ComfyUI nodes aren't installed (returns `MODEL_NOT_FOUND`). Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "job",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { tap_point: { x: 512, y: 512 } },
    output: { active: true, bbox: { x: 100, y: 100, w: 800, h: 800 } },
  },
  since: "1.0.0",
});
