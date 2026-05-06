# ui-component-library — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + `tailwind.config.js`).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables" and §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout" and §"Package layout"; `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers" (per-screen primitive lists); `_ui-implementation-roadmap.md` row 2.

## 1. Purpose

This spec materialises the **component vocabulary** every screen of `apps/mobile` will speak. It locks the shadcn-style mental model — copy-paste, in-tree, headless-primitive-backed components — into the React Native form factor used by DiffuseCraft.

Concretely, this spec:
- Pastes 22 `react-native-reusables` (rnr) primitives into `libs/ui/src/components/<name>.tsx`. Web variants are dropped on paste; tokens from `design-system-foundation` replace any raw colour values that arrived in the rnr source.
- Adds 3 non-rnr companion components (`Sheet` over `@gorhom/bottom-sheet`, `Toast` over `sonner-native`) so the surface every screen author needs is complete in one package; `Checkbox` and `RadioGroup` ship as separate components but share their underlying primitive paste, and `Accordion`/`Collapsible` likewise. The total file count is **25 component files** even though the rnr-only count quoted in the roadmap is "≈22".
- Exports every component (and every public type) through `libs/ui/src/components/index.ts`.
- Provides a snapshot test per component plus a `componentsCoverage.test.ts` that proves every primitive is exported and rendered.

Storybook target, full a11y audit, runtime light/dark theme switching, and any animation polish beyond `react-native-reanimated` defaults are explicitly deferred. Components are PASTED, not imported at runtime — every line lives in this repo.

## 2. Stakeholders & user stories

### S1 — Screen author building the Editor
> **Story 1.** As the implementer of `screens-implementation` task `05-Editor-Generate`, I import `Button`, `Tabs`, `Slider`, `Card`, `Avatar`, `Badge`, and `Sheet` from `@diffusecraft/ui` and assemble the screen in TSX without writing a single hex value, without learning `@rn-primitives/*` directly, and without touching `react-native-reusables` as a dependency.

### S2 — Designer auditing variant coverage
> **Story 2.** As the design reviewer cross-checking the `.pen` artboards, I open `libs/ui/src/components/README.md` and see every component with its variant matrix (Button × 4 variants × 3 sizes; Tabs × 2 variants; Toast × 4 intents). I confirm that every variant in the artboards has a TS-exported counterpart.

### S3 — Future maintainer adding a new variant
> **Story 3.** As a maintainer adding a `tonal` Button variant, I extend the `ButtonVariant` TS union, add the variant's class composition in the same file, and add a snapshot test row. No screen code breaks; passing an unknown variant fails `tsc`.

### S4 — Agent UI tests verifying component shapes
> **Story 4.** As an agent-driven E2E test running `componentsCoverage.test.ts`, I import the barrel and confirm every primitive listed in §3 is exported with its `displayName`. Any component missing from the barrel fails CI.

### S5 — Accessibility-conscious user
> **Story 5.** As a user of the tablet client with a screen reader (VoiceOver) or external keyboard, I expect every interactive component to announce its role and state and to receive focus. A `<Button disabled>` announces "dimmed, button"; a `<Switch checked>` announces "on, switch"; tab order matches visual order.

### S6 — Stylus-only operator
> **Story 6.** As an Apple-Pencil-only user, I do not depend on hover-only affordances. Long-press surfaces context menus; press-down feedback uses `pressed` state, not hover. Every interactive component meets the 44×44pt touch target floor in `md` and `lg` sizes.

## 3. Functional requirements (EARS)

### 3.1 Component scope (the contract)

**FR-1 (Ubiquitous).** `@diffusecraft/ui` SHALL ship the following 25 components, one per file, under `libs/ui/src/components/<Name>.tsx`. Names are PascalCase; filenames match the export.

**Group 1 — Forms & inputs (7 components).**
1. `Button` — variants: `primary`, `secondary`, `ghost`, `destructive`; sizes: `sm`, `md`, `lg`.
2. `Input` — single-line text; optional leading and trailing slots.
3. `Textarea` — multi-line; auto-grow disabled by default; min/max rows props.
4. `Label` — typographic label, paired with form fields by `htmlFor`-equivalent (`nativeID`).
5. `Slider` — single thumb; numeric value 0..N; uses Reanimated for the drag.
6. `Switch` — boolean toggle.
7. `Checkbox` and `RadioGroup` — share `@rn-primitives/checkbox` and `@rn-primitives/radio-group` patterns; ship as two component files but document as a logical pair.

**Group 2 — Layout & meta (7 components).**
8. `Card` — surface with optional header / body / footer slots.
9. `Separator` — horizontal / vertical 1pt rule.
10. `Badge` — pill-shaped chip; intents: `neutral`, `accent`, `success`, `warn`, `danger`, `info`.
11. `Avatar` — circular image with text-initial fallback; sizes `sm`, `md`, `lg`.
12. `Skeleton` — animated placeholder block; respects radius props.
13. `Tabs` — variants: `segmented`, `underlined`.
14. `Accordion` and `Collapsible` — `Accordion` composes `Collapsible` internally; both ship.

**Group 3 — Overlays (5 components).**
15. `Dialog` — modal overlay with focus trap; supports header / body / footer.
16. `AlertDialog` — confirmation dialog; primary + cancel actions; `destructive` intent variant.
17. `Popover` — anchored floating surface; auto-positioning.
18. `Tooltip` — long-press triggered on touch surfaces; pointer-hover triggered when keyboard or external pointer is paired.
19. `Sheet` — bottom sheet wrapping `@gorhom/bottom-sheet`. **Not an rnr paste.** Lives in this package and follows the same theming + a11y contract.

**Group 4 — Pickers & feedback (6 components).**
20. `Select` — single-select dropdown; uses `Popover` underneath.
21. `Combobox` — searchable single-select; filtering inline; uses `Popover` + `Input`.
22. `ContextMenu` — long-press triggered menu; positions near the press point.
23. `DropdownMenu` — anchored menu triggered by tap on a button.
24. `Progress` — determinate (0..1) and indeterminate variants.
25. `Toast` — non-modal notification; wraps `sonner-native`. **Not an rnr paste.** Same theming + API conventions as the rnr siblings.

**FR-2 (Ubiquitous).** Component files SHALL be **pasted in-tree**. `libs/ui/package.json` SHALL NOT declare `react-native-reusables` as a runtime `dependencies` or `peerDependencies` entry. Importing from `react-native-reusables` at runtime is forbidden by lint (FR-13).

**FR-3 (Ubiquitous).** Web-only branches that arrive in the rnr source (e.g., `Platform.OS === 'web'`, `useWebFocus`, DOM-only listeners) SHALL be deleted on paste. The package targets native only, matching the "Web/PWA excluded" stance in `tech.md`.

### 3.2 Theming and tokens

**FR-4 (Ubiquitous).** Every component SHALL consume tokens via the contract frozen by `design-system-foundation`:
- Tailwind classes (`bg-canvas`, `text-primary`, `rounded-lg`, `p-4`, `text-display-lg`, `shadow-sheet`) for static styling.
- `useTheme()` from `@diffusecraft/ui` for runtime token reads (Reanimated shared values, Skia paints, gradient stops).

**FR-5 (Unwanted).** IF a component file under `libs/ui/src/components/` contains a raw hexadecimal colour literal, CI SHALL fail. (Reuses the lint rule landed in `design-system-foundation` T7.)

**FR-6 (Ubiquitous).** Components SHALL NOT directly import token files (`libs/ui/src/theme/tokens.ts`). They consume tokens through `useTheme()` only. The provider is the single runtime read path.

### 3.3 Type safety and variants

**FR-7 (Ubiquitous).** Every component SHALL export a TypeScript type for its props, named `<Component>Props` (e.g., `ButtonProps`, `TabsProps`).

**FR-8 (Ubiquitous).** Variants SHALL be exhaustive in their TS unions. For `Button`, `type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'`; passing an unknown variant SHALL fail `tsc` strict-mode typecheck.

**FR-9 (Ubiquitous).** Every component SHALL set `displayName`. Snapshot trees and the `componentsCoverage.test.ts` rely on it.

### 3.4 Accessibility floor

**FR-10 (Ubiquitous).** Every interactive component SHALL set the appropriate `accessibilityRole` (e.g., `button`, `switch`, `checkbox`, `radio`, `tab`, `menu`, `slider`, `link`).

**FR-11 (Ubiquitous).** Every interactive component SHALL propagate `disabled` semantically through `accessibilityState.disabled` and visually through token-driven dim styling (`text-tertiary` foreground, `bg-elevated` or `border-subtle` neutralisation).

**FR-12 (Ubiquitous).** Overlay components (`Dialog`, `AlertDialog`, `Popover`, `Sheet`, `DropdownMenu`, `ContextMenu`) SHALL trap focus while open and return focus to the trigger on close. `accessibilityViewIsModal` is set on the overlay container.

### 3.5 Stylus and touch-target rules

**FR-13 (Ubiquitous).** Touch targets SHALL be ≥ 44×44pt for `md` and `lg` sizes of every interactive component. The `sm` size MAY drop below 44pt **only** when the component is used as a sub-element inside a denser composite (e.g., a chip in a chip-row, a tab head inside a `segmented` Tabs strip).

**FR-14 (Ubiquitous).** No interactive component SHALL rely on hover-only affordances. Press-feedback SHALL use the `pressed` state. `Tooltip` and `ContextMenu` SHALL be reachable via long-press on touch surfaces.

**FR-15 (Ubiquitous).** Lint or CI guard SHALL ban runtime imports from `react-native-reusables` inside `libs/ui/src/components/`. Mechanism: ESLint rule or grep CI step (`rg -n "from ['\"]react-native-reusables" libs/ui/src/components` must return empty).

### 3.6 Tests

**FR-16 (Ubiquitous).** Every component file SHALL have a co-located test at `libs/ui/src/components/__tests__/<Name>.test.tsx`. The test SHALL render the component inside `<ThemeProvider>` and produce at least one snapshot.

**FR-17 (Ubiquitous).** Components with variants SHALL produce one snapshot per variant × size combination. Concretely: `Button` produces 12 snapshots (4 variants × 3 sizes); `Badge` produces 6 (one per intent); `Tabs` produces 2 (segmented / underlined); `Avatar` produces 3 (sm / md / lg with both image and initial-fallback flavours, so 6 in total). The exact matrix per component is enumerated in `design.md` §8.

**FR-18 (Ubiquitous).** A `libs/ui/src/components/__tests__/componentsCoverage.test.ts` SHALL import the barrel `libs/ui/src/components/index.ts` and assert that every name in §3.1's contract is exported and renders without throwing inside a `<ThemeProvider>` wrapper.

### 3.7 Storybook (deferred)

**FR-19 (Ubiquitous).** This spec SHALL NOT introduce a Storybook-RN target. The component surface is forecastable but Storybook tooling lands post-v1, per `_ui-implementation-roadmap.md` "Open items".

## 4. Non-functional requirements

**NFR-1 (Bundle size).** Components SHALL paste only what is used. The package SHALL NOT export a monolithic catch-all that drags every primitive into a single screen's bundle. Tree-shaking by named import is the default; `index.ts` SHALL re-export each component individually (no `export * from` of an internal "all" file).

**NFR-2 (Performance).** Components SHALL avoid inline styles in render-hot paths. Styling lives in NativeWind class composition (compiled to `StyleSheet`) and `useTheme()` reads are memoised.

**NFR-3 (DX).** Every component SHALL export its props type and set `displayName`. JSDoc on each component SHALL include a one-line summary and one usage example, per `structure.md` "TSDoc on all public exports".

**NFR-4 (Type safety).** `tsc --noEmit` SHALL pass with `strict: true` and `noUncheckedIndexedAccess: true` across `libs/ui`. No `any` in shipped code (`unknown` + narrowing only).

**NFR-5 (Determinism).** Snapshot output SHALL be deterministic across machines. Date/time/random values SHALL be stubbed in tests.

## 5. Acceptance criteria

This spec is APPROVED-FOR-IMPLEMENTATION when:

1. All 25 component files exist at `libs/ui/src/components/<Name>.tsx`, each exporting at least the named component and its props type.
2. `libs/ui/src/components/index.ts` re-exports every component and its props type.
3. Every component has a snapshot test that passes; the variant × size matrix in `design.md` §8 is fully covered.
4. `componentsCoverage.test.ts` passes — every name in the contract is exported and renders inside a `<ThemeProvider>`.
5. `rg -n "#[0-9A-Fa-f]{3,8}\b" libs/ui/src/components` returns empty (or only test fixtures explicitly whitelisted, per `design-system-foundation` §8).
6. `rg -n "from ['\"]react-native-reusables" libs/ui/src/components` returns empty.
7. `tsc --noEmit` clean for `libs/ui`.
8. `libs/ui/src/components/README.md` lists every primitive, its variants, its rnr source attribution (URL or commit), and a one-line usage example.
9. Every primitive is referenced by at least one screen in `screens-implementation` (verified at the end of that downstream spec, not blocking here).

## 6. Out of scope

- **Storybook-RN target.** Deferred per roadmap.
- **Full accessibility audit.** This spec lands a floor; a deeper audit lives in a later spec once chrome is stable.
- **Animations beyond Reanimated defaults.** Custom motion catalogues are out of scope.
- **RTL / bidi support.** Deferred; the v1 product ships in English with Spanish expansion room only.
- **Runtime light/dark theme switching.** `design-system-foundation` types accept a theme name; only `dark` is implemented.
- **Custom domain widgets** — layer rail, brush picker, transform handles, command palette, region overlays. These are NOT rnr primitives; they live in `screens-implementation` or a later `editor-chrome` spec built on top of these primitives.
- **Phone fallback layout** for these components. Tablet only.
- **Form orchestration** (e.g., a `Form` wrapper with validation hooks). Components stay headless; form composition lives in screen code.
- **Internationalisation hooks.** No `useTranslation` integration; i18n lands in a separate spec.
- **Theming modes for individual components** (e.g., per-component dark/light overrides). The theme is global.
