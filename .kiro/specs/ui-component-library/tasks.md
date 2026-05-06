# ui-component-library — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, `tsc --noEmit` clean, lint clean (no raw hex, no runtime `react-native-reusables` import), Conventional Commits with `ui` scope.
> **t-shirt sizes:** XS = ≤30 min · S = ≤2h · M = ≤half-day. (This spec contains only XS / S / M tasks.)

> **Total estimate:** ~3 days for one engineer. Component groups can be parallelised across two engineers because each group is self-contained.

> **Pre-flight:** §9 of `design.md` proposes amending `design-system-foundation` to add `focus.ring`, `scrim`, and `{danger,warn,success,info}.muted` tokens BEFORE starting T1. If foundation has not been amended, surface to the human reviewer before proceeding.

---

## T1 — `libs/ui/package.json` peerDependencies + workspace wiring

**Title.** Land the runtime stack as `peerDependencies` and confirm `apps/mobile` pins versions.

**Files touched.**
- `libs/ui/package.json` — add the `peerDependencies` block from `design.md` §1.1.
- `apps/mobile/package.json` — add (or confirm) pinned versions for every peer.
- `package.json` (workspace root, if needed) — bump pnpm catalog entries.

**Acceptance check.**
- `pnpm install` completes without peer-dep warnings for `@diffusecraft/ui`.
- `pnpm -F @diffusecraft/ui build` (or `tsc --noEmit`) does not report missing modules for any of the 23 peers.
- `react-native-reusables` is **NOT** present in `libs/ui/package.json`.

**Dependencies.** None.

**Size.** S.

---

## T2 — `_internal` helpers + rnr commit pin

**Title.** Create the `_internal/` directory with `cn`, `useTokenColor`, and the barrel; record the rnr source commit.

**Files touched.**
- `libs/ui/src/components/_internal/cn.ts` (new) — class-composition helper from `design.md` §3.2.
- `libs/ui/src/components/_internal/use-token.ts` (new) — typed accessor over `useTheme()` from `design.md` §4.3.
- `libs/ui/src/components/_internal/index.ts` (new) — `export * from './cn'; export * from './use-token';`.
- `libs/ui/src/components/_internal/__tests__/cn.test.ts` (new) — basic concat / falsy filter coverage.
- `libs/ui/src/components/README.md` (new, partial) — header section listing the rnr source repository URL and the pinned commit SHA used for this paste.

**Acceptance check.**
- `cn('a', false, 'b')` returns `'a b'`.
- `useTokenColor('accent.default')` inside `<ThemeProvider>` returns `'#7C5CFF'`.
- README's commit SHA is reachable on `github.com/founded-labs/react-native-reusables`.

**Dependencies.** T1 (peer deps installed so types resolve).

**Size.** S.

---

## T3 — Group 1: Forms & inputs paste + tests

**Title.** Paste the 7 form components from rnr, drop web variants, apply tokens, write snapshot tests.

**Files touched.**
- `libs/ui/src/components/Button.tsx` (new)
- `libs/ui/src/components/Input.tsx` (new)
- `libs/ui/src/components/Textarea.tsx` (new)
- `libs/ui/src/components/Label.tsx` (new)
- `libs/ui/src/components/Slider.tsx` (new)
- `libs/ui/src/components/Switch.tsx` (new)
- `libs/ui/src/components/Checkbox.tsx` (new)
- `libs/ui/src/components/RadioGroup.tsx` (new)
- `libs/ui/src/components/__tests__/Button.test.tsx` (new) — 12 snapshots (4 variants × 3 sizes).
- `libs/ui/src/components/__tests__/Input.test.tsx` (new) — 12 snapshots per `design.md` §8.1.
- `libs/ui/src/components/__tests__/Textarea.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/Label.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/Slider.test.tsx` (new) — 4 snapshots.
- `libs/ui/src/components/__tests__/Switch.test.tsx` (new) — 4 snapshots.
- `libs/ui/src/components/__tests__/Checkbox.test.tsx` (new) — 4 snapshots.
- `libs/ui/src/components/__tests__/RadioGroup.test.tsx` (new) — 2 snapshots.

**Behaviour.** Per `design.md` §2.1 (token consumption), §3.2 (variant tables), §5.1 (a11y roles). Web-only branches deleted on paste. No raw hex. Every component sets `displayName`. Each component file exports `<Name>Props`.

**Acceptance check.**
- All 8 component files compile with `tsc --noEmit`.
- All 8 test files run green; snapshot count matches the §8.1 matrix.
- `rg -n "#[0-9A-Fa-f]{3,8}\b" libs/ui/src/components/{Button,Input,Textarea,Label,Slider,Switch,Checkbox,RadioGroup}.tsx` returns empty.
- Passing `<Button variant="bogus" />` fails `tsc`.

**Dependencies.** T1, T2.

**Size.** M.

---

## T4 — Group 2: Layout & meta paste + tests

**Title.** Paste the 7 layout / meta components, drop web variants, apply tokens, write snapshot tests.

**Files touched.**
- `libs/ui/src/components/Card.tsx` (new)
- `libs/ui/src/components/Separator.tsx` (new)
- `libs/ui/src/components/Badge.tsx` (new)
- `libs/ui/src/components/Avatar.tsx` (new)
- `libs/ui/src/components/Skeleton.tsx` (new)
- `libs/ui/src/components/Tabs.tsx` (new)
- `libs/ui/src/components/Accordion.tsx` (new)
- `libs/ui/src/components/Collapsible.tsx` (new)
- `libs/ui/src/components/__tests__/Card.test.tsx` (new) — 4 snapshots.
- `libs/ui/src/components/__tests__/Separator.test.tsx` (new) — 2 snapshots.
- `libs/ui/src/components/__tests__/Badge.test.tsx` (new) — 12 snapshots (6 intents × 2 sizes).
- `libs/ui/src/components/__tests__/Avatar.test.tsx` (new) — 6 snapshots.
- `libs/ui/src/components/__tests__/Skeleton.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/Tabs.test.tsx` (new) — 4 snapshots (2 variants × 2 cardinalities).
- `libs/ui/src/components/__tests__/Accordion.test.tsx` (new) — 4 snapshots.
- `libs/ui/src/components/__tests__/Collapsible.test.tsx` (new) — 2 snapshots.

**Behaviour.** Per `design.md` §2.2 and §3.2. `Accordion` composes `Collapsible` internally. `Tabs` ships both `segmented` and `underlined` variants under one component (per §10 Q3).

**Acceptance check.**
- All 8 component files compile.
- All 8 test files run green; snapshot count matches §8.1.
- `rg` for raw hex on these files is empty.
- `Tabs` renders a `tab` accessibility role on each trigger.

**Dependencies.** T1, T2. Independent from T3 — can run in parallel.

**Size.** M.

---

## T5 — Group 3a: Overlays paste + tests (Dialog, AlertDialog, Popover, Tooltip)

**Title.** Paste the 4 rnr overlay components and apply tokens + focus management.

**Files touched.**
- `libs/ui/src/components/Dialog.tsx` (new)
- `libs/ui/src/components/AlertDialog.tsx` (new)
- `libs/ui/src/components/Popover.tsx` (new)
- `libs/ui/src/components/Tooltip.tsx` (new)
- `libs/ui/src/components/__tests__/Dialog.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/AlertDialog.test.tsx` (new) — 2 snapshots.
- `libs/ui/src/components/__tests__/Popover.test.tsx` (new) — 2 snapshots.
- `libs/ui/src/components/__tests__/Tooltip.test.tsx` (new) — 2 snapshots.

**Behaviour.** Per `design.md` §2.3, §5.3 (focus trap + return). `Tooltip` triggers on long-press touch (≥ 500 ms) AND pointer hover. `AlertDialog` exposes a `destructive` intent that wires the danger token to the primary action.

**Acceptance check.**
- All 4 components compile.
- All 4 tests pass.
- Opening a `Dialog` moves focus to the primary action; closing returns it to the trigger (verified in test via ref assertions).
- `accessibilityViewIsModal` is `true` on overlay containers.

**Dependencies.** T1, T2.

**Size.** M.

---

## T6 — Group 3b: `Sheet` over `@gorhom/bottom-sheet`

**Title.** Build the `Sheet` wrapper exposing the rnr-style `<Sheet open onOpenChange>` API over `@gorhom/bottom-sheet`.

**Files touched.**
- `libs/ui/src/components/Sheet.tsx` (new) — wrapper per `design.md` §7.1.
- `libs/ui/src/components/__tests__/Sheet.test.tsx` (new) — 3 snapshots.

**Behaviour.** Controlled `open` prop. `backgroundStyle.backgroundColor` reads from `useTokenColor('bg.elevated')`. `handleIndicatorStyle.backgroundColor` reads from `useTokenColor('border.subtle')`. Default `snapPoints` = `['50%', '90%']`. Top corner radius reads from `theme.radius.xl`. Shadow reads from `theme.elevation.sheet`. Focus return on close per §5.3.

**Acceptance check.**
- `Sheet.tsx` compiles.
- All 3 snapshots pass.
- The shadow style is read from `theme.elevation.sheet` (confirmed by a unit test that mocks `useTheme` and asserts the resulting style).
- No raw hex.

**Dependencies.** T2 (uses `useTokenColor`).

**Size.** S.

---

## T7 — Group 4a: Pickers paste + tests (Select, Combobox, ContextMenu, DropdownMenu)

**Title.** Paste the 4 rnr picker components, apply tokens, write tests. `Combobox` composes `Popover` + `Input` (per `design.md` §7.3).

**Files touched.**
- `libs/ui/src/components/Select.tsx` (new)
- `libs/ui/src/components/Combobox.tsx` (new)
- `libs/ui/src/components/ContextMenu.tsx` (new)
- `libs/ui/src/components/DropdownMenu.tsx` (new)
- `libs/ui/src/components/__tests__/Select.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/Combobox.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/ContextMenu.test.tsx` (new) — 2 snapshots.
- `libs/ui/src/components/__tests__/DropdownMenu.test.tsx` (new) — 2 snapshots.

**Behaviour.** Per `design.md` §2.4 and §5.1. `ContextMenu` triggers on long-press at the press location. `DropdownMenu` triggers on tap. `Combobox` filters in-process (per §10 Q6).

**Acceptance check.**
- All 4 components compile.
- All 4 tests pass.
- `Combobox` filtering test: typing 'foo' narrows a 5-option list to options whose label contains 'foo'.
- Trigger elements set `accessibilityRole="button"` with `accessibilityState.expanded` reflecting open/closed.

**Dependencies.** T5 (`Combobox` reuses `Popover`).

**Size.** M.

---

## T8 — Group 4b: `Progress` + `Toast` (sonner-native)

**Title.** Paste `Progress` from rnr; build `Toast` wrapper over `sonner-native`.

**Files touched.**
- `libs/ui/src/components/Progress.tsx` (new)
- `libs/ui/src/components/Toast.tsx` (new) — wrapper per `design.md` §7.2.
- `libs/ui/src/components/__tests__/Progress.test.tsx` (new) — 3 snapshots.
- `libs/ui/src/components/__tests__/Toast.test.tsx` (new) — 4 snapshots (one per intent).

**Behaviour.** `Progress` exposes `determinate` (`value: 0..1`) and `indeterminate` variants. `Toast` exports both `<ToastProvider>` (declarative root) and `toast.show(...)` / `toast.success(...)` etc. (imperative). Background, foreground, and accent strokes per intent map through `useTokenColor` (per §10 Q4).

**Acceptance check.**
- Both components compile.
- All 7 snapshots pass.
- `toast.show({ title: 'x' })` returns a string id.
- `<ToastProvider>` mounts the `sonner-native` `<Toaster />` with token-themed background.

**Dependencies.** T2.

**Size.** S.

---

## T9 — Public barrel `libs/ui/src/components/index.ts`

**Title.** Re-export every component and every `<Name>Props` type. Update `libs/ui/src/index.ts` to forward.

**Files touched.**
- `libs/ui/src/components/index.ts` (new) — one named re-export line per component file.
- `libs/ui/src/index.ts` (updated) — adds `export * from './components';` after the existing `export * from './theme';`.

**Behaviour.** No `export *` of an internal "all" file. Each export is named so tree-shaking works (per `requirements.md` NFR-1).

**Acceptance check.**
- `import { Button, type ButtonProps, Tabs, type TabsProps } from '@diffusecraft/ui'` resolves in `apps/mobile`.
- `Object.keys(require('@diffusecraft/ui/components'))` lists every component name from the contract.

**Dependencies.** T3, T4, T5, T6, T7, T8.

**Size.** XS.

---

## T10 — `componentsCoverage.test.ts`

**Title.** Land the contract test that imports the barrel and asserts every primitive is exported and renders.

**Files touched.**
- `libs/ui/src/components/__tests__/componentsCoverage.test.ts` (new) — implementation per `design.md` §8.2.

**Behaviour.** Assert every name in the §3.1 contract is exported. For each exported component, assert it renders inside `<ThemeProvider>` without throwing. `Toast` is asserted as having `Toast.show` (since it is the imperative API; `ToastProvider` is the renderable counterpart).

**Acceptance check.**
- Test passes against the full set of 25 components.
- Removing one export from `libs/ui/src/components/index.ts` (e.g., `Badge`) causes the test to fail with a clear message naming the missing component.

**Dependencies.** T9.

**Size.** S.

---

## T11 — CI guards: ban runtime rnr imports + raw hex inside `libs/ui/src/components/`

**Title.** Add (or extend) the lint surface so a runtime `import from "react-native-reusables"` and any raw hex literal inside the components directory fails CI.

**Files touched.**
- `tools/lint/no-rnr-runtime-import.js` (new) — tiny custom ESLint rule (or a grep CI step in the repo CI workflow).
- `libs/ui/eslint.config.mjs` (updated) — register the rule.
- `package.json` root: a `"lint:no-rnr-runtime-import"` script wrapping `rg -n "from ['\"]react-native-reusables" libs/ui/src/components` (must return empty).
- `package.json` root: extend the existing no-raw-hex script (from `design-system-foundation` T7) to cover `libs/ui/src/components` (it already does, by its current globs — verify and adjust if needed).

**Behaviour.** Both checks run in CI. The rnr ban applies to `libs/ui/src/components/` only — `libs/ui/src/theme/` and the rest of the repo are free to reference rnr docs in comments.

**Acceptance check.**
- Inserting `import { Button } from 'react-native-reusables';` into a component file fails CI.
- Removing the line restores green.
- Inserting `style={{ color: '#ff0000' }}` into a component file fails CI (existing rule).

**Dependencies.** T9 (so the surface to lint is complete).

**Size.** S.

---

## T12 — `libs/ui/src/components/README.md`

**Title.** Per-primitive table: variants, sizes, rnr source, one-line usage example.

**Files touched.**
- `libs/ui/src/components/README.md` (extended; created in T2 with the rnr commit SHA, here filled with the table).

**Behaviour.** One table row per component. Columns: name | variants | sizes | rnr source path | one-line usage. The pinned rnr commit SHA recorded in T2 is referenced once at the top.

**Acceptance check.**
- All 25 components are listed.
- Every row has a usage example that compiles when copy-pasted into a `.tsx` file inside `<ThemeProvider>`.

**Dependencies.** T9 (so the public API is stable).

**Size.** S.

---

## Dependency order

```
T1 → T2 ┐
        ├→ T3 ┐
        ├→ T4 ┤
        ├→ T5 ┤
        ├→ T6 ┤
        ├→ T7 (depends on T5)
        └→ T8 ┘
                ↓
                T9 → T10
                T9 → T11
                T9 → T12
```

Linear-friendly read: **T1 → T2 → (T3, T4, T5 in parallel) → (T6 after T2; T7 after T5; T8 after T2) → T9 → (T10, T11, T12 in parallel)**.

Two-engineer parallelism: Engineer A drives T3 + T7 + T8; Engineer B drives T4 + T5 + T6. Convergence at T9.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| rnr commit churn between paste and a future re-paste | Pin the commit SHA in `README.md` (T2). Future re-paste compares against the same commit and merges intentional drifts. |
| `@gorhom/bottom-sheet` API shifts (it's pre-2.0) | Pin a major version in `apps/mobile/package.json`. The wrapper isolates screen authors so a future bump is one-file. |
| `sonner-native` not yet stable | Same: pin a version; wrapper isolates the surface. If `sonner-native` becomes untenable, `Toast.tsx` is the single replacement point. |
| Token gaps from §9 not yet amended into foundation | Pre-flight gate at the top of this file: surface to the human reviewer; do not start T1 until foundation is amended. |
| Snapshot drift on macOS vs Linux CI runners | Stub `Date.now`, `Math.random`, and any platform-conditional in `libs/ui/test-setup.ts`. RN Testing Library output is platform-stable in practice. |
| Variant naming drift across components (`primary` vs `default` vs intents) | `design.md` §10 Q2 documents the deliberate distinction; `README.md` (T12) restates it for screen authors. |
| `Combobox` perf with many options | v1 is in-process filter, ≤ 200 options (per §10 Q6). A virtualised variant is a future spec, not this one. |
