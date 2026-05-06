import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId,
});

const Output = z.object({ removed: z.boolean() });

export const removeLayer = defineTool({
  name: "remove_layer",
  title: "Remove layer",
  description:
    "Removes a layer by id. Idempotent: removing an already-removed layer returns `{ removed: false }`. Reversible: undo restores the layer in its original position. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: { removed: true },
  },
  since: "1.0.0",
});
