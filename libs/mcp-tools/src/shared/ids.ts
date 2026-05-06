/**
 * ULID and branded id schemas (Q2 in design.md §1).
 *
 * ULIDs are URL-safe, sortable by creation time, and 26 chars long.
 * Crockford's base32 alphabet excludes I, L, O, U to avoid ambiguity.
 *
 * Branded ids (`z.string().brand<"Tag">()`) provide nominal typing in
 * TypeScript so `LayerId` and `DocumentId` cannot be confused at compile
 * time even though both are ULID strings at runtime.
 */
import { z } from "zod";

/** Crockford base32 ULID — 26 chars, no I/L/O/U. */
export const Ulid = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Must be a valid ULID");
export type Ulid = z.infer<typeof Ulid>;

export const DocumentId = Ulid.brand<"DocumentId">();
export type DocumentId = z.infer<typeof DocumentId>;

export const LayerId = Ulid.brand<"LayerId">();
export type LayerId = z.infer<typeof LayerId>;

export const HistoryItemId = Ulid.brand<"HistoryItemId">();
export type HistoryItemId = z.infer<typeof HistoryItemId>;

export const JobId = Ulid.brand<"JobId">();
export type JobId = z.infer<typeof JobId>;

export const RegionId = Ulid.brand<"RegionId">();
export type RegionId = z.infer<typeof RegionId>;

export const ControlLayerId = Ulid.brand<"ControlLayerId">();
export type ControlLayerId = z.infer<typeof ControlLayerId>;

export const PresetId = Ulid.brand<"PresetId">();
export type PresetId = z.infer<typeof PresetId>;

export const BlobId = Ulid.brand<"BlobId">();
export type BlobId = z.infer<typeof BlobId>;

export const TokenId = Ulid.brand<"TokenId">();
export type TokenId = z.infer<typeof TokenId>;

/**
 * Convenience: string literal helper for example payloads.
 * Branded types reject plain strings in TS even when they look ULID,
 * so example fixtures need an unsafe cast.
 */
export const asUlid = <T extends z.ZodType>(brand: T, value: string): z.infer<T> =>
  brand.parse(value) as z.infer<T>;
