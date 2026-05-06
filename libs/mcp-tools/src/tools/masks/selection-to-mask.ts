import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.optional().describe(
    "Target painted mask layer to overwrite. When omitted, a new mask layer is created and its id is returned.",
  ),
  name: z
    .string()
    .max(120)
    .optional()
    .describe("Name for the newly created mask layer (ignored when `layer_id` is set)."),
});

const Output = z.object({
  layer_id: LayerId,
  created: z
    .boolean()
    .describe("True when a new mask layer was created; false when an existing one was overwritten."),
});

export const selectionToMask = defineTool({
  name: "selection_to_mask",
  title: "Selection → mask",
  description:
    "Rasterizes the active selection into a new or existing painted mask layer. Lossless at threshold 128 when the source uses pure 0/255 values. Reversible: undo removes the layer (or restores prior bytes when overwriting). Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { name: "Selection mask" },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      created: true,
    },
  },
  since: "1.0.0",
});
