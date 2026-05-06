/**
 * StoresProvider — instantiates all six stores and wires the client SDK.
 *
 * Per FR-5, this is the single React entry point. Apps mount it once near
 * the root and pass a (possibly null) client; children consume stores via
 * the typed hooks in `hooks.ts`.
 *
 * Cross-store reactions live here (FR-23): when the connection drops, the
 * provider clears ephemeral mirrors. Components never observe two stores
 * simultaneously to make a decision.
 *
 * The `client` is allowed to be `null` so apps can mount the provider
 * before the SDK is ready (FR-4: factories must not require a client at
 * construction time).
 */
import React, {
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import {
  ConnectionStoreContext,
  EditorStoreContext,
  HistoryStoreContext,
  JobsStoreContext,
  McpCatalogStoreContext,
  ModelsStoreContext,
  StoresClientContext,
} from './context';
import { createEditorStore, type EditorStore } from './editor';
import {
  createConnectionStore,
  type ConnectionStore,
  type ConnectionStoreOptions,
} from './connection';
import {
  createModelsStore,
  type ModelsStore,
  type ModelsStoreOptions,
} from './models';
import { createJobsStore, type JobsStore } from './jobs';
import { createHistoryStore, type HistoryStore } from './history';
import {
  createMcpCatalogStore,
  type McpCatalogStore,
  type McpCatalogStoreOptions,
} from './mcp-catalog';
import type { DiffuseCraftClientLike } from './shared/types';

export interface StoresProviderProps {
  /**
   * Client SDK instance. May be `null` until the SDK is wired (e.g., during
   * cold-start before pairing has occurred).
   */
  client: DiffuseCraftClientLike | null;
  children: ReactNode;
  /** Optional persistence/storage configuration injected by the host app. */
  connectionOptions?: ConnectionStoreOptions;
  modelsOptions?: ModelsStoreOptions;
  mcpCatalogOptions?: McpCatalogStoreOptions;
  /**
   * Optional override: reuse pre-created stores. Used by tests to assert
   * behavior on specific store instances. When present, all six options
   * objects are ignored.
   */
  preinstantiated?: PreinstantiatedStores;
}

export interface PreinstantiatedStores {
  editor: EditorStore;
  connection: ConnectionStore;
  models: ModelsStore;
  jobs: JobsStore;
  history: HistoryStore;
  mcpCatalog: McpCatalogStore;
}

export const StoresProvider: React.FC<StoresProviderProps> = ({
  client,
  children,
  connectionOptions,
  modelsOptions,
  mcpCatalogOptions,
  preinstantiated,
}) => {
  // Memoize so each provider instance owns one set of stores (P21, FR-6).
  const stores = useMemo<PreinstantiatedStores>(() => {
    if (preinstantiated) return preinstantiated;
    return {
      editor: createEditorStore(),
      connection: createConnectionStore(connectionOptions),
      models: createModelsStore(modelsOptions),
      jobs: createJobsStore(),
      history: createHistoryStore(),
      mcpCatalog: createMcpCatalogStore(mcpCatalogOptions),
    };
    // The dependency array intentionally only re-runs when the override
    // identity changes; option objects are not deep-compared (apps should
    // pass stable references).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preinstantiated]);

  // Wire the client → stores. Re-wires when client identity changes.
  useEffect(() => {
    if (!client) return undefined;

    stores.editor.getState().attachClient(client);
    stores.models.getState().attachClient(client);
    stores.history.getState().attachClient(client);

    const unsubscribe = client.events.subscribe((event) => {
      switch (event.name) {
        case 'job.progress':
          stores.jobs.getState().applyProgress(event.payload);
          return;
        case 'job.completed':
          stores.jobs.getState().applyCompleted(event.payload);
          return;
        case 'document.changed':
          stores.editor.getState().applyDocumentChanged(event.payload);
          stores.history.getState().applyDocumentChanged(event.payload);
          return;
        case 'model.download.progress':
          stores.models.getState().applyDownloadProgress(event.payload);
          return;
        case 'audit.entry':
          // No store mirrors audit entries; the audit log is server-side
          // and queried explicitly via `get_audit_log`.
          return;
        default:
          return;
      }
    });

    return () => {
      unsubscribe();
      stores.editor.getState().detachClient();
      stores.models.getState().detachClient();
      stores.history.getState().detachClient();
    };
  }, [client, stores]);

  // Cross-store reaction: when the connection drops, clear ephemeral mirrors.
  useEffect(() => {
    const unsub = stores.connection.subscribe((s, prev) => {
      if (s.connectionStatus === prev.connectionStatus) return;
      if (s.connectionStatus === 'disconnected' || s.connectionStatus === 'error') {
        stores.jobs.getState().clear();
        stores.history.getState().clear();
        stores.models.getState().clearCache();
        stores.editor.getState().clearDocument();
        stores.mcpCatalog.getState().clearCache();
      }
    });
    return unsub;
  }, [stores]);

  return (
    <StoresClientContext.Provider value={client}>
      <EditorStoreContext.Provider value={stores.editor}>
        <ConnectionStoreContext.Provider value={stores.connection}>
          <ModelsStoreContext.Provider value={stores.models}>
            <JobsStoreContext.Provider value={stores.jobs}>
              <HistoryStoreContext.Provider value={stores.history}>
                <McpCatalogStoreContext.Provider value={stores.mcpCatalog}>
                  {children}
                </McpCatalogStoreContext.Provider>
              </HistoryStoreContext.Provider>
            </JobsStoreContext.Provider>
          </ModelsStoreContext.Provider>
        </ConnectionStoreContext.Provider>
      </EditorStoreContext.Provider>
    </StoresClientContext.Provider>
  );
};
StoresProvider.displayName = 'StoresProvider';
