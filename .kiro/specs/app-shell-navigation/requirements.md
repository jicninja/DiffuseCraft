# app-shell-navigation — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + `tailwind.config.js` + `darkTheme`); `ui-component-library` (the 25 primitives + `ToastProvider` + `<PortalProvider>` + `GestureHandlerRootView` mount expectations from §9 / acceptance of that spec).
> **References:** `.kiro/steering/tech.md` §"Stack at a glance" and §"Client UI: NativeWind + react-native-reusables"; `.kiro/steering/structure.md` §"Repository layout", §"Naming conventions"; `.kiro/steering/product.md` §"Glossary" (Workspace, Pairing, Chat panel); `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers" (the 13 artboard briefs); `_ui-implementation-roadmap.md` row 3; `.kiro/specs/workspaces/` (Workspace is an editor-internal mode, NOT a navigation route); `.kiro/specs/pairing-protocol/` (pairing methods MDNS / QR / Code / Manual); `.kiro/specs/ui-component-library/design.md` §9 (cross-spec coordination on `<GestureHandlerRootView>`, `<PortalProvider>`, `<ToastProvider>` mount); future spec `client-state-architecture` (owner of the real `connectionStore`).

## 1. Purpose

This spec lands the **navigation skeleton** of the DiffuseCraft tablet client (`apps/mobile`). After this spec is implemented, every one of the 13 artboards from the canonical `.pen` design exists as an empty placeholder screen reachable via `react-navigation` and via deep link, with **zero product logic** wired in. Pairing does not actually pair, the editor does not actually edit, settings does not actually configure anything; every screen renders a `<Placeholder>` identifying itself by route name and screen label, demonstrating intra-stack navigation only.

This spec replaces the stub `apps/mobile/App.tsx` from `design-system-foundation` (which mounts only `<ThemeProvider>` + `<Swatch>`) with the real root composition: `<GestureHandlerRootView>` → `<ThemeProvider>` → `<PortalProvider>` → `<ToastProvider>` → `<NavigationContainer>` → conditional root selecting between `AuthStack` and `RootStack` based on a stub `connectionStore`. The conditional root contract, deep-link map, route param contract, and state-persistence shape are frozen here; downstream `screens-implementation` fills the placeholders with real chrome from the `.pen` snapshot.

The real `connectionStore` is owned by the future `client-state-architecture` spec. This spec consumes a stub matching its expected interface so the conditional root can be exercised in chrome-only mode; a debug toggle in `Settings.About` cycles the stub between states (`no-paired`, `paired-one`, `paired-many-no-active`, `connected`) so every branch is reachable without real connection logic.

Real pairing handshakes, real ComfyUI connectivity, real document opening, real workspace tool catalog, real chat with paired agents, animation polish beyond `react-navigation` defaults, light theme, and phone fallback layout are all explicitly out of scope.

## 2. Stakeholders & user stories

### S1 — Screen author wiring a placeholder
> **Story 1.** As an `apps/mobile` developer assigned a screen for `screens-implementation` (e.g., `04-Documents`), I open `apps/mobile/src/screens/Documents.tsx`, see a `<Placeholder routeName="Documents" label="04-Documents" />` body and a few hardcoded buttons that demonstrate `navigation.navigate('Editor', { documentId: 'sample' })`, and replace the body with real artboard chrome. I do not need to register a new route — every route already exists.

### S2 — Designer auditing the conditional-root branching
> **Story 2.** As the design reviewer cross-checking the `.pen` artboards against runtime behaviour, I cold-launch the app in the simulator, see `01-Splash`, watch it auto-replace with `02-Pairing-mDNS` (because the stub `connectionStore` defaults to `no-paired`), open `Settings → About`, tap the debug toggle to flip the stub to `connected` + `paired-many-no-active`, kill and relaunch the app, and the cold start now lands me on `03-ServerPicker`. Every branch of the conditional root is observable without real backend.

### S3 — Agent / Maestro test driving the app via deep link
> **Story 3.** As an end-to-end test (Maestro flow or an internal smoke harness) deferred to `screens-implementation`, I send `diffusecraft://editor/sample-doc?workspace=inpaint` to the running Expo build and the app navigates directly to `Editor` with `documentId='sample-doc'` and the `Inpaint` workspace tab pre-selected. The chat panel is closed. Sending `diffusecraft://editor/sample-doc/chat` opens the same screen with the chat panel surfaced. No tap sequence required.

### S4 — Future maintainer adding a new Settings sub-section
> **Story 4.** As a maintainer adding a `Settings.Plugins` detail screen post-v1, I add one route name to `RootStackParamList` (or, more precisely, `SettingsStackParamList`), register one `<Stack.Screen>` in `SettingsStack.tsx`, add one entry in `linking.ts`, and add one row in the `Settings.Index` master list. Total change: under 10 lines spread across three files. No other screen file changes.

### S5 — Implementer of `client-state-architecture` swapping in the real `connectionStore`
> **Story 5.** As the engineer landing the real `connectionStore` in a later spec, I delete `apps/mobile/src/state/connectionStore.stub.ts`, point `RootRouter.tsx` at `@diffusecraft/core`'s real `createConnectionStore()` factory, and remove the debug toggle in `Settings.About`. The conditional-root contract — `{ status, pairedServers, activeServerId }` — is preserved; no navigation file changes.

### S6 — Operator validating kill-and-relaunch resume
> **Story 6.** As the operator running smoke checks, I navigate to `Settings → Connection`, kill the app, relaunch, and the app reopens at `Settings → Connection` (the persisted nav state). If I then change the stub `connectionStore` to `no-paired`, the persisted state is **discarded** on relaunch (the conditional root forces re-evaluation) and the app reopens at `Splash → Pairing.MDNS`.

## 3. Functional requirements (EARS)

### 3.1 Conditional root — connection-state branching

**FR-1 (Ubiquitous).** The app root SHALL contain a `<RootRouter>` component that reads `{ status, pairedServers, activeServerId }` from a `connectionStore` and renders one of four navigators based on the following truth table:

| `status` | `pairedServers.length` | `activeServerId` | Renders |
|---|---|---|---|
| `unknown` (cold start, decision pending) | any | any | `AuthStack` rooted at `Splash` |
| `no-paired` | `0` | `null` | `AuthStack` rooted at `PairingFlow > Pairing.MDNS` |
| `paired-no-active` (>= 1 paired, none active) | `>= 1` | `null` | `RootStack` rooted at `ServerPicker` |
| `connected` | `>= 1` | non-null | `RootStack` rooted at `Documents` |

**FR-2 (Ubiquitous).** The `Splash` screen SHALL be the unique entry of the `unknown` state. After the connection-state decision resolves (in stubbed mode, after a fixed `300 ms` delay; in the future real-store mode, after the connection probe completes), `Splash` SHALL `navigation.replace(...)` to the next stack's entry. No other screen SHALL `navigate('Splash')`. `Splash` is never on the back stack.

**FR-3 (Ubiquitous).** Successful pairing in `PairingFlow` SHALL transition the conditional root from `AuthStack` to `RootStack` by mutating `connectionStore` (in stubbed mode, the debug toggle simulates this; in real-store mode, the pairing handler does it). The transition SHALL pop the entire `AuthStack` and push the `RootStack` — there is no manual `navigation.navigate('Documents')` from inside the AuthStack.

### 3.2 AuthStack shape

**FR-4 (Ubiquitous).** `AuthStack` SHALL be a `react-navigation` native stack with two top-level screens:

| Route | Source artboard | Notes |
|---|---|---|
| `Splash` | `01-Splash` | Initial; auto-replaces with the next stack/screen after the conditional-root decision finishes. Not navigable to from elsewhere. |
| `PairingFlow` | (nested stack) | Itself a native stack with four screens (FR-5). Default entry: `Pairing.MDNS`. |

**FR-5 (Ubiquitous).** `PairingFlow` SHALL be a nested native stack (NOT a tab navigator) with these screens, in this order:

| Route | Source artboard | Default entry? |
|---|---|---|
| `Pairing.MDNS` | `02-Pairing-mDNS` | Yes — the flow always opens here |
| `Pairing.QR` | `02b-Pairing-QR` | No — pushed from `Pairing.MDNS` "Scan QR" affordance |
| `Pairing.Code` | `02c-Pairing-Code` | No — pushed from `Pairing.MDNS` "Enter code" affordance |
| `Pairing.Manual` | `02d-Pairing-Manual` | No — pushed from `Pairing.MDNS` "Paste URL" affordance |

**FR-6 (Ubiquitous).** Inside `PairingFlow`, the user SHALL be able to back-step through the pairing methods (the back chevron in the artboards' top bars maps to `navigation.goBack()`). The flow is intentionally a stack, not a tab navigator, so back-stepping works naturally.

**FR-7 (Ubiquitous).** Hardware back (Android) SHALL behave as follows in `AuthStack`:
- On `Splash`: hardware back is a no-op (the screen is transient).
- On `Pairing.MDNS`: hardware back exits the app (it is the bottom of the AuthStack).
- On `Pairing.QR` / `Pairing.Code` / `Pairing.Manual`: hardware back returns to `Pairing.MDNS`.

The pairing flow SHALL NOT be skippable — there is no "skip" affordance; the only way out of `AuthStack` is a successful pair (which mutates `connectionStore`).

### 3.3 RootStack shape

**FR-8 (Ubiquitous).** `RootStack` SHALL be a `react-navigation` native stack with these top-level screens:

| Route | Source artboard | Conditional? |
|---|---|---|
| `ServerPicker` | `03-ServerPicker` | Initial entry **only when** `pairedServers.length > 1 && activeServerId === null`; skipped otherwise |
| `Documents` | `04-Documents` | Initial entry when `connected`; otherwise pushed after `ServerPicker` selection |
| `Editor` | `05-Editor-Generate` family (see §3.4) | Pushed from `Documents` |
| `SettingsStack` | (nested stack) | Pushed from anywhere via the gear icon in top bars (`Documents`, `ServerPicker`) |

**FR-9 (Ubiquitous).** `Editor` SHALL be a **single route**, NOT four routes. The four `.pen` editor variants (`05-Editor-Generate`, `05b-Editor-Inpaint`, `05c-Editor-Live`, `05d-Editor-Chat-Open`) are different **states of the same screen**, not separate routes. State is driven by:
- `workspace: 'generate' | 'inpaint' | 'upscale' | 'live'` — local state in the screen, hydratable from a deep-link query param.
- `chatPanelOpen: boolean` — local state in the screen, hydratable from a deep-link path suffix.

The Workspace concept is owned by the `workspaces` spec (an MCP-driven editor-internal mode); this spec does NOT model workspaces as routes. See §3.4 for the parameter contract and `design.md` §9 for the rationale.

**FR-10 (Ubiquitous).** `SettingsStack` SHALL be a nested native stack with master-detail behaviour:

| Route | Source artboard | Master-detail role |
|---|---|---|
| `Settings.Index` | `06-Settings` | Master list (left column on tablet); detail column shows `About` by default per the `.pen` |
| `Settings.Connection` | `06a-Settings-Connection` | Detail |
| `Settings.Models` | (placeholder; no `.pen` artboard in v1) | Detail |
| `Settings.Agents` | (placeholder; no `.pen` artboard in v1) | Detail |
| `Settings.Speech` | (placeholder; no `.pen` artboard in v1) | Detail |
| `Settings.Appearance` | (placeholder; no `.pen` artboard in v1) | Detail |
| `Settings.AuditLog` | (placeholder; no `.pen` artboard in v1) | Detail |
| `Settings.About` | (rendered as detail of `06-Settings` per the `.pen` brief) | Detail; hosts the debug toggle (FR-19) |

The seven detail routes share the same master-detail container shape (left column = master list reused from `Settings.Index`; right column = the active detail). Master-detail composition is an in-screen layout concern, not a navigator concern; tablet form factor means master and detail render together on a single route in v1, with the active detail driven by route name.

### 3.4 Editor route param contract

**FR-11 (Ubiquitous).** The `Editor` route SHALL declare these params:

```
type EditorParams = {
  documentId: string;                          // required
  workspace?: 'generate' | 'inpaint' | 'upscale' | 'live';  // optional; default 'generate'
  chat?: boolean;                              // optional; default false
};
```

`documentId` is required: navigating to `Editor` without it is a typecheck error. `workspace` and `chat` are hydration-only — once the screen has mounted, in-screen state takes over and changing the local workspace tab does NOT push a new route.

### 3.5 Deep-link map

**FR-12 (Ubiquitous).** The app SHALL register `react-navigation` deep linking with the URI scheme `diffusecraft://`. The map SHALL be:

| URI | Maps to | Notes |
|---|---|---|
| `diffusecraft://splash` | `AuthStack > Splash` | Debug only; production deep links never target Splash. |
| `diffusecraft://pair` | `AuthStack > PairingFlow > Pairing.MDNS` | Default pairing entry. |
| `diffusecraft://pair/qr` | `AuthStack > PairingFlow > Pairing.QR` | |
| `diffusecraft://pair/code` | `AuthStack > PairingFlow > Pairing.Code` | |
| `diffusecraft://pair/manual` | `AuthStack > PairingFlow > Pairing.Manual` | |
| `diffusecraft://servers` | `RootStack > ServerPicker` | Valid only when `pairedServers.length >= 1`; otherwise the conditional root re-routes to `AuthStack > Pairing.MDNS`. |
| `diffusecraft://documents` | `RootStack > Documents` | |
| `diffusecraft://editor/:documentId` | `RootStack > Editor` with `{ documentId }` | |
| `diffusecraft://editor/:documentId?workspace=generate\|inpaint\|upscale\|live` | `RootStack > Editor` with `{ documentId, workspace }` | Query param hydrates the workspace tab. |
| `diffusecraft://editor/:documentId/chat` | `RootStack > Editor` with `{ documentId, chat: true }` | Path suffix hydrates the chat panel. |
| `diffusecraft://settings` | `RootStack > SettingsStack > Settings.Index` | Master, detail = About (per `.pen`). |
| `diffusecraft://settings/:section` | `RootStack > SettingsStack > Settings.<Section>` | `section` ∈ `connection \| models \| agents \| speech \| appearance \| audit \| about`. |

**FR-13 (Ubiquitous).** Deep links SHALL be subject to the conditional root: a deep link to a `RootStack` route delivered while the conditional root is in `no-paired` state SHALL be redirected to `AuthStack > Pairing.MDNS`. The `RootStack` deep-link target is preserved and re-applied after a successful pair (post-v1 enhancement; for v1, the redirect is sufficient and the deep-link target is dropped — this is documented as an open question in `design.md` §11).

### 3.6 App root composition

**FR-14 (Ubiquitous).** `apps/mobile/App.tsx` SHALL mount these wrappers in this exact order, outside-in:

1. `<GestureHandlerRootView style={{ flex: 1 }}>` — required by `react-native-gesture-handler`; mandated by `ui-component-library` design §9 because every gesture-aware primitive (Sheet, ContextMenu, Slider drag, Tabs, dialog dismissal) depends on it.
2. `<ThemeProvider>` — landed in `design-system-foundation`; provides `useTheme()` to every component.
3. `<PortalProvider>` from `@rn-primitives/portal` (re-exported by `@diffusecraft/ui` if convenient) — required by every overlay primitive (Dialog, AlertDialog, Popover, Tooltip, Select, Combobox, ContextMenu, DropdownMenu, Sheet) per `ui-component-library` design §9.
4. `<ToastProvider>` from `@diffusecraft/ui` — mounts the `sonner-native` Toaster with token theming; required for `toast.show(...)` calls anywhere in the app.
5. `<NavigationContainer linking={...} theme={...} onStateChange={...} initialState={...}>` from `@react-navigation/native` — owns the navigation state, the deep-linking config, and the persistence hooks.
6. `<RootRouter>` — the conditional-root component (FR-1) that selects `<AuthStack>` vs `<RootStack>`.

The order is load-bearing: `GestureHandlerRootView` MUST be the outermost so gestures attach correctly; `ThemeProvider` MUST wrap `PortalProvider` so token reads inside portals work; `PortalProvider` MUST wrap `ToastProvider` because the Toaster mounts a portal; `NavigationContainer` MUST wrap `<RootRouter>`. Reordering any of these is a defect.

### 3.7 Connection state stub

**FR-15 (Ubiquitous).** `apps/mobile/src/state/connectionStore.stub.ts` SHALL export a Zustand store factory `createConnectionStoreStub()` returning a hook with this minimal interface:

```
interface ConnectionState {
  status: 'unknown' | 'no-paired' | 'paired-no-active' | 'connected';
  pairedServers: Array<{ id: string; name: string }>;
  activeServerId: string | null;
  // Debug-only mutators (removed when the real store from client-state-architecture lands):
  __debugSet: (next: Partial<ConnectionState>) => void;
  __debugCycle: () => void;
}
```

The shape MUST match what the future `client-state-architecture` spec is expected to expose (modulo the `__debug*` mutators, which are stub-only). Concretely: when `client-state-architecture` lands, this file is deleted, the import in `RootRouter.tsx` is repointed, and the runtime contract is preserved.

**FR-16 (Ubiquitous).** The stub SHALL initialise with `{ status: 'unknown', pairedServers: [], activeServerId: null }` and SHALL transition to `'no-paired'` after 300 ms (simulating the connection probe). This makes `Splash` observable on cold start.

**FR-17 (Ubiquitous).** The stub SHALL persist the most-recent `__debugSet` state to `AsyncStorage` under key `diffusecraft.connectionStore.stub.v1` so kill-and-relaunch preserves the operator's debug selection across cold starts.

### 3.8 State persistence

**FR-18 (Ubiquitous).** The `<NavigationContainer>` SHALL serialise its navigation state to `AsyncStorage` via `getInitialState` (read on mount) and `onStateChange` (write on every navigation event). The storage key SHALL be `diffusecraft.navigation.state.v1` and SHALL include a version discriminator (`v1`) so a future schema change can invalidate the old payload.

**FR-19 (Ubiquitous).** On cold start, the conditional root SHALL re-evaluate `connectionStore` BEFORE applying the persisted nav state. If the connection state has changed since the last serialisation (e.g., last serialisation was in `connected` state but the stub now reads `no-paired`), the persisted state SHALL be DISCARDED and the conditional root's natural entry SHALL be used. This prevents the user from being dropped into `Editor` after a logout-equivalent.

### 3.9 Debug toggle in `Settings.About`

**FR-20 (Ubiquitous).** `Settings.About` SHALL render a debug-only `<Card>` with a `<Button>` that calls `connectionStoreStub.__debugCycle()`. Cycling iterates through the four states defined in FR-1 in this order: `no-paired` → `paired-no-active` (with 2 sample paired servers) → `connected` (with 1 active server) → `no-paired` (loop). The Card SHALL display the current state as a readable string (e.g., "Stub: connected · 2 paired · active = imac-de-igna") via `mono` token type.

This affordance SHALL be guarded by `__DEV__` (Expo's standard dev flag) so production builds do not ship it.

### 3.10 Placeholder screen contract

**FR-21 (Ubiquitous).** Every screen file SHALL render a body produced by the shared `<Placeholder routeName label />` component (`apps/mobile/src/screens/_shared/Placeholder.tsx`). The placeholder SHALL display:
- The route name (e.g., `Editor`).
- The source artboard label (e.g., `05-Editor-Generate`).
- A back button (when applicable) wired to `navigation.goBack()`.
- A small set of intra-stack navigation buttons demonstrating the screen's outgoing edges (e.g., `Documents` placeholder has a "Open sample document" button calling `navigate('Editor', { documentId: 'sample' })`).

The placeholder SHALL use `@diffusecraft/ui` primitives only — `Card`, `Button`, `Separator`, `Label` — and consume tokens via Tailwind classes / `useTheme()` only. No raw hex.

**FR-22 (Ubiquitous).** No screen file SHALL contain product logic. No screen imports `@diffusecraft/diffusion-client`, `@diffusecraft/canvas-core`, `@diffusecraft/canvas-skia`, or `@diffusecraft/server`. The placeholder body is the entire content; downstream `screens-implementation` replaces it.

## 4. Non-functional requirements

**NFR-1 (Performance).** Stack screens SHALL be lazy-mounted by `react-navigation`'s default behaviour (`lazy: true`). A cold-start to `Documents` SHALL not mount `Editor` or `SettingsStack` screens until the user navigates into them.

**NFR-2 (DX — type safety).** Route names and params SHALL be typed via `RootStackParamList`, `AuthStackParamList`, `PairingFlowParamList`, and `SettingsStackParamList`. The TS module augmentation in `apps/mobile/src/navigation/types.ts` SHALL extend `@react-navigation/native`'s `RootParamList` so `useNavigation()` and `useRoute()` are typed without per-call generic parameters. Passing an unknown route name SHALL fail `tsc`.

**NFR-3 (DX — deep-link types).** The `linking.config.screens` map SHALL be derived from the typed route names; adding a route without a deep-link entry SHALL be flagged by `routesCoverage.test.ts` (FR-26 / `design.md` §10).

**NFR-4 (Maintainability).** Adding a new `Settings.<Section>` sub-route SHALL be a 3-line change spread across these three files: one row in `SettingsStackParamList` (`types.ts`), one `<Stack.Screen>` registration (`SettingsStack.tsx`), and one entry in `linking.ts`. No other file SHALL need to change.

**NFR-5 (Animation defaults).** This spec SHALL NOT introduce custom `screenOptions` transitions. All navigators SHALL use `react-navigation`'s native-stack default animation. Animation polish (e.g., shared-element transitions on `Documents → Editor`) is deferred to a later spec.

**NFR-6 (No business logic).** Per FR-22, this spec SHALL NOT introduce real pairing, real connection, real document opening, real workspace tool catalog, real chat, or any code path that talks to a server. Any temptation to "just add the connection probe here" SHALL be deflected to `client-state-architecture`.

**NFR-7 (Type-safe deep links).** A deep link with a malformed `:documentId` (empty string) SHALL be rejected by the `linking.config` parser (custom `parse` function); the user is dropped on `Documents` rather than `Editor` with an undefined doc id.

## 5. Acceptance criteria

This spec is APPROVED-FOR-IMPLEMENTATION when:

1. `apps/mobile/src/navigation/{types.ts, RootStack.tsx, AuthStack.tsx, PairingFlow.tsx, SettingsStack.tsx, RootRouter.tsx, linking.ts, README.md}` exist and compile under `tsc --noEmit` strict mode.
2. The 14 placeholder screen files exist at `apps/mobile/src/screens/<Name>.tsx` (one per route in the contract: `Splash`, `Pairing.MDNS`, `Pairing.QR`, `Pairing.Code`, `Pairing.Manual`, `ServerPicker`, `Documents`, `Editor`, `Settings.Index`, `Settings.Connection`, `Settings.Models`, `Settings.Agents`, `Settings.Speech`, `Settings.Appearance`, `Settings.AuditLog`, `Settings.About`). The shared `Placeholder` component exists at `apps/mobile/src/screens/_shared/Placeholder.tsx`.

   Note on count: the route contract enumerates **16 placeholder files** when `Settings.AuditLog` and `Settings.About` are both rendered as their own route (per FR-10). The roadmap row 3 phrase "13 screens" refers to the 13 `.pen` artboards; the routing layer adds Settings-detail variants beyond what `.pen` ships, since the `.pen` only renders `06` (master + About) and `06a-Settings-Connection`. The remaining five Settings-detail routes (`Models`, `Agents`, `Speech`, `Appearance`, `AuditLog`) ship as placeholder routes in this spec; their `.pen` artboards land in a future design pass.

3. `apps/mobile/App.tsx` mounts the full root composition per FR-14 (`GestureHandlerRootView` → `ThemeProvider` → `PortalProvider` → `ToastProvider` → `NavigationContainer` → `RootRouter`). The `Swatch` route from `design-system-foundation` is removed from the production tree (it may remain accessible behind a `__DEV__` debug toggle in `Settings.About`, optional).
4. The conditional root branches correctly across all four `connectionStore` states. Each branch is reachable via the debug toggle in `Settings.About` (FR-20).
5. Deep links work: `expo run:ios` + `xcrun simctl openurl booted diffusecraft://editor/sample-doc?workspace=inpaint` lands on `Editor` with `{ documentId: 'sample-doc', workspace: 'inpaint' }` and the chat panel closed. Equivalent for the other 11 deep-link patterns in §3.5.
6. Kill-and-relaunch resumes the navigation state UNLESS the connection state has changed (FR-19).
7. `routesCoverage.test.ts` (vitest) passes: every screen registered in any `Stack.Navigator` has a corresponding `linking.config.screens` entry, and every entry's path is reachable.
8. No raw hex literals inside `apps/mobile/src/navigation/` or `apps/mobile/src/screens/` (the lint rule from `design-system-foundation` T7 catches this).
9. `tsc --noEmit` clean across `apps/mobile`. `eslint` clean.
10. No imports of `@diffusecraft/diffusion-client`, `@diffusecraft/server`, `@diffusecraft/canvas-core`, or `@diffusecraft/canvas-skia` anywhere in `apps/mobile/src/{navigation,screens}/` (verified by a CI grep step).

## 6. Out of scope

- **Real `connectionStore`** — owned by `client-state-architecture`; this spec ships a stub matching its expected interface.
- **Real pairing protocol implementation** — owned by `pairing-protocol`; this spec only ships placeholder screens for the four pairing methods.
- **Real document opening, gallery population, search, sort, view-toggle** — owned by `screens-implementation` (the body of `Documents.tsx` placeholder is replaced there).
- **Real editor chrome** — left rail, right panel, prompt bar, layers list, control layers, regions, chat — owned by `screens-implementation` (the body of `Editor.tsx` placeholder is replaced there).
- **Workspace tool catalog filtering** — owned by `workspaces` spec; this spec only treats `workspace` as a deep-link query param hydrating local state.
- **Live mode regen, fixed-seed lock, latency readout** — owned by a future `live-mode` or `editor-live` spec; this spec only allows `workspace=live` as a state value.
- **Bottom tab bar.** None. Per the `.pen` design and the steering-level "Tablet UX. No bottom tab bar." rule.
- **Drawer navigator.** None. Tablet UX uses side rails / floating panels / sheets; no Material drawer.
- **Gesture-driven side navigation** (e.g., edge-swipe to open Settings). Not in v1.
- **Animation polish** — shared-element transitions, custom modal presentation, splash-to-pairing crossfade. v1 uses `react-navigation` defaults.
- **Splash duration tuning.** v1 uses a fixed 300 ms stub delay (FR-16); real timing depends on the future connection probe.
- **Light theme.** Per `design-system-foundation` §"Out of scope" and the roadmap.
- **Phone fallback layout.** Tablet only.
- **Restoring the originally-targeted deep link after a forced pairing redirect.** Documented as an open question in `design.md` §11; v1 simply drops the original target.
- **A11y audit** of navigation primitives (focus management on stack push, header back-button screen-reader labels). Deferred per the roadmap.
- **Storybook / navigation snapshots** beyond `routesCoverage.test.ts`. Deferred.
