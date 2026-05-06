import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { WorkspaceTag } from "../../shared/capabilities";

const Input = z.object({ document_id: DocumentId.optional() });
const Output = z.object({ active_workspace: WorkspaceTag });

export const getWorkspace = defineTool({
  name: "get_workspace",
  title: "Get workspace",
  description:
    "Returns the active workspace for the document. No side effects.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
