import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe("`from_layer` mask to bake into a `painted` mask."),
});

const Output = z.object({
  layer_id: LayerId,
  applied: z.boolean(),
});

export const bakeMask = defineTool({
  name: "bake_mask",
  title: "Bake mask",
  description:
    "Converts a `from_layer` mask into a `painted` mask by snapshotting its current derived bytes. The layer keeps the same id; only its `mask_data.subkind` flips and a fresh `content_blob_id` is attached. Reversible: undo restores the `from_layer` reference. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      applied: true,
    },
  },
  since: "1.0.0",
});
