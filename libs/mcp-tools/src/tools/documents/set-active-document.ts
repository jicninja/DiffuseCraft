import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";

const OpenAction = z.object({
  action: z.literal("open"),
  /** Path or URI of an existing document file on the server. */
  path: z.string().min(1),
});

const CloseAction = z.object({
  action: z.literal("close"),
  id: DocumentId,
  save_first: z.boolean().default(false),
});

const SetActiveAction = z.object({
  action: z.literal("set_active"),
  id: DocumentId,
});

const Input = z.discriminatedUnion("action", [
  OpenAction,
  CloseAction,
  SetActiveAction,
]);

const Output = z.object({
  active_document_id: DocumentId.optional(),
  closed: z.boolean().optional(),
});

export const setActiveDocument = defineTool({
  name: "set_active_document",
  title: "Open / close / set active document",
  description:
    "Discriminated-union tool that replaces three operations: `open` (load a saved document from server-side path), `close` (unload a document), and `set_active` (mark a loaded document as active for the calling client). Per Q1 in design.md §1, the active document is a per-client preference forwarded as a request header to subsequent tools.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {
      action: "set_active",
      id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
    },
    output: { active_document_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never },
  },
  since: "1.0.0",
});
