# app-shell-navigation — Design

> **Addendum v0.2 (2026-05-03):** Migrated from `@react-navigation/native` + `@react-navigation/native-stack` to `expo-router` file-based routing per user request. Concepts preserved (16 production routes + 2 debug routes, conditional root via connectionStore). Changes: `apps/mobile/src/navigation/` deleted; routing now driven by the file structure under `apps/mobile/app/` (root `_layout.tsx`, group `_layout.tsx` files for `pair/`, `settings/`, `__debug/`, plus the `index.tsx` redirect chain replacing `RootRouter.tsx`). `linking.ts` and `persistence.ts` are gone — `expo-router` handles deep links via the `scheme` in `app.config.ts` and persists state internally. The `chat` flag for the Editor route is now a query param (`?chat=true`) instead of a `/chat` path suffix; deep link `diffusecraft://editor/{id}?chat=true` replaces `diffusecraft://editor/{id}/chat`. Tables below describe the historical react-navigation design and are kept for context; the running implementation matches the addendum.
>
> **Status:** Draft v0.1.
> **Companion to:** `requirements.md`.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + `tailwind.config.js` + `darkTheme`); `ui-component-library` (Button, Card, Separator, Label primitives + `ToastProvider` + `<PortalProvider>` + `GestureHandlerRootView` mount expectations from §9 / acceptance).
> **References:** `.kiro/steering/tech.md` §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout"; `.kiro/specs/workspaces/` (Workspace = editor-internal mode, NOT a route); `.kiro/specs/pairing-protocol/`; `.kiro/specs/ui-component-library/design.md` §9 (cross-spec mount coordination); `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers"; `_ui-implementation-roadmap.md` row 3.

## 1. Module layout

Exact file paths created or touched by this spec, mapped to the monorepo structure declared in `structure.md`:

| Path | Role | Owned by |
|---|---|---|
| `apps/mobile/src/navigation/types.ts` | Typed route params: `RootStackParamList`, `AuthStackParamList`, `PairingFlowParamList`, `SettingsStackParamList` + module augmentation extending `@react-navigation/native`'s `RootParamList`. | This spec |
| `apps/mobile/src/navigation/RootStack.tsx` | Native stack: `ServerPicker`, `Documents`, `Editor`, `SettingsStack` (nested). | This spec |
| `apps/mobile/src/navigation/AuthStack.tsx` | Native stack: `Splash`, `PairingFlow` (nested). | This spec |
| `apps/mobile/src/navigation/PairingFlow.tsx` | Native stack nested inside `AuthStack`: `Pairing.MDNS` (initial), `Pairing.QR`, `Pairing.Code`, `Pairing.Manual`. | This spec |
| `apps/mobile/src/navigation/SettingsStack.tsx` | Native stack nested inside `RootStack`: `Settings.Index` (initial) + 7 detail routes. | This spec |
| `apps/mobile/src/navigation/RootRouter.tsx` | Conditional-root component: subscribes to `connectionStore`, renders `<AuthStack>` or `<RootStack>`. | This spec |
| `apps/mobile/src/navigation/linking.ts` | Deep-link config: scheme `diffusecraft`, full screens map, custom `parse`/`stringify` for `documentId`. | This spec |
| `apps/mobile/src/navigation/persistence.ts` | `getInitialState` / `onStateChange` AsyncStorage persistence with versioned key + connection-state guard. | This spec |
| `apps/mobile/src/navigation/README.md` | Per-route table: route name → param contract → deep-link pattern → source artboard. Operator's quick reference. | This spec |
| `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` | Vitest test asserting every registered screen has a deep-link entry and vice-versa. | This spec |
| `apps/mobile/src/screens/_shared/Placeholder.tsx` | Shared placeholder body used by every screen file. | This spec |
| `apps/mobile/src/screens/Splash.tsx` | `01-Splash` placeholder. | This spec |
| `apps/mobile/src/screens/Pairing.MDNS.tsx` | `02-Pairing-mDNS` placeholder. | This spec |
| `apps/mobile/src/screens/Pairing.QR.tsx` | `02b-Pairing-QR` placeholder. | This spec |
| `apps/mobile/src/screens/Pairing.Code.tsx` | `02c-Pairing-Code` placeholder. | This spec |
| `apps/mobile/src/screens/Pairing.Manual.tsx` | `02d-Pairing-Manual` placeholder. | This spec |
| `apps/mobile/src/screens/ServerPicker.tsx` | `03-ServerPicker` placeholder. | This spec |
| `apps/mobile/src/screens/Documents.tsx` | `04-Documents` placeholder. | This spec |
| `apps/mobile/src/screens/Editor.tsx` | `05-Editor-*` placeholder (single route; workspace + chat are local state). | This spec |
| `apps/mobile/src/screens/Settings.Index.tsx` | `06-Settings` master placeholder; renders About in detail by default. | This spec |
| `apps/mobile/src/screens/Settings.Connection.tsx` | `06a-Settings-Connection` placeholder. | This spec |
| `apps/mobile/src/screens/Settings.Models.tsx` | Detail placeholder (no `.pen` artboard yet). | This spec |
| `apps/mobile/src/screens/Settings.Agents.tsx` | Detail placeholder. | This spec |
| `apps/mobile/src/screens/Settings.Speech.tsx` | Detail placeholder. | This spec |
| `apps/mobile/src/screens/Settings.Appearance.tsx` | Detail placeholder. | This spec |
| `apps/mobile/src/screens/Settings.AuditLog.tsx` | Detail placeholder. | This spec |
| `apps/mobile/src/screens/Settings.About.tsx` | Detail placeholder hosting the debug-toggle Card (FR-20). | This spec |
| `apps/mobile/src/screens/index.ts` | Barrel exporting every screen. | This spec |
| `apps/mobile/App.tsx` | **Rewritten**: full root composition replacing the stub from `design-system-foundation`. | This spec |
| `apps/mobile/src/state/connectionStore.stub.ts` | Zustand factory matching the future `client-state-architecture` shape (see §5). Marked `// TODO(client-state-architecture): replace with real store`. | This spec |

### 1.1 Directory shape after this spec lands

```
apps/mobile/
├── App.tsx                                    # REWRITTEN
└── src/
    ├── navigation/                            # NEW
    │   ├── types.ts
    │   ├── RootRouter.tsx
    │   ├── RootStack.tsx
    │   ├── AuthStack.tsx
    │   ├── PairingFlow.tsx
    │   ├── SettingsStack.tsx
    │   ├── linking.ts
    │   ├── persistence.ts
    │   ├── README.md
    │   └── __tests__/
    │       └── routesCoverage.test.ts
    ├── screens/                               # mostly NEW (Swatch from foundation may stay behind __DEV__)
    │   ├── _shared/
    │   │   └── Placeholder.tsx
    │   ├── Splash.tsx
    │   ├── Pairing.MDNS.tsx
    │   ├── Pairing.QR.tsx
    │   ├── Pairing.Code.tsx
    │   ├── Pairing.Manual.tsx
    │   ├── ServerPicker.tsx
    │   ├── Documents.tsx
    │   ├── Editor.tsx
    │   ├── Settings.Index.tsx
    │   ├── Settings.Connection.tsx
    │   ├── Settings.Models.tsx
    │   ├── Settings.Agents.tsx
    │   ├── Settings.Speech.tsx
    │   ├── Settings.Appearance.tsx
    │   ├── Settings.AuditLog.tsx
    │   ├── Settings.About.tsx
    │   └── index.ts
    └── state/                                 # NEW
        └── connectionStore.stub.ts
```

### 1.2 `apps/mobile/package.json` peerDependencies / dependencies

This spec adds (or confirms) these runtime dependencies in `apps/mobile/package.json` (the app is the version-pinning point per `ui-component-library` design §1.1):

- `@react-navigation/native` (latest v7+)
- `@react-navigation/native-stack`
- `react-native-screens`
- `react-native-safe-area-context`
- `@react-native-async-storage/async-storage`
- `zustand` (for the `connectionStore.stub`; will be reused by `client-state-architecture`)

`react-native-gesture-handler` and `@gorhom/bottom-sheet` are already pinned by `ui-component-library`. `expo-linking` is pulled in to register the URI scheme; Expo's app config (`app.config.ts`) is extended with the `scheme: 'diffusecraft'` entry.

## 2. Stack diagram

The four navigators and the conditional root, with each navigator's screens enumerated. The conditional root chooses ONE branch on render based on `connectionStore.status`.

```
                          App.tsx (root composition)
                                  │
                  GestureHandlerRootView
                                  │
                          ThemeProvider
                                  │
                          PortalProvider
                                  │
                          ToastProvider
                                  │
                       NavigationContainer  (linking + persistence)
                                  │
                            RootRouter
                                  │
                ┌─────────────────┴─────────────────┐
        status: 'unknown'                    status: 'connected'
        status: 'no-paired'                  status: 'paired-no-active'
                │                                    │
            AuthStack                            RootStack
        ┌───────┴────────┐               ┌──────────┼──────────────┐
        │                │               │          │              │
      Splash       PairingFlow      ServerPicker  Documents      Editor      SettingsStack
                        │           (conditional initial)                          │
            ┌──────┬────┴───┬────────┐                                  ┌──────────┴──────────┐
            │      │        │        │                                  │ master  │  details  │
       Pairing.  Pairing. Pairing. Pairing.                       Settings.Index  │  ×7        │
        MDNS      QR       Code    Manual                                          │
        (init)                                                  Settings.Connection
                                                                Settings.Models
                                                                Settings.Agents
                                                                Settings.Speech
                                                                Settings.Appearance
                                                                Settings.AuditLog
                                                                Settings.About
```

The conditional-root truth table (per requirements §3.1 / FR-1):

| `status` | `pairedServers.length` | `activeServerId` | Renders | Initial route |
|---|---|---|---|---|
| `unknown` | any | any | `AuthStack` | `Splash` |
| `no-paired` | `0` | `null` | `AuthStack` | `PairingFlow > Pairing.MDNS` |
| `paired-no-active` | `>= 1` | `null` | `RootStack` | `ServerPicker` |
| `connected` | `>= 1` | non-null | `RootStack` | `Documents` |

Inside `RootStack`, `ServerPicker` is rendered as the initial route ONLY in the `paired-no-active` state; in the `connected` state it is registered but not the initial entry (it remains reachable from `Settings → Connection → Switch server` post-v1; for v1 it is only on the back stack when entered via a deep link).

## 3. Route param contract

Typed in `apps/mobile/src/navigation/types.ts`:

```typescript
// Top-level Auth stack
export type AuthStackParamList = {
  Splash: undefined;
  PairingFlow: NavigatorScreenParams<PairingFlowParamList> | undefined;
};

// Pairing flow (nested in Auth)
export type PairingFlowParamList = {
  'Pairing.MDNS': undefined;
  'Pairing.QR': undefined;
  'Pairing.Code': undefined;
  'Pairing.Manual': undefined;
};

// Top-level Root stack
export type RootStackParamList = {
  ServerPicker: undefined;
  Documents: undefined;
  Editor: {
    documentId: string;
    workspace?: 'generate' | 'inpaint' | 'upscale' | 'live';
    chat?: boolean;
  };
  SettingsStack: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

// Settings stack (nested in Root)
export type SettingsStackParamList = {
  'Settings.Index': undefined;
  'Settings.Connection': undefined;
  'Settings.Models': undefined;
  'Settings.Agents': undefined;
  'Settings.Speech': undefined;
  'Settings.Appearance': undefined;
  'Settings.AuditLog': undefined;
  'Settings.About': undefined;
};

// Module augmentation: makes useNavigation()/useRoute() globally typed.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList, AuthStackParamList,
      PairingFlowParamList, SettingsStackParamList {}
  }
}
```

Per-route notes:

| Route | Params | Source artboard | Outgoing edges |
|---|---|---|---|
| `Splash` | `undefined` | `01-Splash` | `replace('PairingFlow')`, `replace('ServerPicker')`, `replace('Documents')` (programmatic, after conditional-root decision) |
| `Pairing.MDNS` | `undefined` | `02-Pairing-mDNS` | `push('Pairing.QR')`, `push('Pairing.Code')`, `push('Pairing.Manual')` |
| `Pairing.QR` | `undefined` | `02b-Pairing-QR` | `goBack()`, `push('Pairing.Code')`, `push('Pairing.Manual')` |
| `Pairing.Code` | `undefined` | `02c-Pairing-Code` | `goBack()`, `push('Pairing.QR')` |
| `Pairing.Manual` | `undefined` | `02d-Pairing-Manual` | `goBack()` |
| `ServerPicker` | `undefined` | `03-ServerPicker` | `navigate('Documents')`, `navigate('SettingsStack')` |
| `Documents` | `undefined` | `04-Documents` | `navigate('Editor', { documentId })`, `navigate('SettingsStack')` |
| `Editor` | `{ documentId; workspace?; chat? }` | `05-*` family | `goBack()` (back to Documents) |
| `Settings.Index` | `undefined` | `06-Settings` master | `navigate('Settings.<Section>')` |
| `Settings.Connection` | `undefined` | `06a-Settings-Connection` | `goBack()` |
| `Settings.Models` | `undefined` | (placeholder) | `goBack()` |
| `Settings.Agents` | `undefined` | (placeholder) | `goBack()` |
| `Settings.Speech` | `undefined` | (placeholder) | `goBack()` |
| `Settings.Appearance` | `undefined` | (placeholder) | `goBack()` |
| `Settings.AuditLog` | `undefined` | (placeholder) | `goBack()` |
| `Settings.About` | `undefined` | rendered as detail of `06-Settings` per `.pen` | hosts the debug-toggle Card (FR-20) |

`Editor` is the only route with required params. `documentId` cannot be empty; `linking.ts` rejects empty strings (NFR-7). `workspace` defaults to `'generate'`; `chat` defaults to `false`. Both are hydration-only — see §9.

## 4. Deep-link map

`apps/mobile/src/navigation/linking.ts` exports a `LinkingOptions<RootParamList>` object. Scheme: `diffusecraft://` (registered in `app.config.ts` via `scheme: 'diffusecraft'`).

The full table:

| URI pattern | Route path | Params extracted | Notes |
|---|---|---|---|
| `diffusecraft://splash` | `AuthStack > Splash` | — | Debug only. |
| `diffusecraft://pair` | `AuthStack > PairingFlow > Pairing.MDNS` | — | Default pairing entry. |
| `diffusecraft://pair/qr` | `AuthStack > PairingFlow > Pairing.QR` | — | |
| `diffusecraft://pair/code` | `AuthStack > PairingFlow > Pairing.Code` | — | |
| `diffusecraft://pair/manual` | `AuthStack > PairingFlow > Pairing.Manual` | — | |
| `diffusecraft://servers` | `RootStack > ServerPicker` | — | Conditional-root re-routes to AuthStack if `pairedServers.length === 0`. |
| `diffusecraft://documents` | `RootStack > Documents` | — | |
| `diffusecraft://editor/:documentId` | `RootStack > Editor` | `{ documentId }` | |
| `diffusecraft://editor/:documentId?workspace=…` | `RootStack > Editor` | `{ documentId, workspace }` | `workspace ∈ generate \| inpaint \| upscale \| live` |
| `diffusecraft://editor/:documentId/chat` | `RootStack > Editor` | `{ documentId, chat: true }` | `chat=true` is the result of the `/chat` path suffix; `chat=true` is also added if `?chat=true` is provided as a query param (post-v1 nicety). |
| `diffusecraft://settings` | `RootStack > SettingsStack > Settings.Index` | — | Master + About-as-detail. |
| `diffusecraft://settings/connection` | `RootStack > SettingsStack > Settings.Connection` | — | |
| `diffusecraft://settings/models` | `… > Settings.Models` | — | |
| `diffusecraft://settings/agents` | `… > Settings.Agents` | — | |
| `diffusecraft://settings/speech` | `… > Settings.Speech` | — | |
| `diffusecraft://settings/appearance` | `… > Settings.Appearance` | — | |
| `diffusecraft://settings/audit` | `… > Settings.AuditLog` | — | |
| `diffusecraft://settings/about` | `… > Settings.About` | — | |

Sketch of the linking config:

```typescript
// apps/mobile/src/navigation/linking.ts
import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { RootParamList } from './types';

export const linking: LinkingOptions<RootParamList> = {
  prefixes: [Linking.createURL('/'), 'diffusecraft://'],
  config: {
    screens: {
      // AuthStack
      Splash: 'splash',
      PairingFlow: {
        path: 'pair',
        screens: {
          'Pairing.MDNS': '',
          'Pairing.QR': 'qr',
          'Pairing.Code': 'code',
          'Pairing.Manual': 'manual',
        },
      },
      // RootStack
      ServerPicker: 'servers',
      Documents: 'documents',
      Editor: {
        path: 'editor/:documentId/:chatSuffix?',
        parse: {
          documentId: (s: string) => {
            if (!s || s.length === 0) throw new Error('empty documentId');
            return s;
          },
          chatSuffix: (s?: string) => (s === 'chat' ? true : false),
        },
        stringify: {
          chatSuffix: (v: unknown) => (v === true ? 'chat' : ''),
        },
      },
      SettingsStack: {
        path: 'settings',
        screens: {
          'Settings.Index': '',
          'Settings.Connection': 'connection',
          'Settings.Models': 'models',
          'Settings.Agents': 'agents',
          'Settings.Speech': 'speech',
          'Settings.Appearance': 'appearance',
          'Settings.AuditLog': 'audit',
          'Settings.About': 'about',
        },
      },
    },
  },
};
```

The `chat` boolean is parsed from a path suffix because nested `react-navigation` deep-link configs handle path segments cleanly; `workspace` is a plain query param (`?workspace=…`) parsed by react-navigation's default query-string parser.

Conditional-root re-routing (FR-13): `RootRouter` does not consume the linking parser directly. Instead, `<NavigationContainer linking={linking} />` parses the URL, and the resulting `initialState` is then evaluated by `RootRouter`. If the initial state targets a screen in the wrong stack (e.g., `Editor` while `connectionStore.status === 'no-paired'`), `RootRouter` discards the initial state and falls back to the natural entry (`Pairing.MDNS`). The dropped target is logged in `__DEV__`; a future enhancement (post-v1) records it in the stub for replay after pairing — this is open-question Q1 in §11.

## 5. Connection state stub

`apps/mobile/src/state/connectionStore.stub.ts` provides a Zustand factory matching the shape the future `client-state-architecture` spec is expected to expose. The stub is the **only** consumer of the state during chrome-only mode; when the real store lands, this file is deleted and `RootRouter.tsx` repoints its import.

### 5.1 Interface

```typescript
// apps/mobile/src/state/connectionStore.stub.ts
// TODO(client-state-architecture): replace with the real createConnectionStore() factory
// from @diffusecraft/core once that spec lands. The runtime contract below
// (status / pairedServers / activeServerId) MUST be preserved.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ConnectionStatus = 'unknown' | 'no-paired' | 'paired-no-active' | 'connected';

export interface PairedServerSummary {
  id: string;
  name: string;
}

export interface ConnectionState {
  status: ConnectionStatus;
  pairedServers: PairedServerSummary[];
  activeServerId: string | null;
}

export interface ConnectionStoreStub extends ConnectionState {
  // Debug-only mutators; removed when the real store lands.
  __debugSet: (next: Partial<ConnectionState>) => void;
  __debugCycle: () => void;
}

const SAMPLE_PAIRED: PairedServerSummary[] = [
  { id: 'imac-de-igna', name: 'iMac de Igna' },
  { id: 'studio-pc',    name: 'Studio PC'     },
];

const CYCLE: ConnectionState[] = [
  { status: 'no-paired',        pairedServers: [],            activeServerId: null },
  { status: 'paired-no-active', pairedServers: SAMPLE_PAIRED, activeServerId: null },
  { status: 'connected',        pairedServers: SAMPLE_PAIRED, activeServerId: 'imac-de-igna' },
];

export const useConnectionStoreStub = create<ConnectionStoreStub>()(
  persist(
    (set, get) => ({
      status: 'unknown',
      pairedServers: [],
      activeServerId: null,
      __debugSet: (next) => set(next),
      __debugCycle: () => {
        const idx = CYCLE.findIndex((c) => c.status === get().status);
        const nextIdx = (idx + 1) % CYCLE.length;
        set(CYCLE[nextIdx]!);
      },
    }),
    {
      name: 'diffusecraft.connectionStore.stub.v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Do not persist 'unknown' — it's a transient cold-start state.
      partialize: (s) => ({
        status: s.status === 'unknown' ? 'no-paired' : s.status,
        pairedServers: s.pairedServers,
        activeServerId: s.activeServerId,
      }),
    },
  ),
);

// Cold-start probe: if the persisted state is absent, transition unknown → no-paired
// after 300 ms so Splash is observable. If persisted state is present, the
// initial render already reads it; no probe needed.
export function bootConnectionStub() {
  const s = useConnectionStoreStub.getState();
  if (s.status === 'unknown') {
    setTimeout(() => {
      useConnectionStoreStub.setState({ status: 'no-paired' });
    }, 300);
  }
}
```

`RootRouter.tsx` calls `bootConnectionStub()` once on mount.

### 5.2 Why a stub, not a mock module

The future `client-state-architecture` spec owns the real factory. A stub matching its expected shape (rather than a `jest.mock`-style indirection) means:

- The conditional-root code is identical between stubbed and real modes.
- Replacing the file is a one-import swap.
- The stub is testable (a vitest test asserts `__debugCycle` walks through the four states).
- The shape is committed in code, not just in prose, so the future spec inherits a concrete contract to satisfy.

### 5.3 Integration with `Settings.About` debug toggle

Per FR-20, `Settings.About` renders a `__DEV__`-guarded `<Card>` with:
- A read-only label (`mono` type style) showing the current state.
- A `<Button variant="secondary">` labelled "Cycle stub state" calling `useConnectionStoreStub.getState().__debugCycle()`.

Cycling through `no-paired → paired-no-active → connected → no-paired` is enough to exercise every conditional-root branch. The `unknown` state is naturally observable on cold start (when AsyncStorage is empty); operators who want to re-observe Splash kill the app, clear AsyncStorage, and relaunch.

## 6. App root composition

`apps/mobile/App.tsx` rewrite (replaces the stub from `design-system-foundation` T5 entirely):

```typescript
// apps/mobile/App.tsx
import 'react-native-gesture-handler'; // side-effect; must be top of file
import './global.css';                  // NativeWind directives

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider, ToastProvider } from '@diffusecraft/ui';
import { PortalHost } from '@rn-primitives/portal'; // re-exported by @diffusecraft/ui if convenient
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';

import { RootRouter } from './src/navigation/RootRouter';
import { linking } from './src/navigation/linking';
import {
  loadInitialNavigationState,
  saveNavigationState,
} from './src/navigation/persistence';
import { bootConnectionStub } from './src/state/connectionStore.stub';

function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialState, setInitialState] = useState<unknown | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    bootConnectionStub();
    loadInitialNavigationState()
      .then((s) => { if (!cancelled) { setInitialState(s); setIsReady(true); } })
      .catch(() => { if (!cancelled) setIsReady(true); });
    return () => { cancelled = true; };
  }, []);

  if (!isReady) return null; // brief blank; native splash still showing

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <PortalHost>
          <ToastProvider>
            <NavigationContainer
              linking={linking}
              initialState={initialState as never}
              onStateChange={(state) => { void saveNavigationState(state); }}
            >
              <RootRouter />
            </NavigationContainer>
          </ToastProvider>
        </PortalHost>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
export default App;
```

Notes on the order:

1. `GestureHandlerRootView` is the outermost — required by `react-native-gesture-handler` for gestures to attach. Documented in `ui-component-library` design §9 as a cross-spec coordination concern.
2. `ThemeProvider` wraps everything below so `useTheme()` is available inside portal hosts and overlays.
3. `PortalHost` (from `@rn-primitives/portal`) is the mount point for every overlay primitive (Dialog, AlertDialog, Popover, Tooltip, Select, Combobox, ContextMenu, DropdownMenu, Sheet) — required per `ui-component-library` design §9.
4. `ToastProvider` mounts the `sonner-native` `<Toaster />` configured with token theming (per `ui-component-library` §7.2). It needs to be inside `PortalHost` so the toast surface lifts correctly.
5. `NavigationContainer` owns the navigation state, the linking parser, and persistence. It must wrap `RootRouter`.
6. `RootRouter` selects the active stack on every render based on `connectionStore`.

The placement of `ToastProvider` inside `PortalHost` may be revised if `sonner-native` ships its own portal — to be confirmed during implementation. Listed as Q4 in §11.

## 7. State persistence

`apps/mobile/src/navigation/persistence.ts`:

```typescript
// apps/mobile/src/navigation/persistence.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { useConnectionStoreStub } from '../state/connectionStore.stub';

const NAV_STATE_KEY = 'diffusecraft.navigation.state.v1';
const CONN_FINGERPRINT_KEY = 'diffusecraft.navigation.fingerprint.v1';

interface PersistedEnvelope {
  version: 1;
  navState: PartialState<NavigationState>;
  fingerprint: string; // hashes connectionStore at save time
}

function fingerprint(): string {
  const s = useConnectionStoreStub.getState();
  return `${s.status}|${s.pairedServers.length}|${s.activeServerId ?? '-'}`;
}

export async function loadInitialNavigationState() {
  try {
    const raw = await AsyncStorage.getItem(NAV_STATE_KEY);
    if (!raw) return undefined;
    const env = JSON.parse(raw) as PersistedEnvelope;
    if (env.version !== 1) return undefined;
    // Conditional-root guard: discard if connection state changed.
    if (env.fingerprint !== fingerprint()) return undefined;
    return env.navState;
  } catch {
    return undefined;
  }
}

export async function saveNavigationState(state: NavigationState | undefined) {
  if (!state) return;
  const env: PersistedEnvelope = {
    version: 1,
    navState: state,
    fingerprint: fingerprint(),
  };
  try {
    await AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify(env));
  } catch {
    // ignore write failures; persistence is best-effort
  }
}
```

**Versioning scheme.** The storage key includes a version discriminator (`v1`). When the navigation tree changes incompatibly (e.g., a stack is renamed, a route's params shape changes), bump the version: the new code reads `v2` and ignores any `v1` payload. Old payloads are not migrated — they are discarded.

**Fingerprint guard (FR-19).** The fingerprint is a coarse hash of the four state fields. If the fingerprint at save time differs from the fingerprint at load time, the persisted state is discarded; the conditional root's natural entry is used. This handles the "logout" scenario without modeling logout explicitly: if the operator cycles the stub from `connected` to `no-paired` between sessions, the next launch lands on `Pairing.MDNS` rather than the persisted `Editor`.

## 8. Placeholder screens

Every screen file is a thin wrapper over the shared `<Placeholder>` component. The placeholder lives at `apps/mobile/src/screens/_shared/Placeholder.tsx`:

```typescript
// apps/mobile/src/screens/_shared/Placeholder.tsx
import { ScrollView, View } from 'react-native';
import { Card, Button, Separator, Label } from '@diffusecraft/ui';
import type { ReactNode } from 'react';

export interface PlaceholderProps {
  routeName: string;          // e.g., 'Editor'
  label: string;              // e.g., '05-Editor-Generate'
  description?: string;       // one-line role from product.md / .pen brief
  detail?: ReactNode;         // free-form area; route-specific affordances (debug Card, params readout, intra-stack nav buttons)
  onBack?: () => void;        // wired to navigation.goBack() when present
  outgoing?: Array<{ label: string; onPress: () => void }>; // demo buttons exercising the screen's outgoing edges
}

export function Placeholder({
  routeName, label, description, detail, onBack, outgoing,
}: PlaceholderProps) {
  return (
    <ScrollView className="flex-1 bg-canvas">
      <View className="p-6 gap-4">
        <Card>
          <Label className="text-display-md text-primary">{routeName}</Label>
          <Label className="text-caption text-secondary">{label}</Label>
          {description && (
            <>
              <Separator />
              <Label className="text-body text-secondary">{description}</Label>
            </>
          )}
        </Card>

        {onBack && (
          <Button variant="secondary" onPress={onBack}>Back</Button>
        )}

        {outgoing && outgoing.length > 0 && (
          <Card>
            <Label className="text-body-strong text-primary">Outgoing edges</Label>
            <Separator />
            <View className="gap-2">
              {outgoing.map((edge) => (
                <Button key={edge.label} variant="primary" onPress={edge.onPress}>
                  {edge.label}
                </Button>
              ))}
            </View>
          </Card>
        )}

        {detail && <View className="gap-2">{detail}</View>}
      </View>
    </ScrollView>
  );
}
Placeholder.displayName = 'Placeholder';
```

Per-screen file shape (example — `Documents.tsx`):

```typescript
// apps/mobile/src/screens/Documents.tsx
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Placeholder } from './_shared/Placeholder';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Documents'>;

export function DocumentsScreen() {
  const nav = useNavigation<Nav>();
  return (
    <Placeholder
      routeName="Documents"
      label="04-Documents"
      description="Tablet gallery — replaced by screens-implementation."
      outgoing={[
        { label: 'Open sample document → Editor', onPress: () => nav.navigate('Editor', { documentId: 'sample-doc' }) },
        { label: 'Open Settings',                  onPress: () => nav.navigate('SettingsStack') },
      ]}
    />
  );
}
DocumentsScreen.displayName = 'DocumentsScreen';
```

Every other screen file follows the same shape: a typed `useNavigation`, a `<Placeholder>` body, an `outgoing` array exercising the screen's outgoing edges. `Splash.tsx` is the special case — it has no outgoing buttons; its `useEffect` triggers `RootRouter` to make the conditional-root decision and `replace`s.

The placeholder consumes only `Card`, `Button`, `Separator`, `Label` from `@diffusecraft/ui`. No raw hex (the existing `design-system-foundation` T7 lint rule enforces this; no exceptions added by this spec).

## 9. Editor screen — the special case

Per FR-9, `Editor` is a single route, not four. The `.pen` artboards `05-Editor-Generate`, `05b-Editor-Inpaint`, `05c-Editor-Live`, `05d-Editor-Chat-Open` are different **states** of the same screen, not separate routes. This decision is load-bearing and merits explicit defence:

### 9.1 Why a single route

1. **Workspace is an MCP-driven editor-internal mode**, not a navigation concept. The `workspaces` spec models it as an in-process state on the server (per-token, in-memory) and a UI tab on the client; there is nothing about "switching workspace" that benefits from a route boundary. Modeling it as a route would force unnecessary back-stack semantics ("did the user back-navigate from Inpaint to Generate, or did they tap a tab?") that the design does not want.
2. **Chat panel open/closed is a panel toggle**, not a route. The `.pen` `05d-Editor-Chat-Open` is the same screen with the right panel showing the Chat tab as active; it does not introduce new chrome or remove anything. Treating it as a route would split state across two routes that need to share the same canvas state and the same right-panel persistence.
3. **Deep-link hydration is enough.** The deep-link map (§4) lets agents and tests target a specific workspace + chat state via query params and a path suffix. Once the screen has hydrated, in-screen state takes over; there is no two-way binding back to the URL (changing the workspace tab does NOT push a new route or rewrite the URL).
4. **State persistence is simpler.** `react-navigation` persists route state, but the workspace tab and chat panel are local component state (eventually a Zustand slice owned by `editor-state` / `client-state-architecture`). They survive intra-app navigation via the store; they do not need to be encoded in route state.
5. **Editor variants visually share 95% of the chrome.** Splitting them into routes would force `screens-implementation` to either duplicate the chrome four times or extract a shared `<EditorChrome>` component anyway — the latter is what we want, achieved more cleanly with a single route.

### 9.2 In-screen state shape

For this spec (placeholder body), `Editor.tsx` keeps it simple:

```typescript
// apps/mobile/src/screens/Editor.tsx
import { useEffect, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Card, Label } from '@diffusecraft/ui';
import { Placeholder } from './_shared/Placeholder';
import type { RootStackParamList } from '../navigation/types';

type WorkspaceTab = 'generate' | 'inpaint' | 'upscale' | 'live';

export function EditorScreen() {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const { documentId, workspace = 'generate', chat = false } = route.params;

  // Hydration-only: route params seed local state ONCE.
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(workspace);
  const [chatPanelOpen, setChatPanelOpen] = useState<boolean>(chat);

  useEffect(() => {
    // intentionally NOT syncing back to route params — see §9.1 point (3).
  }, []);

  return (
    <Placeholder
      routeName="Editor"
      label={`05-Editor-${workspaceTab}${chatPanelOpen ? ' (chat open)' : ''}`}
      description={`Document: ${documentId}. Workspace: ${workspaceTab}. Chat: ${chatPanelOpen ? 'open' : 'closed'}.`}
      onBack={() => nav.goBack()}
      detail={
        <Card>
          <Label className="text-body-strong text-primary">Workspace tabs (placeholder)</Label>
          {(['generate','inpaint','upscale','live'] as const).map((w) => (
            <Label key={w}
              onPress={() => setWorkspaceTab(w)}
              className={w === workspaceTab ? 'text-primary text-body-strong' : 'text-secondary text-body'}>
              {w}
            </Label>
          ))}
          <Label className="text-body-strong text-primary mt-3">Chat panel toggle</Label>
          <Label
            onPress={() => setChatPanelOpen((v) => !v)}
            className="text-body text-secondary"
          >
            {chatPanelOpen ? 'Close chat' : 'Open chat'}
          </Label>
        </Card>
      }
    />
  );
}
EditorScreen.displayName = 'EditorScreen';
```

`screens-implementation` replaces the body; the route shape and the param contract stay identical.

### 9.3 What this spec deliberately does NOT do

- Does NOT introduce four separate `Editor.Generate`, `Editor.Inpaint`, `Editor.Live`, `Editor.ChatOpen` routes.
- Does NOT introduce a `Tab.Navigator` for the workspace tabs.
- Does NOT couple the chat panel to a `Modal` route.
- Does NOT teach `react-navigation` about the workspace concept.

These are all explicit non-goals. Any future spec that argues for splitting Editor into multiple routes must first refute the five points in §9.1.

## 10. Validation strategy

| Check | Tool | Enforcement |
|---|---|---|
| Typed route names compile-time-checked | `tsc --noEmit` strict mode + the module augmentation in `types.ts` | CI |
| Every screen registered in any `Stack.Navigator` has a `linking.config.screens` entry, and every entry resolves to a registered screen | `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` (vitest) — imports `linking.config.screens`, walks the navigator trees, asserts the bijection | CI |
| Every required deep-link pattern resolves | Same test file: feeds `getStateFromPath` (`@react-navigation/core`) the URI patterns from §4 and asserts the resulting state targets the expected route + params | CI |
| `Editor` rejects empty `documentId` deep links | Same test file: `getStateFromPath('editor/')` throws or yields a fallback | CI |
| No imports from `@diffusecraft/diffusion-client`, `@diffusecraft/server`, `@diffusecraft/canvas-core`, `@diffusecraft/canvas-skia` in `apps/mobile/src/{navigation,screens}/` | `rg -n "from ['\"]@diffusecraft/(diffusion-client\|server\|canvas-core\|canvas-skia)" apps/mobile/src/{navigation,screens}` returns empty | CI step |
| No raw hex in placeholder / navigation files | Existing `design-system-foundation` T7 lint rule | CI |
| Cold-start to a placeholder screen renders without throwing | Vitest + RN Testing Library: render `<App />` with mocked AsyncStorage, assert one of the placeholder route names is in the tree | CI |
| Manual Maestro smoke (deferred) | A `tools/maestro/app-shell.yaml` flow visiting every route via deep link, capturing screenshots | DEFERRED to `screens-implementation` / `visual-verification` |

`routesCoverage.test.ts` is the central guard. It catches "added a stack screen but forgot the deep link" (the most likely defect when adding a new route post-v1) at CI time.

## 11. Open questions

### Q1 — Restoring a deep-link target after a forced pairing redirect

When a deep link to `RootStack` arrives while the conditional root is in `no-paired` state, FR-13 says to redirect to `Pairing.MDNS`. v1 drops the original target. Should v2:
- (a) Persist the target in `connectionStore` (or a separate `pendingDeepLink` slice) and replay it after pairing?
- (b) Surface a banner in `Pairing.MDNS` saying "After pairing, we'll open the file you tapped"?

**Recommendation.** Defer to a post-v1 spec (`deep-link-replay` or similar). v1's behaviour is acceptable because the chrome-only mode has no real "external link" surface to worry about.

### Q2 — Hash-style deep links for Settings sub-sections

`react-navigation`'s linking parser supports hash-style routes (`#section=connection`). Should `Settings.<Section>` use a hash so the master row stays visible in a way that does NOT push a new entry on the back stack?

**Recommendation.** No. The current path-based form (`/settings/connection`) is simpler and matches the master-detail mental model: tapping a row in the master list pushes a detail route on the back stack, and the back chevron pops it. The `.pen` design treats master/detail as a single screen visually but the navigation contract treats the detail as a route push so the back chevron in the top bar has a meaningful target.

### Q3 — AsyncStorage key versioning policy

The persistence file uses `v1` in the key. When does the version bump?

**Recommendation.** Bump on:
- Renaming any registered route name.
- Changing any route's params shape (TypeScript-breaking).
- Restructuring the navigator tree (e.g., promoting `SettingsStack` from a nested stack to a top-level navigator).

Don't bump on:
- Adding a new optional param.
- Adding a new route (the persisted state simply doesn't reference it; old states still load).

A shared constants file (`apps/mobile/src/navigation/persistence.ts`) hosts the version. Bumping is a one-liner.

### Q4 — `ToastProvider` placement relative to `PortalHost`

The current root composition mounts `ToastProvider` INSIDE `PortalHost`. `sonner-native` may ship its own portal internally, in which case nesting is harmless but redundant. Verify during implementation; if `sonner-native` is incompatible with being inside an `@rn-primitives/portal` host, move it outside.

**Status.** Open until implementation; defer to T8.

### Q5 — Should `PairingFlow` be a Modal stack (`presentation: 'modal'`) instead of a push stack?

**Recommendation.** No, push stack. The pairing flow is the only thing the user can do in `AuthStack` — modal presentation would imply a "dismiss" affordance that does not exist (there is no underlying screen). A native push stack with a back chevron in the top bar is the correct match.

### Q6 — Splash duration

v1 uses a fixed 300 ms stub delay (FR-16). The real connection probe (in `client-state-architecture`) may take 50–2000 ms. Should v1 cap the splash duration with a maximum?

**Recommendation.** Out of scope; the cap is a property of the real connection probe, not this spec. v1's 300 ms stub is observable but not annoying.

### Q7 — Are `Settings.Models`, `Settings.Agents`, `Settings.Speech`, `Settings.Appearance`, `Settings.AuditLog` worth shipping as routes when their `.pen` artboards do not exist yet?

**Recommendation.** Yes. The maintainability requirement (NFR-4) says adding a Settings sub-section is a 3-line change; pre-creating the routes (with placeholder bodies) means a future design spec only needs to land the chrome, not the routing. The five placeholder bodies are trivially small (`<Placeholder routeName="Settings.Models" label="(no .pen artboard yet)" />`) and cost almost nothing to maintain.
