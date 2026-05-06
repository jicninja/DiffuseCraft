# screens-implementation — Design

> **Status:** Draft v0.1.
> **Companion to:** `requirements.md`.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + `tailwind.config.js` + `darkTheme`); `ui-component-library` (the 25 in-tree primitives + `ToastProvider` + `Sheet` over `@gorhom/bottom-sheet` + `Toast` over `sonner-native`); `app-shell-navigation` (the 16 typed routes + `<Placeholder>` shape + `RootRouter` + `connectionStore.stub` + deep-link map).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables"; `.kiro/steering/structure.md` §"Repository layout" and §"Naming conventions"; `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers" (the 13 artboard briefs are the authoritative visual specifications); `prompts/ui-implementation-orchestrator.md` (the orchestrator pattern this spec replicates and encodes); `_ui-implementation-roadmap.md` row 4; `apps/mobile/design-snapshot/manifest.json` (snapshot version cited per design.md §5); `.kiro/specs/workspaces/{requirements,design}.md` (the 4 workspaces driving Editor's internal tab state); `.kiro/specs/ui-component-library/design.md` §9 (token gaps surfaced); `.kiro/specs/visual-verification/` (the screenshot-diff pipeline that consumes this spec's visual output).

> **Snapshot manifest version cited:** the `apps/mobile/design-snapshot/manifest.json` produced by `design-system-foundation/T1`, snapshot_version 1 when the canonical `.pen` lands, snapshot_version 0 (placeholder) until then.

## 1. Module layout

Exact file paths created or touched by this spec, mapped to the monorepo structure declared in `structure.md` and the route names declared in `app-shell-navigation/types.ts`:

### 1.1 New / rewritten screen files

| Path | Role | Owned by | Wave |
|---|---|---|---|
| `apps/mobile/src/screens/Splash.tsx` | `01-Splash` chrome (REWRITTEN; replaces placeholder body). | This spec | 1 |
| `apps/mobile/src/screens/Pairing/MDNS.tsx` | `02-Pairing-mDNS` chrome (NEW; replaces `Pairing.MDNS.tsx`). | This spec | 1 |
| `apps/mobile/src/screens/Pairing/QR.tsx` | `02b-Pairing-QR` chrome (NEW). | This spec | 1 |
| `apps/mobile/src/screens/Pairing/Code.tsx` | `02c-Pairing-Code` chrome (NEW). | This spec | 1 |
| `apps/mobile/src/screens/Pairing/Manual.tsx` | `02d-Pairing-Manual` chrome (NEW). | This spec | 1 |
| `apps/mobile/src/screens/ServerPicker.tsx` | `03-ServerPicker` chrome (REWRITTEN). | This spec | 2 |
| `apps/mobile/src/screens/Documents.tsx` | `04-Documents` chrome (REWRITTEN). | This spec | 2 |
| `apps/mobile/src/screens/Settings/Index.tsx` | `06-Settings` master+detail chrome (NEW; replaces `Settings.Index.tsx`). | This spec | 2 |
| `apps/mobile/src/screens/Settings/Connection.tsx` | `06a-Settings-Connection` chrome (NEW; replaces `Settings.Connection.tsx`). | This spec | 2 |
| `apps/mobile/src/screens/Editor/index.tsx` | Composition root for the Editor screen. Last to land. | This spec (orchestrator) | 3 (final wire) |
| `apps/mobile/src/screens/Editor/LeftToolRail.tsx` | 72pt vertical rail. | This spec | 3 |
| `apps/mobile/src/screens/Editor/TopBar.tsx` | 56pt top bar. | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/index.tsx` | Right panel container (320pt). | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/Layers.tsx` | Layers sub-tab. | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/History.tsx` | History sub-tab. | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/Controls.tsx` | Controls sub-tab. | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/Regions.tsx` | Regions sub-tab. | This spec | 3 |
| `apps/mobile/src/screens/Editor/RightPanel/Chat.tsx` | Chat sub-tab. | This spec | 3 |
| `apps/mobile/src/screens/Editor/BottomPromptBar.tsx` | Floating prompt bar. | This spec | 3 |
| `apps/mobile/src/screens/Editor/CanvasPlaceholder.tsx` | Canvas-area placeholder rectangle. | This spec | 3 |
| `apps/mobile/src/screens/Editor/WorkspaceTabs.tsx` | Segmented Generate/Inpaint/Upscale/Live tabs. | This spec | 3 |
| `apps/mobile/src/screens/Editor/LiveSettingsCard.tsx` | Live workspace card. | This spec | 3 |
| `apps/mobile/src/screens/Editor/InpaintModeChips.tsx` | Inpaint mode pill row. | This spec | 3 |
| `apps/mobile/src/screens/Editor/useEditorState.ts` | Local-state hook. | This spec (orchestrator) | 3 (final wire) |

### 1.2 Out-of-scope Settings details (relocated, not re-implemented)

| Path | Role | Owned by |
|---|---|---|
| `apps/mobile/src/screens/Settings/Models.tsx` | Placeholder body, RELOCATED from `Settings.Models.tsx`. Body unchanged. | T-Final-3 |
| `apps/mobile/src/screens/Settings/Agents.tsx` | Same. | T-Final-3 |
| `apps/mobile/src/screens/Settings/Speech.tsx` | Same. | T-Final-3 |
| `apps/mobile/src/screens/Settings/Appearance.tsx` | Same. | T-Final-3 |
| `apps/mobile/src/screens/Settings/AuditLog.tsx` | Same. | T-Final-3 |
| `apps/mobile/src/screens/Settings/About.tsx` | Placeholder body + debug-toggle Card (already added by `app-shell-navigation/T11`). RELOCATED; body unchanged. | T-Final-3 |

### 1.3 Mock and string fixtures

| Path | Role |
|---|---|
| `apps/mobile/src/screens/_mock/servers.ts` | 3 paired-server fixtures. |
| `apps/mobile/src/screens/_mock/documents.ts` | 8 document tiles. |
| `apps/mobile/src/screens/_mock/layers.ts` | 4 layer fixtures. |
| `apps/mobile/src/screens/_mock/historyItems.ts` | 6 generation history items. |
| `apps/mobile/src/screens/_mock/chatMessages.ts` | 4 chat messages + 1 tool-call card. |
| `apps/mobile/src/screens/_mock/presets.ts` | 6 preset chips. |
| `apps/mobile/src/screens/_mock/mdnsServers.ts` | 3 mDNS-discovered servers. |
| `apps/mobile/src/screens/_mock/index.ts` | Barrel re-exporting every fixture by named export. |
| `apps/mobile/src/screens/_mock/_thumbs/*.png` | Solid-colour placeholder thumbnails (≈ 14 small PNGs). |
| `apps/mobile/src/screens/_strings/<screen>.ts` | One file per screen (13 + 5 out-of-scope = 18 files); each exports a single named `<SCREEN>_STRINGS` const. |
| `apps/mobile/src/screens/_strings/index.ts` | Barrel re-exporting every string constant. |

### 1.4 Shared infrastructure

| Path | Role |
|---|---|
| `apps/mobile/src/screens/_shared/Placeholder.tsx` | UNCHANGED. Still used by 5 out-of-scope Settings details + as a fallback per FR-11. |
| `apps/mobile/src/screens/_shared/MasterDetailLayout.tsx` | NEW. Master-detail container used by `Settings/Index.tsx` (master list left, detail right). |
| `apps/mobile/src/screens/_shared/CanvasPlaceholderShared.tsx` | NEW (optional, only if the Editor's canvas placeholder is reused elsewhere — likely not in v1; kept here as a hook). |
| `apps/mobile/src/screens/index.ts` | UPDATED. Re-exports the new screen file paths. |
| `apps/mobile/src/screens/coverageReport.md` | NEW. Generated by T-Final-2; checked into git. |
| `apps/mobile/src/navigation/SettingsStack.tsx` | UPDATED. Imports the relocated Settings details from `./screens/Settings/<X>.tsx`. |
| `apps/mobile/src/navigation/AuthStack.tsx` and `PairingFlow.tsx` | UPDATED. Imports from `./screens/Pairing/<X>.tsx`. |

### 1.5 Directory shape after this spec lands

```
apps/mobile/src/screens/
├── _mock/
│   ├── _thumbs/
│   │   ├── doc-1.png ... doc-8.png
│   │   └── layer-1.png ... layer-4.png  (etc.)
│   ├── chatMessages.ts
│   ├── documents.ts
│   ├── historyItems.ts
│   ├── index.ts
│   ├── layers.ts
│   ├── mdnsServers.ts
│   ├── presets.ts
│   └── servers.ts
├── _shared/
│   ├── MasterDetailLayout.tsx
│   └── Placeholder.tsx
├── _strings/
│   ├── editor.ts
│   ├── pairing-mdns.ts
│   ├── ... (one per screen)
│   └── index.ts
├── Editor/
│   ├── BottomPromptBar.tsx
│   ├── CanvasPlaceholder.tsx
│   ├── InpaintModeChips.tsx
│   ├── LeftToolRail.tsx
│   ├── LiveSettingsCard.tsx
│   ├── RightPanel/
│   │   ├── Chat.tsx
│   │   ├── Controls.tsx
│   │   ├── History.tsx
│   │   ├── Layers.tsx
│   │   ├── Regions.tsx
│   │   └── index.tsx
│   ├── TopBar.tsx
│   ├── WorkspaceTabs.tsx
│   ├── index.tsx
│   └── useEditorState.ts
├── Pairing/
│   ├── Code.tsx
│   ├── MDNS.tsx
│   ├── Manual.tsx
│   └── QR.tsx
├── Settings/
│   ├── About.tsx          (relocated; body unchanged)
│   ├── Agents.tsx         (relocated; placeholder)
│   ├── Appearance.tsx     (relocated; placeholder)
│   ├── AuditLog.tsx       (relocated; placeholder)
│   ├── Connection.tsx     (chrome implemented)
│   ├── Index.tsx          (chrome implemented; master+detail)
│   ├── Models.tsx         (relocated; placeholder)
│   └── Speech.tsx         (relocated; placeholder)
├── Documents.tsx
├── ServerPicker.tsx
├── Splash.tsx
├── coverageReport.md       (generated)
└── index.ts                (barrel)
```

## 2. Multi-agent implementation strategy

This spec encodes the orchestrator + 13 parallel implementer subagents pattern as a first-class part of the implementation contract — **the multi-agent dispatch is itself part of the design**, not an incidental tactic. This mirrors `prompts/ui-implementation-orchestrator.md` (which orchestrated this spec's authoring) and `prompts/pencil-design-screens.md` (which orchestrated the original `.pen` design).

### 2.1 The orchestrator pattern

An orchestrator session reads `tasks.md`, dispatches implementer subagents in three waves, and converges. Each wave is a single message to the agent runtime containing parallel `Agent` (or equivalent subagent-dispatch) tool calls.

The orchestrator does NOT touch screen files except for:
- **T-Final-1.** Wiring `Editor/index.tsx` and `Editor/useEditorState.ts` after Wave 3's sub-components return.
- **T-Final-2.** Generating `coverageReport.md`.
- **T-Final-3.** Re-running `routesCoverage.test.ts`, updating navigator imports for the relocated Pairing/Settings paths, regenerating the screen barrel.

### 2.2 Wave 1 — Group A (5 parallel subagents, trivial screens)

**Why this is one wave.** The 5 screens are structurally tiny (one or two cards plus a few buttons each), share no internal coordination, and read no overlapping mock fixtures (Splash reads no mocks; the 4 Pairing screens each read at most `mdnsServers.ts`). Dispatch in a single message with 5 `Agent` calls.

Subagents and assigned files:

| Subagent | File | Brief reference |
|---|---|---|
| W1.S1 | `apps/mobile/src/screens/Splash.tsx` | `prompts/pencil-design-screens.md` §"01-Splash" + `apps/mobile/design-snapshot/01-Splash/preview.png` |
| W1.S2 | `apps/mobile/src/screens/Pairing/MDNS.tsx` | §"02-Pairing-mDNS" + `02-Pairing-mDNS/preview.png` |
| W1.S3 | `apps/mobile/src/screens/Pairing/QR.tsx` | §"02b-Pairing-QR" + `02b-Pairing-QR/preview.png` |
| W1.S4 | `apps/mobile/src/screens/Pairing/Code.tsx` | §"02c-Pairing-Code" + `02c-Pairing-Code/preview.png` |
| W1.S5 | `apps/mobile/src/screens/Pairing/Manual.tsx` | §"02d-Pairing-Manual" + `02d-Pairing-Manual/preview.png` |

### 2.3 Wave 2 — Group B (4 parallel subagents, medium screens)

**Why one wave.** The 4 medium screens are larger than Group A but still independent: ServerPicker reads `servers.ts`, Documents reads `documents.ts` + `presets.ts`, Settings.Index reads no mocks (master list is the section names), Settings.Connection reads `servers.ts`. There is no cross-file coordination beyond sharing the `_mock/` barrel.

Subagents and assigned files:

| Subagent | File | Brief reference |
|---|---|---|
| W2.S1 | `apps/mobile/src/screens/ServerPicker.tsx` | §"03-ServerPicker" + `03-ServerPicker/preview.png` |
| W2.S2 | `apps/mobile/src/screens/Documents.tsx` | §"04-Documents" + `04-Documents/preview.png` |
| W2.S3 | `apps/mobile/src/screens/Settings/Index.tsx` | §"06-Settings" + `06-Settings/preview.png` |
| W2.S4 | `apps/mobile/src/screens/Settings/Connection.tsx` | §"06a-Settings-Connection" + `06a-Settings-Connection/preview.png` |

### 2.4 Wave 3 — Group C (10 parallel subagents, Editor sub-components)

**Why this is the heaviest wave.** Editor's chrome is the bulk of this spec's work. Splitting it into 13 small files (per FR-16) with one subagent per file is what makes parallelism actually useful: each subagent has a well-bounded scope (≤ 200 lines of chrome) and reads only its slice of the brief.

The 10 Wave 3 subagents (the remaining 3 files — `index.tsx`, `useEditorState.ts`, plus a smoothing of `LiveSettingsCard.tsx`/`InpaintModeChips.tsx` if they need adjustments — are owned by the orchestrator's T-Final-1 pass):

| Subagent | File | Brief reference |
|---|---|---|
| W3.S1 | `apps/mobile/src/screens/Editor/LeftToolRail.tsx` | §"05-Editor-Generate" left rail bullet + `05-Editor-Generate/preview.png` |
| W3.S2 | `apps/mobile/src/screens/Editor/TopBar.tsx` | §"05-Editor-Generate" top bar bullet |
| W3.S3 | `apps/mobile/src/screens/Editor/RightPanel/index.tsx` | §"05-Editor-Generate" right panel bullet (container + sub-tab routing) |
| W3.S4 | `apps/mobile/src/screens/Editor/RightPanel/Layers.tsx` | §"05-Editor-Generate" Layers list bullet |
| W3.S5 | `apps/mobile/src/screens/Editor/RightPanel/History.tsx` | §"05-Editor-Generate" + history-strip refs |
| W3.S6 | `apps/mobile/src/screens/Editor/RightPanel/Controls.tsx` | §"05b-Editor-Inpaint" right-panel-defaults-to-Controls bullet |
| W3.S7 | `apps/mobile/src/screens/Editor/RightPanel/Regions.tsx` | §"05-Editor-Generate" Regions tab + `regions` spec |
| W3.S8 | `apps/mobile/src/screens/Editor/RightPanel/Chat.tsx` + `LiveSettingsCard.tsx` (paired because Chat owns the chat-message rendering and `LiveSettingsCard.tsx` is small enough to ride along) | §"05d-Editor-Chat-Open" + §"05c-Editor-Live" |
| W3.S9 | `apps/mobile/src/screens/Editor/BottomPromptBar.tsx` + `InpaintModeChips.tsx` (paired because the Inpaint mode chips render inside the prompt bar) | §"05-Editor-Generate" prompt bar bullet + §"05b-Editor-Inpaint" sub-mode pill row |
| W3.S10 | `apps/mobile/src/screens/Editor/CanvasPlaceholder.tsx` + `WorkspaceTabs.tsx` (paired because both are presentation-thin and don't depend on each other) | §"05-Editor-Generate" canvas + workspace tabs bullets |

Pairing two files per subagent in W3.S8/S9/S10 keeps the wave at 10 dispatches while letting the strongly-related pairs land together (Chat and LiveSettingsCard share message-card visual idioms; BottomPromptBar and InpaintModeChips share placement; CanvasPlaceholder and WorkspaceTabs are both small and independent). The final assignment may shift slightly during implementation if a pair becomes contentious — the orchestrator decides at dispatch time.

### 2.5 Subagent prompt template (verbatim)

Every subagent in Waves 1, 2, 3 receives a prompt of this exact shape (with `<X>` substitutions per row in §2.2 / §2.3 / §2.4):

> **Description:** "Screen implementer — `<TARGET-FILE>`"
>
> **Prompt:**
>
> You are a Screen Implementer subagent in a multi-agent UI chrome job. Your job: produce the React Native chrome for **one** screen file (or a small pair of related files) in `apps/mobile/src/screens/`. You will write nothing outside your assigned file(s).
>
> **Project in two sentences:** DiffuseCraft is a tablet-first, Procreate-inspired, AI-native image editor that pairs with a ComfyUI server. The UI must feel like a calm instrument — vendor-neutral, dark-first, voice and keyboard as peers, layers + transforms + masks at the heart.
>
> **Your assignment:**
> - **File(s):** `<TARGET-FILE>`
> - **Visual reference:** `apps/mobile/design-snapshot/<ARTBOARD>/preview.png` (read this image for layout). If absent, fall back to the brief and add `// TODO(.pen-snapshot)` comments wherever a layout offset / size was guessed.
> - **Brief:** `prompts/pencil-design-screens.md` §"<ARTBOARD>" — the brief content IS the spec for what the screen looks like.
> - **Layout offsets** (when present): `apps/mobile/design-snapshot/<ARTBOARD>/layout.json` — encode as top-of-file constants, never inline.
>
> **Allowed imports:**
> - `react`, `react-native` (View, Text, ScrollView, Image, Pressable for layout containers).
> - `@diffusecraft/ui` (any of the 25 primitives — see `libs/ui/src/components/index.ts`).
> - `@react-navigation/native` (`useNavigation`, `useRoute`).
> - `apps/mobile/src/screens/_mock/...` (mock fixtures by named import).
> - `apps/mobile/src/screens/_strings/...` (string constants by named import).
> - For Editor sub-components only: `apps/mobile/src/screens/Editor/useEditorState.ts` (the local-state hook).
>
> **Forbidden imports (CI-enforced):**
> - `@diffusecraft/diffusion-client`, `@diffusecraft/server`, `@diffusecraft/canvas-core`, `@diffusecraft/canvas-skia`.
> - `react-native-reusables` (banned at the package level).
> - Any third-party UI kit (NativeBase, Paper, Tamagui, Gluestack).
> - Any networking primitive (`fetch`, `XMLHttpRequest`, `WebSocket`).
> - `Date.now()` or `Math.random()` in render paths (determinism for snapshots).
>
> **Hard rules:**
> - Tokens by name only. Tailwind classes for static styling; `useTheme()` for dynamic. NO raw hex.
> - Every interactive element gets the correct `accessibilityRole`. Touch targets ≥ 44×44pt for primary actions.
> - Every action button calls `console.log("TODO(<future-spec-slug>)", "<short descriptor>")` — no silent no-ops.
> - File length ≤ 250 lines (≤ 200 for Editor sub-components). Mock data and string constants are imports; not counted.
> - English strings come from `_strings/<screen>.ts`. No inline string literals in JSX.
> - **Do not edit any file other than your assignment.** If you find a missing primitive or token, STOP and surface it in your reply — do not silently add to `@diffusecraft/ui` or `tailwind.config.js`.
>
> **Workflow:**
> 1. Read the brief and open the snapshot preview image.
> 2. Read the imports you'll need (`@diffusecraft/ui` exports, `_mock/` fixtures, `_strings/<screen>.ts`).
> 3. Implement the chrome.
> 4. Add a snapshot test at `apps/mobile/src/screens/__tests__/<file-without-tsx>.test.tsx` rendering the screen inside `<ThemeProvider>`.
> 5. Run `tsc --noEmit` from the workspace root; fix any type error in your file only.
> 6. Reply to the orchestrator with: (a) one-paragraph summary, (b) primitives used, (c) mock fixtures consumed, (d) tokens used, (e) gaps (missing primitives or tokens), (f) open questions.

### 2.6 Convergence (orchestrator, sequential)

After Wave 3 returns, the orchestrator runs T-Final-1, T-Final-2, T-Final-3 from `tasks.md`:
1. Wires `Editor/index.tsx` from the 13 returned sub-components plus the `useEditorState` hook.
2. Generates `apps/mobile/src/screens/coverageReport.md` from the union of subagent reply tables.
3. Re-runs `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` and updates the four navigator files (`AuthStack.tsx`, `PairingFlow.tsx`, `RootStack.tsx`, `SettingsStack.tsx`) to import from the relocated paths (`Pairing/<X>.tsx`, `Settings/<X>.tsx`). Updates `apps/mobile/src/screens/index.ts`.

## 3. Mock data fixtures

Sketches for the 7 fixture files in `apps/mobile/src/screens/_mock/`. All exports are deterministic top-level `const`s.

### 3.1 `servers.ts`

```typescript
import doc1 from './_thumbs/doc-1.png'; // for capability illustration only

export interface ServerFixture {
  id: string;
  name: string;
  ip: string;
  port: number;
  online: boolean;
  lastConnected: string;        // human string, e.g., "2 hours ago"
  capabilityChips: string[];    // e.g., ["ComfyUI ✓", "Models: 12"]
}

export const SERVERS_MOCK: ServerFixture[] = [
  { id: 'imac-de-igna', name: 'iMac de Igna', ip: '192.168.1.50', port: 9876,
    online: true,  lastConnected: '2 hours ago',
    capabilityChips: ['ComfyUI ✓', 'Models: 12'] },
  { id: 'studio-pc',   name: 'Studio PC',     ip: '192.168.1.71', port: 9876,
    online: false, lastConnected: 'yesterday',
    capabilityChips: ['ComfyUI ✓', 'Models: 8'] },
  { id: 'meshcraft-laptop', name: 'MeshCraft Laptop', ip: '192.168.1.92', port: 9876,
    online: true,  lastConnected: '5 minutes ago',
    capabilityChips: ['MeshCraft host', 'Models: 6'] },
];
```

### 3.2 `documents.ts`

```typescript
import doc1 from './_thumbs/doc-1.png';
import doc2 from './_thumbs/doc-2.png';
// ...

export interface DocumentFixture {
  id: string;
  name: string;
  thumbnail: number;            // result of require('./_thumbs/doc-N.png')
  lastEdit: string;             // "3 days ago"
  workspace: 'Generate' | 'Inpaint' | 'Upscale' | 'Live';
}

export const DOCUMENTS_MOCK: DocumentFixture[] = [
  { id: 'doc-1', name: 'Cover concept',     thumbnail: doc1, lastEdit: '3 days ago',  workspace: 'Generate' },
  { id: 'doc-2', name: 'Hero pose',         thumbnail: doc2, lastEdit: 'yesterday',   workspace: 'Generate' },
  // ... 8 total
];
```

### 3.3 `layers.ts`

```typescript
import layer1 from './_thumbs/layer-1.png';
// ...

export interface LayerFixture {
  id: string;
  name: string;
  kind: 'paint' | 'reference' | 'structural';
  visible: boolean;
  opacity: number;              // 0..1
  thumbnail: number;
}

export const LAYERS_MOCK: LayerFixture[] = [
  { id: 'l-1', name: 'Sketch',           kind: 'paint',      visible: true,  opacity: 1.0, thumbnail: layer1 },
  { id: 'l-2', name: 'Inking',           kind: 'paint',      visible: true,  opacity: 1.0, thumbnail: layer2 },
  { id: 'l-3', name: 'Pose ref',         kind: 'reference',  visible: true,  opacity: 0.6, thumbnail: layer3 },
  { id: 'l-4', name: 'Depth (ControlNet)', kind: 'structural', visible: true, opacity: 1.0, thumbnail: layer4 },
];
```

### 3.4 `historyItems.ts`

```typescript
import h1 from './_thumbs/history-1.png';
// ...

export interface HistoryItemFixture {
  id: string;
  prompt: string;
  thumbnail: number;
  timestamp: string;             // "10 min ago"
}

export const HISTORY_ITEMS_MOCK: HistoryItemFixture[] = [
  { id: 'h-1', prompt: 'a calm warrior under moonlight, ink-line style', thumbnail: h1, timestamp: '10 min ago' },
  // ... 6 total
];
```

### 3.5 `chatMessages.ts`

```typescript
export type ChatRole = 'user' | 'agent' | 'tool-call';

export interface ChatMessageFixture {
  id: string;
  role: ChatRole;
  text?: string;
  toolName?: string;             // role === 'tool-call'
  toolArgs?: string;             // pretty-printed JSON, role === 'tool-call'
}

export const CHAT_MESSAGES_MOCK: ChatMessageFixture[] = [
  { id: 'm-1', role: 'user',  text: 'now make this brighter and add a tree on the left' },
  { id: 'm-2', role: 'agent', text: "Got it — I'll adjust the exposure and place a maple tree." },
  { id: 'm-3', role: 'tool-call', toolName: 'add_layer', toolArgs: '{ "kind": "paint", "name": "tree-left" }' },
  { id: 'm-4', role: 'agent', text: 'Tree placed. Want it taller?' },
  { id: 'm-5', role: 'user',  text: 'Yes, about 30% taller please.' },
];
```

### 3.6 `presets.ts`

```typescript
export interface PresetFixture {
  id: string;
  label: string;
}

export const PRESETS_MOCK: PresetFixture[] = [
  { id: 'p-1', label: 'Concept art' },
  { id: 'p-2', label: 'Ink line' },
  { id: 'p-3', label: 'Watercolour' },
  { id: 'p-4', label: 'Photo-real' },
  { id: 'p-5', label: 'Anime soft' },
  { id: 'p-6', label: 'Storyboard' },
];
```

### 3.7 `mdnsServers.ts`

```typescript
export interface MDNSServerFixture {
  name: string;
  ip: string;
  port: number;
}

export const MDNS_SERVERS_MOCK: MDNSServerFixture[] = [
  { name: 'iMac de Igna',     ip: '192.168.1.50', port: 9876 },
  { name: 'Studio PC',        ip: '192.168.1.71', port: 9876 },
  { name: 'MeshCraft Laptop', ip: '192.168.1.92', port: 9876 },
];
```

### 3.8 Barrel

```typescript
// apps/mobile/src/screens/_mock/index.ts
export * from './servers';
export * from './documents';
export * from './layers';
export * from './historyItems';
export * from './chatMessages';
export * from './presets';
export * from './mdnsServers';
```

## 4. Editor architecture

The Editor's chrome is the bulk of this spec. This section details the composition that `Editor/index.tsx` produces and defends the single-route decision (per `app-shell-navigation` FR-9 / `requirements.md` FR-2).

### 4.1 Composition diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TopBar (h=56pt)                                                              │
│  back | doc-name | saved          [Generate|Inpaint|Upscale|Live]    chip ⋯  │
├──────┬───────────────────────────────────────────────────────┬───────────────┤
│      │                                                       │ Right panel   │
│ Left │                                                       │ (w=320pt)     │
│ Tool │                                                       │               │
│ Rail │                                                       │ ┌───────────┐ │
│ (72) │                CanvasPlaceholder                      │ │ Sub-tabs  │ │
│      │              "Canvas — see canvas-fundamentals"       │ │ Layers /  │ │
│  brushes              [marching-ants if selectionMock]       │ │ History / │ │
│  sep                                                         │ │ Controls /│ │
│  sel/transf                                                  │ │ Regions   │ │
│  mask                                                        │ │ ↔  Chat   │ │
│  picker                                                      │ │  (when    │ │
│  sep                                                         │ │  chatOpen)│ │
│  layers              ┌──────────────────────────────────┐   │ └───────────┘ │
│  undo/redo           │  BottomPromptBar (floating)      │   │ <active body> │
│                      │  [mic][input.....][✨][Generate]  │   │               │
│                      │  strength · presets row           │   │               │
│                      └──────────────────────────────────┘   │               │
└──────┴───────────────────────────────────────────────────────┴───────────────┘
```

### 4.2 State-driven conditional rendering

The 4 `.pen` Editor variants are produced by the SAME composition, with different `EditorLocalState`:

| `.pen` artboard | `workspace` | `chatOpen` | `selectionMock` | `inpaintMode` | Renders |
|---|---|---|---|---|---|
| `05-Editor-Generate` | `'Generate'` | `false` | `false` | n/a | TopBar (Generate active) + LeftToolRail + Canvas + RightPanel.Layers + BottomPromptBar (primary = "Generate") |
| `05b-Editor-Inpaint` | `'Inpaint'` | `false` | `true`  | `'Fill'` | TopBar (Inpaint active) + LeftToolRail + Canvas (with marching-ants) + RightPanel.Controls + BottomPromptBar (primary = "Fill", with InpaintModeChips above the input) |
| `05c-Editor-Live` | `'Live'` | `false` | `false` | n/a | TopBar (Live active) + LeftToolRail + Canvas (with floating preview top-right) + RightPanel hosting LiveSettingsCard + BottomPromptBar (primary = "Stop Live", outline-style) |
| `05d-Editor-Chat-Open` | `'Generate'` | `true`  | `false` | n/a | TopBar (Generate active) + LeftToolRail + Canvas + RightPanel.Chat + BottomPromptBar (primary = "Generate") |

Defence of single-route — the five points from `app-shell-navigation/design.md` §9.1 apply unchanged. Restated here for reviewers of THIS spec:

1. **Workspace is an MCP-driven editor-internal mode** (per `workspaces` spec). Modeling it as a route would force back-stack semantics that the design explicitly rejects.
2. **Chat panel open/closed is a panel toggle**, not a route. `05d` is the same screen with `rightPanelTab === 'Chat'`.
3. **Deep-link hydration is enough.** `?workspace=inpaint` and `/chat` path suffix seed local state once. No two-way URL sync.
4. **State persistence is simpler** without route-encoded variant state.
5. **Visually 95% shared chrome.** Splitting into routes forces an `<EditorChrome>` extraction anyway — single route is a cleaner achievement of the same end.

### 4.3 `useEditorState` shape

```typescript
// apps/mobile/src/screens/Editor/useEditorState.ts
import { useCallback, useState } from 'react';

export type WorkspaceTab = 'Generate' | 'Inpaint' | 'Upscale' | 'Live';
export type RightPanelTab = 'Layers' | 'History' | 'Controls' | 'Regions' | 'Chat';
export type InpaintMode = 'Fill' | 'Expand' | 'Add' | 'Remove' | 'ReplaceBg';

export interface EditorLocalState {
  workspace: WorkspaceTab;
  rightPanelTab: RightPanelTab;
  chatOpen: boolean;
  selectionMock: boolean;
  inpaintMode: InpaintMode;
  liveContinuousRegen: boolean;
  liveSeedLocked: boolean;
}

export interface EditorLocalActions {
  setWorkspace: (w: WorkspaceTab) => void;
  setRightPanelTab: (t: RightPanelTab) => void;
  toggleChat: () => void;
  toggleSelectionMock: () => void;
  setInpaintMode: (m: InpaintMode) => void;
  toggleLiveContinuousRegen: () => void;
  toggleLiveSeedLocked: () => void;
}

export interface UseEditorStateInit {
  workspace?: WorkspaceTab;
  chatOpen?: boolean;
}

export function useEditorState(init?: UseEditorStateInit): EditorLocalState & EditorLocalActions {
  const [workspace, setWorkspaceRaw] = useState<WorkspaceTab>(init?.workspace ?? 'Generate');
  const [rightPanelTab, setRightPanelTabRaw] = useState<RightPanelTab>(
    init?.chatOpen ? 'Chat' : workspace === 'Inpaint' ? 'Controls' : 'Layers',
  );
  const [chatOpen, setChatOpen] = useState<boolean>(init?.chatOpen ?? false);
  const [selectionMock, setSelectionMock] = useState<boolean>(false);
  const [inpaintMode, setInpaintModeRaw] = useState<InpaintMode>('Fill');
  const [liveContinuousRegen, setLiveContinuousRegen] = useState<boolean>(true);
  const [liveSeedLocked, setLiveSeedLocked] = useState<boolean>(true);

  const setWorkspace = useCallback((w: WorkspaceTab) => {
    setWorkspaceRaw(w);
    // Inpaint defaults to Controls; selection mock auto-on (purely cosmetic)
    if (w === 'Inpaint') { setRightPanelTabRaw('Controls'); setSelectionMock(true); }
    else { setSelectionMock(false); if (rightPanelTab === 'Controls') setRightPanelTabRaw('Layers'); }
  }, [rightPanelTab]);

  const toggleChat = useCallback(() => {
    setChatOpen((v) => !v);
    setRightPanelTabRaw((t) => t === 'Chat' ? 'Layers' : 'Chat');
  }, []);

  // ... other setters wrapped in useCallback
  return { workspace, rightPanelTab, chatOpen, selectionMock, inpaintMode,
           liveContinuousRegen, liveSeedLocked,
           setWorkspace, setRightPanelTab: setRightPanelTabRaw, toggleChat,
           toggleSelectionMock: () => setSelectionMock(v => !v),
           setInpaintMode: setInpaintModeRaw,
           toggleLiveContinuousRegen: () => setLiveContinuousRegen(v => !v),
           toggleLiveSeedLocked: () => setLiveSeedLocked(v => !v) };
}
```

The orchestrator implements this hook in T-Final-1 because every Editor sub-component depends on it; landing it after Wave 3 lets each sub-component declare what it needs from `EditorLocalState` (via its prop type) without the hook trying to be omniscient ahead of time.

### 4.4 `Editor/index.tsx` composition root

```typescript
// apps/mobile/src/screens/Editor/index.tsx — sketch
import { View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { useEditorState } from './useEditorState';
import { LeftToolRail } from './LeftToolRail';
import { TopBar } from './TopBar';
import { CanvasPlaceholder } from './CanvasPlaceholder';
import { RightPanel } from './RightPanel';
import { BottomPromptBar } from './BottomPromptBar';

const LEFT_RAIL_WIDTH = 72;     // TODO(.pen-snapshot)
const RIGHT_PANEL_WIDTH = 320;  // TODO(.pen-snapshot)
const TOPBAR_HEIGHT = 56;       // TODO(.pen-snapshot)

export function EditorScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const { documentId, workspace = 'generate', chat = false } = route.params;
  const editor = useEditorState({
    workspace: (workspace.charAt(0).toUpperCase() + workspace.slice(1)) as 'Generate' | 'Inpaint' | 'Upscale' | 'Live',
    chatOpen: chat,
  });

  return (
    <View className="flex-1 bg-canvas">
      <TopBar editor={editor} documentId={documentId} />
      <View className="flex-1 flex-row">
        <View style={{ width: LEFT_RAIL_WIDTH }}>
          <LeftToolRail editor={editor} />
        </View>
        <View className="flex-1 relative">
          <CanvasPlaceholder editor={editor} />
          <BottomPromptBar editor={editor} />
        </View>
        <View style={{ width: RIGHT_PANEL_WIDTH }}>
          <RightPanel editor={editor} />
        </View>
      </View>
    </View>
  );
}
EditorScreen.displayName = 'EditorScreen';
```

The hook return value flows to every sub-component as a single `editor` prop. This keeps the prop surface stable (sub-components don't re-spread the entire shape) and lets each sub-component grab only the slice it needs from `editor.x`.

## 5. Snapshot ingestion contract

Each subagent reads `apps/mobile/design-snapshot/<artboard>/preview.png` at design time as the visual reference. Per FR-10 / FR-11, the PNG is:
- **Not imported at runtime.** No `import preview from '../../design-snapshot/...'`. The PNG is opened in the editor / viewer / multimodal model that the subagent uses while authoring chrome.
- **Cited in a comment** at the top of each screen file: `// Visual reference: apps/mobile/design-snapshot/<artboard>/preview.png (manifest snapshot_version <N>)`.
- **Layout offsets** (when the snapshot's `layout.json` is present and non-empty) extracted into top-of-file constants (per FR-12). When the snapshot is the placeholder produced by `design-system-foundation/T1` in pre-`.pen` mode, every offset constant is annotated `// TODO(.pen-snapshot): replace with measured value`.

The runtime-side comparison (rendered chrome vs. the snapshot PNG) is owned by `visual-verification` (spec 5). That spec consumes:
- The snapshot PNG at `apps/mobile/design-snapshot/<artboard>/preview.png`.
- The runtime screenshot captured by Maestro (or equivalent) at deep-link entry.

`visual-verification`'s diff reports are informative in v1 (non-gating). When this spec's chrome diverges from the artboard, the divergence appears in the `visual-verification` artifact and triggers a follow-up implementer-subagent dispatch — NOT a silent edit by the orchestrator.

## 6. Token & component coverage

`apps/mobile/src/screens/coverageReport.md` is generated by T-Final-2 and contains three sections:

### 6.1 Per-primitive coverage

For each of the 25 `@diffusecraft/ui` primitives, list the screen(s) that import it. Example excerpt:

| Primitive | Used by |
|---|---|
| `Button` | every screen except `Splash` |
| `Card` | `Documents`, `ServerPicker`, `Settings/Index`, `Settings/Connection`, `Editor/RightPanel/*`, `Editor/LiveSettingsCard` |
| `Slider` | `Editor/BottomPromptBar` (strength), `Editor/RightPanel/Layers` (opacity) |
| `Tabs` | `Editor/WorkspaceTabs`, `Editor/RightPanel/index` (sub-tabs) |
| `Sheet` | (none in v1 chrome) — candidate for removal? |
| `ContextMenu` | `ServerPicker` (long-press → Rename / Revoke / Audit log) |
| `Toast` | (no toasts triggered by chrome — primitives mounted via `ToastProvider` in `App.tsx` but never invoked here) |
| ... | ... |

### 6.2 Per-screen coverage

For each implemented screen, list:
- Primitives consumed.
- Mock fixtures consumed.
- Tokens consumed (by name).
- Notable gaps surfaced.

Example excerpt for `Documents.tsx`:

| Aspect | Value |
|---|---|
| Primitives | `Card`, `Avatar`, `Input`, `Button`, `Badge`, `Tabs` (sort), `Skeleton` (empty grid placeholder), `Separator` |
| Mocks | `DOCUMENTS_MOCK` |
| Tokens | `bg.canvas`, `bg.surface`, `border.subtle`, `text.primary`, `text.secondary`, `accent.default` (FAB), radius `lg`, `xl`, type `title`, `body`, `caption` |
| Gaps | none |

### 6.3 Candidates for removal

Primitives defined in `ui-component-library` that no screen consumed in this implementation pass. Informational — removal is a `ui-component-library` amendment, not auto-applied. Likely candidates from the early sketch:
- `Toast` — only the provider is mounted; no chrome triggers a toast.
- `AlertDialog` — none of the 13 screens shows a destructive-confirm flow in chrome (real flows live in pairing / token-revocation specs).
- `Combobox` — no chrome surface uses a searchable select in v1.
- `Popover` — used transitively by `ContextMenu`, `DropdownMenu`, `Tooltip` but rarely directly.

Each candidate is paired with a recommendation: keep (rationale: needed for upcoming specs), remove (rationale: dead code), or defer-decision (rationale: real-data spec will exercise it).

## 7. Stylus / touch ergonomics

The chrome inherits the rules from `ui-component-library/design.md` §6 ("Stylus-friendly rules"). Spots in the 13 screens where these rules apply concretely:

| Rule | Where it applies in this spec |
|---|---|
| Touch target floor 44×44pt | Editor `LeftToolRail` tool tiles (each ≥ 56×56pt per `.pen`). BottomPromptBar's mic button (≥ 56×56). BottomPromptBar's primary action (≥ 56pt tall). `Pairing/Code.tsx` numeric pad keys (≥ 56×56 per the brief). |
| No hover-only affordances | `ServerPicker` long-press → ContextMenu (Rename / Revoke / Audit log) is touch-native. `Documents` filename rename is a long-press in the chrome (logs `TODO(documents-rename)`). |
| Long-press surfaces context | `ServerPicker` cards (long-press → ContextMenu). `Editor/RightPanel/Layers` rows (long-press → opacity slider — implemented as a tap that toggles a Slider visible inline, since long-press → popover would need a Popover surface that the chrome doesn't add). |
| Generous hit slop on icon-only buttons | `Editor/TopBar` icon buttons (back chevron, share, more), `Editor/BottomPromptBar` enhance ✨ button — all wrapped with `hitSlop={8}`. |
| Press feedback uses `pressed` state | All `Pressable`s in chrome (Editor tool rail tiles, Pairing-Code digit-pad keys) read `pressed` and apply `active:` Tailwind classes. |
| 44pt floor exception (`sm` size) | `Editor/BottomPromptBar` preset chip row uses `sm` Badge / `sm` Button (chip-row sub-element). `Editor/RightPanel/Layers` opacity slider uses `sm` Slider when shown inline. Both per FR-13's chip-row exception. |

## 8. Internationalization placeholder

Every English string visible in JSX comes from `apps/mobile/src/screens/_strings/<screen>.ts`. The shape is a top-level `const <SCREEN>_STRINGS = { ... } as const;` object. A future i18n spec (`internationalization`, post-v1) replaces the import with a `t()` wrapper:

```typescript
// today (v1)
import { PAIRING_MDNS_STRINGS as S } from '../_strings/pairing-mdns';
<Label>{S.title}</Label>

// future (post-v1)
import { useTranslation } from '../_i18n';
const t = useTranslation('pairing-mdns');
<Label>{t('title')}</Label>
```

The change is a one-line import swap per screen plus the `t(...)` substitution. JSX structure is unchanged. v1 SHALL NOT add `t()`, `i18next`, `react-i18next`, or any i18n library. The constants are the deferral surface.

## 9. Validation strategy

| Check | Tool | Enforcement |
|---|---|---|
| Snapshot tests per screen render inside `<ThemeProvider>` without throwing | Vitest + `@testing-library/react-native` | CI |
| `Editor/index.tsx` renders all four workspace permutations (Generate, Inpaint, Live, Chat-Open) | Vitest test in `__tests__/Editor.permutations.test.tsx` exercising the hook + each variant | CI |
| Visual diff vs. `apps/mobile/design-snapshot/<artboard>/preview.png` | Maestro / odiff pipeline owned by `visual-verification` | CI (informative; non-gating in v1) |
| Routes coverage still passes after screen swap | `apps/mobile/src/navigation/__tests__/routesCoverage.test.ts` from `app-shell-navigation` | CI |
| No raw hex literals in `apps/mobile/src/screens/` | Existing `design-system-foundation` T7 lint rule | CI |
| No business-logic imports in `apps/mobile/src/screens/` | Existing `app-shell-navigation` acceptance #10 grep | CI |
| File size budget | A simple `wc -l` CI step asserting each screen file ≤ 250 lines (Editor sub-components ≤ 200) | CI (informative; non-gating) |
| `tsc --noEmit` clean | TS strict mode | CI |
| Coverage report freshness | Vitest test asserting `coverageReport.md` references all 25 primitives by name | CI |

## 10. Open questions

### Q1 — Gallery thumbnail aspect ratio

The `04-Documents` brief says "responsive grid of document tiles (3–4 columns landscape) — thumbnail + filename + last edit + workspace badge" but does NOT specify the thumbnail aspect ratio. Options:

- (a) Square (1:1).
- (b) 4:3 landscape (matches the iPad viewport ratio).
- (c) Source-aware (each thumbnail respects the document's actual canvas ratio; mocks would declare per-document ratios).

**Recommendation.** **Defer to a designer pass.** v1 chrome ships square (1:1) thumbnails because (a) it's the simplest grid math, (b) mocks are 256×256 placeholders anyway, (c) when real generation thumbnails arrive, the grid can switch to source-aware without screen changes (the thumbnail container becomes responsive, the mock shape grows a `ratio` field). The `Documents.tsx` author marks this with `// TODO(designer-pass): thumbnail aspect ratio`.

### Q2 — Editor LeftToolRail tool order

The `05-Editor-Generate` brief lists tools in this order: "5 brush presets (pen, pencil, marker, eraser, smooth), separator, selection (lasso/rect), transform, mask, eyedropper. Bottom: layers toggle, undo/redo." Does the chrome follow this order EXACTLY left-to-right (top-to-bottom in the rail), or is there leeway?

**Recommendation.** **Follow the brief verbatim.** The `.pen` artboard is the visual contract; subagents reproduce the order shown in `05-Editor-Generate/preview.png`. Reordering is a designer concern and lives in a future amendment of the brief, not a chrome decision.

### Q3 — `Settings/Index.tsx` master-detail "default detail"

The `06-Settings` brief says detail-by-default is `About`. But on a tablet, when the user taps a master row, the detail navigates to that section's route (per `app-shell-navigation` `SettingsStack`). On the route `Settings.Index` with no detail explicitly chosen, what renders on the right?

Options:
- (a) About content rendered inline as the default detail.
- (b) Empty-state on the right ("Select a section").
- (c) Pre-navigate to `Settings.About` so the right column is always a route.

**Recommendation.** **(a) About inline as the default detail.** This matches the `.pen` directly: the artboard shows About in the right column. The master row "About" is highlighted as active in the master list. Tapping any other master row pushes its detail route on the back stack; tapping back lands on Index again with About inline. `Settings.About` as a standalone route is a deep-link-only entry, kept for symmetry with the other detail routes.

### Q4 — First-run tooltip layer?

Should v1 ship a "first run" tooltip layer (e.g., bullets pointing at the LeftToolRail and BottomPromptBar saying "tap here to pick a brush", "type or dictate a prompt here") that the user dismisses?

**Recommendation.** **No, not in v1.** First-run education is a separate spec (`onboarding-tour` or similar) that lands once real connections work. Adding tooltips to chrome-only mode is premature; the user has nothing real to do yet. The chrome's job here is to LOOK right, not to teach.

### Q5 — Pairing flow nav: "Use a code instead" / "Paste URL" cross-links

The `02b-Pairing-QR` brief says "Bottom row: alt links **Use a code instead**, **Paste URL**." These are nav-side affordances (push to `Pairing.Code` / `Pairing.Manual`). The chrome implements these as `Button variant="ghost"` calling `nav.navigate(...)`. Confirm or revisit?

**Recommendation.** **Confirm.** Ghost button is the right primitive for a tertiary cross-link; it matches the `.pen` styling of subdued text-only inline links. No design issue; no change.

### Q6 — Editor `RightPanel/Layers.tsx` opacity slider — long-press or always-inline?

The `05-Editor-Generate` brief says "opacity slider (long-press)". A long-press on touch gives a stylus-friendly affordance. But long-press → popover requires a `Popover`-like surface; `ui-component-library` ships `Popover` but anchoring it inside a virtualised list is non-trivial.

Options:
- (a) Tap (not long-press) toggles an inline opacity slider beneath the layer row. Stylus-friendly and snapshot-test-trivial.
- (b) Long-press → Popover anchored at the layer row's right edge. Closer to the brief but more complex.

**Recommendation.** **(a) Tap toggles inline slider** for v1 chrome. Add a `// TODO(.pen-faithful): long-press → Popover when canvas state lands` comment. The designer can re-evaluate post-v1. The chrome reads as right because the row layout matches the artboard; the interaction model is a known divergence.

### Q7 — `.pen` snapshot drift between authoring and implementation

When the canonical `.pen` is updated post-snapshot (e.g., a designer tweaks the prompt-bar layout), the `apps/mobile/design-snapshot/` PNGs become stale. How does the chrome stay in sync?

**Recommendation.** Re-running `tools/snapshot-pen.ts` (from `design-system-foundation/T1`) regenerates the snapshot. The chrome is then re-reviewed against the new PNGs; any divergence triggers a new implementer-subagent dispatch on the affected screen file. The `visual-verification` pipeline catches these automatically (the diff artifact grows). No code change here; the workflow is implicit in the snapshot's versioning.

### Q8 — `.pen` not yet present at implementation time

If `design-system-foundation/T1` is still in placeholder mode (the `.pen` hasn't been delivered) when this spec's implementation kicks off, every layout offset is a `// TODO(.pen-snapshot)`. Should we delay implementation until the `.pen` lands?

**Recommendation.** **No — implement against the brief alone.** The brief in `prompts/pencil-design-screens.md` is detailed enough to produce visually plausible chrome. When the snapshot lands, `visual-verification`'s diff identifies divergences; the orchestrator dispatches re-do subagents on affected screens. This unblocks implementation without sacrificing fidelity (because the divergence is visible in CI).
