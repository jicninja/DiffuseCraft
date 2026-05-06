import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { DocumentState } from "../../shared/common";

const Input = z.object({
  document_id: DocumentId.optional()
    .describe("Defaults to active document from session."),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict response to listed top-level fields (FR-39). Saves bytes when full state is not needed.",
    ),
});

export const getDocumentState = defineTool({
  name: "get_document_state",
  title: "Document state (bundled)",
  description:
    "Bundled query (FR-44): returns layers + selection + workspace + control layers + regions in one call so agents do not need 4+ round-trips. No side effects.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: DocumentState,
  since: "1.0.0",
});
