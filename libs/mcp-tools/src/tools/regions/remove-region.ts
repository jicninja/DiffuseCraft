import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, RegionId } from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  region_id: RegionId,
});

const Output = z.object({ removed: z.boolean() });

export const removeRegion = defineTool({
  name: "remove_region",
  title: "Remove region",
  description:
    "Removes a region by id. Idempotent. Reversible: undo restores it. The underlying paint layer is unaffected.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
