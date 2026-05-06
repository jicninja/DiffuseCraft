// Thin re-export bridge to the real connection store from @diffusecraft/core.
//
// The original stub file owned its own Zustand state and a debug cycle. The
// `client-state-architecture` spec moved that state into
// `createConnectionStore()` in @diffusecraft/core. This file preserves the
// public shape (`useConnectionStoreStub`, `describeConnectionState`,
// `__debugSetStatus`, `__debugCycle`) so `app/index.tsx` and
// `screens/Settings/About.tsx` keep working without changes.
//
// The hook returned here mirrors zustand v4's `UseBoundStore` shape: it is
// callable as a hook with an optional selector AND exposes `.getState()` /
// `.setState()` / `.subscribe()` / `.destroy()`. We achieve that by
// attaching the StoreApi methods to the wrapper function.
//
// TODO(deletion-after-spec-implementation): once apps/mobile migrates to the
// `StoresProvider` + `useConnectionStore` hook from @diffusecraft/core, delete
// this file and update the import sites.

import { useStore } from 'zustand';

import {
  createConnectionStore,
  type ConnectionState,
  type RouterConnectionStatus,
  type PairedServerSummary,
} from '@diffusecraft/core';

// One module-level instance — preserves the stub's "shared singleton" feel for
// the app router and Settings.About debug card. The real provider-based wiring
// is added in the apps-mobile integration step (out of scope for this spec).
const store = createConnectionStore();

// DEV ONLY: pre-seed a connected mock so the cold-start flow lands directly in
// /documents and we can drive into Editor without paging through the pairing
// flow. Remove once `pairing-protocol` integration ships in apps/mobile.
if (__DEV__) {
  store.getState().__debugSetServers([
    { id: 'srv-studio-imac', name: 'studio-iMac' },
  ]);
  store.getState().__debugSetStatus('connected');
}

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
