import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, HistoryItemId, LayerId } from "../../shared/ids";

const Input = z.object({
  history_item_id: HistoryItemId,
  document_id: DocumentId.optional()
    .describe("Defaults to the document the history item was generated against."),
});

const Output = z.object({
  layer_id: LayerId,
  position: z.number().int().nonnegative(),
});

export const applyHistoryItem = defineTool({
  name: "apply_history_item",
  title: "Apply history item",
  description:
    "Applies a generation preview as a new layer in the document. Insertion position follows Q4: Fill/Inpaint result above the inpainted layer; Refine result above the source; pure Generate result on top of the stack. Reversible: undo removes the applied layer. Minimum invocation (FR-42): { history_item_id: \"...\" }; server resolves the target document. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { history_item_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      position: 1,
    },
  },
  since: "1.0.0",
});
