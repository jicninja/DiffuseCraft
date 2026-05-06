/**
 * Image envelope and selection schemas.
 *
 * Image-returning tools wrap bytes in an `ImageEnvelope` with either an
 * `inline` base64 payload (≤256 KB by handshake-negotiated cap) or a
 * `ref` URI pointing at a short-lived blob resource.
 *
 * Selection has three shapes: `rect`, `mask` (an inner ImageEnvelope), and
 * `none` (explicit clear).
 */
import { z } from "zod";

export const ImageFormat = z.enum(["png", "jpeg", "webp"]);
export type ImageFormat = z.infer<typeof ImageFormat>;

const ImageBase = z.object({
  format: ImageFormat,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const InlineImage = z.object({
  inline: z.object({
    encoding: z.literal("base64"),
    data: z.string(),
  }),
});

const RefImage = z.object({
  ref: z.object({
    uri: z
      .string()
      .regex(
        /^diffusecraft:\/\/blob\/[0-9A-HJKMNP-TV-Z]{26}$/,
        "Must be diffusecraft://blob/<ULID>",
      ),
    expires_at: z.string().datetime().optional(),
  }),
});

/**
 * Carrier for image bytes. Exactly one of `inline` or `ref` is present.
 *
 * Server picks the encoding based on size and the client's
 * `max_inline_image_kb` capability declared at handshake.
 */
export const ImageEnvelope = z.union([
  ImageBase.merge(InlineImage),
  ImageBase.merge(RefImage),
]);
export type ImageEnvelope = z.infer<typeof ImageEnvelope>;

/** A simple axis-aligned rectangle, integer pixels. */
export const Rect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type Rect = z.infer<typeof Rect>;

/**
 * Selection input: rect, raster mask, or explicit clear.
 *
 * `none` is preserved so callers can clear the selection idempotently.
 */
export const Selection = z.union([
  z.object({ kind: z.literal("rect"), rect: Rect }),
  z.object({ kind: z.literal("mask"), mask: ImageEnvelope }),
  z.object({ kind: z.literal("none") }),
]);
export type Selection = z.infer<typeof Selection>;
