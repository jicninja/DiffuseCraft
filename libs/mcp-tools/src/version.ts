/**
 * Catalog semver (FR-6).
 *
 * - Adding a new tool/event/resource/optional input field → minor bump.
 * - Removing or renaming a tool/event/resource → major bump.
 * - Changing an enum's existing values or making an optional field
 *   required → major bump.
 * - Footprint exceeding 100 KB → blocked at build (CI fails) — see
 *   `scripts/emit-json-schema.ts`.
 */
export const CATALOG_VERSION = "1.0.0" as const;
export type CatalogVersion = typeof CATALOG_VERSION;
