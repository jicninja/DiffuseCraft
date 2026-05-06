/**
 * Persistence schema version (FR-8).
 *
 * Bump when the persisted shape of any persisted store changes in a
 * non-backwards-compatible way. The `persistedSlice` factory in
 * `persist-config.ts` discards persisted state on version mismatch unless a
 * matching migration is supplied.
 *
 * History:
 *   - v1: initial connection-store shape
 *     ({ pairedBackends: { id, name, lastConnectedAt, origin }[], currentBackendId })
 *   - v2: connection-store added `url` to PairedBackend so paired entries
 *     are dial-able after app restart. Migration drops entries without a
 *     URL (orphaned handles from the v1 stub flow).
 */
export const PERSISTENCE_SCHEMA_VERSION = 2 as const;
