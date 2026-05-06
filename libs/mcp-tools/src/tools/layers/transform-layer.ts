import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, LayerId } from "../../shared/ids";

/**
 * `transform_layer` — promoted from the deferred catalog (mcp-tool-catalog
 * §3.3.17) into v1 by `transform-tools`. Accepts either a partial absolute
 * decomposed transform OR a relative delta (Q7 in transform-tools/design.md).
 *
 * The handler stores the resulting transform on the layer and registers a
 * reversible Command on the per-document undo stack. Group transform is
 * supported via the optional `group_id` field — when set, the same partial
 * input applies to every member layer with their relative offsets preserved.
 */

const Point = z.object({
  x: z.number(),
  y: z.number(),
});

const Anchor = Point;

const DistortCorners = z.tuple([Point, Point, Point, Point]);

const TransformPartial = z
  .object({
    tx: z.number().optional(),
    ty: z.number().optional(),
    sx: z.number().optional(),
    sy: z.number().optional(),
    rotation_deg: z.number().optional(),
    skew_x_deg: z.number().optional(),
    skew_y_deg: z.number().optional(),
    flip_h: z.boolean().optional(),
    flip_v: z.boolean().optional(),
    anchor: Anchor.optional(),
    /** Pass `null` to clear an existing distort override. */
    distort_corners: z.union([DistortCorners, z.null()]).optional(),
  })
  .strict();

const TransformDelta = z
  .object({
    translate: z
      .object({ dx: z.number(), dy: z.number() })
      .optional(),
    scale: z
      .object({ sx: z.number(), sy: z.number() })
      .optional(),
    rotate_deg: z.number().optional(),
    skew: z
      .object({ dx_deg: z.number(), dy_deg: z.number() })
      .optional(),
    flip_h: z.boolean().optional(),
    flip_v: z.boolean().optional(),
  })
  .strict();

/**
 * Either an absolute partial or a relative delta. The handler distinguishes
 * by the presence of delta-only keys (`translate`, `scale`, `rotate_deg`,
 * `skew`).
 */
const TransformInput = z.union([TransformDelta, TransformPartial]);

const TransformDecomposedOutput = z.object({
  tx: z.number(),
  ty: z.number(),
  sx: z.number(),
  sy: z.number(),
  rotation_deg: z.number(),
  skew_x_deg: z.number(),
  skew_y_deg: z.number(),
  flip_h: z.boolean(),
  flip_v: z.boolean(),
  anchor: Anchor,
  distort_corners: DistortCorners.optional(),
});

const Input = z.object({
  document_id: DocumentId.optional(),
  layer_id: LayerId.optional().describe(
    "Target layer. Required unless `group_id` is set.",
  ),
  group_id: z
    .string()
    .optional()
    .describe(
      "When set, applies the same partial transform to every layer in the group; relative offsets between members are preserved on absolute fields.",
    ),
  transform: TransformInput.describe(
    "Partial absolute transform OR relative delta. Missing fields preserve current state.",
  ),
});

const Output = z.object({
  layer_id: LayerId.optional(),
  group_id: z.string().optional(),
  transform: TransformDecomposedOutput.optional().describe(
    "Resulting transform after merge. Omitted on group transforms (per-layer state is reflected via `document.changed`).",
  ),
  affected_layer_ids: z.array(LayerId),
});

export const transformLayer = defineTool({
  name: "transform_layer",
  title: "Transform layer",
  description:
    "Translate, scale, rotate, flip, skew, or distort a single layer or a group composite. Accepts either a partial absolute transform (each provided field overwrites) or a relative delta (`translate: { dx, dy }`, `scale: { sx, sy }`, `rotate_deg`, `skew`). Missing fields preserve current state. Reversible: undo restores the prior transform for every affected layer in one step. Idempotent for identical absolute inputs (deltas are not, by definition). Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      transform: {
        translate: { dx: 50, dy: -10 },
        rotate_deg: 15,
      },
    },
    output: {
      layer_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      transform: {
        tx: 50,
        ty: -10,
        sx: 1,
        sy: 1,
        rotation_deg: 15,
        skew_x_deg: 0,
        skew_y_deg: 0,
        flip_h: false,
        flip_v: false,
        anchor: { x: 0.5, y: 0.5 },
      },
      affected_layer_ids: ["01HZK2X9VTVM7E9WX0H4QF6P5N" as never],
    },
  },
  since: "1.0.0",
});
