import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { Ulid } from "../../shared/ids";

const Scope = z.enum(["document", "layer"]);

const Input = z.object({
  scope: Scope,
  id: Ulid.optional()
    .describe("Required for `layer`; ignored for `document` (uses active doc)."),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

const Output = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255),
});

export const getPixel = defineTool({
  name: "get_pixel",
  title: "Read pixel",
  description:
    "Returns RGBA at (x, y) on a document or layer. For sparse color sampling without a full image transfer.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
