import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { ImageEnvelope } from "../../shared/envelope";
import { BlendMode, LayerKind, MaskSubKind, FromLayerChannel } from "../../shared/common";

const Input = z.object({
  document_id: DocumentId.optional(),
  kind: LayerKind,
  name: z.string().max(120).optional(),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("0 = bottom of stack. Defaults to top of stack."),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  blend_mode: BlendMode.default("normal"),
  content: ImageEnvelope.optional()
    .describe(
      "Initial image content for paint or mask layers. Replaces the previous `import_image` tool.",
    ),
  // Mask-system extensions (FR-2). Only honoured when `kind === "mask"`.
  subkind: MaskSubKind.optional().describe(
    "Mask sub-kind (mask-system FR-2). Required when `kind === 'mask'`.",
  ),
  source_layer_id: LayerId.optional().describe(
    "Source paint layer id; required when `subkind === 'from_layer'`.",
  ),
  channel: FromLayerChannel.optional().describe(
    "Channel selector for `from_layer` masks: 'alpha' (default) or 'luminance'.",
  ),
  invert: z
    .boolean()
    .optional()
    .describe("Invert flag for `from_layer` masks; defaults to false."),
});

const Output = z.object({
  layer_id: LayerId,
  position: z.number().int().nonnegative(),
});

export const addLayer = defineTool({
  name: "add_layer",
  title: "Add layer",
  description:
    "Adds a new layer to the active (or specified) document. Optional `content` envelope seeds the layer with image bytes — replaces a separate import tool. Reversible: undo removes the layer. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { kind: "paint", name: "background" },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      position: 0,
    },
  },
  since: "1.0.0",
});
