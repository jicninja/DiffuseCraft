import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { PresetId } from "../../shared/ids";

const Input = z.object({ id: PresetId });
const Output = z.object({ deleted: z.boolean() });

export const deletePreset = defineTool({
  name: "delete_preset",
  title: "Delete preset",
  description:
    "Deletes a preset by id. Idempotent: deleting a missing preset returns `{ deleted: false }`. Documents/history that referenced the preset retain the resolved model + sampler in their metadata.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
