// Root layout — provider stack for the entire app shell. Wrapper order is
// load-bearing (see app-shell-navigation/design.md §6):
//
//   GestureHandlerRootView   — required by react-native-gesture-handler;
//   SafeAreaProvider         — provides safe-area insets to every screen;
//   ThemeProvider            — landed in design-system-foundation;
//   StoresProvider (outer)   — mounted with `client={null}` and a fixed
//                              `preinstantiated` set of stores so the
//                              SDK gate below can READ the connection
//                              store via the standard `useConnectionStore`
//                              hook;
//   SdkClientGate            — reads the connection store, instantiates
//                              a `DiffuseCraftClient` over HTTP, and
//                              re-publishes the result through a nested
//                              `StoresProvider` that reuses the SAME
//                              store instances (`preinstantiated`) so
//                              the inner provider only re-runs the
//                              client-attach + event-subscribe wiring;
//   <Slot />                 — expo-router renders the active route here;
//   PortalHost               — mount point for every overlay primitive;
//   ToastProvider            — sonner-native Toaster.
//
// Why the sandwich: `useDiffuseCraftClient` needs to read the
// connection store (so it knows which backend to dial), and the result
// has to flow back into `<StoresProvider client={...}>` so editor /
// jobs / models / history are wired to the SDK. The two providers
// share their store set via `preinstantiated`, so pairing on the inner
// provider mutates the outer provider's view of state automatically —
// it's the same zustand store instance behind both contexts. The outer
// provider's `client={null}` short-circuits its own attach effect, so
// only the inner provider drives the SDK fan-out.
//
// expo-router handles linking automatically via the `scheme` declared in
// app.config.ts. No NavigationContainer / linking config / persistence
// modules needed — they're owned by expo-router internals now.

import 'react-native-gesture-handler';
import '../global.css';

import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Slot } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';

import {
  createEditorStore,
  createHistoryStore,
  createJobsStore,
  createMcpCatalogStore,
  createModelsStore,
  registerUndoToastAdapter,
  StoresProvider,
  type PreinstantiatedStores,
} from '@diffusecraft/core';
import { ThemeProvider, ToastProvider, toast } from '@diffusecraft/ui';

import { useDiffuseCraftClient } from '../src/sdk/useDiffuseCraftClient';
import { connectionStoreSingleton } from '../src/state/connectionStore.stub';

// Wire the undo/redo toast adapter once at app boot so `useUndoRedo`
// (libs/core) can surface the 1.5 s confirmation banner without core
// taking a hard dep on `@diffusecraft/ui` (FR-31, undo-redo-system §H).
registerUndoToastAdapter((message, options) => {
  toast.info(message, options);
});

/**
 * Inner gate — runs inside the outer `StoresProvider` so it can read
 * the connection store via `useDiffuseCraftClient`. The hook returns a
 * post-handshake `DiffuseCraftClientLike` (or `null` while the user
 * has no active backend). The gate re-publishes that result through a
 * nested `StoresProvider` that reuses the SAME store instances as the
 * outer mount — the inner provider only re-runs the client-attach +
 * event-subscribe wiring, which is exactly what we want when a paired
 * backend is selected for the first time.
 */
function SdkClientGate({ stores }: { stores: PreinstantiatedStores }) {
  const client = useDiffuseCraftClient();
  return (
    <StoresProvider client={client} preinstantiated={stores}>
      <Slot />
      <PortalHost />
      <ToastProvider />
      <StatusBar style="light" />
    </StoresProvider>
  );
}

export default function RootLayout() {
  // Construct the store set ONCE per root mount (P21 / FR-6). Both
  // providers share this set via `preinstantiated`, so pairing flows
  // mutate a single zustand store instance behind every consumer.
  //
  // For v0.1 the connection store uses its bundled in-memory
  // secure-token adapter — tokens are forgotten on app restart, but
  // Manual paste re-creates them. AsyncStorage / expo-secure-store
  // adapters wire in via `connectionOptions` / `modelsOptions` in a
  // later pass once the native config-plugin work lands; the seam is
  // already there on `StoresProvider`.
  const stores = useMemo<PreinstantiatedStores>(
    () => ({
      editor: createEditorStore(),
      // Reuse the singleton from connectionStore.stub so the router
      // (app/index.tsx) and Settings observe the SAME state that
      // useDiffuseCraftClient + StoresProvider write to. Without this,
      // Manual pairing writes here while the router keeps reading a
      // separate stub instance and never advances past /pair.
      connection: connectionStoreSingleton,
      models: createModelsStore(),
      jobs: createJobsStore(),
      history: createHistoryStore(),
      mcpCatalog: createMcpCatalogStore(),
    }),
    [],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StoresProvider client={null} preinstantiated={stores}>
            <SdkClientGate stores={stores} />
          </StoresProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
