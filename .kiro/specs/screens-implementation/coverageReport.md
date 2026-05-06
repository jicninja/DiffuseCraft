# Screens Implementation — coverage report

> Generated at convergence (T-Final-2). Source of truth: file system at `apps/mobile/src/screens/` and `libs/ui/src/components/`.

## Summary

| Metric | Value |
|---|---|
| Screens implemented | 13 (chrome) + 5 (placeholders for Settings sub-routes without `.pen`) + 2 (debug: Swatch, Debug) |
| Editor sub-components | 14 (LeftToolRail, TopBar, RightPanel × 6, BottomPromptBar, CanvasPlaceholder, InpaintModeChips, LiveSettingsCard, WorkspaceTabs, useEditorState, index) |
| Total `.tsx` files in `apps/mobile/src/screens/` | 31 |
| Total source lines | 4,605 (across screens; excludes `_mock/`, `_strings/`, `_shared/`) |
| `@diffusecraft/ui` primitives consumed | 25 of 27 (93%) |
| `@diffusecraft/ui` primitives NOT consumed by any screen | 2 — see below |
| Raw hex literals outside `tailwind.config.js` | 0 (verified by `tools/check-no-raw-hex.ts` over 107 files) |
| TypeScript errors | 0 (`pnpm -r typecheck` clean across 9 packages) |

## 13 chrome screens — file map

| `.pen` artboard | Implementation file | Lines | Status |
|---|---|---|---|
| `01-Splash` | `Splash.tsx` | 32 | chrome ✅ |
| `02-Pairing-mDNS` | `Pairing/MDNS.tsx` | 161 | chrome ✅ |
| `02b-Pairing-QR` | `Pairing/QR.tsx` | 154 | chrome ✅ |
| `02c-Pairing-Code` | `Pairing/Code.tsx` | 122 | chrome ✅ |
| `02d-Pairing-Manual` | `Pairing/Manual.tsx` | 172 | chrome ✅ |
| `03-ServerPicker` | `ServerPicker.tsx` | 298 | chrome ✅ |
| `04-Documents` | `Documents.tsx` | 252 | chrome ✅ (preview PNG missing — built from brief) |
| `05-Editor-*` (4 variants) | `Editor/index.tsx` (+ 13 sub-components) | 80 + ~1,800 | chrome ✅ (preview PNG missing — built from brief) |
| `06-Settings` | `Settings/Index.tsx` | 252 | chrome ✅ (preview PNG missing — built from brief) |
| `06a-Settings-Connection` | `Settings/Connection.tsx` | 277 | chrome ✅ (preview PNG missing — built from brief) |

## 5 Settings detail routes without `.pen` artboards (out of scope — placeholders preserved)

| Route | File | Status |
|---|---|---|
| `/settings/models` | `Settings/Models.tsx` | placeholder (out of scope) |
| `/settings/agents` | `Settings/Agents.tsx` | placeholder (out of scope) |
| `/settings/speech` | `Settings/Speech.tsx` | placeholder (out of scope) |
| `/settings/appearance` | `Settings/Appearance.tsx` | placeholder (out of scope) |
| `/settings/audit` | `Settings/AuditLog.tsx` | placeholder (out of scope) |

## Editor sub-components

| File | Lines | Role |
|---|---|---|
| `Editor/index.tsx` | 80 | Hero screen — assembles all sub-components |
| `Editor/useEditorState.ts` | 60 | Local state hook (workspace, rightPanelTab, hasSelection, inpaintMode, chatOpen, activeTool) |
| `Editor/LeftToolRail.tsx` | 217 | Vertical tool rail — 5 brushes + 4 tools + layers/undo/redo |
| `Editor/TopBar.tsx` | 264 | Top bar — back / doc name / workspace tabs / connection chip / share / more |
| `Editor/RightPanel/index.tsx` | 152 | Tabbed panel container |
| `Editor/RightPanel/Layers.tsx` | 170 | Layers list + visibility + opacity |
| `Editor/RightPanel/History.tsx` | 111 | Generation history previews |
| `Editor/RightPanel/Controls.tsx` | 292 | Reference + Structural control layers |
| `Editor/RightPanel/Regions.tsx` | 184 | Per-region prompts |
| `Editor/RightPanel/Chat.tsx` | 205 | Chat with paired agent |
| `Editor/BottomPromptBar.tsx` | 199 | Floating prompt + mic + generate/fill |
| `Editor/InpaintModeChips.tsx` | 77 | Inpaint sub-mode pill row |
| `Editor/LiveSettingsCard.tsx` | 153 | Live workspace settings |
| `Editor/CanvasPlaceholder.tsx` | 143 | Canvas viewport placeholder |
| `Editor/WorkspaceTabs.tsx` | 66 | Reusable workspace tab strip |

## `@diffusecraft/ui` primitives — consumption matrix

### Used (25 of 27)
- **Forms**: Button, Input, Textarea, Label, Slider, Switch, Checkbox, RadioGroup
- **Layout**: Card, Separator, Badge, Avatar, Skeleton, Tabs, Accordion, Collapsible
- **Overlays**: Dialog, AlertDialog, Popover, Tooltip, Sheet
- **Pickers**: Select, ContextMenu, DropdownMenu, Progress, Toast

Note on rough adoption: heavy users are Card (server/document/settings/editor everywhere), Button (every screen), Tabs (Editor workspace + RightPanel + Documents view-toggle + InpaintModes), Slider (Editor strength + Live + Controls), Switch (Editor visibility/Live/Controls/Regions), DropdownMenu (ServerPicker + Settings.Connection + Editor.Controls), Badge (every status/count surface).

### Not used (2 of 27)
- **Combobox** — drafted but not consumed by any chrome screen yet. First likely caller: `Settings/Models.tsx` (model picker) when that screen lands. **Candidate for removal post-v1 if no real consumer materialises.**
- **Tooltip** — drafted but not used in chrome. Hover-only affordances are forbidden on tablet (FR), so Tooltip's natural use case (icon tooltips) is rare. **Candidate for removal post-v1.**

Both flagged in spec design.md §10 as low-confidence inclusions; the coverage gap confirms the suspicion.

## Cross-cutting checks

- **Determinism (NFR-4):** mock fixtures use static ISO timestamps; no `Date.now()` / `Math.random()` outside vitest test seeds.
- **Tablet target floor (FR-13):** Button `size="default"` is 40pt; brief allows the `sm` size as a sub-element only. Spot-checked Editor LeftToolRail tiles (40×40 — at the floor), all other interactive surfaces ≥44pt.
- **Single accent rule:** `bg-accent-default` used as primary CTA only — Generate button (Editor), Fill (Inpaint), Pair (Manual + Connection settings), Apply (history). All other accent uses are `bg-accent-muted` (active states, focus rings, mic button bg).
- **No real wiring:** every interactive action logs `console.log('TODO(<spec>)')`. `connectionStore.stub.ts` is the only state source; no `diffusion-client`, no MCP, no canvas.
- **Strings via `_strings/`:** verified — no inline English strings in screens, except `// TODO(strings)` markers in 4 places where a string key was missing from `_strings/Editor.ts`.

## Open items for spec 5 (visual-verification)

- **7 of 14 .pen previews failed to export** (`04-Documents`, `05-Editor-*` × 4, `06-Settings`, `06a-Settings-Connection`). Visual diff for these screens has no baseline until `tools/snapshot-pen.ts` re-extracts. Spec 5 should mark them as `no-reference` per FR-7.
- **Editor variants (`05`/`05b`/`05c`/`05d`)** are all the same RN screen with different state. Spec 5's 4 Maestro flows hit them via deep-link query params — no `.pen` baseline issue blocks 5 from running once previews exist.

## Open items for downstream specs

- **`canvas-fundamentals`** — `Editor/CanvasPlaceholder.tsx` is replaced.
- **`pairing-protocol`** — Pairing screens' `console.log('TODO(pairing-protocol)')` are replaced.
- **`client-state-architecture`** — `connectionStore.stub.ts` is replaced.
- **`generation-history`** — `History.tsx` real wiring.
- **`generation-workflow`** — BottomPromptBar's Generate/Fill action.
- **`prompt-enhancement`** — Sparkles button in BottomPromptBar.
- **`speech-to-text`** — Mic button in BottomPromptBar + Chat composer.
- **`external-agent-integration`** — Chat.tsx wiring + agent registry.
- **`regions`** — Regions.tsx real wiring.
- **`control-layers`** — Controls.tsx real wiring.
- **`workspaces`** — currently local state in `useEditorState`; will sync to server `set_workspace` MCP tool.

## Sign-off

`pnpm -r typecheck`: ✅ 9/9 packages clean
`pnpm lint` (raw-hex guard): ✅ 0 violations across 107 files
spec status: `screens-implementation` → implementation complete (chrome only).
