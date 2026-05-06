import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { BlendMode } from "../../shared/common";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId,
  name: z.string().max(120).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  blend_mode: BlendMode.optional(),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Reorder: target index in the layer stack."),
});

const Output = z.object({
  layer_id: LayerId,
  updated_fields: z.array(z.string()),
});

export const updateLayer = defineTool({
  name: "update_layer",
  title: "Update layer properties",
  description:
    "Updates one or more layer properties: name, opacity, visibility, blend mode, or stack position. Omitted fields stay unchanged. Reversible: undo restores prior values. Idempotent for identical input. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      opacity: 0.5,
      visible: true,
    },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      updated_fields: ["opacity", "visible"],
    },
  },
  since: "1.0.0",
});
