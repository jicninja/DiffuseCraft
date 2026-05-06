/**
 * React contexts for each store.
 *
 * One context per store (FR-5). Consumer hooks read from these contexts to
 * locate the store instance bound by the parent `StoresProvider`.
 *
 * The contexts default to `null`; consuming a store outside the provider is
 * a usage error and the hooks throw a descriptive error (FR-5, design §5).
 */
import { createContext } from 'react';

import type { EditorStore } from './editor';
import type { ConnectionStore } from './connection';
import type { ModelsStore } from './models';
import type { JobsStore } from './jobs';
import type { HistoryStore } from './history';
import type { McpCatalogStore } from './mcp-catalog';
import type { DiffuseCraftClientLike } from './shared/types';

export const EditorStoreContext = createContext<EditorStore | null>(null);
EditorStoreContext.displayName = 'EditorStoreContext';

export const ConnectionStoreContext = createContext<ConnectionStore | null>(null);
ConnectionStoreContext.displayName = 'ConnectionStoreContext';

export const ModelsStoreContext = createContext<ModelsStore | null>(null);
ModelsStoreContext.displayName = 'ModelsStoreContext';

export const JobsStoreContext = createContext<JobsStore | null>(null);
JobsStoreContext.displayName = 'JobsStoreContext';

export const HistoryStoreContext = createContext<HistoryStore | null>(null);
HistoryStoreContext.displayName = 'HistoryStoreContext';

export const McpCatalogStoreContext = createContext<McpCatalogStore | null>(null);
McpCatalogStoreContext.displayName = 'McpCatalogStoreContext';

/**
 * Client SDK handle exposed to consumers that need to invoke MCP tools
 * directly (e.g., the `useUndoRedo` hook). Defaults to `null` so
 * `useStoresClient()` returns `null` outside the provider rather than
 * throwing — call sites are expected to no-op gracefully.
 */
export const StoresClientContext = createContext<DiffuseCraftClientLike | null>(null);
StoresClientContext.displayName = 'StoresClientContext';
