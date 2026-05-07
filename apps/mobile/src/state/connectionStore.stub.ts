// Thin re-export bridge to the real connection store from @diffusecraft/core.
//
// The legacy stub used to own its own Zustand state. It now shares the
// SAME zustand instance that `<StoresProvider>` mounts in `app/_layout.tsx`,
// so the router (`app/index.tsx`), Settings, the Debug deep link, and
// `useDiffuseCraftClient` all read and write a single source of truth.
//
// The exported `connectionStoreSingleton` is what `_layout.tsx` passes
// in `preinstantiated.connection` — that is what unifies both contexts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useStore } from 'zustand';

import {
  createConnectionStore,
  type ConnectionState,
  type RouterConnectionStatus,
  type PairedServerSummary,
} from '@diffusecraft/core';

// Persist `pairedBackends` + `currentBackendId` via AsyncStorage; tokens
// land in expo-secure-store (Keychain on iOS / Keystore on Android) so
// they never appear in plain-text persistence (FR-9 / FR-18).
//
// `expo-secure-store`'s top-level methods already match the
// `SecureTokenAdapter` shape (`setItemAsync` / `getItemAsync` /
// `deleteItemAsync`), so we pass the namespace through directly.
const store = createConnectionStore({
  storage: AsyncStorage,
  secureTokens: {
    setItemAsync: SecureStore.setItemAsync,
    getItemAsync: SecureStore.getItemAsync,
    deleteItemAsync: SecureStore.deleteItemAsync,
  },
});

/** The shared connection store. Pass to `<StoresProvider preinstantiated.connection>`. */
export const connectionStoreSingleton = store;

/** Status vocabulary expected by the existing chrome. */
export type ConnectionStatus =
  | 'unknown'
  | RouterConnectionStatus;

export type { PairedServerSummary };

/** Shape the existing chrome reads. */
export interface LegacyConnectionState {
  status: ConnectionStatus;
  pairedServers: ReadonlyArray<PairedServerSummary>;
  activeServerId: string | null;
}

export interface ConnectionStoreStub extends LegacyConnectionState {
  __debugSetStatus(status: ConnectionStatus): void;
  __debugSetServers(servers: ReadonlyArray<PairedServerSummary>): void;
  __debugCycle(): void;
}

function project(state: ConnectionState): ConnectionStoreStub {
  return {
    status: state.routerStatus,
    pairedServers: state.pairedSummaries,
    activeServerId: state.currentBackendId,
    __debugSetStatus: (status) => {
      // 'unknown' has no analogue in the real store; treat as no-op so the
      // pre-hydration cold-start case in apps/mobile/app/index.tsx still
      // renders Splash without forcing a state change.
      if (status === 'unknown') return;
      state.__debugSetStatus(status);
    },
    __debugSetServers: state.__debugSetServers,
    __debugCycle: state.__debugCycle,
  };
}

/**
 * Hook callable as `useConnectionStoreStub(selector?)`. With no selector the
 * full projected state is returned (mirrors zustand v4 default behavior).
 */
type StubHook = {
  <T>(selector: (state: ConnectionStoreStub) => T): T;
  (): ConnectionStoreStub;
  getState(): ConnectionStoreStub;
  subscribe(listener: (state: ConnectionStoreStub) => void): () => void;
};

const hook = (<T>(selector?: (state: ConnectionStoreStub) => T) => {
  // Subscribe to the full state and project to the legacy shape inside the
  // selector. `useStore` re-renders on shallow change of the selector output.
  return useStore(store, (s) => {
    const projected = project(s);
    return selector ? selector(projected) : (projected as unknown as T);
  });
}) as StubHook;

hook.getState = () => project(store.getState());
hook.subscribe = (listener) =>
  store.subscribe((s) => listener(project(s)));

export const useConnectionStoreStub = hook;

/**
 * Returns a one-line human-readable summary of the current store state.
 * Used by the debug Card in Settings.About to render the active branch.
 */
export function describeConnectionState(s: LegacyConnectionState): string {
  return `${s.status} · ${s.pairedServers.length} paired · active=${s.activeServerId ?? '-'}`;
}
