# design-system-foundation — Design

> **Status:** Draft v0.1.
> **Companion to:** `requirements.md`.
> **Depends on:** — (foundation spec).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables", §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout", §"Package layout"; `prompts/pencil-design-screens.md` §"WAVE 1 — Bootstrap"; `_ui-implementation-roadmap.md` "Phase 0 — `.pen` snapshot extraction".

## 1. Module layout

Exact file paths created or touched by this spec, mapped to the monorepo structure declared in `structure.md`:

| Path | Role | Owned by |
|---|---|---|
| `tailwind.config.js` | Workspace-root Tailwind config: full token registration; consumed by `apps/mobile` and `libs/ui`. | This spec |
| `libs/ui/src/theme/index.ts` | Public entry: re-exports `ThemeProvider`, `useTheme`, `type Theme`. | This spec |
| `libs/ui/src/theme/tokens.ts` | Typed re-export of the token shape; mirrors `tailwind.config.js` values. Single source of TS-side truth. | This spec |
| `libs/ui/src/theme/types.ts` | `Theme`, `ThemeName`, `ColorToken`, `SpacingToken`, `RadiusToken`, `TypeToken`, `ElevationToken` type definitions. | This spec |
| `libs/ui/src/theme/provider.tsx` | `ThemeProvider` component + `useTheme` hook implementation. | This spec |
| `libs/ui/src/index.ts` | Adds `export * from './theme'`. | This spec |
| `apps/mobile/babel.config.js` | Adds `nativewind/babel`. | This spec |
| `apps/mobile/metro.config.js` | Wraps Expo metro with `withNativeWind`. | This spec |
| `apps/mobile/global.css` | Tailwind directives. | This spec |
| `apps/mobile/app.config.ts` | Expo config; ensures NativeWind plugin entries (if any) and notes any required env vars. | This spec |
| `apps/mobile/App.tsx` | Mounts `<ThemeProvider>`. (Stub; navigation lands in `app-shell-navigation`.) | This spec (stub) |
| `tools/snapshot-pen.ts` | TS script using `@modelcontextprotocol/sdk` to talk to the pencil MCP server and write `apps/mobile/design-snapshot/`. Run with `pnpm tsx tools/snapshot-pen.ts`. | This spec |
| `apps/mobile/design-snapshot/.gitkeep` | Placeholder so the directory exists in git. | This spec |
| `apps/mobile/design-snapshot/manifest.json` | Either real snapshot manifest or placeholder with 13 artboard labels (see §6). | This spec |
| `apps/mobile/src/screens/Swatch.tsx` | Visual smoke test of all tokens. | This spec |
| `apps/mobile/src/screens/index.ts` | Re-exports `Swatch` (consumed by App.tsx as the temporary default route). | This spec |
| `tools/lint/no-raw-hex.js` (or ESLint rule via existing config) | CI guard banning raw hex outside `tailwind.config.js`. | This spec |

Directory shape after this spec lands:

```
DiffuseCraft/
├── tailwind.config.js              # NEW
├── apps/mobile/
│   ├── App.tsx                     # NEW (stub mounting ThemeProvider + Swatch)
│   ├── app.config.ts               # NEW
│   ├── babel.config.js             # NEW
│   ├── metro.config.js             # NEW
│   ├── global.css                  # NEW
│   ├── design-snapshot/            # NEW (gitkeep + manifest.json + per-artboard dirs when .pen exists)
│   └── src/screens/
│       ├── Swatch.tsx              # NEW
│       └── index.ts                # NEW
├── libs/ui/src/theme/              # NEW
│   ├── index.ts
│   ├── tokens.ts
│   ├── types.ts
│   └── provider.tsx
└── tools/
    ├── snapshot-pen.ts             # NEW
    └── lint/no-raw-hex.js          # NEW (or rule embedded in eslint.config)
```

## 2. Token system

The token set is the **frozen contract** for every downstream UI spec. Names and values match `prompts/pencil-design-screens.md` §"WAVE 1 — Bootstrap" exactly. Hex values appear here because this section IS the contract; they appear nowhere else in this spec.

### 2.1 Color — neutral (dark, default)

| Token | Value | Use |
|---|---|---|
| `bg/canvas` | `#0B0B0C` | App background; default canvas backdrop |
| `bg/surface` | `#141416` | Default panel/card surface |
| `bg/elevated` | `#1C1C1F` | Elevated surfaces (floating prompt bar, popover, dialog) |
| `bg/inset` | `#0F0F11` | Inset surfaces (input fields, code wells, digit boxes) |
| `border/subtle` | `#26262B` | Default separators |
| `border/strong` | `#3A3A42` | Emphasised borders (focused input, primary outline button) |
| `text/primary` | `#F4F4F5` | Body and headings |
| `text/secondary` | `#A1A1AA` | Captions, helper text |
| `text/tertiary` | `#71717A` | Disabled, low-emphasis meta |

**Rationale.** Dark-first because the tablet client is for long stylus sessions in studios where colour fidelity matters. Three background steps (canvas → surface → elevated) plus an inset step give enough hierarchy without shadows. Three text steps (primary/secondary/tertiary) match the desktop_workshop reference's restraint.

### 2.2 Color — accent (single accent)

| Token | Value | Use |
|---|---|---|
| `accent/default` | `#7C5CFF` | Primary action; active state of a single tool / tab |
| `accent/hover` | `#8E72FF` | Hover/active feedback (rare on tablet; reserved for keyboard/stylus hover) |
| `accent/muted` | `#2A2240` | Active-row background (current layer, current tab body) |

**Rationale.** A single indigo accent (`#7C5CFF`) keeps the palette monochromatic except for one decision point per screen — the primary action. `accent/muted` is the desaturated companion used as a fill rather than a stroke (active layer row, selected chip background).

### 2.3 Color — semantic

| Token | Value | Use |
|---|---|---|
| `danger` | `#EF4444` | Destructive action labels, error border |
| `warn` | `#F59E0B` | Cautionary helper text |
| `success` | `#22C55E` | Confirmation chip, online dot |
| `info` | `#0EA5E9` | Informational chip; rare |

**Rationale.** Standard Tailwind palette stops, kept saturated rather than muted because they appear sparingly (only on actual events, not as decoration).

### 2.4 Radii

| Token | Value (pt) |
|---|---|
| `xs` | 4 |
| `sm` | 6 |
| `md` | 10 |
| `lg` | 14 |
| `xl` | 20 |
| `pill` | 999 |

**Rationale.** Six steps cover everything from chip (`xs`) through digit box (`lg`) through rounded panel (`xl`) and pill button (`pill`). Steps are non-linear because design needs cluster around small (4–10) and large (14–20) — not in the middle.

### 2.5 Spacing

`2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72` — 12 stops.

**Rationale.** Twelve stops with denser packing in the small range (where stylus precision matters: 2/4/6/8) and looser packing in the large range (where layout breathing room dominates: 24/32/40/56/72). Avoids the "too many stops" of a strict 4pt grid.

### 2.6 Type

| Token | Size | Line height | Weight |
|---|---|---|---|
| `display/lg` | 32 | 40 | 600 |
| `display/md` | 24 | 32 | 600 |
| `title` | 18 | 24 | 600 |
| `body` | 14 | 20 | 400 |
| `body-strong` | 14 | 20 | 500 |
| `mono` | 13 | 18 | 400 |
| `caption` | 12 | 16 | 400 |

Font family stack: `Inter` (preferred), `SF Pro Text` / `-apple-system` (fallback). Mono family stack: `JetBrains Mono`, `SF Mono`, `Menlo`, `monospace`.

**Rationale.** Two display sizes (32/24), one title (18), two body weights at the same metrics (400/500), one mono for technical strings (URLs, fingerprints, latencies), one caption. The 14/20 body is the workhorse; everything else is sparing.

### 2.7 Elevation

| Token | Value | Use |
|---|---|---|
| `shadow/sheet` | `0 -8 24 rgba(0,0,0,0.4)` | Bottom sheets entering from below |

**Rationale — borders > shadows.** Per the desktop_workshop reference, panels separate via border + background shift, not drop shadows. Shadow appears in exactly one situation: a bottom sheet appearing from offscreen needs an above-it shadow so the user perceives separation from the canvas. No other surface in v1 uses elevation.

## 3. Theme types

```typescript
// libs/ui/src/theme/types.ts
export type ThemeName = 'dark' | 'light';

export type ColorToken =
  | 'bg.canvas' | 'bg.surface' | 'bg.elevated' | 'bg.inset'
  | 'border.subtle' | 'border.strong'
  | 'text.primary' | 'text.secondary' | 'text.tertiary'
  | 'accent.default' | 'accent.hover' | 'accent.muted'
  | 'danger' | 'warn' | 'success' | 'info';

export type RadiusToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'pill';

export type SpacingToken = 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 56 | 72;

export type TypeToken =
  | 'display.lg' | 'display.md' | 'title'
  | 'body' | 'body-strong' | 'mono' | 'caption';

export type ElevationToken = 'sheet';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600';
  fontFamily: 'sans' | 'mono';
}

export interface Theme {
  name: ThemeName;
  color: Record<ColorToken, string>;
  radius: Record<RadiusToken, number>;
  spacing: Record<SpacingToken, number>;
  type: Record<TypeToken, TypeStyle>;
  elevation: Record<ElevationToken, {
    offsetX: number; offsetY: number; blur: number; color: string;
  }>;
}
```

The dotted token names (`bg.canvas`) match Tailwind nested key access. NativeWind classnames use the dash-flattened form (`bg-canvas`, `text-primary`, `rounded-lg`, `p-4`). This dual representation is intentional: TS code reads `theme.color['bg.canvas']`; JSX reads `className="bg-canvas"`. Both are derived from the single config in §4.

## 4. NativeWind integration

### 4.1 Class resolution

NativeWind v4 reads `tailwind.config.js`, runs the same Tailwind tree-shaking pass over project source, and emits a compile-time `StyleSheet.create({...})` for every encountered class. At runtime, `<View className="bg-canvas">` becomes a styled View with no dynamic style recomputation. (NativeWind v4's compile model is JIT at build time, not runtime.)

### 4.2 `tailwind.config.js` shape

```javascript
// tailwind.config.js (workspace root)
module.exports = {
  content: [
    './apps/mobile/src/**/*.{ts,tsx}',
    './apps/mobile/App.tsx',
    './libs/ui/src/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        canvas:    '#0B0B0C',
        surface:   '#141416',
        elevated:  '#1C1C1F',
        inset:     '#0F0F11',
        'border-subtle': '#26262B',
        'border-strong': '#3A3A42',
        primary:   '#F4F4F5',
        secondary: '#A1A1AA',
        tertiary:  '#71717A',
        accent: {
          DEFAULT: '#7C5CFF',
          hover:   '#8E72FF',
          muted:   '#2A2240',
        },
        danger:  '#EF4444',
        warn:    '#F59E0B',
        success: '#22C55E',
        info:    '#0EA5E9',
      },
      borderRadius: {
        xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999,
      },
      spacing: {
        0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16,
        5: 20, 6: 24, 8: 32, 10: 40, 14: 56, 18: 72,
      },
      fontSize: {
        'display-lg': ['32px', { lineHeight: '40px', fontWeight: '600' }],
        'display-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        title:        ['18px', { lineHeight: '24px', fontWeight: '600' }],
        body:         ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-strong':['14px', { lineHeight: '20px', fontWeight: '500' }],
        mono:         ['13px', { lineHeight: '18px', fontWeight: '400' }],
        caption:      ['12px', { lineHeight: '16px', fontWeight: '400' }],
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Text', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        sheet: '0 -8px 24px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};
```

Resulting class examples:
- `bg-canvas`, `bg-surface`, `bg-elevated`, `bg-inset`
- `text-primary`, `text-secondary`, `text-tertiary`
- `border-border-subtle`, `border-border-strong`
- `bg-accent`, `bg-accent-hover`, `bg-accent-muted`
- `rounded-lg`, `rounded-pill`
- `p-2` (= 8pt), `gap-3` (= 12pt), `mt-6` (= 24pt)
- `text-display-lg`, `text-body-strong`
- `shadow-sheet`

### 4.3 `@apply`

`@apply` is permitted inside `apps/mobile/global.css` for composing utility shorthands (e.g., `.pressable-base { @apply min-h-11 min-w-11; }` enforcing the 44pt touch target floor). Components SHALL prefer inline `className` for everything else; `@apply` is for cross-cutting primitives only.

### 4.4 Future light-theme toggle

When light theme lands post-v1, `tailwind.config.js` adopts NativeWind's `darkMode: 'class'` strategy. Two colour blocks (one per theme) are declared; `<ThemeProvider name="light">` toggles a `dark` className at the root view. No JSX changes required — only token consumers under `useTheme()` need re-rendering, handled by the provider.

## 5. ThemeProvider

```typescript
// libs/ui/src/theme/provider.tsx
import React, { createContext, useContext, useMemo, useState } from 'react';
import { darkTheme } from './tokens';
import type { Theme, ThemeName } from './types';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  initialTheme?: ThemeName;
  children: React.ReactNode;
}

export function ThemeProvider({ initialTheme = 'dark', children }: ThemeProviderProps) {
  const [name, setName] = useState<ThemeName>(initialTheme);
  // v1: only 'dark' is implemented; 'light' falls back to dark with a console.warn in dev.
  const theme = useMemo<Theme>(() => (name === 'dark' ? darkTheme : darkTheme), [name]);
  const value = useMemo(() => ({ theme, setTheme: setName }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

export function useSetTheme(): (name: ThemeName) => void {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useSetTheme must be used inside <ThemeProvider>');
  return ctx.setTheme;
}
```

`tokens.ts` exports `darkTheme: Theme` whose values mirror the table in §2 byte-for-byte (and §4.2 in the Tailwind config). Light theme placeholder is reserved but deliberately unimplemented in v1.

Mount point in `apps/mobile/App.tsx`:

```typescript
// apps/mobile/App.tsx (stub for this spec; replaced by app-shell-navigation later)
import './global.css';
import { ThemeProvider } from '@diffusecraft/ui';
import { Swatch } from './src/screens';

export default function App() {
  return (
    <ThemeProvider>
      <Swatch />
    </ThemeProvider>
  );
}
```

## 6. Snapshot script

`tools/snapshot-pen.ts` is a Node + TS script (run via `pnpm tsx tools/snapshot-pen.ts`) that talks to the pencil MCP server using `@modelcontextprotocol/sdk` (Client + StdioClientTransport). It is operator-driven, not a build step.

### 6.1 Behaviour

1. Spawn the configured pencil MCP server (path read from env `PENCIL_MCP_BIN` or a default config file). Connect via stdio transport.
2. Call `get_editor_state`. If no document is open, call `open_document` with the configured `.pen` path (env `DIFFUSECRAFT_PEN_PATH`).
3. Call `get_variables` once → write `apps/mobile/design-snapshot/tokens.json` (informational; runtime contract remains `tailwind.config.js`).
4. For each artboard label in the manifest target list:
   - `export_nodes` (artboard root) → `nodes.json`.
   - `get_screenshot` (artboard) → `preview.png`.
   - `snapshot_layout` (artboard) → `layout.json`.
5. Write `manifest.json` (schema below).
6. Disconnect.

### 6.2 Manifest schema

```typescript
interface SnapshotManifest {
  snapshot_version: number;            // monotonically increasing on re-run
  source_pen_path: string | null;      // absolute path; null when .pen not yet present
  extracted_at: string;                // ISO 8601, deterministically formatted
  pencil_mcp_version: string;          // from initialize handshake
  artboards: Array<{
    label: string;                     // e.g., "01-Splash"
    size: { width: number; height: number };
    paths: {
      nodes: string;                   // relative to apps/mobile/design-snapshot/
      preview: string;
      layout: string;
    };
  }>;
}
```

### 6.3 Target artboard list (frozen for v1)

The 13 screens, in roadmap order, plus the optional `Z-Components`:

`01-Splash`, `02-Pairing-mDNS`, `02b-Pairing-QR`, `02c-Pairing-Code`, `02d-Pairing-Manual`, `03-ServerPicker`, `04-Documents`, `05-Editor-Generate`, `05b-Editor-Inpaint`, `05c-Editor-Live`, `05d-Editor-Chat-Open`, `06-Settings`, `06a-Settings-Connection`. All 1366×1024.

### 6.4 Pre-`.pen` placeholder

When the canonical `.pen` does not yet exist, `tools/snapshot-pen.ts` carries a `// TODO(.pen-not-yet)` comment and the script's `main()` writes a placeholder `apps/mobile/design-snapshot/manifest.json` with `snapshot_version: 0`, `source_pen_path: null`, and the 13 artboard labels populated with empty `paths` so downstream specs can read the manifest as a stable contract.

## 7. Swatch screen

`apps/mobile/src/screens/Swatch.tsx` is a single scrollable screen, divided into five labelled sections, used as a visual smoke test:

1. **Colour chips** — one row per token group (Neutrals, Accent, Semantic). Each chip is a 96×64 rect with rounded `lg` corners; the token name + hex is rendered below it. Border `border-subtle` for legibility against `bg-canvas`.
2. **Spacing bars** — vertical stack of horizontal bars; each bar's width equals the spacing value (in pt). Label on the right shows the token name + value.
3. **Radii squares** — row of 12 squares, each 64×64, with the radius applied. Label below.
4. **Type specimens** — one labelled string per type style, displayed at its actual size and weight, with the metrics annotated as a `mono` caption next to it.
5. **Elevation preview** — a card pinned to the bottom edge demonstrating `shadow/sheet` against a `bg-canvas` backdrop.

The screen reads its values via `useTheme()` (so the test exercises the runtime hook, not just the static Tailwind config) and applies styles via Tailwind classes (so the test exercises NativeWind compilation). Any token visible in §2 that is missing from the screen is a verification gap.

## 8. Validation strategy

| Check | Tool | Enforcement |
|---|---|---|
| Token shape matches between `tailwind.config.js` and `libs/ui/src/theme/tokens.ts` | A vitest test that imports both and asserts every `bg-*`, `text-*`, `rounded-*`, `p-*`, `text-display-*` value resolves to the same hex/pt/style as `darkTheme`. | CI |
| No raw hex outside `tailwind.config.js` | Custom ESLint rule (or a simple regex grep step in CI: `rg -n "#[0-9A-Fa-f]{3,8}\b" apps/mobile libs/ui --glob '!tailwind.config.js' --glob '!**/__snapshots__/**' --glob '!**/design-snapshot/**'` must return empty). | CI |
| `tsc --noEmit` clean | TS strict mode | CI |
| Swatch screen renders | Vitest + RN Testing Library snapshot. | CI |
| `useTheme()` outside `<ThemeProvider>` throws | Vitest test asserting the error. | CI |
| NativeWind classes compile without warning | Build runs metro with `withNativeWind` and asserts exit code 0. | CI (non-blocking warn → blocking error if achievable) |

## 9. Open questions

### Q1 — Should tokens also emit CSS custom properties for a future web port?
**Decision:** No. Web is excluded per `tech.md`. Adding CSS variables would be dead code. If a future MeshCraft host wants to render DiffuseCraft UI in a webview, it writes its own adapter against `darkTheme`.

### Q2 — Should the snapshot script be an Nx project under `tools/e2e/` or a standalone script?
**Decision:** Standalone script in `tools/snapshot-pen.ts`, run via `pnpm tsx`. It is operator-driven and one-shot — no need for an Nx project boundary. Future enhancement: wrap with an `nx run-script snapshot-pen` target if it gains complexity.

### Q3 — Is `accent/hover` useful on a stylus-only surface?
**Open.** Tablet has limited hover semantics. Hover may apply only when keyboard or external trackpad is paired. v1 keeps the token because (a) Pencil hover on iPad does fire pointer events, (b) stylus hover (Apple Pencil 2nd gen on M-series iPad) is real, (c) removing it later is a token-rename, not a structure change.

### Q4 — Should `font-weight` for `body-strong` be `500` or `600`?
**Decision:** `500`. The brief says `500`; this matches the desktop_workshop reference. `600` is reserved for `title` and `display` to keep weight contrast.

### Q5 — Any tokens missing from the contract?
**Open.** The author of this spec noticed three potential gaps but does NOT add them silently:
- A focus ring colour (currently no token; downstream component spec may need `accent/default` reused or a new `focus.ring` token).
- A scrim / overlay colour (Dialog backdrop; could be `bg-canvas` at 60% opacity but no token currently captures it).
- A success/danger background variant for chips (currently semantic colours are stroke-grade saturation; a softer fill variant might be wanted).

These should be debated when `ui-component-library` first encounters the need.

### Q6 — Does the snapshot live in git?
**Decision:** Yes. `apps/mobile/design-snapshot/` is committed (manifest, JSON, PNGs). Re-running the script overwrites and produces a new commit; PR review compares the snapshot drift. PNGs are small (artboard-sized, optimised).
