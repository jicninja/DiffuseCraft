/**
 * Connection store factory.
 *
 * Owns paired backends, current connection, status, and discovered backends.
 * Persists ONLY `pairedBackends` and `currentBackendId` (FR-7). Tokens live
 * in the secure store (FR-9, FR-18).
 *
 * Per P21, this is a factory function: each call returns a fresh store.
 */
import { createStore, type StoreApi } from 'zustand';

import { buildPersistOptions, persist, type AsyncKvStorage } from '../shared/persist-config';
import {
  createMemorySecureTokenAdapter,
  tokenKey,
  type SecureTokenAdapter,
} from './secure-token';
import type {
  ConnectionError,
  ConnectionState,
  ConnectionStatus,
  NewPairedBackend,
  PairedBackend,
  PairedServerSummary,
  PersistedConnectionState,
  RouterConnectionStatus,
} from './types';

export type ConnectionStore = StoreApi<ConnectionState>;

export interface ConnectionStoreOptions {
  /**
   * Storage adapter for the persisted slice. Apps pass AsyncStorage; tests
   * pass an in-memory adapter. If omitted, the store is non-persistent.
   */
  storage?: AsyncKvStorage;
  /**
   * Secure token adapter. Apps pass `expo-secure-store`; tests pass the
   * in-memory adapter. Defaults to in-memory so the store always has a
   * working backend even if the app forgot to wire one.
   */
  secureTokens?: SecureTokenAdapter;
  /**
   * Override the persisted-slice name. Used by tests that want isolated
   * storage per case.
   */
  persistKey?: string;
}

const SAMPLE_PAIRED: PairedServerSummary[] = [
  { id: 'imac-de-igna', name: 'iMac de Igna' },
  { id: 'studio-pc', name: 'Studio PC' },
];

interface DebugCycleStep {
  status: RouterConnectionStatus;
  pairedServers: PairedServerSummary[];
  activeServerId: string | null;
}

const DEBUG_CYCLE: ReadonlyArray<DebugCycleStep> = [
  { status: 'no-paired', pairedServers: [], activeServerId: null },
  { status: 'paired-no-active', pairedServers: SAMPLE_PAIRED, activeServerId: null },
  { status: 'connected', pairedServers: SAMPLE_PAIRED, activeServerId: 'imac-de-igna' },
];

/**
 * Derive the coarse router status used by `apps/mobile`'s root router from
 * the rich connection state.
 */
function deriveRouterStatus(s: {
  pairedBackends: ReadonlyArray<PairedBackend>;
  currentBackendId: string | null;
  connectionStatus: ConnectionStatus;
}): RouterConnectionStatus {
  if (s.pairedBackends.length === 0) return 'no-paired';
  if (s.currentBackendId !== null && s.connectionStatus === 'connected') return 'connected';
  return 'paired-no-active';
}

function deriveSummaries(
  pairedBackends: ReadonlyArray<PairedBackend>,
): ReadonlyArray<PairedServerSummary> {
  return pairedBackends.map((b) => ({ id: b.id, name: b.name }));
}

export function createConnectionStore(
  options: ConnectionStoreOptions = {},
): ConnectionStore {
  const secureTokens = options.secureTokens ?? createMemorySecureTokenAdapter();
  const persistKey = options.persistKey ?? 'connection';

  const initializer = (
    set: StoreApi<ConnectionState>['setState'],
    get: StoreApi<ConnectionState>['getState'],
  ): ConnectionState => {
    const recompute = (): void => {
      const s = get();
      set({
        routerStatus: deriveRouterStatus(s),
        pairedSummaries: deriveSummaries(s.pairedBackends),
      });
    };

    return {
      pairedBackends: [],
      currentBackendId: null,

      connectionStatus: 'disconnected',
      lastError: null,
      discoveredBackends: [],

      routerStatus: 'no-paired',
      pairedSummaries: [],

      pairBackend: async (backend: NewPairedBackend, rawToken: string) => {
        await secureTokens.setItemAsync(tokenKey(backend.id), rawToken);
        const next: PairedBackend = {
          id: backend.id,
          name: backend.name,
          origin: backend.origin,
          lastConnectedAt: null,
        };
        const existing = get().pairedBackends.filter((b) => b.id !== backend.id);
        set({ pairedBackends: [...existing, next] });
        recompute();
      },

      removeBackend: async (id: string) => {
        await secureTokens.deleteItemAsync(tokenKey(id));
        const filtered = get().pairedBackends.filter((b) => b.id !== id);
        const wasCurrent = get().currentBackendId === id;
        set({
          pairedBackends: filtered,
          currentBackendId: wasCurrent ? null : get().currentBackendId,
        });
        recompute();
      },

      setCurrentBackend: (id: string | null) => {
        set({ currentBackendId: id });
        recompute();
      },

      setDiscoveredBackends: (list) => {
        set({ discoveredBackends: [...list] });
      },

      setConnectionStatus: (status, error?: ConnectionError | null) => {
        set({
          connectionStatus: status,
          lastError: error ?? (status === 'error' ? get().lastError : null),
        });
        recompute();
      },

      getToken: async (backendId) => {
        return secureTokens.getItemAsync(tokenKey(backendId));
      },

      // ---- legacy debug bridge ----
      __debugSetStatus: (status: RouterConnectionStatus) => {
        const step = DEBUG_CYCLE.find((c) => c.status === status);
        if (!step) {
          set({ routerStatus: status });
          return;
        }
        const paired: PairedBackend[] = step.pairedServers.map((p) => ({
          id: p.id,
          name: p.name,
          origin: 'manual',
          lastConnectedAt: null,
        }));
        set({
          pairedBackends: paired,
          currentBackendId: step.activeServerId,
          connectionStatus: step.status === 'connected' ? 'connected' : 'disconnected',
        });
        recompute();
      },

      __debugSetServers: (servers) => {
        const paired: PairedBackend[] = servers.map((p) => ({
          id: p.id,
          name: p.name,
          origin: 'manual',
          lastConnectedAt: null,
        }));
        set({ pairedBackends: paired });
        recompute();
      },

      __debugCycle: () => {
        const current = get().routerStatus;
        const idx = DEBUG_CYCLE.findIndex((c) => c.status === current);
        const nextIdx = idx === -1 ? 0 : (idx + 1) % DEBUG_CYCLE.length;
        const step = DEBUG_CYCLE[nextIdx]!;
        const paired: PairedBackend[] = step.pairedServers.map((p) => ({
          id: p.id,
          name: p.name,
          origin: 'manual',
          lastConnectedAt: null,
        }));
        set({
          pairedBackends: paired,
          currentBackendId: step.activeServerId,
          connectionStatus: step.status === 'connected' ? 'connected' : 'disconnected',
        });
        recompute();
      },
    };
  };

  if (!options.storage) {
    return createStore<ConnectionState>()(initializer);
  }

  const persistOptions = buildPersistOptions<ConnectionState, PersistedConnectionState>({
    name: persistKey,
    partialize: (s) => ({
      pairedBackends: s.pairedBackends,
      currentBackendId: s.currentBackendId,
    }),
    storage: options.storage,
  });

  return createStore<ConnectionState>()(persist(initializer, persistOptions));
}

export type { ConnectionState } from './types';
