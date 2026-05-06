import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { Rect } from "../../shared/envelope";

const Input = z.object({
  document_id: DocumentId.optional(),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
});

export const invertSelection = defineTool({
  name: "invert_selection",
  title: "Invert selection",
  description:
    "Swaps selected and unselected regions on the active document. `none` becomes the entire canvas; an existing selection becomes its complement. Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {},
    output: { active: true, bbox: { x: 0, y: 0, w: 1024, h: 1024 } },
  },
  since: "1.0.0",
});
