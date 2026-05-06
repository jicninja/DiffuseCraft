import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { WorkspaceTag } from "../../shared/capabilities";

const Input = z.object({
  name: z.string().min(1).max(120).describe("Human-readable document name."),
  width: z
    .number()
    .int()
    .min(64)
    .max(8192)
    .describe("Pixel width of the canvas."),
  height: z
    .number()
    .int()
    .min(64)
    .max(8192)
    .describe("Pixel height of the canvas."),
  initial_workspace: WorkspaceTag.optional()
    .describe("Workspace to activate on creation. Defaults to `Generate`."),
});

const Output = z.object({
  document_id: DocumentId,
  becomes_active: z.boolean(),
});

export const createDocument = defineTool({
  name: "create_document",
  title: "Create document",
  description:
    "Creates a new empty document of the given dimensions and makes it the active document for the calling client. Each new document starts with a single transparent paint layer. Reversible by closing it via `set_active_document`. Side effects: emits `document.changed` for new doc.",
  category: "write",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { name: "char-A-concept", width: 1024, height: 1024 },
    output: {
      document_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      becomes_active: true,
    },
  },
  since: "1.0.0",
});
