import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe("Target painted mask layer."),
});

const Output = z.object({
  layer_id: LayerId,
  applied: z.boolean(),
});

export const clearMask = defineTool({
  name: "clear_mask",
  title: "Clear mask",
  description:
    "Sets every byte of a painted mask layer to 0 (fully transparent). Only valid on painted masks; `from_layer` masks should be modified by editing the source layer instead. Reversible: undo restores the prior bytes. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never, applied: true },
  },
  since: "1.0.0",
});
