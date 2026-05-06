import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe(
    "Target mask layer. For `from_layer` masks, toggles the `invert` flag in metadata. For `painted` masks, swaps 0↔255 in the alpha bytes.",
  ),
});

const Output = z.object({
  layer_id: LayerId,
  applied: z.boolean(),
});

export const invertMask = defineTool({
  name: "invert_mask",
  title: "Invert mask",
  description:
    "Inverts a mask layer. For painted masks the alpha bytes are flipped (0↔255). For `from_layer` masks the metadata `invert` flag is toggled (no byte rewrite). Reversible: a second invert restores the prior state.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never, applied: true },
  },
  since: "1.0.0",
});
