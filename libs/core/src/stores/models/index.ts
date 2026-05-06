/**
 * Models store factory.
 *
 * Mirrors the server's `models` and `presets` lists. Cache-style persistence
 * (FR-7): persisted shape includes the lists + last refresh timestamp;
 * actual freshness is asserted on connect/refresh.
 */
import { createStore, type StoreApi } from 'zustand';

import { buildPersistOptions, persist, type AsyncKvStorage } from '../shared/persist-config';
import type { DiffuseCraftClientLike, ModelDownloadProgressPayload } from '../shared/types';

export interface Model {
  id: string;
  name: string;
  family: string;
  size_bytes: number | null;
  installed: boolean;
}

export interface Preset {
  id: string;
  name: string;
  workspace: string;
}

export interface ModelDownloadState {
  bytes_downloaded: number;
  bytes_total: number;
}

export interface ModelsState {
  models: ReadonlyArray<Model>;
  presets: ReadonlyArray<Preset>;
  /** ISO timestamp of the last successful refresh from the server. */
  lastRefresh: string | null;
  /** Per-model download progress, indexed by model id. */
  downloads: Readonly<Record<string, ModelDownloadState>>;

  attachClient(client: DiffuseCraftClientLike): void;
  detachClient(): void;
  /** Pull a fresh models + presets list from the server. */
  refresh(): Promise<void>;
  /** Apply a `model.download.progress` event payload. */
  applyDownloadProgress(payload: ModelDownloadProgressPayload): void;
  /** Drop cached lists. Called by the provider on disconnect. */
  clearCache(): void;
}

export interface PersistedModelsState {
  models: ReadonlyArray<Model>;
  presets: ReadonlyArray<Preset>;
  lastRefresh: string | null;
}

export type ModelsStore = StoreApi<ModelsState>;

export interface ModelsStoreOptions {
  storage?: AsyncKvStorage;
  persistKey?: string;
}

export function createModelsStore(options: ModelsStoreOptions = {}): ModelsStore {
  let attached: DiffuseCraftClientLike | null = null;

  const initializer = (
    set: StoreApi<ModelsState>['setState'],
    get: StoreApi<ModelsState>['getState'],
  ): ModelsState => ({
    models: [],
    presets: [],
    lastRefresh: null,
    downloads: {},

    attachClient: (client) => {
      attached = client;
    },
    detachClient: () => {
      attached = null;
    },

    refresh: async () => {
      // TODO(client-sdk): replace with parallel calls
      //   await client.invokeTool('list_models', {});
      //   await client.invokeTool('list_presets', {});
      // For now, leave existing cache and bump lastRefresh so consumers can
      // observe the action ran.
      if (!attached) {
        set({ lastRefresh: new Date().toISOString() });
        return;
      }
      set({ lastRefresh: new Date().toISOString() });
    },

    applyDownloadProgress: (payload) => {
      const next: Record<string, ModelDownloadState> = { ...get().downloads };
      next[payload.model_id] = {
        bytes_downloaded: payload.bytes_downloaded,
        bytes_total: payload.bytes_total,
      };
      set({ downloads: next });
    },

    clearCache: () => {
      set({ models: [], presets: [], lastRefresh: null, downloads: {} });
    },
  });

  if (!options.storage) {
    return createStore<ModelsState>()(initializer);
  }

  const persistOptions = buildPersistOptions<ModelsState, PersistedModelsState>({
    name: options.persistKey ?? 'models',
    partialize: (s) => ({
      models: s.models,
      presets: s.presets,
      lastRefresh: s.lastRefresh,
    }),
    storage: options.storage,
  });

  return createStore<ModelsState>()(persist(initializer, persistOptions));
}
