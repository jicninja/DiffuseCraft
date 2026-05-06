import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { ControlLayerId, DocumentId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  control_layer_id: ControlLayerId,
});

const Output = z.object({ removed: z.boolean() });

export const removeControlLayer = defineTool({
  name: "remove_control_layer",
  title: "Remove control layer",
  description:
    "Removes a control layer by id. Idempotent. Reversible: undo restores it. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
