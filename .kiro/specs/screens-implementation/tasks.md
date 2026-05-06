# screens-implementation — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI; `tsc --noEmit` clean; lint clean (no raw hex, no business-logic imports, no `react-native-reusables` runtime imports); per-screen snapshot test passes; Conventional Commits with `mobile` scope.
> **t-shirt sizes:** XS = ≤30 min · S = ≤2h · M = ≤half-day. (This spec contains only XS / S / M tasks per parallel-implementer file.)

> **Total estimate:** ~3 days for one engineer; ~1 day with the multi-agent orchestration described in `design.md` §2 (because waves run in parallel).

> **Pre-flight gate.** This spec depends on `design-system-foundation` (T1–T8 landed), `ui-component-library` (T1–T12 landed), and `app-shell-navigation` (T1–T12 landed). Specifically: `<ThemeProvider>`, `<ToastProvider>`, all 25 primitives from `@diffusecraft/ui`, the four navigator stacks, the 16 placeholder screens, and `<Placeholder>` itself MUST exist. If any prerequisite is missing, surface to the human reviewer before starting T0a.

> **Token-gap pre-flight (T0a).** `ui-component-library/design.md` §9 surfaced four token gaps (`focus.ring`, `scrim`, `{danger,warn,success,info}.muted`). T0a confirms the gap status BEFORE Wave 1 begins. See T0a for the two acceptable resolutions.

---

## T0a — Token-gap audit

**Title.** Confirm the four token additions surfaced in `ui-component-library/design.md` §9 are either landed via a `design-system-foundation` v0.2 amendment or documented as missing-but-tolerated for this spec.

**Files touched.**
- `.kiro/specs/screens-implementation/_token-gap-status.md` (new) — a short markdown file recording the resolution. Two acceptable outcomes:
  1. **Landed.** `design-system-foundation/tailwind.config.js` and `libs/ui/src/theme/tokens.ts` now define `focus.ring`, `scrim`, `danger.muted`, `warn.muted`, `success.muted`, `info.muted`. Note the commit SHA in this file. No code change here.
  2. **Tolerated.** The chrome implementation does not need any of these four tokens for v1. Document the consequence: focus rings are absent (chrome is touch/stylus first, focus is a keyboard/external-pointer concern); scrims fall back to `bg.canvas` at 60% opacity rendered via `useTheme()` + alpha; semantic-fill chips use the saturated semantic token at reduced opacity (e.g., `bg-success/20`).

**Acceptance check.**
- `_token-gap-status.md` exists with one of the two outcomes selected.
- If "tolerated", every chrome usage of a soft semantic fill is annotated in code with `// TODO(token-gap-soft-fills)`.
- If "landed", `tsc --noEmit` from `libs/ui` cross-check test (`tokens-match-tailwind.test.ts`) passes against the new tokens.

**Dependencies.** None inside this spec; gates Wave 1 dispatch.

**Size.** XS.

---

## T0b — Build `_mock/` fixtures

**Title.** Land the 7 fixture files plus `_thumbs/` placeholder PNGs and the barrel.

**Files touched.**
- `apps/mobile/src/screens/_mock/servers.ts` (new) — per `design.md` §3.1.
- `apps/mobile/src/screens/_mock/documents.ts` (new) — per §3.2.
- `apps/mobile/src/screens/_mock/layers.ts` (new) — per §3.3.
- `apps/mobile/src/screens/_mock/historyItems.ts` (new) — per §3.4.
- `apps/mobile/src/screens/_mock/chatMessages.ts` (new) — per §3.5.
- `apps/mobile/src/screens/_mock/presets.ts` (new) — per §3.6.
- `apps/mobile/src/screens/_mock/mdnsServers.ts` (new) — per §3.7.
- `apps/mobile/src/screens/_mock/index.ts` (new) — per §3.8.
- `apps/mobile/src/screens/_mock/_thumbs/*.png` (new) — solid-colour 256×256 placeholder PNGs. One per fixture row that needs a thumbnail (≈ 18 PNGs total: 8 docs, 4 layers, 6 history items).

**Behaviour.** Per `design.md` §3. Every fixture is a top-level `const` with deterministic values. Thumbnail PNGs are `require()`'d. No `Date.now()`, no `Math.random()`.

**Acceptance check.**
- `import { SERVERS_MOCK, DOCUMENTS_MOCK, ... } from 'apps/mobile/src/screens/_mock'` resolves.
- `tsc --noEmit` clean for the fixtures.
- Snapshot test that imports the barrel and asserts each fixture's array length matches the contract (3, 8, 4, 6, 5, 6, 3) passes.

**Dependencies.** T0a.

**Size.** S.

---

## T0c — Build `_strings/` constants

**Title.** Land one string-constants file per screen (13 in-scope + 5 out-of-scope = 18 files) plus the barrel.

**Files touched.**
- `apps/mobile/src/screens/_strings/splash.ts` (new).
- `apps/mobile/src/screens/_strings/pairing-mdns.ts` (new).
- `apps/mobile/src/screens/_strings/pairing-qr.ts` (new).
- `apps/mobile/src/screens/_strings/pairing-code.ts` (new).
- `apps/mobile/src/screens/_strings/pairing-manual.ts` (new).
- `apps/mobile/src/screens/_strings/server-picker.ts` (new).
- `apps/mobile/src/screens/_strings/documents.ts` (new).
- `apps/mobile/src/screens/_strings/settings-index.ts` (new).
- `apps/mobile/src/screens/_strings/settings-connection.ts` (new).
- `apps/mobile/src/screens/_strings/editor.ts` (new) — covers all Editor sub-components (single shared dictionary).
- `apps/mobile/src/screens/_strings/settings-{models,agents,speech,appearance,audit-log,about}.ts` (new) — placeholder stubs for the 5 out-of-scope routes; each exports a single `title` and `description` for the `<Placeholder>` body.
- `apps/mobile/src/screens/_strings/index.ts` (new) — barrel.

**Behaviour.** Per `design.md` §8. Each file exports a single `<SCREEN>_STRINGS` const using `as const`.

**Acceptance check.**
- All 18 files exist and `tsc --noEmit` clean.
- The barrel re-exports every constant.
- A unit test asserts every const has a non-empty `title` field (basic shape check).

**Dependencies.** None inside this spec; can run in parallel with T0a / T0b.

**Size.** S.

---

## Wave 1 — Group A (5 parallel subagents)

The orchestrator dispatches all 5 subagents in a single message. Each subagent uses the verbatim prompt template in `design.md` §2.5, with `<TARGET-FILE>` and `<ARTBOARD>` substituted per row.

### W1.S1 — `apps/mobile/src/screens/Splash.tsx`

**Title.** Implement the `01-Splash` chrome.

**Files touched.**
- `apps/mobile/src/screens/Splash.tsx` (REWRITTEN; replaces placeholder body).
- `apps/mobile/src/screens/__tests__/Splash.test.tsx` (new) — vitest snapshot.

**Behaviour.** Centered wordmark "DiffuseCraft" (token `text-display-lg`), small caption "Connecting to your studio…" (token `text-secondary text-caption`), single indeterminate `Progress` hairline. No buttons. Background `bg-canvas`. Strings from `_strings/splash.ts`. Cite snapshot: `apps/mobile/design-snapshot/01-Splash/preview.png`.

**Acceptance check.**
- File ≤ 100 lines.
- `tsc --noEmit` clean. Snapshot test green.
- The route still auto-replaces to the next stack on `connectionStore` resolution (logic from `app-shell-navigation`'s `Splash.tsx` is preserved — chrome is the visual layer only).

**Dependencies.** T0a, T0b, T0c.

**Size.** S.

---

### W1.S2 — `apps/mobile/src/screens/Pairing/MDNS.tsx`

**Title.** Implement the `02-Pairing-mDNS` chrome.

**Files touched.**
- `apps/mobile/src/screens/Pairing/MDNS.tsx` (new; relocates `Pairing.MDNS.tsx` body).
- `apps/mobile/src/screens/__tests__/Pairing.MDNS.test.tsx` (new).

**Behaviour.** Title + subtitle. List of `MDNS_SERVERS_MOCK` rendered as `Card` rows: server icon (`Avatar`), name, IP:port (`mono`), tap-to-pair affordance (full-row `Pressable` logging `TODO(pairing-protocol)`). Empty state (rendered when `MDNS_SERVERS_MOCK.length === 0` — for v1 the mock is non-empty, but the empty state code path exists): centered illustration (use a `Skeleton` rectangle as illustration placeholder) + "No servers nearby" + 3 `Button variant="secondary"` (Scan QR, Enter code, Paste URL) navigating to the matching Pairing routes. Top-right help `Button variant="ghost"`. Bottom `mono` caption: "Don't have a server yet? Run `npx @diffusecraft/server` on your PC."

**Acceptance check.**
- File ≤ 200 lines.
- `tsc --noEmit` clean. Snapshot test green.
- Tapping each empty-state CTA pushes the matching Pairing route (verified in test by mocking `nav.navigate`).
- Strings come from `_strings/pairing-mdns.ts`.

**Dependencies.** T0a, T0b, T0c.

**Size.** S.

---

### W1.S3 — `apps/mobile/src/screens/Pairing/QR.tsx`

**Title.** Implement the `02b-Pairing-QR` chrome.

**Files touched.**
- `apps/mobile/src/screens/Pairing/QR.tsx` (new).
- `apps/mobile/src/screens/__tests__/Pairing.QR.test.tsx` (new).

**Behaviour.** Top: back chevron + title "Scan the QR on your server screen". Center: dark frame (a `View` with `bg-canvas`) with centered square cutout (a stroked `View` using `border-text-primary/60`). Brackets in the four corners (4 small absolute-positioned `View`s with `border-accent`-default when "detecting" is mocked-true in a local state). Helper text below: "Hold steady — auto-detects". Bottom row: 2 ghost buttons "Use a code instead" / "Paste URL" pushing to `Pairing.Code` / `Pairing.Manual`.

**Acceptance check.**
- File ≤ 150 lines.
- Snapshot test green. Strings from `_strings/pairing-qr.ts`.
- Cross-link buttons navigate to the right routes.

**Dependencies.** T0a, T0b, T0c.

**Size.** S.

---

### W1.S4 — `apps/mobile/src/screens/Pairing/Code.tsx`

**Title.** Implement the `02c-Pairing-Code` chrome.

**Files touched.**
- `apps/mobile/src/screens/Pairing/Code.tsx` (new).
- `apps/mobile/src/screens/__tests__/Pairing.Code.test.tsx` (new).

**Behaviour.** Title "Enter the 6-digit code shown on your server". Six separate digit boxes (each `bg-inset rounded-lg border-border-subtle h-14 w-12`). On-screen numeric pad: 3×4 grid of `Button variant="secondary" size="lg"` (each ≥ 56pt). Wrong-attempt state: `border-danger` for 600 ms after a mock-bad-attempt (state-driven, no real validation). Bottom secondary link: ghost `Button` "Try QR instead" → `nav.navigate('Pairing.QR')`.

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green (covering both default and wrong-attempt visual states via a state-toggle prop in the test).
- Strings from `_strings/pairing-code.ts`. Tapping a digit-pad key updates the local state `code: string` (max length 6).

**Dependencies.** T0a, T0b, T0c.

**Size.** S.

---

### W1.S5 — `apps/mobile/src/screens/Pairing/Manual.tsx`

**Title.** Implement the `02d-Pairing-Manual` chrome.

**Files touched.**
- `apps/mobile/src/screens/Pairing/Manual.tsx` (new).
- `apps/mobile/src/screens/__tests__/Pairing.Manual.test.tsx` (new).

**Behaviour.** Two `Input` fields with `Label`s above:
1. "Server URL" (placeholder `http://192.168.1.50:9876`).
2. "Pairing token" (mono via `Input` with `font-mono` + a trailing eye-icon button toggling `secureTextEntry`).
Single primary `Button` "Pair" (logs `TODO(pairing-protocol)`). Helper text per field via `Label` with `text-secondary text-caption`. Below form: a `Collapsible` "What's this?" with 4 short bullets in body text. Footer: ghost `Button` "Back to discovery" → `nav.goBack()`.

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green (collapsed and expanded states).
- Strings from `_strings/pairing-manual.ts`.

**Dependencies.** T0a, T0b, T0c.

**Size.** S.

---

## Wave 2 — Group B (4 parallel subagents)

After Wave 1 returns, the orchestrator dispatches all 4 in a single message.

### W2.S1 — `apps/mobile/src/screens/ServerPicker.tsx`

**Title.** Implement the `03-ServerPicker` chrome.

**Files touched.**
- `apps/mobile/src/screens/ServerPicker.tsx` (REWRITTEN).
- `apps/mobile/src/screens/__tests__/ServerPicker.test.tsx` (new).

**Behaviour.** Title "Your studios". Vertical list of `SERVERS_MOCK` rendered as `Card` rows: `Avatar` with server initial (computed from name), name (`title`), last-connected timestamp (`text-secondary text-caption`), online dot (`bg-success` or `bg-tertiary` 8×8 rounded-pill), capability chips (`Badge` per item, intent `accent` for "ComfyUI ✓" and `neutral` for the rest). Tap-to-connect logs `TODO(client-state-architecture)`. Long-press triggers `ContextMenu` with three items: Rename, Revoke token, Show audit log (each logs `TODO(...)`). FAB-style `Button variant="primary" size="lg"` "+ Pair new" anchored bottom-right, navigating to `PairingFlow`. Top-right: ghost `Button` icon-only (gear) navigating to `SettingsStack`.

**Acceptance check.**
- File ≤ 250 lines.
- Snapshot test green. ContextMenu open state captured.
- Strings from `_strings/server-picker.ts`.

**Dependencies.** Wave 1 returns.

**Size.** M.

---

### W2.S2 — `apps/mobile/src/screens/Documents.tsx`

**Title.** Implement the `04-Documents` chrome.

**Files touched.**
- `apps/mobile/src/screens/Documents.tsx` (REWRITTEN).
- `apps/mobile/src/screens/__tests__/Documents.test.tsx` (new).

**Behaviour.** Top app bar: app title (`title`) left, search `Input` center (with leading magnifier icon from `lucide-react-native`), `DropdownMenu` "Sort" + segmented `Tabs` "grid/list" right, `Avatar` (user) far-right. Body: `FlatList` (or grid `View` with `flex-row flex-wrap`) of `DOCUMENTS_MOCK` tiles. Each tile: `Card` with `Image` thumbnail (square 1:1 — see Open Q1), filename (`body-strong`), `lastEdit` (`caption text-secondary`), workspace badge (`Badge` intent `neutral`). Sticky `Button variant="primary" size="lg"` "+ New" bottom-right (`absolute`), logs `TODO(documents-create)`. Empty state (rendered when `DOCUMENTS_MOCK.length === 0`): `Skeleton` illustration rectangle + 2 CTAs ("Start blank", "Import image") logging `TODO(...)`.

**Acceptance check.**
- File ≤ 250 lines.
- Snapshot test green (populated grid + empty-state flavors via a render-prop test variant).
- Strings from `_strings/documents.ts`.
- `// TODO(designer-pass): thumbnail aspect ratio` comment present (per Open Q1).

**Dependencies.** Wave 1 returns.

**Size.** M.

---

### W2.S3 — `apps/mobile/src/screens/Settings/Index.tsx`

**Title.** Implement the `06-Settings` master+detail chrome.

**Files touched.**
- `apps/mobile/src/screens/Settings/Index.tsx` (new).
- `apps/mobile/src/screens/_shared/MasterDetailLayout.tsx` (new) — generic 320pt-left + flex-1 right layout.
- `apps/mobile/src/screens/__tests__/Settings.Index.test.tsx` (new).

**Behaviour.** Top bar: back chevron + title "Settings". Use `MasterDetailLayout`. Master column (320pt): vertical list of section names — Connection, Models & Presets, Agents, Speech, Appearance, Audit log, About. Each row is a `Pressable` with active row highlighted via `bg-accent-muted` (default active: About per Open Q3). Tapping a non-About row pushes the matching `Settings.<Section>` route. Detail column (right): About content rendered inline by default — version (mock string `"v1.0.0-dev"`), build (`"build local"`), `mono` rows for repo + license URLs, "Made by Suquía Bytes" footer. Plus the `__DEV__`-guarded debug-toggle Card (already added by `app-shell-navigation/T11`) — preserved at the bottom of the About content.

**Acceptance check.**
- File ≤ 250 lines (excluding `MasterDetailLayout.tsx`).
- Snapshot test green.
- Tapping "Connection" pushes `Settings.Connection`.
- About active row + content visible by default.
- Strings from `_strings/settings-index.ts`.

**Dependencies.** Wave 1 returns.

**Size.** M.

---

### W2.S4 — `apps/mobile/src/screens/Settings/Connection.tsx`

**Title.** Implement the `06a-Settings-Connection` chrome.

**Files touched.**
- `apps/mobile/src/screens/Settings/Connection.tsx` (new).
- `apps/mobile/src/screens/__tests__/Settings.Connection.test.tsx` (new).

**Behaviour.** Right-column content (no master here; the master list is shared via `MasterDetailLayout` if rendered as a stack push, but per `app-shell-navigation/design.md` §2 the seven Settings details ARE separate routes, so this file owns its full screen including a back chevron in a top bar). Sections (each a `Card` block, separated by `Separator`):

1. **Paired servers.** List of `SERVERS_MOCK` items: server name (`body-strong`), IP:port (`mono`), connected status (Badge `accent` if online, `neutral` if offline), last activity, "⋯" `DropdownMenu` icon-button (Rename, Revoke token, Show in audit log).
2. **Pairing.** Single `Button variant="primary" size="lg"` "Pair a new server" (the **only** accent on this screen) → `nav.navigate('PairingFlow')`.
3. **This device.** Editable `Input` "Device name" (default value: a mock string), public-key fingerprint as a copy-to-clipboard `Pressable` showing `mono` text + a copy icon.

**Acceptance check.**
- File ≤ 250 lines.
- Snapshot test green.
- Only one accent button on the screen ("Pair a new server").
- Strings from `_strings/settings-connection.ts`.

**Dependencies.** Wave 1 returns.

**Size.** M.

---

## Wave 3 — Group C (10 parallel subagents)

After Wave 2 returns, the orchestrator dispatches all 10 in a single message. Editor's `index.tsx` and `useEditorState.ts` are NOT in this wave — they are owned by the orchestrator's T-Final-1.

### W3.S1 — `apps/mobile/src/screens/Editor/LeftToolRail.tsx`

**Title.** Implement the 72pt vertical tool rail.

**Files touched.**
- `apps/mobile/src/screens/Editor/LeftToolRail.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/LeftToolRail.test.tsx` (new).

**Behaviour.** A 72pt-wide column. From top: 5 brush preset tiles (pen / pencil / marker / eraser / smooth) — each is a `Pressable` ≥ 56×56pt with a `lucide-react-native` icon and an active-state background `bg-accent-muted` (read from `editor.activeBrush`, mock-defaulted to `pen`). `Separator` (horizontal). 4 tool tiles (selection / transform / mask / eyedropper). `Separator`. Bottom: layers-toggle tile (`Button variant="ghost"`), undo, redo. Each tile logs `TODO(editor-tools)`. Active tool tile uses `bg-accent-muted`; press feedback uses `active:bg-elevated`.

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green.
- Every tile ≥ 56×56pt.
- Strings from `_strings/editor.ts`.

**Dependencies.** Wave 2 returns. Cannot start before T-Final-1's `useEditorState.ts` exists, but the orchestrator pre-publishes a stub of `useEditorState.ts` with the type signature and default values BEFORE Wave 3 dispatch (a 30-min orchestrator task in §"Pre-Wave-3 stub" below) so subagents can import and consume it.

**Size.** S.

---

### W3.S2 — `apps/mobile/src/screens/Editor/TopBar.tsx`

**Title.** Implement the 56pt top bar.

**Files touched.**
- `apps/mobile/src/screens/Editor/TopBar.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/TopBar.test.tsx` (new).

**Behaviour.** Three regions:
- **Left.** Back chevron (`Button variant="ghost"` icon-only) → `nav.goBack()`. Inline-editable `Input` for document name (mock value: `route.params.documentId`). Saved-indicator `Badge` ("Saved" with intent `success` neutral).
- **Center.** `WorkspaceTabs` component (segmented `Tabs` with 4 entries; calls `editor.setWorkspace`).
- **Right.** Connection chip (`Card` row inline: `Avatar` + server name from `SERVERS_MOCK[0]` + green dot). `Button variant="ghost"` icon "Share". `DropdownMenu` "More" with 3 items (Export, Duplicate, Delete — each logs `TODO`).

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green for each `editor.workspace` value (4 snapshots).

**Dependencies.** Wave 2 returns + `useEditorState.ts` stub.

**Size.** S.

---

### W3.S3 — `apps/mobile/src/screens/Editor/RightPanel/index.tsx`

**Title.** Right panel container — sub-tab routing.

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/index.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/index.test.tsx` (new).

**Behaviour.** 320pt-wide column with `bg-surface`. Sub-tabs strip at top (`Tabs` variant=`underlined` with 5 entries: Layers, History, Controls, Regions, Chat). Active tab is `editor.rightPanelTab`. Body region renders the active sub-tab component (`Layers`, `History`, `Controls`, `Regions`, `Chat`). When `editor.workspace === 'Live'`, the body slot renders `<LiveSettingsCard editor={editor} />` instead of the active sub-tab (Live overrides; per `05c-Editor-Live` brief).

**Acceptance check.**
- File ≤ 150 lines (mostly composition).
- Snapshot test green for each `rightPanelTab` value + Live override.

**Dependencies.** Wave 2 returns + `useEditorState.ts` stub. The 5 sub-tab files (W3.S4 through W3.S8) and `LiveSettingsCard.tsx` (W3.S8) are imported from this file; if they have not landed at the moment of W3.S3's authoring, stub them temporarily — the dispatch order in `design.md` §2.4 puts them in parallel, so they all converge by Wave 3 close.

**Size.** S.

---

### W3.S4 — `apps/mobile/src/screens/Editor/RightPanel/Layers.tsx`

**Title.** Layers sub-tab body.

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/Layers.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/Layers.test.tsx` (new).

**Behaviour.** `ScrollView` with `LAYERS_MOCK` items. Each row (`Card`-like): thumbnail (`Image` 32×32 `rounded-md`), name (`body`), visibility eye `Pressable` icon (toggles a local visible-state via `editor` setter — mock; logs `TODO(layers)`). Tap on row toggles an inline `Slider` opacity row beneath (per Open Q6, tap not long-press in v1; `// TODO(.pen-faithful)` comment). Active layer (mock: index 0) has `bg-accent-muted`. Bottom: `Button variant="secondary"` "+ Add layer".

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green.
- Strings from `_strings/editor.ts`.

**Dependencies.** Wave 2 returns + `useEditorState.ts` stub.

**Size.** S.

---

### W3.S5 — `apps/mobile/src/screens/Editor/RightPanel/History.tsx`

**Title.** History sub-tab body.

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/History.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/History.test.tsx` (new).

**Behaviour.** `ScrollView` of `HISTORY_ITEMS_MOCK` rendered as `Card`s: thumbnail + truncated prompt (`caption`) + timestamp (`mono caption text-secondary`). Each card has a long-press affordance (mock: a `Pressable onLongPress` logging `TODO(history-context-menu)`).

**Acceptance check.**
- File ≤ 150 lines.
- Snapshot test green.

**Dependencies.** Wave 2 returns + stub.

**Size.** S.

---

### W3.S6 — `apps/mobile/src/screens/Editor/RightPanel/Controls.tsx`

**Title.** Controls sub-tab body.

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/Controls.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/Controls.test.tsx` (new).

**Behaviour.** Per `05b-Editor-Inpaint` brief: shows structural control layers attached to the inpaint. List of control-layer rows (filter `LAYERS_MOCK` to `kind === 'structural' || kind === 'reference'`). Each row: type badge (`Badge` with intent matching kind), name, weight `Slider` (mock value 0.7), enabled `Switch`. Bottom: `Button variant="secondary"` "+ Add control".

**Acceptance check.**
- File ≤ 200 lines.
- Snapshot test green.

**Dependencies.** Wave 2 returns + stub.

**Size.** S.

---

### W3.S7 — `apps/mobile/src/screens/Editor/RightPanel/Regions.tsx`

**Title.** Regions sub-tab body.

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/Regions.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/Regions.test.tsx` (new).

**Behaviour.** v1 chrome shows an empty state because v1 mocks do not include a region fixture (regions ship as a real-data spec). The empty state: `Skeleton` illustration + "No regions yet" + `Button variant="secondary"` "Add region" (logs `TODO(regions)`). When real region data lands post-v1, this file is amended; the placeholder state is the v1 chrome.

**Acceptance check.**
- File ≤ 100 lines.
- Snapshot test green.
- A `// TODO(regions-spec)` comment marks the empty-state-only design.

**Dependencies.** Wave 2 returns + stub.

**Size.** XS.

---

### W3.S8 — `apps/mobile/src/screens/Editor/RightPanel/Chat.tsx` + `LiveSettingsCard.tsx`

**Title.** Chat sub-tab body AND Live settings card (paired because the chrome idiom is "card-with-rows" in both).

**Files touched.**
- `apps/mobile/src/screens/Editor/RightPanel/Chat.tsx` (new).
- `apps/mobile/src/screens/Editor/LiveSettingsCard.tsx` (new).
- `apps/mobile/src/screens/Editor/RightPanel/__tests__/Chat.test.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/LiveSettingsCard.test.tsx` (new).

**Behaviour — `Chat.tsx`.** Per `05d-Editor-Chat-Open` brief: agent identity row at top (Avatar + agent name "Claude Code @ studio-iMac" + green dot). Message list `ScrollView` of `CHAT_MESSAGES_MOCK`:
- `role === 'user'`: bubble right-aligned, `bg-accent-muted`, `text-primary`.
- `role === 'agent'`: bubble left-aligned, `bg-elevated`, `text-primary`.
- `role === 'tool-call'`: distinct card style (icon `🛠`, `mono` for tool name + args, expandable `Collapsible`).
Bottom: input row with mic `Button` (left, prominent, ≥ 56×56), `Textarea` (center, single-line growable), send `Button variant="primary"` (right). Each interactive logs `TODO(chat)`.

**Behaviour — `LiveSettingsCard.tsx`.** Per `05c-Editor-Live` brief: a `Card` with rows:
- "Continuous regen" + `Switch` bound to `editor.liveContinuousRegen`.
- "Fixed seed" + `Switch` bound to `editor.liveSeedLocked` (default ON).
- Latency readout: `mono` text "230 ms" (mock).

**Acceptance check.**
- Both files ≤ 200 lines each.
- Snapshot tests green for each.
- Strings from `_strings/editor.ts`.

**Dependencies.** Wave 2 returns + stub.

**Size.** M.

---

### W3.S9 — `apps/mobile/src/screens/Editor/BottomPromptBar.tsx` + `InpaintModeChips.tsx`

**Title.** Floating prompt bar AND Inpaint sub-mode chip row (paired because the chips render directly above the prompt bar input only when workspace=Inpaint).

**Files touched.**
- `apps/mobile/src/screens/Editor/BottomPromptBar.tsx` (new).
- `apps/mobile/src/screens/Editor/InpaintModeChips.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/BottomPromptBar.test.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/InpaintModeChips.test.tsx` (new).

**Behaviour — `BottomPromptBar.tsx`.** Floating bar: max-w 720pt, h 64pt, `rounded-lg`, `bg-elevated`, anchored bottom-center via `absolute` positioning. Layout: large mic `Button variant="ghost"` icon-only ≥ 56×56 left (logs `TODO(speech-to-text)`), `Input` center (placeholder "Describe what to generate…", strings from `_strings/editor.ts`), enhance `Button variant="ghost"` icon-only ✨ next, primary action `Button variant="primary" size="lg"` right. Primary action **label** is dynamic per `editor.workspace`:
- `Generate` → "Generate"
- `Inpaint` → matches `editor.inpaintMode` ("Fill" / "Expand" / etc.)
- `Upscale` → "Upscale to 2×"
- `Live` → "Stop Live" with `variant="secondary"` styling and `text-danger` foreground (per brief: outline + danger text, NOT full red).

Below the bar: a row with `Slider` (strength 0..100, label "Strength" + mock value text) and a horizontal `ScrollView` of preset chips (`Badge`s from `PRESETS_MOCK`). When `editor.workspace === 'Inpaint'`, render `<InpaintModeChips editor={editor} />` ABOVE the input row.

**Behaviour — `InpaintModeChips.tsx`.** Pill `Tabs` (variant `segmented`, `sm` size for chip-row sub-element exception per `ui-component-library` FR-13) with 5 values: Fill, Expand, Add, Remove, Replace bg. Active value: `editor.inpaintMode`. On tap: `editor.setInpaintMode(...)`.

**Acceptance check.**
- Both files ≤ 200 lines each.
- Snapshot tests green for every (workspace × inpaint-mode) permutation that's reachable.
- Mic and primary action ≥ 56×56pt.

**Dependencies.** Wave 2 returns + stub.

**Size.** M.

---

### W3.S10 — `apps/mobile/src/screens/Editor/CanvasPlaceholder.tsx` + `WorkspaceTabs.tsx`

**Title.** Canvas placeholder rectangle AND segmented workspace tabs (paired because both are presentation-thin).

**Files touched.**
- `apps/mobile/src/screens/Editor/CanvasPlaceholder.tsx` (new).
- `apps/mobile/src/screens/Editor/WorkspaceTabs.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/CanvasPlaceholder.test.tsx` (new).
- `apps/mobile/src/screens/Editor/__tests__/WorkspaceTabs.test.tsx` (new).

**Behaviour — `CanvasPlaceholder.tsx`.** A centered rectangle with a subtle dotted boundary (`borderStyle: 'dashed'`, `border-border-subtle`) sized to the `.pen` canvas extents (e.g., 1024×768pt, `// TODO(.pen-snapshot)`). Background `bg-canvas`. Center text "Canvas — see canvas-fundamentals spec" (token `text-secondary text-body`). When `editor.selectionMock === true`, overlay a second `View` with `borderStyle: 'dashed'` and animated border (mock — no actual animation in v1; use a static dashed `border-text-primary`). Top-right corner overlay: `Card` with `mono` rows showing zoom (`100%`), fit, 1:1 (each is a `Button variant="ghost" size="sm"`). When `editor.workspace === 'Live'`, an additional thumbnail `Card` floats top-right showing the "last completed frame" (mock: `Image` from `HISTORY_ITEMS_MOCK[0].thumbnail`).

**Behaviour — `WorkspaceTabs.tsx`.** `Tabs` variant `segmented` with 4 values: Generate, Inpaint, Upscale, Live. Active value: `editor.workspace`. On change: `editor.setWorkspace(value)`.

**Acceptance check.**
- Both files ≤ 200 lines each (CanvasPlaceholder will be the larger of the two).
- Snapshot test green: 4 workspace × 2 selectionMock variations for CanvasPlaceholder.
- Strings from `_strings/editor.ts`.

**Dependencies.** Wave 2 returns + stub.

**Size.** S.

---

## Pre-Wave-3 stub (orchestrator, ≤ 30 min)

Before dispatching Wave 3, the orchestrator authors a TYPE-ONLY stub of `apps/mobile/src/screens/Editor/useEditorState.ts` containing:
- The `EditorLocalState` and `EditorLocalActions` types from `design.md` §4.3.
- A stubbed `useEditorState()` returning `{} as EditorLocalState & EditorLocalActions` (cast to satisfy `tsc`).
- A `// TODO(orchestrator-T-Final-1): replace stub with real implementation after Wave 3 returns` comment.

This unblocks Wave 3 subagents to import the hook and consume its types. T-Final-1 replaces the stub with the real implementation.

**Files touched.**
- `apps/mobile/src/screens/Editor/useEditorState.ts` (new — stub form).

**Size.** XS.

---

## T-Final-1 — Wire `Editor/index.tsx` and finish `useEditorState.ts`

**Title.** Orchestrator-only: assemble Editor's composition root and replace the `useEditorState.ts` stub with the real implementation.

**Files touched.**
- `apps/mobile/src/screens/Editor/index.tsx` (new) — composition per `design.md` §4.4.
- `apps/mobile/src/screens/Editor/useEditorState.ts` (REWRITTEN) — real implementation per `design.md` §4.3.
- `apps/mobile/src/screens/Editor/__tests__/Editor.permutations.test.tsx` (new) — vitest renders all 4 `.pen` Editor variants by mounting the composed `Editor/index.tsx` with the four hydration states from `EditorLocalState`. Asserts no throw, snapshots the tree.
- `apps/mobile/src/screens/__tests__/Editor.test.tsx` (existing or new) — top-level snapshot mounting the screen with default route params.

**Acceptance check.**
- All 4 `.pen` Editor permutations render: Generate / Inpaint / Live / Chat-Open.
- File `Editor/index.tsx` ≤ 200 lines.
- `tsc --noEmit` clean.
- Tapping a workspace tab in TopBar updates the canvas, right-panel default, and primary action label simultaneously (verified in test).

**Dependencies.** Wave 3 returns.

**Size.** S.

---

## T-Final-2 — Generate `coverageReport.md`

**Title.** Aggregate the subagent reports into `apps/mobile/src/screens/coverageReport.md`.

**Files touched.**
- `apps/mobile/src/screens/coverageReport.md` (new) — per `design.md` §6.

**Behaviour.** The orchestrator collects the (e), (f) sections from each subagent's reply (primitives used, mocks consumed, tokens used, gaps, open questions) and produces three sections:
1. **Per-primitive coverage** — for each of the 25 `@diffusecraft/ui` primitives, list consumers.
2. **Per-screen coverage** — for each of the 13 implemented screens, list primitives + mocks + tokens.
3. **Candidates for removal** — primitives never used (e.g., `Toast`, `AlertDialog`, `Combobox`); each row carries a recommendation (keep / remove / defer).

**Acceptance check.**
- `coverageReport.md` exists and references all 25 primitives by name (a vitest test asserts this).
- The orchestrator commits the file with the message `docs(mobile): add screens-implementation coverage report`.

**Dependencies.** T-Final-1.

**Size.** S.

---

## T-Final-3 — Re-run navigation coverage + update barrels

**Title.** After the directory restructuring (Pairing/* and Settings/*), re-run `routesCoverage.test.ts` and update navigator imports to keep the navigation contract intact.

**Files touched.**
- `apps/mobile/src/navigation/AuthStack.tsx` (UPDATED) — keep registered route names (`Splash`, `PairingFlow`); the nested `PairingFlow.tsx` updates its imports.
- `apps/mobile/src/navigation/PairingFlow.tsx` (UPDATED) — imports change from `../screens/Pairing.MDNS` etc. to `../screens/Pairing/MDNS` etc.
- `apps/mobile/src/navigation/SettingsStack.tsx` (UPDATED) — imports change from `../screens/Settings.<X>` to `../screens/Settings/<X>`.
- `apps/mobile/src/navigation/RootStack.tsx` (UPDATED) — imports change for `Editor` (now `./screens/Editor` directory entry-point) and the relocated `Settings/Index`.
- `apps/mobile/src/screens/index.ts` (UPDATED) — re-exports the new file paths.
- (No changes to `types.ts` or `linking.ts`; the route names are preserved.)

**Behaviour.** Per `app-shell-navigation/NFR-4` ("Adding a new Settings sub-section is a 3-line change"), the inverse — moving an existing screen — is similarly a 3-line change. The `routesCoverage.test.ts` from `app-shell-navigation/T10` is the gate: route name changes would fail it; route file relocations do not (the test reads route names, not file paths).

**Acceptance check.**
- `pnpm --filter mobile test apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` passes.
- Cold-start `pnpm --filter mobile dev` lands on `Splash` then auto-replaces correctly per `RootRouter`.
- `xcrun simctl openurl booted diffusecraft://settings/connection` opens `Settings/Connection.tsx` (the new chrome).
- `tsc --noEmit` clean.

**Dependencies.** T-Final-1, T-Final-2.

**Size.** S.

---

## Dependency order

```
T0a (token-gap audit) ─┐
T0b (mocks)            ├─→ Wave 1 (5 parallel) ─┐
T0c (strings)          │                        │
                       │                        ├─→ Wave 2 (4 parallel) ─┐
                       │                        │                        │
                       │                        │                        ├─→ Pre-W3 stub ─→ Wave 3 (10 parallel) ─→ T-Final-1 ─→ T-Final-2 ─→ T-Final-3
```

Linear-friendly read: **T0a → (T0b ∥ T0c) → Wave 1 → Wave 2 → Pre-W3 stub → Wave 3 → T-Final-1 → T-Final-2 → T-Final-3**.

Multi-agent execution (per `design.md` §2):

- One orchestrator session.
- Wave 1: 5 implementer subagents in parallel.
- Wave 2: 4 implementer subagents in parallel.
- Wave 3: 10 implementer subagents in parallel (paired files where noted).
- Orchestrator owns T0a, T0b, T0c, Pre-W3 stub, T-Final-1, T-Final-2, T-Final-3.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `.pen` snapshot not yet present (FR-11) | Implement against the brief alone with `// TODO(.pen-snapshot)` comments. `visual-verification` flags divergences; orchestrator dispatches re-do subagents on affected files. |
| Token gaps from `ui-component-library` §9 not landed | T0a forces a decision (landed vs tolerated). Tolerated mode adds `// TODO(token-gap-soft-fills)` annotations everywhere semantic fills are needed; the chrome uses opacity-on-saturated as a fallback. |
| Subagent silently adds a new `@diffusecraft/ui` component or a new token | Subagent prompt forbids it (explicit in the verbatim template). Orchestrator reviews subagent replies for any "I added X" report and rejects the patch if found; routes the gap to the upstream spec amendment. |
| Editor sub-components diverge on the `editor` prop shape | The `useEditorState` stub (Pre-Wave-3) freezes the shape via TypeScript. Sub-components consume it by import; deviations fail `tsc`. |
| Pairing flow / Settings restructuring breaks navigator imports | T-Final-3's `routesCoverage.test.ts` is the gate. Route names are preserved; only file paths move. Imports updated in 4 navigator files. |
| `coverageReport.md` becomes stale | Generated by T-Final-2 from subagent reply data. Re-running T-Final-2 after a chrome change refreshes it; the freshness vitest test asserts every primitive is referenced. |
| Wave 3 subagents over-couple via the `editor` prop (any setter triggers re-render of every sub-component) | Setters are wrapped in `useCallback`; sub-components destructure only what they read from `editor`. Performance pass deferred to a profiling spec; not in scope for chrome v1. |
| Editor `index.tsx` ends up larger than 200 lines | Split would push compositional logic into a sub-component; if needed, the orchestrator extracts a `<EditorLayout>` helper. Risk mitigated because chrome composition is intentionally thin (sub-components own their own chrome). |
| The 5 out-of-scope Settings details cause confusion (relocated but unchanged) | T-Final-3 explicitly relocates them with body unchanged. `requirements.md` §3.9 / FR-18 documents the scope clearly. `coverageReport.md` notes them as "out of scope — placeholder body retained". |
| Mock thumbnails leak as if they were real | They are 256×256 solid-colour-with-label PNGs (per FR-8); a manual smoke confirms they read as placeholder. |
| `routesCoverage.test.ts` becomes brittle if it walks file paths | The test (per `app-shell-navigation/T10`) walks route names, not file paths — the relocation does not affect it. Verified in T-Final-3. |
| Future i18n spec breaks the `_strings/<screen>.ts` shape | The current shape is a const object with named fields. A future i18n spec wraps the import with `t()`; the const stays as the source dictionary. No breakage. |
| Snapshot test churn when chrome changes | Expected and accepted. Reviewers approve snapshot diffs as part of chrome PRs; the test is the gate, not the artifact. |
