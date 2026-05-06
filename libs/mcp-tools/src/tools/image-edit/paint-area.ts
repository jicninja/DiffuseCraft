import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { ImageEnvelope, Rect } from "../../shared/envelope";

const Color = z
  .string()
  .regex(
    /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/,
    "Hex color, optionally with alpha (#rrggbbaa).",
  );

const Mode = z.enum(["fill", "erase", "color_replace"]);

const Target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("selection") }),
  z.object({ kind: z.literal("rect"), rect: Rect }),
  z.object({ kind: z.literal("mask"), mask: ImageEnvelope }),
]);

const SolidContent = z.object({ kind: z.literal("solid"), color: Color });
const GradientContent = z.object({
  kind: z.literal("gradient"),
  stops: z
    .array(z.object({ offset: z.number().min(0).max(1), color: Color }))
    .min(2)
    .max(8),
  angle: z.number().min(0).max(360).default(0),
});
const ImageContent = z.object({ kind: z.literal("image"), image: ImageEnvelope });

const Content = z.discriminatedUnion("kind", [
  SolidContent,
  GradientContent,
  ImageContent,
]);

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId,
  mode: Mode,
  target: Target,
  content: Content.optional()
    .describe("Required for `fill` and `color_replace`. Ignored for `erase`."),
  ignore_selection: z.boolean().default(false),
});

const Output = z.object({
  applied: z.boolean(),
  affected_bbox: Rect,
});

export const paintArea = defineTool({
  name: "paint_area",
  title: "Fill / erase / replace color in area",
  description:
    "Floods or clears a region. Modes: `fill` (paints content into target), `erase` (clears alpha), `color_replace` (swaps hue while keeping luminance). Replaces separate fill/erase/color-replace tools. Reversible. Respects the active selection unless `ignore_selection: true`. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
