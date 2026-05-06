import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";
import { Rect } from "../../shared/envelope";

const Input = z.object({
  document_id: DocumentId.optional(),
  grow_px: z.number().min(0).max(64).optional(),
  shrink_px: z.number().min(0).max(64).optional(),
  feather_px: z.number().min(0).max(64).optional(),
  blur_px: z.number().min(0).max(64).optional(),
  smooth_px: z
    .number()
    .min(0)
    .max(64)
    .optional()
    .describe(
      "Reserved for chaikin-style edge smoothing; current implementation maps it to `blur_px`.",
    ),
  threshold: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe(
      "Re-binarize the refined mask at this threshold (0..255). Omit for an anti-aliased result.",
    ),
});

const Output = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
});

export const refineSelection = defineTool({
  name: "refine_selection",
  title: "Refine selection (grow / shrink / feather / blur)",
  description:
    "Compose grow → shrink → feather → blur on the existing selection in one server-side pass. Mirrors `refine_mask`. Reversible: undo restores the prior selection. Emits `document.changed`.",
  category: "write",
  idempotent: false,
  reversible: true,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { grow_px: 2, feather_px: 4 },
    output: { active: true, bbox: { x: 0, y: 0, w: 256, h: 256 } },
  },
  since: "1.0.0",
});
