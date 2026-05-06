import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import {
  ControlLayerId,
  DocumentId,
  LayerId,
  RegionId,
} from "../../shared/ids";
import { ImageEnvelope } from "../../shared/envelope";
import { ControlLayerType } from "../../shared/common";

const Input = z.object({
  document_id: DocumentId.optional(),
  type: ControlLayerType,
  weight: z
    .number()
    .min(0)
    .max(2)
    .default(1)
    .describe("Influence weight (krita parity: 0..2 typical range)."),
  layer_id: LayerId.optional()
    .describe("Existing layer to source from. Mutually exclusive with `content`."),
  content: ImageEnvelope.optional()
    .describe("Inline image content. Mutually exclusive with `layer_id`."),
  region_id: RegionId.optional()
    .describe("Optional: bind this control layer to a region (vs document-global)."),
});

const Output = z.object({
  control_layer_id: ControlLayerId,
});

export const addControlLayer = defineTool({
  name: "add_control_layer",
  title: "Add control layer",
  description:
    "Adds a control layer (Reference / IP-Adapter family: reference, style, composition, face; or Structural / ControlNet family: scribble, line_art, soft_edge, canny, depth, normal, pose, segmentation, unblur, stencil). Reversible: undo removes the control layer. To change a control layer, remove + add (collapsed updates per design.md §3.4). Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
