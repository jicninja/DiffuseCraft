import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe("Target painted mask layer."),
  grow_px: z.number().min(0).max(64).optional().describe("Dilate radius in pixels."),
  shrink_px: z.number().min(0).max(64).optional().describe("Erode radius in pixels."),
  feather_px: z.number().min(0).max(64).optional().describe("Edge feather (gaussian sigma) in pixels."),
  blur_px: z.number().min(0).max(64).optional().describe("Whole-mask gaussian blur in pixels."),
  threshold: z
    .number()
    .min(0)
    .max(255)
    .optional()
    .describe("Threshold first to crisp 0/255 (e.g. 128). Applied before grow/shrink."),
});

const Output = z.object({
  layer_id: LayerId,
  applied: z.boolean(),
});

export const refineMask = defineTool({
  name: "refine_mask",
  title: "Refine mask",
  description:
    "Applies grow / shrink / feather / blur / threshold to a painted mask layer atomically. Each parameter is optional; missing fields are no-ops. Order: threshold → grow → shrink → feather → blur. Reversible: undo restores the prior mask bytes. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      grow_px: 3,
      feather_px: 2,
    },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      applied: true,
    },
  },
  since: "1.0.0",
});
