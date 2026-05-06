import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { ModelId } from "../../shared/common";

const Input = z.object({
  id: ModelId,
});

const Output = z.object({
  deleted: z.boolean(),
  bytes_freed: z.number().int().nonnegative(),
});

export const deleteModel = defineTool({
  name: "delete_model",
  title: "Delete model",
  description:
    "Deletes a model file from disk. Idempotent: deleting a missing model returns `{ deleted: false, bytes_freed: 0 }`. Cannot be undone via the undo system; reinstall via `download_model` if needed.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
