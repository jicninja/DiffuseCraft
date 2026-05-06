# app-shell-navigation — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, `tsc --noEmit` clean, lint clean (no raw hex, no business-logic imports per `design.md` §10), Conventional Commits with `mobile` scope (or `repo` for cross-cutting).
> **t-shirt sizes:** XS = ≤30 min · S = ≤2h · M = ≤half-day. (This spec contains only XS / S / M tasks.)

> **Total estimate:** ~1.5 days for one engineer. Tasks T6 + T7 are the only true parallelism opportunity once T2–T5 land.

> **Pre-flight.** This spec depends on `design-system-foundation` (T1–T8 landed) and `ui-component-library` (T1–T12 landed). In particular, `<ThemeProvider>`, `<ToastProvider>`, `Card`, `Button`, `Separator`, `Label`, and the `@rn-primitives/portal` peerDep must already be available. If `ui-component-library` is not yet implemented, surface to the human reviewer before proceeding.

---

## T1 — `apps/mobile/src/state/connectionStore.stub.ts`

**Title.** Land the Zustand connection-store stub matching the future `client-state-architecture` shape.

**Files touched.**
- `apps/mobile/src/state/connectionStore.stub.ts` (new) — implementation per `design.md` §5.
- `apps/mobile/src/state/__tests__/connectionStore.stub.test.ts` (new) — vitest covering: initial `unknown` state, `bootConnectionStub` transitions to `no-paired` after 300 ms, `__debugCycle` walks `no-paired → paired-no-active → connected → no-paired`, AsyncStorage persistence is keyed `diffusecraft.connectionStore.stub.v1`.
- `apps/mobile/package.json` — add `zustand` and `@react-native-async-storage/async-storage` if not already present.

**Behaviour.** Per `design.md` §5.1. `// TODO(client-state-architecture):` comment at the top of the file documenting that this is a stub.

**Acceptance check.**
- The stub compiles with `tsc --noEmit`.
- The test file passes.
- `useConnectionStoreStub.getState()` after `bootConnectionStub() + 300 ms` returns `status: 'no-paired'` (when AsyncStorage is empty).
- Cycling through `__debugCycle` four times returns to the starting state.

**Dependencies.** None inside this spec. Externally: `ui-component-library` peer-dep tree is sufficient (`zustand` is a new addition).

**Size.** S.

---

## T2 — `apps/mobile/src/navigation/types.ts`

**Title.** Land the typed route param lists and the global module augmentation.

**Files touched.**
- `apps/mobile/src/navigation/types.ts` (new) — `RootStackParamList`, `AuthStackParamList`, `PairingFlowParamList`, `SettingsStackParamList` + `declare global { namespace ReactNavigation { interface RootParamList ... } }` per `design.md` §3.

**Behaviour.** Verbatim from `design.md` §3. Every route shape declared. `Editor` is the only route with required + optional params; everything else is `undefined`.

**Acceptance check.**
- `tsc --noEmit` clean.
- `useNavigation()` and `useRoute()` return correctly typed values without explicit generics in the screen files (verified by smoke-typing one screen file in T7).

**Dependencies.** T1 only because T1 also bumps `apps/mobile/package.json` deps; ordering avoids merge conflicts. Otherwise independent.

**Size.** XS.

---

## T3 — Four navigator stack files

**Title.** Create `AuthStack.tsx`, `PairingFlow.tsx`, `RootStack.tsx`, `SettingsStack.tsx` with placeholder screen registrations.

**Files touched.**
- `apps/mobile/src/navigation/AuthStack.tsx` (new) — `createNativeStackNavigator<AuthStackParamList>()`; registers `Splash` and `PairingFlow`. Header configured with theme tokens.
- `apps/mobile/src/navigation/PairingFlow.tsx` (new) — registers the four `Pairing.*` screens. Initial route: `Pairing.MDNS`.
- `apps/mobile/src/navigation/RootStack.tsx` (new) — registers `ServerPicker`, `Documents`, `Editor`, `SettingsStack`. The initial route is decided by `RootRouter` (T5), not by this file's `initialRouteName`.
- `apps/mobile/src/navigation/SettingsStack.tsx` (new) — registers `Settings.Index` (initial) + 7 detail routes.

**Behaviour.** Each `Stack.Screen` references a screen component imported from `apps/mobile/src/screens/`; placeholder screens land in T7 — for this task the imports may be temporarily satisfied by stub `() => null` components if T7 has not yet landed (preferred ordering: T6 + T7 before T3).

**Acceptance check.**
- All four stack files compile.
- `tsc --noEmit` clean.
- Importing a stack from `apps/mobile/App.tsx` does not crash.

**Dependencies.** T2 (types). Can run after T6 + T7 to avoid the temporary stub imports.

**Size.** M.

---

## T4 — `apps/mobile/src/navigation/linking.ts`

**Title.** Land the deep-link config covering every route in §4 of `design.md`.

**Files touched.**
- `apps/mobile/src/navigation/linking.ts` (new) — `LinkingOptions<RootParamList>` per `design.md` §4 (full sketch).
- `apps/mobile/app.config.ts` — add `scheme: 'diffusecraft'`.
- `apps/mobile/package.json` — add `expo-linking`.

**Behaviour.** Per `design.md` §4. Custom `parse` rejects empty `documentId`; the `chatSuffix` boolean is derived from a path suffix (`/chat` → `true`).

**Acceptance check.**
- `getStateFromPath('editor/sample-doc?workspace=inpaint', linking.config)` returns a state with `Editor` and `{ documentId: 'sample-doc', workspace: 'inpaint' }`.
- `getStateFromPath('editor/sample-doc/chat', linking.config)` yields `{ documentId: 'sample-doc', chat: true }` (after the `chatSuffix → chat` adapter, which lives in the screen — see Q4 / §9 of design).
- `getStateFromPath('editor/', linking.config)` does NOT crash; falls back gracefully (per NFR-7).
- Every settings sub-section URI resolves to the matching `Settings.<Section>` route.

**Dependencies.** T2 (types).

**Size.** S.

---

## T5 — `apps/mobile/src/navigation/RootRouter.tsx`

**Title.** Land the conditional-root component selecting `<AuthStack>` vs `<RootStack>` based on `connectionStore`.

**Files touched.**
- `apps/mobile/src/navigation/RootRouter.tsx` (new) — subscribes to `useConnectionStoreStub`, renders one of the two stacks per the truth table in `design.md` §2 / requirements §3.1. Uses Splash as the `unknown`-state entry (per FR-2).

**Behaviour.** Pure conditional rendering. No side effects beyond what Zustand subscription provides. The `RootStack` initial route name (`ServerPicker` vs `Documents`) is driven by props passed from `RootRouter` to `<RootStack>`.

**Acceptance check.**
- Mounting `<RootRouter />` with `status: 'unknown'` renders `Splash`.
- Mutating to `'no-paired'` renders `Pairing.MDNS`.
- Mutating to `'paired-no-active'` (with 2 paired servers) renders `ServerPicker`.
- Mutating to `'connected'` renders `Documents`.
- A vitest test exercises the four states with mocked Zustand.

**Dependencies.** T1 (the stub), T3 (the two stacks).

**Size.** S.

---

## T6 — `apps/mobile/src/screens/_shared/Placeholder.tsx`

**Title.** Land the shared `<Placeholder>` component used by every screen file.

**Files touched.**
- `apps/mobile/src/screens/_shared/Placeholder.tsx` (new) — implementation per `design.md` §8.
- `apps/mobile/src/screens/_shared/__tests__/Placeholder.test.tsx` (new) — vitest snapshot of three configurations: minimal, with `outgoing` buttons, with `detail` slot.

**Behaviour.** Uses `Card`, `Button`, `Separator`, `Label` from `@diffusecraft/ui` only. NativeWind classes only; no raw hex.

**Acceptance check.**
- `Placeholder.tsx` compiles.
- The three snapshots pass.
- `rg -n "#[0-9A-Fa-f]{3,8}\b" apps/mobile/src/screens/_shared/Placeholder.tsx` returns empty.

**Dependencies.** None inside this spec; needs `ui-component-library` already implemented.

**Size.** S.

---

## T7 — 16 placeholder screen files

**Title.** Create one screen file per route in the contract: `Splash`, `Pairing.MDNS`, `Pairing.QR`, `Pairing.Code`, `Pairing.Manual`, `ServerPicker`, `Documents`, `Editor`, `Settings.Index`, `Settings.Connection`, `Settings.Models`, `Settings.Agents`, `Settings.Speech`, `Settings.Appearance`, `Settings.AuditLog`, `Settings.About` — 16 files total. Plus `apps/mobile/src/screens/index.ts` barrel.

**Files touched.**
- `apps/mobile/src/screens/Splash.tsx` (new) — uses `useEffect` to observe `connectionStore` and `replace()` to the next route once `status !== 'unknown'`.
- `apps/mobile/src/screens/Pairing.MDNS.tsx` (new) — outgoing buttons to `Pairing.QR`, `Pairing.Code`, `Pairing.Manual`.
- `apps/mobile/src/screens/Pairing.QR.tsx` (new) — back + cross-link to other pairing methods.
- `apps/mobile/src/screens/Pairing.Code.tsx` (new) — back + cross-link.
- `apps/mobile/src/screens/Pairing.Manual.tsx` (new) — back.
- `apps/mobile/src/screens/ServerPicker.tsx` (new) — outgoing to `Documents` (mock select-server) and `SettingsStack`.
- `apps/mobile/src/screens/Documents.tsx` (new) — outgoing to `Editor` with sample `documentId`, `SettingsStack`.
- `apps/mobile/src/screens/Editor.tsx` (new) — implementation per `design.md` §9.2 (workspace tab + chat panel as local state).
- `apps/mobile/src/screens/Settings.Index.tsx` (new) — outgoing buttons to all 7 detail routes.
- `apps/mobile/src/screens/Settings.Connection.tsx` (new).
- `apps/mobile/src/screens/Settings.Models.tsx` (new) — placeholder body indicates "no .pen artboard yet".
- `apps/mobile/src/screens/Settings.Agents.tsx` (new) — same.
- `apps/mobile/src/screens/Settings.Speech.tsx` (new) — same.
- `apps/mobile/src/screens/Settings.Appearance.tsx` (new) — same.
- `apps/mobile/src/screens/Settings.AuditLog.tsx` (new) — same.
- `apps/mobile/src/screens/Settings.About.tsx` (new) — placeholder body + `__DEV__`-guarded debug-toggle Card (FR-20). Debug toggle implementation lands in T11; for this task, leave a placeholder Card with the text "debug toggle here" and a comment `// TODO(T11)`.
- `apps/mobile/src/screens/index.ts` (new) — re-exports every screen.

**Justification for one task.** Each file is ~25 lines (a typed `useNavigation` + a `<Placeholder>` invocation + an `outgoing` array). 16 × 25 = ~400 lines, all mechanical, ≤ 2 hours total. Splitting into 16 sub-tasks is overhead that does not aid review (the reviewer reads them as a group anyway because they are structurally identical).

**Acceptance check.**
- All 16 files compile.
- `tsc --noEmit` clean.
- `rg -n "#[0-9A-Fa-f]{3,8}\b" apps/mobile/src/screens` returns empty.
- `rg -n "from ['\"]@diffusecraft/(diffusion-client\|server\|canvas-core\|canvas-skia)" apps/mobile/src/screens` returns empty.
- Importing the barrel in `apps/mobile/src/navigation/RootStack.tsx` resolves all 16 screens.

**Dependencies.** T2 (types), T6 (`<Placeholder>`).

**Size.** M.

---

## T8 — `apps/mobile/App.tsx` rewrite

**Title.** Rewrite the app root with the full composition: `GestureHandlerRootView` → `ThemeProvider` → `PortalHost` → `ToastProvider` → `NavigationContainer` → `RootRouter`.

**Files touched.**
- `apps/mobile/App.tsx` (REWRITTEN) — implementation per `design.md` §6.
- `apps/mobile/index.ts` — verify `registerRootComponent(App)` still hooks up.
- `apps/mobile/package.json` — add `@react-navigation/native`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context` if not already present.

**Behaviour.** Per `design.md` §6 (full code sketch). The wrapper order is load-bearing; document it in a one-line comment at the top of the file.

**Acceptance check.**
- App boots under Expo (`pnpm --filter mobile dev`) without throwing.
- The first frame after the splash native screen disappears is the placeholder `Splash` screen.
- The Swatch screen from `design-system-foundation` is no longer the default route. (Optionally accessible via a `__DEV__` toggle in `Settings.About`; decided in T11.)

**Dependencies.** T1, T2, T3, T4, T5, T6, T7. (Effectively last in the implementation chain, before tests.)

**Size.** S.

---

## T9 — `apps/mobile/src/navigation/persistence.ts`

**Title.** Wire AsyncStorage persistence with a versioned key and a connection-state fingerprint guard.

**Files touched.**
- `apps/mobile/src/navigation/persistence.ts` (new) — implementation per `design.md` §7.
- `apps/mobile/src/navigation/__tests__/persistence.test.ts` (new) — vitest covering: load returns `undefined` on empty storage; save writes versioned envelope; load returns `undefined` when the stored fingerprint differs from the current fingerprint; load returns the stored state when fingerprints match.
- `apps/mobile/App.tsx` (touched) — wires `loadInitialNavigationState` and `saveNavigationState` per `design.md` §6.

**Behaviour.** Per `design.md` §7. Storage keys: `diffusecraft.navigation.state.v1`. Fingerprint hash: `${status}|${pairedServers.length}|${activeServerId ?? '-'}`.

**Acceptance check.**
- The vitest test passes.
- A manual smoke (Expo): navigate to `Settings → Connection`, kill the app, relaunch — the app reopens at `Settings → Connection`.
- Cycle the stub to `no-paired` between sessions — the app reopens at `Pairing.MDNS`, NOT at `Settings → Connection`.

**Dependencies.** T1, T8.

**Size.** S.

---

## T10 — `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts`

**Title.** Land the bijection test asserting every screen has a deep-link entry and vice-versa.

**Files touched.**
- `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` (new) — vitest implementation walking the navigator trees and the `linking.config.screens` tree to assert the bijection. Also feeds the URI patterns from §4 to `getStateFromPath` and asserts each yields the expected route + params.

**Behaviour.** The test imports `linking` (T4) and the four stack files (T3). For each stack, it inspects the registered screen names (via the navigator's screen children — exposed for testing) and cross-checks against the `screens` map in `linking.config`. Any mismatch fails with a clear message naming the offending route.

**Acceptance check.**
- The test passes against the full set of routes.
- Removing one entry from `linking.config.screens` (e.g., `'Settings.Models'`) causes the test to fail.
- Removing one screen registration from `SettingsStack.tsx` causes the test to fail.
- Adding a new route without a deep-link entry fails the test.

**Dependencies.** T3, T4.

**Size.** S.

---

## T11 — Debug toggle in `Settings.About`

**Title.** Replace the T7 placeholder card in `Settings.About.tsx` with the real `__DEV__`-guarded debug toggle that cycles `connectionStoreStub` state.

**Files touched.**
- `apps/mobile/src/screens/Settings.About.tsx` (touched) — adds the `__DEV__`-guarded `<Card>` with a current-state readout and a "Cycle stub state" `<Button>`.
- `apps/mobile/src/screens/__tests__/Settings.About.test.tsx` (new) — vitest covering: in `__DEV__`, the Card renders and the button cycles the stub state; with `__DEV__` falsified (mocked), the Card does NOT render.

**Behaviour.** Per requirements §3.9 / FR-20 and `design.md` §5.3. Current-state readout uses the `mono` token type (`text-mono`).

**Acceptance check.**
- The test passes.
- Manual smoke: in a development build, opening `Settings → About` shows the Card; tapping the button cycles the conditional root through Pairing → ServerPicker → Documents and back.
- Production build (`__DEV__` false) does NOT render the Card.

**Dependencies.** T1, T7, T8.

**Size.** S.

---

## T12 — `apps/mobile/src/navigation/README.md`

**Title.** Operator's quick reference: per-route table + deep-link map + how to add a new Settings sub-section.

**Files touched.**
- `apps/mobile/src/navigation/README.md` (new) — sections:
  1. The four stacks (one paragraph each).
  2. Per-route table: route name | source artboard | params | deep-link pattern.
  3. The conditional-root truth table (copied from `design.md` §2 / requirements §3.1).
  4. "How to add a new Settings sub-section" — the 3-line checklist (NFR-4): add to `SettingsStackParamList` in `types.ts`, register `<Stack.Screen>` in `SettingsStack.tsx`, add an entry in `linking.ts`. Optionally add a row in the `Settings.Index` master list.
  5. "How to test a deep link" — `xcrun simctl openurl booted diffusecraft://editor/sample-doc?workspace=inpaint` and the Android equivalent (`adb shell am start -a android.intent.action.VIEW -d ...`).

**Acceptance check.**
- Every route in the contract appears in the per-route table.
- The "add a Settings sub-section" recipe is verifiable: a developer following it adds a route in under 5 minutes.

**Dependencies.** T8 (so the public surface is stable).

**Size.** S.

---

## Dependency order

```
T1 (stub) ──────────────────┐
                            ├──→ T5 (RootRouter) ──┐
T2 (types) ──→ T3 (stacks) ─┘                      │
                            │                      │
T2 (types) ──→ T4 (linking) ┘                      │
                                                   │
T6 (Placeholder) ──→ T7 (16 screens) ──────────────┤
                                                   │
                                                   ├──→ T8 (App.tsx) ──→ T9 (persistence)
                                                   │
                                                   ├──→ T10 (routesCoverage)
                                                   │
                                                   ├──→ T11 (debug toggle)
                                                   │
                                                   └──→ T12 (README)
```

Linear-friendly read: **T1 → T2 → T6 → T7 → T4 → T3 → T5 → T8 → T9 → T10 → T11 → T12**.

Two-engineer parallelism: Engineer A drives T1 + T2 + T4 + T5 + T9; Engineer B drives T6 + T7 + T11. Convergence at T8.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `react-navigation` v7 API drift between authoring and implementation | Pin a version in `apps/mobile/package.json`. The wrapper code in `App.tsx` and `RootRouter.tsx` is the only API surface this spec depends on; future upgrades are a one-file change. |
| `expo-linking` URL-scheme registration on iOS / Android requires native config | `app.config.ts` declares the scheme; T4 includes a manual smoke (`xcrun simctl openurl ...`). If the scheme does not register on a fresh `expo prebuild`, document the platform-specific knob in `README.md` (T12). |
| Stub `connectionStore` shape diverges from the future `client-state-architecture` shape | Surface the stub interface in `design.md` §5.1 verbatim; reviewers of `client-state-architecture` MUST diff their proposed factory against this stub. The TODO comment in the stub file is the gate. |
| AsyncStorage persistence races with the conditional root on cold start | T8's `App.tsx` waits for `loadInitialNavigationState()` to resolve before mounting `<NavigationContainer>` (per `design.md` §6 sketch). The vitest test in T9 covers the empty-storage and stale-fingerprint paths. |
| Editor's local state (workspace tab, chat panel) gets lost on intra-app navigation | Out of scope for this spec; the placeholder body re-initialises from route params each mount, which is correct chrome-mode behaviour. The future `editor-state` / `client-state-architecture` spec moves this to a Zustand slice. |
| `ToastProvider` interaction with `PortalHost` (Q4 of design §11) | T8 verifies on a real device; if `sonner-native` requires a different mount position, move it and document in `README.md` (T12). |
| `routesCoverage.test.ts` becomes brittle if `react-navigation`'s internal screen-children API changes | Use the public `linking.config.screens` walker as the canonical source; the test asserts the screen names registered in each stack file are a subset of the linking map. The internal API is touched only to read screen names, which is stable. |
| Adding a new route post-v1 forgets the deep-link entry | T10's `routesCoverage.test.ts` catches this at CI time. |
| The 14-vs-16 screen count discrepancy (roadmap says 13, this spec ships 16 placeholders) confuses reviewers | Documented in requirements §5 acceptance note. The roadmap's "13 screens" refers to `.pen` artboards; the routing layer ships 16 because Settings details extend beyond what `.pen` covers. |
