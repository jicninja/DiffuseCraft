import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  mask_layer_id: LayerId.describe("Source mask layer (painted or from_layer)."),
  threshold: z
    .number()
    .int()
    .min(0)
    .max(255)
    .default(128)
    .describe("Alpha threshold; pixels at-or-above become selected."),
});

const Output = z.object({
  active: z.boolean(),
});

export const maskToSelection = defineTool({
  name: "mask_to_selection",
  title: "Mask → selection",
  description:
    "Sets the active selection from a mask layer's alpha (`>= threshold` becomes selected). Lossless when threshold=128 and the mask uses pure 0/255 values. Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {
      mask_layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      threshold: 128,
    },
    output: { active: true },
  },
  since: "1.0.0",
});
