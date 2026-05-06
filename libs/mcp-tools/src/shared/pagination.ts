/**
 * Pagination + field-selection helpers (FR-39).
 *
 * Cursor is opaque to the client; servers may encode any state inside.
 * Field-selection is documented at the resource protocol level: clients
 * pass `?fields=a,b,c` on resource URIs and `fields` on tools that wrap
 * a list (currently `get_audit_log`).
 */
import { z } from "zod";

export const Cursor = z.string().max(256).optional();
export type Cursor = z.infer<typeof Cursor>;

/**
 * Wrap a per-item schema in a paginated envelope. Items capped at 50
 * per page (FR-39); `next_cursor` may be present even for short pages.
 */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item).max(50),
    next_cursor: Cursor,
    total_known: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Total count when cheaply known; absent otherwise. Do not rely on for completion checks.",
      ),
  });

export type Paginated<T> = {
  items: T[];
  next_cursor?: string;
  total_known?: number;
};

/**
 * Common input shape for list/read tools that wrap a paginated resource.
 */
export const ListInput = z.object({
  cursor: Cursor,
  limit: z.number().int().min(1).max(50).default(20),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict response to listed fields per item. Saves bytes when full record is not needed.",
    ),
  since: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO-8601 timestamp; return only entities changed after this moment (FR-46).",
    ),
});
export type ListInput = z.infer<typeof ListInput>;
