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
      if (!attached) {
        // No client yet (cold start before pairing); bump the timestamp
        // so consumers can observe that a refresh was attempted.
        set({ lastRefresh: new Date().toISOString() });
        return;
      }
      // Fetch both lists in parallel. Each `diffusecraft://*/list`
      // resource returns `{ items: T[], next_cursor?: string }` per the
      // catalog manifest (libs/mcp-tools/src/resources/manifest.ts).
      const [modelsPage, presetsPage] = await Promise.all([
        attached.readResource<{ items: Model[]; next_cursor?: string }>(
          'diffusecraft://models/list',
        ),
        attached.readResource<{ items: Preset[]; next_cursor?: string }>(
          'diffusecraft://presets/list',
        ),
      ]);
      set({
        models: modelsPage?.items ?? [],
        presets: presetsPage?.items ?? [],
        lastRefresh: new Date().toISOString(),
      });
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
