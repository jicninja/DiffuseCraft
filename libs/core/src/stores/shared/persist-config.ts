/**
 * Persist-middleware factory used by stores that persist state.
 *
 * Per FR-7 and FR-8, only some stores persist, and persistence carries a
 * schema version. Storage is injectable so apps/mobile uses AsyncStorage and
 * tests use an in-memory implementation (FR-6: stores must be re-instantiable
 * per test).
 *
 * NOTE: this module imports `zustand/middleware` lazily-typed to avoid
 * coupling test runners to React Native's storage stack. The real storage
 * adapter is provided per-call by the consumer.
 */
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistOptions, PersistStorage, StateStorage } from 'zustand/middleware';

import { PERSISTENCE_SCHEMA_VERSION } from './version';

/**
 * Minimal interface that any storage backend must provide. AsyncStorage and
 * the in-memory test storage both satisfy this shape.
 */
export type AsyncKvStorage = Pick<
  StateStorage,
  'getItem' | 'setItem' | 'removeItem'
>;

export interface PersistedSliceConfig<TState extends object, TPersisted = unknown> {
  /** Logical store name; the on-disk key is `diffusecraft-<name>`. */
  name: string;
  /** Schema version for the persisted shape. Defaults to the global constant. */
  version?: number;
  /** Subset of state to persist. */
  partialize: (state: TState) => TPersisted;
  /** Storage adapter; falls back to no persistence if undefined. */
  storage?: AsyncKvStorage;
  /**
   * Optional migration from an older persisted shape. If absent, persisted
   * state from a different version is discarded.
   */
  migrate?: (persisted: unknown, fromVersion: number) => TPersisted | undefined;
}

/**
 * Build a Zustand `persist` middleware option object from a PersistedSliceConfig.
 *
 * The returned object must be passed as the second argument to `persist()`
 * inside the store factory. Example:
 *
 * ```ts
 * persist(
 *   (set, get) => ({ ... }),
 *   buildPersistOptions({
 *     name: 'connection',
 *     partialize: (s) => ({ pairedBackends: s.pairedBackends, ... }),
 *     storage: AsyncStorage,
 *   }),
 * )
 * ```
 */
export function buildPersistOptions<TState extends object, TPersisted = unknown>(
  config: PersistedSliceConfig<TState, TPersisted>,
): PersistOptions<TState, TPersisted> {
  const version = config.version ?? PERSISTENCE_SCHEMA_VERSION;
  const storage: PersistStorage<TPersisted> | undefined = config.storage
    ? createJSONStorage<TPersisted>(() => config.storage as StateStorage) ?? undefined
    : undefined;

  return {
    name: `diffusecraft-${config.name}`,
    version,
    storage,
    partialize: config.partialize as (state: TState) => TPersisted,
    migrate: (persisted, fromVersion) => {
      if (fromVersion === version) return persisted as TPersisted;
      if (config.migrate) {
        const migrated = config.migrate(persisted, fromVersion);
        if (migrated !== undefined) return migrated;
      }
      // No migration supplied or migration declined: discard persisted state.
      // Returning undefined causes Zustand to fall back to initial state.
      return undefined as unknown as TPersisted;
    },
  };
}

/**
 * Re-export the upstream `persist` middleware so consumers don't need to
 * import zustand directly when building a store.
 */
export { persist };

/**
 * In-memory KV storage adapter for tests. Each instance is isolated.
 */
export function createMemoryStorage(): AsyncKvStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}
