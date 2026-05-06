import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { ImageEnvelope, ImageFormat } from "../../shared/envelope";

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_ids: z
    .array(LayerId)
    .optional()
    .describe("If omitted, exports the composited document."),
  format: ImageFormat.default("png"),
  quality: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Only honored for `jpeg` and `webp`."),
  to_path: z
    .string()
    .optional()
    .describe(
      "Server-side absolute path to write the export. If omitted, returns bytes via ImageEnvelope.",
    ),
});

const Output = z.object({
  written_to: z.string().optional(),
  image: ImageEnvelope.optional(),
});

export const exportImage = defineTool({
  name: "export_image",
  title: "Export image",
  description:
    "Exports the active document (or specified layers) as image bytes (returns ImageEnvelope) or to a server-side file path (`to_path`). For client-side downloads agents typically use the inline/ref envelope path.",
  category: "write",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
