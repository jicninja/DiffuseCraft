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

export const selectAll = defineTool({
  name: "select_all",
  title: "Select all",
  description:
    "Sets the active selection to cover the entire document canvas (rect equivalent to `{0,0,W,H}`). Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {},
    output: { active: true, bbox: { x: 0, y: 0, w: 1024, h: 1024 } },
  },
  since: "1.0.0",
});
