/**
 * Persistence schema version (FR-8).
 *
 * Bump when the persisted shape of any persisted store changes in a
 * non-backwards-compatible way. The `persistedSlice` factory in
 * `persist-config.ts` discards persisted state on version mismatch unless a
 * matching migration is supplied.
 */
export const PERSISTENCE_SCHEMA_VERSION = 1 as const;
