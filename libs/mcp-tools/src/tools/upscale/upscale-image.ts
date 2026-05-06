import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, JobId, LayerId } from "../../shared/ids";
import { ModelId } from "../../shared/common";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.optional()
    .describe("Layer to upscale. If omitted, upscales the composite document."),
  factor: z
    .number()
    .min(1.5)
    .max(8)
    .default(2)
    .describe("Linear scale factor; final pixels = factor * source."),
  upscaler_model: ModelId.optional()
    .describe("Override the default upscaler. Format `<registry>:<id>`."),
  tile_size: z
    .number()
    .int()
    .min(256)
    .max(2048)
    .default(1024)
    .describe("Tile size in pixels; smaller saves VRAM but is slower."),
});

const Output = z.object({
  job_id: JobId,
});

export const upscaleImage = defineTool({
  name: "upscale_image",
  title: "Upscale (tile-based)",
  description:
    "Submits a tile-based upscale job. Returns a job handle; subscribe to job.progress / job.completed for status and the resulting `history_item_id`. Apply via apply_history_item.",
  category: "job",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
  workspace: ["Upscale"],
});
