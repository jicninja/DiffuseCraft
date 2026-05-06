import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { ImageEnvelope, Rect } from "../../shared/envelope";

const Input = z.object({
  document_id: DocumentId.optional(),
  include_mask: z
    .boolean()
    .default(false)
    .describe("When true, also return the selection mask bytes."),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
  mask: ImageEnvelope.optional(),
});

export const getSelection = defineTool({
  name: "get_selection",
  title: "Get selection",
  description:
    "Returns the active selection metadata for the document. Set `include_mask: true` to also fetch the raster mask bytes (otherwise only the bounding box is returned). No side effects.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
