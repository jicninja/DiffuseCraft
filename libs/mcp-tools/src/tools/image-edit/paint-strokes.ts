import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";
import { BlendMode } from "../../shared/common";

const Color = z
  .string()
  .regex(
    /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/,
    "Hex color, optionally with alpha (#rrggbbaa).",
  );

const Point = z.object({
  x: z.number(),
  y: z.number(),
  /** Stylus pressure 0..1 if available; falls back to 1 when omitted. */
  pressure: z.number().min(0).max(1).optional(),
});

const Stroke = z.object({
  points: z.array(Point).min(1),
  color: Color,
  brush_id: z.string().describe("Brush definition id from the brush registry."),
  size: z.number().min(0.5).max(4096),
  blend_mode: BlendMode.optional(),
});

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.describe("Target paint or mask layer."),
  strokes: z.array(Stroke).min(1).max(512),
  ignore_selection: z
    .boolean()
    .default(false)
    .describe(
      "Bypass the active selection (FR-30). Default false → strokes are clipped to the selection when one is active.",
    ),
});

const Output = z.object({
  applied: z.boolean(),
  affected_bbox: z.object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int(),
    h: z.number().int(),
  }),
});

export const paintStrokes = defineTool({
  name: "paint_strokes",
  title: "Paint strokes",
  description:
    "Applies a sequence of brush strokes to a paint layer or mask. Strokes are clipped to the active selection unless `ignore_selection: true` (FR-30). Reversible: undo restores prior pixels via snapshot. Emits `document.changed` with bounding box.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
