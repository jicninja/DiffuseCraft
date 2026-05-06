import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe("Target painted mask layer."),
  value: z
    .number()
    .int()
    .min(0)
    .max(255)
    .describe("Greyscale alpha value to fill the entire mask with."),
});

const Output = z.object({
  layer_id: LayerId,
  applied: z.boolean(),
});

export const fillMask = defineTool({
  name: "fill_mask",
  title: "Fill mask",
  description:
    "Sets every byte of a painted mask layer to the supplied value. Useful for `value: 255` (select-all) and `value: 0` (clear). Reversible: undo restores prior bytes. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never, value: 255 },
    output: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never, applied: true },
  },
  since: "1.0.0",
});
