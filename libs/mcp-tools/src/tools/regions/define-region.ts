import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import {
  ControlLayerId,
  DocumentId,
  LayerId,
  RegionId,
} from "../../shared/ids";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe(
    "Paint layer whose alpha/opacity drives the region mask (krita parity).",
  ),
  prompt: z.string().min(1).max(2000),
  negative_prompt: z.string().max(2000).optional(),
  control_layer_ids: z.array(ControlLayerId).optional(),
});

const Output = z.object({ region_id: RegionId });

export const defineRegion = defineTool({
  name: "define_region",
  title: "Define region",
  description:
    "Creates a region linked to a paint layer with a per-region prompt (and optional negative prompt + region-scoped control layers). The layer's alpha defines where the region applies during generation. Reversible: undo removes the region. To change a region, remove + define.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
