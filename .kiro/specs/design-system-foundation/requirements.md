# design-system-foundation — Requirements

> **Status:** Draft v0.1.
> **Depends on:** — (foundation spec; first row of `_ui-implementation-roadmap.md`).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables" and §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout"; `prompts/pencil-design-screens.md` §"WAVE 1 — Bootstrap" (token contract source); `_ui-implementation-roadmap.md` row 1 and "Phase 0 — `.pen` snapshot extraction".

## 1. Purpose

Materialise the visual design tokens of the DiffuseCraft tablet client (`apps/mobile`) and shared UI library (`@diffusecraft/ui`) as a single, machine-readable, type-safe source of truth. This spec freezes the **token names and structure** for the rest of the UI implementation effort: every later spec (`ui-component-library`, `app-shell-navigation`, `screens-implementation`, `visual-verification`) consumes these tokens by name, never by value.

Concretely, this spec:
- Wires NativeWind v4 into Expo for `apps/mobile`, with the workspace-root `tailwind.config.js` shared between the app and `@diffusecraft/ui`.
- Registers the full token set (color, spacing, radii, type, elevation) listed in the design brief.
- Exports a `ThemeProvider` from `@diffusecraft/ui` that mounts at the app root and provides typed token access for non-Tailwind code paths (e.g., Skia, Reanimated values).
- Lands the snapshot ingestion script `tools/snapshot-pen.ts` so that the canonical `.pen` design file (when present) materialises into `apps/mobile/design-snapshot/` for downstream specs to read.
- Provides a Swatch screen that visually renders every token as a smoke test.

Light theme, animations beyond NativeWind, phone fallback layout, and a11y audit are explicitly deferred.

## 2. Stakeholders & user stories

### S1 — App developer adding a new screen
> **Story 1.** As an `apps/mobile` developer adding a screen for `screens-implementation`, I import a Tailwind class like `bg-canvas text-primary` and the screen renders with the correct colour without me knowing the hex value. If I try to write `style={{ color: '#F4F4F5' }}` directly, CI fails.

### S2 — Component author in `@diffusecraft/ui`
> **Story 2.** As a contributor pasting a `react-native-reusables` Button into `libs/ui/src/components/Button.tsx`, I replace its raw colour values with token classes (`bg-accent text-primary`). I also need typed token access for `react-native-skia` snippets that don't accept Tailwind classes — I use `useTheme()` from `@diffusecraft/ui` and read `theme.color.accent.default`.

### S3 — Design reviewer auditing token compliance
> **Story 3.** As the design reviewer running `pnpm lint`, I get a hard error listing every file that contains a raw hex literal outside `tailwind.config.js`. I run `tools/snapshot-pen.ts`, open `apps/mobile/design-snapshot/manifest.json`, and confirm the artboard list matches the 13 screens declared in the roadmap.

### S4 — Future maintainer adding a light theme
> **Story 4.** As a maintainer adding a `light` theme post-v1, I duplicate the `colors` block in `tailwind.config.js` under a `light:` key, extend `ThemeProvider` with `setTheme('light')`, and switch a CSS variable namespace. No screen code or component changes — every consumer reads tokens by name.

### S5 — Snapshot consumer (downstream spec orchestrator)
> **Story 5.** As the orchestrator of `screens-implementation`, I dispatch 13 designer subagents and pass each one the path `apps/mobile/design-snapshot/<artboard-label>/{nodes.json, preview.png}`. The manifest produced by this spec lists those 13 artboards so the orchestrator can iterate without hard-coding labels.

## 3. Functional requirements (EARS)

### 3.1 Token registration

**FR-1 (Ubiquitous).** The workspace SHALL declare a single Tailwind configuration at `tailwind.config.js` (workspace root) registering the **complete** token set in §2 of `design.md`:
- 9 neutral colour tokens (`bg/canvas`, `bg/surface`, `bg/elevated`, `bg/inset`, `border/subtle`, `border/strong`, `text/primary`, `text/secondary`, `text/tertiary`).
- 3 accent colour tokens (`accent/default`, `accent/hover`, `accent/muted`).
- 4 semantic colour tokens (`danger`, `warn`, `success`, `info`).
- 6 radius tokens (`xs`, `sm`, `md`, `lg`, `xl`, `pill`).
- 12 spacing tokens (2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72).
- 7 type styles (`display/lg`, `display/md`, `title`, `body`, `body-strong`, `mono`, `caption`) declaring font size, line height, and font weight.
- 1 elevation token (`shadow/sheet`).

Token names and values SHALL match `prompts/pencil-design-screens.md` §"WAVE 1 — Bootstrap" exactly. The names are a frozen contract for all downstream specs.

**FR-2 (Ubiquitous).** Both `apps/mobile` and `@diffusecraft/ui` SHALL consume the same `tailwind.config.js` (single source of truth). No package SHALL declare a private Tailwind config.

### 3.2 NativeWind integration

**FR-3 (Ubiquitous).** `apps/mobile` SHALL wire NativeWind v4 via:
- `babel.config.js` adding the `nativewind/babel` preset.
- `metro.config.js` wrapping the Expo metro config with `withNativeWind({ input: './global.css' })`.
- `global.css` containing the three Tailwind directives (`@tailwind base/components/utilities`).
- `app.config.ts` (or `app.json`) exposing any required Expo plugin entries.

**FR-4 (Ubiquitous).** NativeWind classes SHALL compile to React Native `StyleSheet` at build time. No runtime style recomputation in shipped builds.

### 3.3 ThemeProvider in `@diffusecraft/ui`

**FR-5 (Ubiquitous).** `@diffusecraft/ui` SHALL export a `ThemeProvider` React component and a `useTheme()` hook from `libs/ui/src/theme/index.ts`. The default theme is `dark`. Light theme is structurally supported (the type signature accepts a theme name) but only `dark` is implemented in v1.

**FR-6 (Ubiquitous).** `useTheme()` SHALL return a typed object:
```
{ name: 'dark', color, spacing, radius, type, elevation, setTheme }
```
where `color`, `spacing`, `radius`, `type`, `elevation` are typed records keyed by the same names declared in `tailwind.config.js`. Keys are stable; values may differ between themes.

**FR-7 (Ubiquitous).** `apps/mobile/App.tsx` SHALL wrap the navigation root in `<ThemeProvider>`.

### 3.4 Token consumption rule (raw-hex ban)

**FR-8 (Unwanted).** IF a file under `apps/mobile/` or `libs/ui/` (excluding `tailwind.config.js`, generated files, snapshot fixtures, and tests that explicitly assert hex values) contains a raw hexadecimal colour literal, CI SHALL fail.

**FR-9 (Ubiquitous).** Components SHALL prefer Tailwind class names (`bg-canvas`, `text-secondary`, `rounded-lg`, `p-4`) for styling. Where Tailwind cannot reach (Skia paint colours, Reanimated shared values, gradient stops), components SHALL read tokens via `useTheme()`.

### 3.5 Snapshot ingestion script

**FR-10 (Event-driven).** WHEN the canonical `.pen` design file exists at the path declared by the orchestrator and the operator runs `pnpm tsx tools/snapshot-pen.ts`, THE script SHALL:
1. Open the `.pen` document via the pencil MCP using the `@modelcontextprotocol/sdk` client (transport: stdio against the locally configured pencil MCP server).
2. For each artboard listed in the design brief (13 screens + optional `Z-Components`), call `export_nodes` to obtain JSON node data and `get_screenshot` to obtain a PNG preview. Optionally call `snapshot_layout` to obtain layout JSON.
3. Call `get_variables` once and write the result as `apps/mobile/design-snapshot/tokens.json` (informational; the runtime contract remains `tailwind.config.js`).
4. Write per-artboard outputs to `apps/mobile/design-snapshot/<artboard-label>/{nodes.json, preview.png, layout.json}`.
5. Write `apps/mobile/design-snapshot/manifest.json` with the schema declared in `design.md` §6.

**FR-11 (Unwanted).** IF the canonical `.pen` does not yet exist when this spec is implemented, THE T1 task SHALL be SKIPPED and a placeholder `apps/mobile/design-snapshot/manifest.json` SHALL be written with `snapshot_version: 0`, an empty `extracted_at`, the literal `source_pen_path: null`, and the **13 expected artboard labels** populated as `artboards[]` so downstream specs can reference the manifest. A `// TODO(.pen-not-yet)` comment at the top of `tools/snapshot-pen.ts` SHALL document the deferral.

### 3.6 Swatch screen

**FR-12 (Ubiquitous).** `apps/mobile/src/screens/Swatch.tsx` SHALL render every token visually:
- One labelled chip per colour token (background = token, label = token name + hex from `useTheme()`).
- One labelled bar per spacing token (width = spacing value).
- One labelled rounded square per radius token.
- One labelled string per type style.
- A bottom sheet preview demonstrating `shadow/sheet`.

**FR-13 (Ubiquitous).** The Swatch screen SHALL be reachable as a temporary entry point during T6 (e.g., the default Expo route for the implementation pass) so a developer running `pnpm dev` sees every token rendered.

### 3.7 Light theme is deferred

**FR-14 (Ubiquitous).** Token definitions SHALL be structured so a light theme is a future swap (typed shape with theme name as a discriminator), but only the `dark` variant is implemented in v1. Adding `light` is explicitly out of scope.

## 4. Non-functional requirements

**NFR-1 (Performance).** NativeWind v4 SHALL compile classes to `StyleSheet`; no runtime style recomputation should occur in shipped builds. `useTheme()` SHALL return a stable reference per theme switch (no per-render allocation).

**NFR-2 (Portability).** The workspace-root `tailwind.config.js` SHALL be consumable by both `apps/mobile` and `libs/ui`. Neither package may import the other to read tokens.

**NFR-3 (Maintainability).** Token names declared here are a **stable contract**. Renaming a token after this spec is approved requires a follow-up spec amendment, not a silent edit. Adding a token is allowed in a downstream spec via amendment to `tailwind.config.js`.

**NFR-4 (Type safety).** `useTheme()` return type SHALL be exhaustively typed. Adding a token to `tailwind.config.js` without updating the TS shape SHALL fail `tsc`.

**NFR-5 (Determinism).** Running `tools/snapshot-pen.ts` twice without `.pen` changes SHALL produce byte-identical output (modulo the `extracted_at` timestamp, which is deterministically formatted).

## 5. Acceptance criteria

This spec is APPROVED-FOR-IMPLEMENTATION when:

1. `tailwind.config.js` exists at the workspace root and exports every token listed in §3.1 with the exact names and values from the contract.
2. `apps/mobile` boots under Expo with NativeWind v4 active; `pnpm dev` does not throw a styling error.
3. `@diffusecraft/ui` exports `ThemeProvider` and `useTheme` from `libs/ui/src/theme/index.ts`; `apps/mobile/App.tsx` mounts it.
4. `tools/snapshot-pen.ts` exists; either has run and produced `apps/mobile/design-snapshot/{tokens.json, manifest.json, <13 artboards>/...}` (when `.pen` is available), or has produced a placeholder `manifest.json` with the 13 expected artboard labels and a `// TODO(.pen-not-yet)` comment in the script.
5. CI fails on raw hex literals outside `tailwind.config.js` within `apps/mobile/` and `libs/ui/`.
6. `apps/mobile/src/screens/Swatch.tsx` renders all tokens and is reachable as the temporary default route.
7. `tsc` passes with `strict: true` across `apps/mobile` and `libs/ui`.
8. A snapshot test of `Swatch.tsx` exists and passes (Vitest + RN Testing Library).

## 6. Out of scope

- **Light theme implementation.** Type shape supports it; no second token set lands here.
- **Phone fallback layout.** Tablet only.
- **Animations beyond what NativeWind handles natively.** Reanimated motion catalog lives in `ui-component-library` or a later spec.
- **A11y audit.** Deferred per `_ui-implementation-roadmap.md`.
- **Component library content.** Buttons, Inputs, Cards etc. are owned by spec `ui-component-library`. This spec only exposes the tokens those components will consume.
- **Navigation.** Owned by `app-shell-navigation`.
- **Screen content.** Owned by `screens-implementation`.
- **CSS custom property emission for a hypothetical web port.** Web is excluded per `tech.md`.
- **Storybook target for `@diffusecraft/ui`.** Deferred per roadmap "Open items".
