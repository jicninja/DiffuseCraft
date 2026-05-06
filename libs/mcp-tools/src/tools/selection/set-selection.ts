import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { ImageEnvelope, Rect } from "../../shared/envelope";

const Point = z.object({ x: z.number(), y: z.number() });

const RectSel = z.object({ kind: z.literal("rect"), rect: Rect });
const MaskSel = z.object({ kind: z.literal("mask"), mask: ImageEnvelope });
const PolygonSel = z.object({
  kind: z.literal("polygon"),
  points: z
    .array(Point)
    .min(3)
    .describe("Closed polygon, ≥3 vertices. The renderer auto-closes the path."),
});
const ClearSel = z.object({ kind: z.literal("clear") });
const ModifySel = z.object({
  kind: z.literal("modify"),
  op: z.enum(["grow", "shrink", "feather", "blur", "invert"]),
  amount: z
    .number()
    .min(0)
    .max(256)
    .optional()
    .describe("Pixel amount for grow/shrink/feather/blur. Ignored for invert."),
});
const MagicWandSel = z.object({
  kind: z.literal("magic_wand"),
  layer_id: z
    .string()
    .optional()
    .describe(
      "Active layer id whose pixels are sampled. Falls back to composite when omitted (subject to `sample_composite`).",
    ),
  tap_point: Point,
  tolerance: z.number().int().min(0).max(255).default(32),
  contiguous: z.boolean().default(true),
  sample_composite: z
    .boolean()
    .default(false)
    .describe("Sample the composite raster instead of the active layer."),
});

const Input = z.object({
  document_id: DocumentId.optional(),
  shape: z.discriminatedUnion("kind", [
    RectSel,
    MaskSel,
    PolygonSel,
    ClearSel,
    ModifySel,
    MagicWandSel,
  ]),
  op: z
    .enum(["replace", "add", "subtract", "intersect"])
    .default("replace")
    .describe(
      "Boolean composition with the existing selection. Defaults to `replace`.",
    ),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
});

export const setSelection = defineTool({
  name: "set_selection",
  title: "Set selection (rect/polygon/mask/magic-wand/clear/modify)",
  description:
    "Polymorphic setter for the active selection. `rect`, `polygon`, `mask`, and `magic_wand` set or compose with the existing selection (per `op`); `clear` removes it; `modify` operates on the existing selection (grow, shrink, feather, blur, invert). The `op` field controls boolean composition with the prior selection (`replace` default). Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "write",
  idempotent: true,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { shape: { kind: "rect", rect: { x: 0, y: 0, w: 256, h: 256 } } },
    output: { active: true, bbox: { x: 0, y: 0, w: 256, h: 256 } },
  },
  since: "1.0.0",
});
