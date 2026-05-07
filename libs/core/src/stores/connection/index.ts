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

/**
 * Synthetic URLs for the debug-cycle sample backends. The debug bridge is
 * exercised by hand (Settings.About debug card) and by visual-verification
 * flows; the URLs are placeholders that are never actually dialed because
 * the debug bridge skips token storage and connection setup.
 */
const SAMPLE_BACKEND_URLS: Record<string, string> = {
  'imac-de-igna': 'http://imac-de-igna.local:7821',
  'studio-pc': 'http://studio-pc.local:7821',
};

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

function debugSampleUrl(id: string): string {
  return SAMPLE_BACKEND_URLS[id] ?? `http://${id}.local:7821`;
}

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
          url: backend.url,
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
          url: debugSampleUrl(p.id),
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
          url: debugSampleUrl(p.id),
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
          url: debugSampleUrl(p.id),
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
    migrate: migrateConnectionPersistedState,
  });

  return createStore<ConnectionState>()(persist(initializer, persistOptions));
}

/**
 * Migrate persisted connection-store state forward across schema versions.
 *
 * v1 → v2: PairedBackend gained a required `url` field. v1 entries do
 * not carry a URL so the SDK cannot dial them; they are dropped to
 * force the user back through the pairing flow with a real, recorded
 * URL. Entries that already happen to carry `url` (cross-version test
 * fixtures, hand-edited persistence) are kept verbatim. The current
 * backend id is cleared if it pointed at a dropped entry so the
 * router does not advertise a phantom active connection.
 *
 * Returning `undefined` falls through to "discard persisted state" in
 * `buildPersistOptions`, which is the right move when the persisted
 * shape is from a future version we don't understand or when no v2+
 * entries survive the filter.
 */
function migrateConnectionPersistedState(
  persisted: unknown,
  fromVersion: number,
): PersistedConnectionState | undefined {
  if (persisted === null || typeof persisted !== 'object') return undefined;
  const candidate = persisted as Partial<PersistedConnectionState> & {
    pairedBackends?: unknown;
    currentBackendId?: unknown;
  };

  if (fromVersion === 1) {
    const rawList = Array.isArray(candidate.pairedBackends)
      ? candidate.pairedBackends
      : [];
    const survivors: PairedBackend[] = [];
    for (const entry of rawList) {
      if (entry === null || typeof entry !== 'object') continue;
      const e = entry as Partial<PairedBackend>;
      if (typeof e.id !== 'string' || e.id.length === 0) continue;
      if (typeof e.name !== 'string') continue;
      if (typeof e.url !== 'string' || e.url.length === 0) continue;
      const origin: PairedBackend['origin'] =
        e.origin === 'mdns' ||
        e.origin === 'qr' ||
        e.origin === 'code'
          ? e.origin
          : 'manual';
      survivors.push({
        id: e.id,
        name: e.name,
        origin,
        url: e.url,
        lastConnectedAt: typeof e.lastConnectedAt === 'string' ? e.lastConnectedAt : null,
      });
    }

    const rawCurrent =
      typeof candidate.currentBackendId === 'string' ? candidate.currentBackendId : null;
    const currentBackendId =
      rawCurrent !== null && survivors.some((b) => b.id === rawCurrent) ? rawCurrent : null;

    return { pairedBackends: survivors, currentBackendId };
  }

  // Unknown version — let buildPersistOptions discard.
  return undefined;
}

export type { ConnectionState } from './types';
