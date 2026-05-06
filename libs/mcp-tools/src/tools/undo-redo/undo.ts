import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
});

const Output = z.object({
  reverted: z.boolean(),
  command_description: z.string().optional(),
});

export const undo = defineTool({
  name: "undo",
  title: "Undo",
  description:
    "Reverts the calling client's last reversible operation on the document (P27, FR-22 — per-client per-document stack). Idempotent: when the stack is empty, returns `{ reverted: false }`.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
