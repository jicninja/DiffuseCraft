/**
 * MCP catalog store factory.
 *
 * Mirrors the negotiated tool / resource / prompt list and server
 * capabilities for the current backend (FR-19, FR-20). Cache-style
 * persistence per backend id (FR-7).
 */
import { createStore, type StoreApi } from 'zustand';

import { buildPersistOptions, persist, type AsyncKvStorage } from '../shared/persist-config';

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  category: 'read' | 'mutation' | 'job' | 'admin';
  idempotent: boolean;
  reversible: boolean;
  since: string;
}

export interface ResourceDescriptor {
  uri: string;
  title: string;
  description: string;
}

export interface PromptDescriptor {
  name: string;
  description: string;
}

export interface ServerCapabilities {
  catalog_version_range: readonly [string, string];
  comfyui_status: 'ready' | 'starting' | 'unavailable';
  supported_workspaces: ReadonlyArray<string>;
  sampling_supported: boolean;
  audit_log_enabled: boolean;
}

export interface HandshakeResult {
  catalogVersion: string;
  tools: ReadonlyArray<ToolDescriptor>;
  resources: ReadonlyArray<ResourceDescriptor>;
  prompts: ReadonlyArray<PromptDescriptor>;
  capabilities: ServerCapabilities;
}

export interface McpCatalogState {
  /** Currently-mirrored backend id; cache is scoped per-backend. */
  backendId: string | null;
  catalogVersion: string | null;
  tools: ReadonlyArray<ToolDescriptor>;
  resources: ReadonlyArray<ResourceDescriptor>;
  prompts: ReadonlyArray<PromptDescriptor>;
  capabilities: ServerCapabilities | null;

  /** Replace mirror with a fresh handshake result for the given backend. */
  loadFromHandshake(backendId: string, handshake: HandshakeResult): void;
  /** Selector helper used by FR-20 conditional UI. */
  hasTool(name: string): boolean;
  /** Drop the cache. Called on disconnect. */
  clearCache(): void;
}

export interface PersistedMcpCatalogState {
  backendId: string | null;
  catalogVersion: string | null;
  tools: ReadonlyArray<ToolDescriptor>;
  resources: ReadonlyArray<ResourceDescriptor>;
  prompts: ReadonlyArray<PromptDescriptor>;
  capabilities: ServerCapabilities | null;
}

export type McpCatalogStore = StoreApi<McpCatalogState>;

export interface McpCatalogStoreOptions {
  storage?: AsyncKvStorage;
  persistKey?: string;
}

export function createMcpCatalogStore(
  options: McpCatalogStoreOptions = {},
): McpCatalogStore {
  const initializer = (
    set: StoreApi<McpCatalogState>['setState'],
    get: StoreApi<McpCatalogState>['getState'],
  ): McpCatalogState => ({
    backendId: null,
    catalogVersion: null,
    tools: [],
    resources: [],
    prompts: [],
    capabilities: null,

    loadFromHandshake: (backendId, handshake) => {
      set({
        backendId,
        catalogVersion: handshake.catalogVersion,
        tools: handshake.tools,
        resources: handshake.resources,
        prompts: handshake.prompts,
        capabilities: handshake.capabilities,
      });
    },

    hasTool: (name) => {
      return get().tools.some((t) => t.name === name);
    },

    clearCache: () => {
      set({
        backendId: null,
        catalogVersion: null,
        tools: [],
        resources: [],
        prompts: [],
        capabilities: null,
      });
    },
  });

  if (!options.storage) {
    return createStore<McpCatalogState>()(initializer);
  }

  const persistOptions = buildPersistOptions<McpCatalogState, PersistedMcpCatalogState>({
    name: options.persistKey ?? 'mcp-catalog',
    partialize: (s) => ({
      backendId: s.backendId,
      catalogVersion: s.catalogVersion,
      tools: s.tools,
      resources: s.resources,
      prompts: s.prompts,
      capabilities: s.capabilities,
    }),
    storage: options.storage,
  });

  return createStore<McpCatalogState>()(persist(initializer, persistOptions));
}
