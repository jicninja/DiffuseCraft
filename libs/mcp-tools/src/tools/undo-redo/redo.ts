import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
});

const Output = z.object({
  reapplied: z.boolean(),
  command_description: z.string().optional(),
});

export const redo = defineTool({
  name: "redo",
  title: "Redo",
  description:
    "Re-applies the calling client's most recently undone operation on the document (P27). Idempotent: when the redo stack is empty, returns `{ reapplied: false }`.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
