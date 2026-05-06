import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { Ulid } from "../../shared/ids";
import { ImageEnvelope, ImageFormat, Rect } from "../../shared/envelope";

const Scope = z.enum([
  "document",
  "layer",
  "selection",
  "region",
  "history_item",
  "thumbnail",
]);

const Input = z.object({
  scope: Scope,
  id: Ulid.optional()
    .describe(
      "Required for layer/region/history_item. For thumbnail defaults to active document.",
    ),
  alpha_only: z
    .boolean()
    .default(false)
    .describe("Returns mask-only (alpha channel) when true. Useful for selection mask, layer mask."),
  region: z
    .union([
      z.object({ rect: Rect }),
      z.object({ mask_id: Ulid }),
    ])
    .optional()
    .describe("Optional sub-region clip applied before encoding."),
  format: ImageFormat.default("png"),
  max_dimension: z
    .number()
    .int()
    .min(64)
    .max(8192)
    .optional()
    .describe(
      "Downscale longest edge. For thumbnails (max_dimension ≤ 512) the result is always inline (FR-50).",
    ),
});

export const getImage = defineTool({
  name: "get_image",
  title: "Read image data",
  description:
    "Polymorphic image read. Scopes: composite document, individual layer, active selection content, selection mask (`scope:'selection', alpha_only: true`), region content, history-item preview, downscaled thumbnail. Returns the standard ImageEnvelope (inline for ≤256KB, ref otherwise per FR-29). Server picks PNG by default, WEBP when `accepts_lossy: true` and source has no alpha-critical content.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: ImageEnvelope,
  example: {
    input: {
      scope: "thumbnail",
      id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      max_dimension: 256,
    },
    output: {
      format: "png",
      width: 256,
      height: 256,
      inline: { encoding: "base64", data: "<base64>" },
    },
  },
  since: "1.0.0",
});
