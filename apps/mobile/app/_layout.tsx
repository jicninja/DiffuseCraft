// Root layout — provider stack for the entire app shell. Wrapper order is
// load-bearing (see app-shell-navigation/design.md §6):
//
//   GestureHandlerRootView   — required by react-native-gesture-handler;
//   SafeAreaProvider         — provides safe-area insets to every screen;
//   ThemeProvider            — landed in design-system-foundation;
//   <Slot />                 — expo-router renders the active route here;
//   PortalHost               — mount point for every overlay primitive;
//   ToastProvider            — sonner-native Toaster.
//
// expo-router handles linking automatically via the `scheme` declared in
// app.config.ts. No NavigationContainer / linking config / persistence
// modules needed — they're owned by expo-router internals now.

import 'react-native-gesture-handler';
import '../global.css';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Slot } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';

import { registerUndoToastAdapter, StoresProvider } from '@diffusecraft/core';
import { ThemeProvider, ToastProvider, toast } from '@diffusecraft/ui';

// Wire the undo/redo toast adapter once at app boot so `useUndoRedo`
// (libs/core) can surface the 1.5 s confirmation banner without core
// taking a hard dep on `@diffusecraft/ui` (FR-31, undo-redo-system §H).
registerUndoToastAdapter((message, options) => {
  toast.info(message, options);
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StoresProvider client={null}>
            <Slot />
            <PortalHost />
            <ToastProvider />
            <StatusBar style="light" />
          </StoresProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
