import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { WorkspaceTag } from "../../shared/capabilities";

const Input = z.object({
  document_id: DocumentId.optional(),
  workspace: WorkspaceTag,
});

const Output = z.object({ active_workspace: WorkspaceTag });

export const setWorkspace = defineTool({
  name: "set_workspace",
  title: "Set workspace",
  description:
    "Switches the active workspace for the document. Workspaces gate which tools are available (FR-38) and reshape the UI. Idempotent. Not reversible (per requirements §3.3.19: explicitly `reversible: false`). Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { workspace: "Generate" },
    output: { active_workspace: "Generate" },
  },
  since: "1.0.0",
});
