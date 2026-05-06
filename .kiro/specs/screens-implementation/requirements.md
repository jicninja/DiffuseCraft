# screens-implementation — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + Tailwind config + `darkTheme`); `ui-component-library` (the 25 in-tree primitives + `ToastProvider` + `Sheet`); `app-shell-navigation` (16 typed routes + `<Placeholder>` body shape + `RootRouter` conditional root + `connectionStore.stub` + deep-link map).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables" and §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout" and §"Naming conventions"; `.kiro/steering/product.md` §"Glossary" (Workspace, Chat panel, Pairing); `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers" (the 13 artboard briefs — these ARE the visual specifications for this spec); `prompts/ui-implementation-orchestrator.md` (the orchestrator pattern this spec replicates); `_ui-implementation-roadmap.md` row 4; `.kiro/specs/workspaces/{requirements,design}.md` (4 workspaces drive Editor's internal tab state); future spec `visual-verification` (consumer of the visual output produced here); future spec `canvas-fundamentals` (owner of the actual canvas; not this spec).

## 1. Purpose

This spec turns the 16 placeholder screens landed by `app-shell-navigation` into running **chrome** that visually matches the canonical `.pen` design. After this spec is implemented, `apps/mobile` is a navigable, no-data, no-network app: every screen renders the layout, panels, lists, cards, and chips from its `.pen` artboard, every action button logs `TODO(<spec-slug>)` to the console, and every list/state is a hardcoded mock. No real ComfyUI, no real MCP, no real pairing, no real canvas rendering.

Concretely, this spec:
- Replaces the `<Placeholder>` body of 13 screens (one per `.pen` artboard) with hand-coded chrome built exclusively from `@diffusecraft/ui` primitives, consuming tokens by name.
- Treats Editor's four `.pen` variants (`05-Editor-Generate`, `05b-Editor-Inpaint`, `05c-Editor-Live`, `05d-Editor-Chat-Open`) as states of a single route (per `app-shell-navigation` FR-9) — not as four separate routes. Workspace tab + chat panel + selection-mock + inpaint-mode are local state in the Editor screen.
- Ships a `_mock/` directory of hardcoded fixtures (servers, documents, layers, history items, chat messages, presets) so every list and tile has plausible content without touching a real store.
- Ships a `_strings/` directory of English string constants per screen so a future i18n pass swaps the source without touching JSX.
- Uses the `apps/mobile/design-snapshot/<artboard>/preview.png` files as visual references at design-time only — never imported at runtime. The runtime-side comparison is owned by `visual-verification` (spec 5).
- Encodes the multi-agent execution strategy as a first-class part of the spec: the implementation runs as orchestrator + 13 parallel implementer subagents in three waves (A: trivial, B: medium, C: hero/Editor). Each subagent touches only its assigned file(s).

The 5 Settings detail routes without `.pen` artboards (`Settings.Models`, `Settings.Agents`, `Settings.Speech`, `Settings.Appearance`, `Settings.AuditLog`) are explicitly **out of scope** for this spec — they remain as placeholders rendered by the `<Placeholder>` body landed in `app-shell-navigation`. They will be filled by a future design pass.

Real data wiring, animations beyond `react-native-reanimated` defaults, full a11y audit, phone fallback layout, light theme, and the Editor canvas itself (owned by `canvas-fundamentals`) are also out of scope.

## 2. Stakeholders & user stories

### S1 — Designer comparing the running app to the `.pen` artboards
> **Story 1.** As the design reviewer cross-checking the running app against the `.pen` design, I cold-launch `pnpm --filter mobile dev`, deep-link to each of the 13 routes (`diffusecraft://documents`, `diffusecraft://editor/sample-doc?workspace=inpaint`, `diffusecraft://settings/connection`, etc.) and visually compare the rendered chrome side-by-side with `apps/mobile/design-snapshot/<artboard>/preview.png`. Layouts, paddings, panel positions, chip colours, and type rhythm match within the `visual-verification` thresholds.

### S2 — Screen author working on Group C (Editor sub-components)
> **Story 2.** As an `apps/mobile` developer assigned the Editor `RightPanel/Layers.tsx` sub-component, I open `apps/mobile/design-snapshot/05-Editor-Generate/preview.png` for the visual reference, read `prompts/pencil-design-screens.md` §"05-Editor-Generate" for the brief, import `Card`, `Slider`, `Avatar` from `@diffusecraft/ui`, import the `LAYERS_MOCK` array from `apps/mobile/src/screens/_mock/layers.ts`, and render the layers list. I do not need to know about the workspace tab state, the chat panel, or any other Editor sub-component — my file is the entire scope of my edit.

### S3 — Agent / smoke test verifying chrome navigates correctly after the swap
> **Story 3.** As an end-to-end smoke harness running after this spec lands, I deep-link to every route in turn (the 16 routes from `app-shell-navigation`), assert the screen renders without throwing, and snapshot the resulting tree. The 11 routes with `.pen` artboards render the spec's chrome; the 5 Settings detail routes without `.pen` artboards still render the `<Placeholder>` body from `app-shell-navigation`. None throw, none import business logic, none reach the network.

### S4 — Mobile QA running a smoke pass on real hardware
> **Story 4.** As a QA engineer running `pnpm --filter mobile ios` on a real iPad with Apple Pencil, I tap through every chrome surface, exercise the workspace-tab swap in Editor (Generate → Inpaint → Live → Chat-Open), watch every action button log `TODO(<spec-slug>)` to the Metro console, and confirm no button silently no-ops. I confirm the LeftToolRail tools are 44×44pt minimum, the BottomPromptBar's mic and Generate buttons are easy to hit with a stylus, and the right panel scrolls smoothly.

### S5 — Future developer wiring real data into one of these screens
> **Story 5.** As the engineer landing the real `documentsStore` in a later spec, I open `apps/mobile/src/screens/Documents.tsx`, replace the `import { DOCUMENTS_MOCK } from './_mock/documents';` line with `const docs = useDocumentsStore((s) => s.documents);`, delete the matching mock file from `_mock/`, and the rest of the screen file is untouched. Mocks were the **only** thing the chrome read; chrome is data-shape-agnostic beyond what the mock declared.

### S6 — Orchestrator running the multi-agent implementation
> **Story 6.** As the orchestrator dispatching subagents to implement this spec, I read `tasks.md`, dispatch Wave 1 (5 subagents in one message), wait, dispatch Wave 2 (4 subagents in one message), wait, dispatch Wave 3 (10 subagents in one message), then myself wire `Editor/index.tsx` from the returned sub-components. Each subagent touches only its assigned file(s); cross-cutting changes (token additions, new components, route additions) are forbidden and trigger an upstream-spec amendment, not a silent edit.

## 3. Functional requirements (EARS)

### 3.1 The 13 screens to implement

**FR-1 (Ubiquitous).** This spec SHALL replace the `<Placeholder>` body of the following 13 screen files, each cross-referenced to its `.pen` artboard:

| # | `.pen` artboard | Screen file (post this spec) |
|---|---|---|
| 1 | `01-Splash` | `apps/mobile/src/screens/Splash.tsx` |
| 2 | `02-Pairing-mDNS` | `apps/mobile/src/screens/Pairing/MDNS.tsx` |
| 3 | `02b-Pairing-QR` | `apps/mobile/src/screens/Pairing/QR.tsx` |
| 4 | `02c-Pairing-Code` | `apps/mobile/src/screens/Pairing/Code.tsx` |
| 5 | `02d-Pairing-Manual` | `apps/mobile/src/screens/Pairing/Manual.tsx` |
| 6 | `03-ServerPicker` | `apps/mobile/src/screens/ServerPicker.tsx` |
| 7 | `04-Documents` | `apps/mobile/src/screens/Documents.tsx` |
| 8 | `06-Settings` | `apps/mobile/src/screens/Settings/Index.tsx` (master-detail; About in detail by default) |
| 9 | `06a-Settings-Connection` | `apps/mobile/src/screens/Settings/Connection.tsx` |
| 10 | `05-Editor-Generate` | `apps/mobile/src/screens/Editor/index.tsx` (workspace=`Generate`, chat=closed) |
| 11 | `05b-Editor-Inpaint` | same file (workspace=`Inpaint`) |
| 12 | `05c-Editor-Live` | same file (workspace=`Live`) |
| 13 | `05d-Editor-Chat-Open` | same file (workspace=`Generate`, chat=open) |

The Pairing flow's four screens are reorganised under `apps/mobile/src/screens/Pairing/` for cohesion (was `Pairing.MDNS.tsx` etc. in `app-shell-navigation`); the route names declared in `app-shell-navigation/types.ts` are preserved, only the file location changes. The `Settings.Index.tsx` file similarly moves to `Settings/Index.tsx`. See `design.md` §1 for the exact path map.

**FR-2 (Ubiquitous).** Editor's four `.pen` variants (`05`, `05b`, `05c`, `05d`) SHALL be implemented as **states of a single route**, NOT as four routes. The state shape SHALL be:

```typescript
interface EditorLocalState {
  workspace: 'Generate' | 'Inpaint' | 'Upscale' | 'Live';
  rightPanelTab: 'Layers' | 'History' | 'Controls' | 'Regions' | 'Chat';
  chatOpen: boolean;            // true ↔ rightPanelTab === 'Chat'; deep-link hydration may set this
  selectionMock: boolean;       // mock for inpaint preview; true shows marching-ants rectangle on canvas placeholder
  inpaintMode: 'Fill' | 'Expand' | 'Add' | 'Remove' | 'ReplaceBg';  // only meaningful when workspace === 'Inpaint'
  liveContinuousRegen: boolean; // only meaningful when workspace === 'Live'
  liveSeedLocked: boolean;      // only meaningful when workspace === 'Live'
}
```

Initial state is hydrated from route params (`workspace`, `chat`) per `app-shell-navigation/design.md` §9.2; thereafter changes are local. This invariant defends `app-shell-navigation` FR-9 — Editor stays a single route. See `design.md` §4 for the full rationale.

### 3.2 Chrome construction rules

**FR-3 (Ubiquitous).** Screen files SHALL use ONLY `@diffusecraft/ui` primitives for chrome elements. Allowed:
- React Native primitives `View`, `Text`, `ScrollView`, `Image`, `Pressable` (for layout containers and raw views; `View` for layout, `Text` only inside `<Label>` or as children of `<Card>` / `<Button>`).
- Every component listed in `ui-component-library/requirements.md` §3.1 (the 25 primitives).

Forbidden:
- `Button`, `Switch`, `Slider`, etc. from `react-native` (use `@diffusecraft/ui` versions).
- Any third-party UI kit (NativeBase, Paper, Tamagui, Gluestack, etc.) — already banned by `tech.md` §"Client UI" rules.
- `react-native-reusables` runtime imports — already banned by `ui-component-library` FR-15.
- Inline `style={{ ... }}` props for colours, spacing, radii, or typography. NativeWind `className` is the styling channel.

**FR-4 (Ubiquitous).** Screen files SHALL consume tokens BY NAME ONLY:
- Tailwind classes for static styling (`bg-canvas`, `text-primary`, `rounded-lg`, `p-4`, `text-display-lg`).
- `useTheme()` from `@diffusecraft/ui` for runtime token reads (gradient stops, native shadow specs, dynamic tints if any).

The no-raw-hex CI rule landed in `design-system-foundation` T7 enforces this; introducing `style={{ color: '#ff0000' }}` fails CI.

**FR-5 (Ubiquitous).** Screen files SHALL NOT contain real business logic. Specifically:
- No imports of `@diffusecraft/diffusion-client`, `@diffusecraft/server`, `@diffusecraft/canvas-core`, `@diffusecraft/canvas-skia`. (Already banned by `app-shell-navigation` acceptance criterion 10; this spec inherits the rule.)
- No `fetch`, `XMLHttpRequest`, `WebSocket`, or any networking primitive.
- No imports from a real Zustand store (`useDocumentsStore`, `useEditorStore`, etc.) — those stores will land in `client-state-architecture`.
- Every action button (Generate, Pair, Fill, Stop Live, Pair a new server, etc.) SHALL call `console.log("TODO(<spec-slug>)", "<short action descriptor>")`. The `<spec-slug>` is the slug of the future spec that will wire that action (e.g., `pairing-protocol`, `generation-workflow`, `inpaint-flow`); when that slug is unknown, use `screens-implementation` and add a `// TODO(<future-spec>)` comment.

**FR-6 (Ubiquitous).** The Editor canvas area SHALL NOT render a real canvas. It is a placeholder rectangle (sized per the `.pen` brief: centered, with a subtle dotted boundary indicating canvas size, surrounded by `bg-canvas`) showing the text "Canvas — see canvas-fundamentals spec" in `text-secondary`. When `selectionMock === true`, an additional dashed-outline rectangle (marching-ants placeholder) is overlaid; this is purely visual and triggers no behaviour.

### 3.3 Mock data conventions

**FR-7 (Ubiquitous).** A single `apps/mobile/src/screens/_mock/` directory SHALL hold all hardcoded fixtures consumed by chrome. Every screen imports from there; no screen declares its mock data inline. The required fixtures:

- `servers.ts` — 3 paired servers with `{ id, name, ip, port, online, lastConnected, capabilityChips: string[] }`.
- `documents.ts` — 8 document tiles with `{ id, name, thumbnailUri, lastEdit, workspace }`.
- `layers.ts` — 4 layers with `{ id, name, kind: 'paint' | 'ref' | 'structural', visible, opacity, thumbnailUri }`.
- `historyItems.ts` — 6 generation history items with `{ id, prompt, thumbnailUri, timestamp }`.
- `chatMessages.ts` — 4 messages alternating user / agent + 1 inline tool-call card. Shape: `{ id, role: 'user' | 'agent' | 'tool-call', text?, toolName?, toolArgs? }`.
- `presets.ts` — 6 chip presets with `{ id, label }`.
- `mdnsServers.ts` — 3 discovered servers for the Pairing-mDNS screen with `{ name, ip, port }`.

Every mock array SHALL be a top-level `const` exported as a named export. No factory functions, no random data, no `Date.now()` — fixtures are deterministic so snapshots are stable.

**FR-8 (Ubiquitous).** Thumbnail URIs in mocks SHALL be `require()`d local placeholder PNGs colocated under `apps/mobile/src/screens/_mock/_thumbs/` (1 per fixture: `doc-1.png` … `doc-8.png`, etc.). The placeholder PNGs are 256×256 solid-colour-with-label images checked into git. They are NOT the real artboard previews — the artboard previews live under `apps/mobile/design-snapshot/` and are design-time-only references.

### 3.4 String constants

**FR-9 (Ubiquitous).** A `apps/mobile/src/screens/_strings/` directory SHALL hold one file per screen (`splash.ts`, `pairing-mdns.ts`, `editor.ts`, etc.) exporting a single named `const` object of strings used by that screen. Every English string visible in JSX SHALL come from this file; no inline literals in JSX. Example:

```typescript
// apps/mobile/src/screens/_strings/pairing-mdns.ts
export const PAIRING_MDNS_STRINGS = {
  title: 'Find your DiffuseCraft server',
  subtitle: "We'll look on your network",
  emptyTitle: 'No servers nearby',
  emptyHelpQR: 'Scan QR',
  emptyHelpCode: 'Enter code',
  emptyHelpManual: 'Paste URL',
  footerHint: "Don't have a server yet? Run `npx @diffusecraft/server` on your PC.",
} as const;
```

Justification: a future i18n spec swaps `_strings/<screen>.ts` to a `t()` wrapper without touching JSX. v1 ships constants only; no `t()` wrapper, no react-i18next.

### 3.5 Snapshot ingestion contract

**FR-10 (Ubiquitous).** Each screen's chrome is hand-coded against the brief in `prompts/pencil-design-screens.md` §"WAVE 2" and the visual reference at `apps/mobile/design-snapshot/<artboard>/preview.png`. The snapshot PNG is consulted **at design-time only** and is **never imported at runtime**. The screen file SHALL NOT contain `import preview from '../../design-snapshot/...'` or any equivalent.

**FR-11 (Unwanted).** IF the snapshot directory is missing for an artboard (because `design-system-foundation/T1` ran in placeholder mode per its FR-11), the implementer SHALL fall back to the brief in `prompts/pencil-design-screens.md` and mark every layout offset/size as `// TODO(.pen-snapshot)`. The chrome SHALL still be implemented with reasonable defaults; the comment is the gate for re-review once the snapshot lands.

**FR-12 (Ubiquitous).** Layout offsets / sizes that come from `design-snapshot/<artboard>/layout.json` (when present) SHALL be encoded as constants at the top of the screen file (e.g., `const LEFT_RAIL_WIDTH = 72`). They SHALL NOT be inlined as raw numbers in JSX. This makes a future snapshot update a one-line change per constant.

### 3.6 Multi-agent execution requirement

**FR-13 (Ubiquitous).** The implementation of this spec SHALL run as orchestrator + 13 parallel implementer subagents, dispatched in three waves:

| Wave | Group | Subagent count | Files |
|---|---|---|---|
| 1 | Group A — trivial | 5 | Splash + 4 Pairing |
| 2 | Group B — medium | 4 | ServerPicker, Documents, Settings.Index, Settings.Connection |
| 3 | Group C — Editor sub-components | 10 | LeftToolRail, TopBar, RightPanel/{index,Layers,History,Controls,Regions,Chat}, BottomPromptBar, CanvasPlaceholder, WorkspaceTabs (LiveSettingsCard and InpaintModeChips ride along inside their parent files; `useEditorState.ts` is built by the orchestrator) |

Editor's `index.tsx` is implemented LAST by the orchestrator after Wave 3's sub-components return. See `design.md` §2 for the full dispatch pattern, including the verbatim subagent prompt template.

**FR-14 (Ubiquitous).** Each subagent SHALL touch ONLY its assigned screen file(s). Cross-cutting changes are forbidden:
- Adding a new component to `@diffusecraft/ui` is forbidden — surface as a missing primitive in the subagent's reply; the orchestrator routes it to a `ui-component-library` amendment.
- Adding a new token to `tailwind.config.js` is forbidden — surface as a token gap; the orchestrator routes it to a `design-system-foundation` amendment.
- Adding a new route or modifying `app-shell-navigation/types.ts` is forbidden — surface as a routing gap; the orchestrator routes it to an `app-shell-navigation` amendment.

**FR-15 (Ubiquitous).** Each subagent's reply SHALL include: (a) one-paragraph summary of what was implemented, (b) list of `@diffusecraft/ui` primitives used, (c) list of mock fixtures consumed, (d) tokens used (by name), (e) any tokens or primitives that were missing (gap report), (f) any open questions for the orchestrator.

### 3.7 Editor sub-component organisation

**FR-16 (Ubiquitous).** The Editor screen SHALL be split into the following sub-components, each in its own file under `apps/mobile/src/screens/Editor/`:

| File | Role | Used in workspaces |
|---|---|---|
| `index.tsx` | Composition root: assembles all sub-components based on `EditorLocalState`. | All |
| `LeftToolRail.tsx` | 72pt vertical rail: brushes, separator, selection / transform / mask / eyedropper, layers toggle, undo/redo. | All |
| `TopBar.tsx` | 56pt top bar: back chevron + doc-name + saved indicator (left), workspace tabs (center), connection chip + share + more (right). | All |
| `RightPanel/index.tsx` | 320pt right panel: hosts the active sub-tab. | All |
| `RightPanel/Layers.tsx` | Layers sub-tab content. | Default for Generate |
| `RightPanel/History.tsx` | History sub-tab content. | All |
| `RightPanel/Controls.tsx` | Control layers sub-tab content. | Default for Inpaint |
| `RightPanel/Regions.tsx` | Regions sub-tab content. | All |
| `RightPanel/Chat.tsx` | Chat tab content (replaces other sub-tabs when `chatOpen === true`). | All |
| `BottomPromptBar.tsx` | Floating prompt bar: mic + input + enhance + primary action button. | All |
| `CanvasPlaceholder.tsx` | Canvas-area placeholder rectangle + zoom overlay. | All |
| `WorkspaceTabs.tsx` | Segmented tabs (Generate / Inpaint / Upscale / Live) used by `TopBar`. | All |
| `LiveSettingsCard.tsx` | Live-only card: continuous-regen toggle, fixed-seed lock, latency readout. Rendered inside `RightPanel` when `workspace === 'Live'`. | Live |
| `InpaintModeChips.tsx` | Sub-mode pill row (Fill / Expand / Add / Remove / Replace bg). Rendered inside `BottomPromptBar` when `workspace === 'Inpaint'`. | Inpaint |
| `useEditorState.ts` | Local-state hook returning `EditorLocalState` + setters. | All |

`index.tsx` and `useEditorState.ts` are owned by the orchestrator (Wave 3 final-wire pass). The other 13 files are owned by Wave 3 subagents (one subagent per file).

### 3.8 Acceptance per screen

**FR-17 (Ubiquitous).** Each implemented screen SHALL pass these checks:
- Renders without throwing in a `<ThemeProvider>` wrapper (a vitest snapshot test exists per screen).
- Every interactive element has the correct `accessibilityRole` (`button`, `tab`, `slider`, `switch`, `checkbox`, `radio`).
- Touch-target floor 44×44pt for primary actions (per `ui-component-library` FR-13).
- Visually matches its `.pen` artboard within the thresholds defined in `visual-verification` (informative diff, non-gating in v1).
- Uses NO raw hex literals (CI rule from `design-system-foundation` T7).
- Imports NO business-logic packages (CI rule from `app-shell-navigation` acceptance #10).

### 3.9 Out-of-scope screens

**FR-18 (Ubiquitous).** The 5 Settings detail routes without `.pen` artboards SHALL NOT be implemented in this spec. They are:
- `Settings.Models` (`apps/mobile/src/screens/Settings/Models.tsx`)
- `Settings.Agents` (`apps/mobile/src/screens/Settings/Agents.tsx`)
- `Settings.Speech` (`apps/mobile/src/screens/Settings/Speech.tsx`)
- `Settings.Appearance` (`apps/mobile/src/screens/Settings/Appearance.tsx`)
- `Settings.AuditLog` (`apps/mobile/src/screens/Settings/AuditLog.tsx`)

These files continue to render the `<Placeholder>` body landed by `app-shell-navigation`. They will be addressed by a future `settings-detail-screens` spec once the corresponding `.pen` artboards exist.

The directory move (from `Settings.<Section>.tsx` flat files to `Settings/<Section>.tsx` nested files) DOES touch these 5 files (they are relocated as plain-`<Placeholder>` files). The orchestrator handles this as part of T-Final-3 (re-running the navigator imports). No subagent edits these placeholders' bodies.

### 3.10 Coverage report

**FR-19 (Ubiquitous).** At the end of this spec's implementation, the orchestrator SHALL produce `apps/mobile/src/screens/coverageReport.md` listing:
- For each of the 25 `@diffusecraft/ui` primitives: which screen(s) used it.
- For each of the 13 implemented screens: which primitives it used, which mock fixtures it consumed, which tokens it consumed by name.
- A "candidates for removal" section listing primitives defined but never used (informational; removal is a `ui-component-library` amendment, not auto-applied).

The report is markdown, checked into git, and re-generated when this spec is re-implemented (e.g., after a snapshot update).

## 4. Non-functional requirements

**NFR-1 (Performance).** Screens SHALL avoid needless re-renders. Mock data arrays SHALL be `useMemo`'d when passed to `FlatList` or similar virtualised lists. The Editor's `useEditorState` hook SHALL return setters wrapped in `useCallback` to avoid prop-identity churn across sub-components.

**NFR-2 (DX — file-size budget).** Each screen file SHALL be ≤ 250 lines (excluding mock imports and string-constant imports). The Editor's `index.tsx` SHALL be ≤ 200 lines (composition only); each Editor sub-component file SHALL be ≤ 200 lines.

**NFR-3 (Maintainability).** File organisation SHALL match `design.md` §1 verbatim. Renaming a screen file or moving it to a different directory after this spec is approved is a follow-up amendment, not a silent edit (since `app-shell-navigation/types.ts` and the navigator imports must stay in sync).

**NFR-4 (Determinism).** Mock fixtures SHALL be deterministic (no `Date.now()`, no `Math.random()`). Snapshot tests pass identically across machines and CI runners.

**NFR-5 (No animations beyond defaults).** This spec SHALL NOT add custom Reanimated motion, Skia transitions, or shared-element animations. Default press feedback (`active:` state classes) is the only motion in v1. Animation polish is deferred.

**NFR-6 (Type safety).** `tsc --noEmit` strict mode SHALL pass across `apps/mobile/src/screens/`. The `EditorLocalState` shape (FR-2) SHALL be exported from `useEditorState.ts` and consumed by every Editor sub-component as a prop or via the hook.

**NFR-7 (Tablet form-factor).** All chrome assumes the 1366×1024 landscape iPad viewport (per the `.pen` artboard size in `prompts/pencil-design-screens.md`). Phone fallback is out of scope.

## 5. Acceptance criteria

This spec is APPROVED-FOR-IMPLEMENTATION when:

1. The 13 screen files at the paths in FR-1 exist with chrome bodies replacing `<Placeholder>`. Each renders without throwing and matches its `.pen` artboard within `visual-verification` thresholds.
2. `apps/mobile/src/screens/Editor/` exists with all 14 sub-component files from FR-16 plus `index.tsx` and `useEditorState.ts`.
3. `apps/mobile/src/screens/_mock/` exists with the 7 fixture files from FR-7 plus `_thumbs/` placeholder PNGs.
4. `apps/mobile/src/screens/_strings/` exists with one file per screen exporting the English string constants from FR-9.
5. The 5 out-of-scope Settings detail routes (FR-18) still render the `<Placeholder>` body at their relocated paths under `apps/mobile/src/screens/Settings/`.
6. `app-shell-navigation/SettingsStack.tsx` and the screen barrel `apps/mobile/src/screens/index.ts` are updated to reflect the directory restructuring (`Pairing.<X>.tsx` → `Pairing/<X>.tsx`; `Settings.<X>.tsx` → `Settings/<X>.tsx`).
7. Every interactive element fires `console.log("TODO(...)")` with a short descriptor; no silent no-ops.
8. `coverageReport.md` exists at `apps/mobile/src/screens/coverageReport.md` covering all 25 primitives and all 13 implemented screens.
9. `routesCoverage.test.ts` from `app-shell-navigation` still passes after the screen swap (route names and deep links are preserved).
10. No raw hex literals in `apps/mobile/src/screens/` (existing CI rule).
11. No imports of business-logic packages in `apps/mobile/src/screens/` (existing CI rule from `app-shell-navigation` acceptance #10).
12. `tsc --noEmit` clean across `apps/mobile`. Snapshot tests for every implemented screen pass.

## 6. Out of scope

- **Real data wiring** — no Zustand stores read, no MCP tool calls, no ComfyUI traffic. Owned by `client-state-architecture`, `mcp-tool-catalog`, `comfyui-management`, `pairing-protocol`, `generation-workflow`, `prompt-enhancement`, `speech-to-text`.
- **Real canvas rendering** — Editor's canvas area is a placeholder rectangle. Owned by `canvas-fundamentals` (and downstream `brush-system`, `selection-tools`, `transform-tools`, `mask-system`, `regions`, `control-layers`).
- **Animations beyond `react-navigation` / `react-native-reanimated` defaults.** No shared-element transitions, no Skia paint transitions, no custom press effects.
- **Full a11y audit.** Floor (correct `accessibilityRole`, 44pt touch targets) is enforced; deeper audit deferred.
- **The 5 Settings detail routes without `.pen` artboards** (`Models`, `Agents`, `Speech`, `Appearance`, `AuditLog`). They remain placeholders.
- **Phone fallback layout.** Tablet only.
- **Light theme.** Per `design-system-foundation`.
- **i18n at runtime.** v1 ships English string constants in `_strings/`; a future spec wraps them with `t()`.
- **Real thumbnails / generation previews.** Mock thumbnails are solid-colour PNGs.
- **Real chat history persistence.** The 4 mock chat messages are inline in `_mock/chatMessages.ts`.
- **Real workspace tool-catalog filtering.** The Editor's WorkspaceTabs render all four tabs unconditionally; what tools are visible per workspace is owned by `workspaces` and `mcp-tool-catalog`.
- **Storybook target.** Deferred per `_ui-implementation-roadmap.md`.
- **Visual-diff thresholds.** Owned by `visual-verification`. This spec produces the visual surface; spec 5 measures the divergence.
