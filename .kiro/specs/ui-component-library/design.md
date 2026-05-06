# ui-component-library — Design

> **Status:** Draft v0.1.
> **Companion to:** `requirements.md`.
> **Depends on:** `design-system-foundation` (frozen tokens + `ThemeProvider` + `tailwind.config.js` + `darkTheme`).
> **References:** `.kiro/steering/tech.md` §"Client UI: NativeWind + react-native-reusables" and §"Stack at a glance"; `.kiro/steering/structure.md` §"Repository layout" and §"Coding standards"; `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers"; `_ui-implementation-roadmap.md` row 2.

## 1. Module layout

Exact file paths created or touched by this spec, mapped to the monorepo structure declared in `structure.md`:

| Path | Role | Owned by |
|---|---|---|
| `libs/ui/src/components/<Name>.tsx` × 25 | Pasted (or wrapped) component files. One per primitive. | This spec |
| `libs/ui/src/components/index.ts` | Public barrel; re-exports every component + every `<Name>Props` type. | This spec |
| `libs/ui/src/components/_internal/cn.ts` | Class-composition helper (NativeWind-compatible variant resolver). | This spec |
| `libs/ui/src/components/_internal/use-token.ts` | Thin hook over `useTheme()` returning typed accessors (`useTokenColor('accent.default')`). | This spec |
| `libs/ui/src/components/_internal/index.ts` | Barrel for internal helpers; not re-exported from the public surface. | This spec |
| `libs/ui/src/components/__tests__/<Name>.test.tsx` × 25 | Snapshot tests (one file per component). | This spec |
| `libs/ui/src/components/__tests__/componentsCoverage.test.ts` | Asserts every primitive in the contract is exported and renders. | This spec |
| `libs/ui/src/components/__snapshots__/` | Vitest snapshot files; checked in. | This spec |
| `libs/ui/src/components/README.md` | Per-primitive table: variants, sizes, rnr source attribution, one-line usage. | This spec |
| `libs/ui/src/index.ts` | Adds `export * from './components';` after the existing `export * from './theme';`. | This spec |
| `libs/ui/package.json` | `peerDependencies` adds the runtime stack (see §1.1). | This spec |
| `tools/lint/no-rnr-runtime-import.js` (or grep CI step) | CI guard banning runtime imports from `react-native-reusables`. | This spec |

### 1.1 `libs/ui/package.json` peerDependencies update

The package adds (or confirms) these `peerDependencies` so `apps/mobile` is the single installer of versions:

```jsonc
{
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "nativewind": "^4",
    "react-native-reanimated": "*",
    "react-native-gesture-handler": "*",
    "@gorhom/bottom-sheet": "*",
    "sonner-native": "*",
    "lucide-react-native": "*",
    "@rn-primitives/accordion": "*",
    "@rn-primitives/alert-dialog": "*",
    "@rn-primitives/avatar": "*",
    "@rn-primitives/checkbox": "*",
    "@rn-primitives/collapsible": "*",
    "@rn-primitives/context-menu": "*",
    "@rn-primitives/dialog": "*",
    "@rn-primitives/dropdown-menu": "*",
    "@rn-primitives/label": "*",
    "@rn-primitives/popover": "*",
    "@rn-primitives/portal": "*",
    "@rn-primitives/progress": "*",
    "@rn-primitives/radio-group": "*",
    "@rn-primitives/select": "*",
    "@rn-primitives/separator": "*",
    "@rn-primitives/slider": "*",
    "@rn-primitives/slot": "*",
    "@rn-primitives/switch": "*",
    "@rn-primitives/tabs": "*",
    "@rn-primitives/tooltip": "*"
  }
}
```

Exact versions are pinned in `apps/mobile/package.json`. `react-native-reusables` is **NOT** listed — the package is pasted, not imported.

### 1.2 Directory shape after this spec lands

```
libs/ui/src/components/
├── _internal/
│   ├── cn.ts
│   ├── use-token.ts
│   └── index.ts
├── Accordion.tsx
├── AlertDialog.tsx
├── Avatar.tsx
├── Badge.tsx
├── Button.tsx
├── Card.tsx
├── Checkbox.tsx
├── Collapsible.tsx
├── Combobox.tsx
├── ContextMenu.tsx
├── Dialog.tsx
├── DropdownMenu.tsx
├── Input.tsx
├── Label.tsx
├── Popover.tsx
├── Progress.tsx
├── RadioGroup.tsx
├── Select.tsx
├── Separator.tsx
├── Sheet.tsx
├── Skeleton.tsx
├── Slider.tsx
├── Switch.tsx
├── Tabs.tsx
├── Textarea.tsx
├── Toast.tsx
├── Tooltip.tsx
├── README.md
├── index.ts
├── __tests__/
│   ├── Accordion.test.tsx
│   ├── ... (one per component)
│   └── componentsCoverage.test.ts
└── __snapshots__/
    └── ... (Vitest output)
```

## 2. Component catalog

Tables map each primitive to its variants, sizes, rnr source, the underlying `@rn-primitives/*` package, and the tokens it consumes. The "rnr source" column cites the file path inside the `react-native-reusables` repository at the pinned commit; T1 of `tasks.md` records the exact commit SHA in `libs/ui/src/components/README.md`.

### 2.1 Group 1 — Forms & inputs

| Component | Variants | Sizes | rnr source / custom | rn-primitive | Tokens consumed |
|---|---|---|---|---|---|
| `Button` | `primary`, `secondary`, `ghost`, `destructive` | `sm`, `md`, `lg` | `packages/ui/src/components/ui/button.tsx` | `@rn-primitives/slot` | `accent.default`, `accent.hover`, `bg.elevated`, `border.subtle`, `border.strong`, `text.primary`, `text.secondary`, `danger`, radius `md`, `lg`, type `body-strong` |
| `Input` | n/a | `sm`, `md`, `lg` | `packages/ui/src/components/ui/input.tsx` | (native `TextInput`) | `bg.inset`, `border.subtle`, `border.strong`, `text.primary`, `text.secondary`, radius `md`, type `body` |
| `Textarea` | n/a | `md` (default) | `packages/ui/src/components/ui/textarea.tsx` | (native `TextInput`) | same as `Input` |
| `Label` | n/a | n/a | `packages/ui/src/components/ui/label.tsx` | `@rn-primitives/label` | `text.primary`, `text.secondary`, type `body-strong`, `caption` |
| `Slider` | n/a | `md` (default) | `packages/ui/src/components/ui/slider.tsx` | `@rn-primitives/slider` (+ Reanimated drag) | `accent.default`, `bg.inset`, `border.strong`, radius `pill`, `text.secondary` |
| `Switch` | n/a | `md` (default) | `packages/ui/src/components/ui/switch.tsx` | `@rn-primitives/switch` | `accent.default`, `bg.elevated`, `border.subtle`, `text.primary` |
| `Checkbox` | n/a | `md` | `packages/ui/src/components/ui/checkbox.tsx` | `@rn-primitives/checkbox` | `accent.default`, `bg.inset`, `border.subtle`, `border.strong`, radius `xs`, icon (`lucide-react-native:Check`) |
| `RadioGroup` | n/a | `md` | `packages/ui/src/components/ui/radio-group.tsx` | `@rn-primitives/radio-group` | same as `Checkbox` minus icon; uses `accent.default` filled disc |

### 2.2 Group 2 — Layout & meta

| Component | Variants | Sizes | rnr source / custom | rn-primitive | Tokens consumed |
|---|---|---|---|---|---|
| `Card` | n/a | n/a | `packages/ui/src/components/ui/card.tsx` | (compound `View`) | `bg.surface`, `border.subtle`, radius `lg`, spacing `4`, `6`; type `title`, `body`, `caption` |
| `Separator` | `horizontal`, `vertical` | n/a | `packages/ui/src/components/ui/separator.tsx` | `@rn-primitives/separator` | `border.subtle` |
| `Badge` | `neutral`, `accent`, `success`, `warn`, `danger`, `info` | `sm`, `md` | `packages/ui/src/components/ui/badge.tsx` | (compound `View`) | per intent: `accent.muted`+`accent.default`, `success`, `warn`, `danger`, `info`; `bg.elevated`, `text.primary`, `text.secondary`, radius `pill`, type `caption` |
| `Avatar` | image / initials-fallback | `sm` (24), `md` (32), `lg` (48) | `packages/ui/src/components/ui/avatar.tsx` | `@rn-primitives/avatar` | `bg.elevated`, `text.primary`, `text.secondary`, radius `pill`, type `body-strong` |
| `Skeleton` | n/a | n/a | `packages/ui/src/components/ui/skeleton.tsx` | (animated `View`) | `bg.elevated`, `bg.inset`, radius `md` |
| `Tabs` | `segmented`, `underlined` | n/a | `packages/ui/src/components/ui/tabs.tsx` | `@rn-primitives/tabs` | `bg.elevated`, `bg.surface`, `accent.default`, `accent.muted`, `border.subtle`, `text.primary`, `text.secondary`, radius `md`, type `body-strong` |
| `Accordion` | `single`, `multiple` | n/a | `packages/ui/src/components/ui/accordion.tsx` | `@rn-primitives/accordion` (uses `Collapsible` internally) | `bg.surface`, `border.subtle`, `text.primary`, `text.secondary`, radius `md`, type `body-strong`, `body` |
| `Collapsible` | n/a | n/a | `packages/ui/src/components/ui/collapsible.tsx` | `@rn-primitives/collapsible` | `text.primary`, `text.secondary` |

### 2.3 Group 3 — Overlays

| Component | Variants | Sizes | rnr source / custom | rn-primitive | Tokens consumed |
|---|---|---|---|---|---|
| `Dialog` | n/a | n/a | `packages/ui/src/components/ui/dialog.tsx` | `@rn-primitives/dialog`, `@rn-primitives/portal` | `bg.elevated`, `bg.canvas` (scrim base), `border.subtle`, `text.primary`, `text.secondary`, radius `xl`, spacing `6`, type `title`, `body` |
| `AlertDialog` | `default`, `destructive` | n/a | `packages/ui/src/components/ui/alert-dialog.tsx` | `@rn-primitives/alert-dialog`, `@rn-primitives/portal` | same as `Dialog` + `danger` for destructive intent |
| `Popover` | n/a | n/a | `packages/ui/src/components/ui/popover.tsx` | `@rn-primitives/popover`, `@rn-primitives/portal` | `bg.elevated`, `border.subtle`, radius `md`, spacing `3`, `4` |
| `Tooltip` | n/a | n/a | `packages/ui/src/components/ui/tooltip.tsx` | `@rn-primitives/tooltip`, `@rn-primitives/portal` | `bg.elevated`, `border.subtle`, `text.primary`, radius `sm`, type `caption` |
| `Sheet` | `bottom` (only in v1) | n/a | **custom** wrapper over `@gorhom/bottom-sheet` | `@gorhom/bottom-sheet` | `bg.elevated`, `border.subtle`, `text.primary`, `text.secondary`, radius `xl`, elevation `sheet` (reads `boxShadow.sheet` via `useTheme()`) |

### 2.4 Group 4 — Pickers & feedback

| Component | Variants | Sizes | rnr source / custom | rn-primitive | Tokens consumed |
|---|---|---|---|---|---|
| `Select` | n/a | `sm`, `md`, `lg` | `packages/ui/src/components/ui/select.tsx` | `@rn-primitives/select`, `@rn-primitives/portal` | `bg.inset`, `bg.elevated`, `border.subtle`, `border.strong`, `accent.muted`, `text.primary`, `text.secondary`, radius `md`, type `body` |
| `Combobox` | n/a | `md` | `packages/ui/src/components/ui/combobox.tsx` (built on `Popover` + `Input`) | `@rn-primitives/popover`, `@rn-primitives/portal` | same as `Select` |
| `ContextMenu` | n/a | n/a | `packages/ui/src/components/ui/context-menu.tsx` | `@rn-primitives/context-menu`, `@rn-primitives/portal` | `bg.elevated`, `border.subtle`, `accent.muted`, `text.primary`, `text.secondary`, radius `md`, type `body`, `caption` |
| `DropdownMenu` | n/a | n/a | `packages/ui/src/components/ui/dropdown-menu.tsx` | `@rn-primitives/dropdown-menu`, `@rn-primitives/portal` | same as `ContextMenu` |
| `Progress` | `determinate`, `indeterminate` | `sm` (4pt), `md` (8pt) | `packages/ui/src/components/ui/progress.tsx` | `@rn-primitives/progress` | `accent.default`, `bg.inset`, radius `pill` |
| `Toast` | intents: `neutral`, `success`, `warn`, `danger` | n/a | **custom** wrapper over `sonner-native` | `sonner-native` | `bg.elevated`, `bg.surface`, `border.subtle`, `accent.default`, `success`, `warn`, `danger`, `text.primary`, `text.secondary`, radius `md`, type `body-strong`, `caption` |

The "rnr source" column points to the path inside the `react-native-reusables` repository (canonical at `https://github.com/founded-labs/react-native-reusables`). T2 in `tasks.md` records the exact commit SHA so re-pasting in the future is reproducible.

## 3. Variant strategy

### 3.1 Variant typing

Variants are typed as exhaustive string-literal unions colocated with their component:

```typescript
// libs/ui/src/components/Button.tsx
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant; // default 'primary'
  size?: ButtonSize;       // default 'md'
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  // ...
}
```

`Omit<PressableProps, 'style'>` is intentional: callers should not bypass token styling with raw `style` props. NativeWind's `className` is the styling channel.

### 3.2 Class composition

NativeWind classes are composed via a tiny helper at `_internal/cn.ts`:

```typescript
// libs/ui/src/components/_internal/cn.ts
export function cn(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter(Boolean).join(' ');
}
```

Per-variant class tables are inline tagged-template-style records inside each component file:

```typescript
// libs/ui/src/components/Button.tsx (excerpt)
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:     'bg-accent active:bg-accent-hover',
  secondary:   'bg-elevated border border-border-subtle',
  ghost:       'bg-transparent',
  destructive: 'bg-elevated border border-danger',
};
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 rounded-md',  // 36pt — sub-element only (chip-row); not a primary tap target
  md: 'h-11 px-4 rounded-md', // 44pt — primary touch target floor
  lg: 'h-14 px-5 rounded-lg', // 56pt — prominent CTA
};
```

`class-variance-authority` (`cva`) is intentionally **not** introduced as a dependency. The variant tables above are simpler, faster to grep, and keep the component file self-describing. (See §10 Q1.)

### 3.3 Variant matrix tests

Snapshot tests iterate the matrix declared in §8 — `Button` produces 12 snapshots, etc. Adding a new variant requires updating the matrix in the test file; tests fail loudly if a new union case is added without a corresponding snapshot row.

## 4. Theming contract

### 4.1 Read path

Components read tokens through `useTheme()` from `@diffusecraft/ui` (the hook landed in `design-system-foundation`). Direct imports from `libs/ui/src/theme/tokens.ts` are forbidden — the provider is the only runtime read path. This isolates the (future) light-theme switch from component code.

### 4.2 Static styling — Tailwind classes

Static colours, spacing, radii, and type styles arrive via NativeWind classes:

```typescript
// libs/ui/src/components/Button.tsx (sketch)
import { Pressable, Text, View } from 'react-native';
import { cn } from './_internal/cn';

export function Button({ variant = 'primary', size = 'md', children, ...rest }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        'flex-row items-center justify-center',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        rest.disabled && 'opacity-50',
      )}
      {...rest}
    >
      <Text className="text-primary text-body-strong">{children}</Text>
    </Pressable>
  );
}
Button.displayName = 'Button';
```

Note: every colour, radius, and spacing reference is a token class (`bg-accent`, `text-primary`, `rounded-md`, `h-11`, `px-4`). No raw hex.

### 4.3 Dynamic styling — `useToken`

When NativeWind is unreachable (Reanimated shared values, Skia paints, gradient stops, `@gorhom/bottom-sheet` `backgroundStyle`), components call the typed accessor:

```typescript
// libs/ui/src/components/_internal/use-token.ts
import { useTheme } from '../../theme';
import type { ColorToken } from '../../theme/types';

export function useTokenColor(name: ColorToken): string {
  const theme = useTheme();
  return theme.color[name];
}
```

Used by `Sheet`, `Toast`, `Slider` (Reanimated), and any future Skia-backed component.

## 5. Accessibility contract

### 5.1 Roles and state

| Component | `accessibilityRole` | State props consumed |
|---|---|---|
| `Button` | `button` | `disabled`, `busy` |
| `Input`, `Textarea` | `text` (RN's `accessibilityRole="none"` + `editable` semantics) | `disabled`, `editable` |
| `Switch` | `switch` | `checked`, `disabled` |
| `Checkbox` | `checkbox` | `checked`, `disabled`, `indeterminate` |
| `RadioGroup` items | `radio` | `selected`, `disabled` |
| `Slider` | `adjustable` | `value`, `min`, `max`, `disabled` |
| `Tabs` items | `tab` | `selected`, `disabled` |
| `Dialog`, `AlertDialog`, `Sheet` | `none` (container) + `accessibilityViewIsModal` | `expanded` |
| `Popover`, `Tooltip` | `none` (container) | `expanded` |
| `Select`, `Combobox`, `DropdownMenu`, `ContextMenu` | trigger: `button` (`hasPopup: 'menu'` or `'listbox'`) | `expanded` |
| `Progress` | `progressbar` | `value`, `min`, `max`, `indeterminate` |
| `Toast` | `alert` | (transient; auto-dismiss) |
| `Avatar`, `Badge`, `Card`, `Separator`, `Skeleton`, `Label`, `Accordion`/`Collapsible` content | role-by-content (`header`, `text`, etc.) | n/a |

### 5.2 Labels

Every interactive component accepts `accessibilityLabel`. Components with text children fall back to the rendered text when `accessibilityLabel` is absent (rnr's default, preserved on paste).

### 5.3 Focus management — overlays

`Dialog`, `AlertDialog`, `Sheet`, `Popover`, `DropdownMenu`, and `ContextMenu` SHALL:
- Move focus to the first focusable child on open (`useEffect` + ref on the primary action when present, else the close button).
- Trap focus while open (the rn-primitive layer already provides the trap; the wrapper preserves it).
- Return focus to the trigger element on close.
- Set `accessibilityViewIsModal={true}` on the overlay container.

`Tooltip` does not steal focus; it is announced via `accessibilityHint` or short-press preview only.

### 5.4 Disabled state

`disabled` is propagated through:
- `accessibilityState.disabled = true`.
- Visual dim: `opacity-50` plus `text-tertiary` foreground (token-driven, not a raw alpha).
- Press handlers gated (`onPress` is a no-op when disabled).

## 6. Stylus-friendly rules

DiffuseCraft's primary input is the Apple Pencil / S-Pen. Components are written for stylus and finger; keyboard and pointer are secondary.

| Rule | Implementation |
|---|---|
| No hover-only affordances | `Tooltip` opens on long-press touch (≥ 500 ms) AND on pointer hover when present. Hover-only states are forbidden. |
| Press feedback uses `pressed` state | Every `Pressable` consumer reads `pressed` and applies a token-driven `active:` class (`active:bg-accent-hover` etc.). |
| Long-press surfaces context | `ContextMenu` triggers on long-press at the press location. |
| Touch target floor 44×44pt | `md` and `lg` sizes meet the floor; `sm` is reserved for chip-row sub-elements. |
| Generous hit slop on icon-only buttons | Default `hitSlop={8}` on icon-only Buttons and dismiss icons. |
| No double-tap-to-confirm | `AlertDialog` provides confirmation; double-tap is reserved for canvas zoom. |

## 7. Sheet, Toast, special components

### 7.1 `Sheet`

`Sheet` is a custom wrapper over `@gorhom/bottom-sheet` exposed with the same prop shape conventions as the rnr siblings:

```typescript
// libs/ui/src/components/Sheet.tsx (sketch)
export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapPoints?: Array<string | number>; // default ['50%', '90%']
  children: React.ReactNode;
}
```

Behaviour:
- `open` is the controlled prop; mirrors `Dialog.open`.
- Background colour reads from `useTokenColor('bg.elevated')` (not a Tailwind class, because `BottomSheet`'s `backgroundStyle` accepts `ViewStyle`, not `className`).
- `borderTopLeftRadius` / `borderTopRightRadius` set from `theme.radius.xl`.
- Shadow read from `theme.elevation.sheet` and applied as RN style.
- Handle indicator coloured `border.subtle`.
- Focus return on close per §5.3.

The wrapper exists so screen authors do not have to learn `@gorhom/bottom-sheet`'s API surface twice — the rnr-style `<Sheet open onOpenChange>` pattern is the only API the screens learn.

### 7.2 `Toast`

`Toast` is a custom wrapper over `sonner-native`. It exposes:

```typescript
export interface ToastOptions {
  title: string;
  description?: string;
  intent?: 'neutral' | 'success' | 'warn' | 'danger'; // default 'neutral'
  duration?: number; // ms, default 4000
  action?: { label: string; onPress: () => void };
}

export const toast: {
  show: (opts: ToastOptions) => string; // returns toast id
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  warn: (title: string, description?: string) => string;
  danger: (title: string, description?: string) => string;
};

export function ToastProvider(props: { children: React.ReactNode }): JSX.Element;
```

Background, foreground, and accent strokes are mapped per intent through `useTokenColor`. The provider mounts the `sonner-native` `<Toaster />` with token-driven theming. `apps/mobile/App.tsx` mounts `<ToastProvider>` next to `<ThemeProvider>` (note for `app-shell-navigation`).

### 7.3 `Combobox`

`Combobox` is a composite, not a paste from a single rnr file (rnr ships it but as a `Popover + Command + Input` recipe). The wrapper composes `Popover` + `Input` + an internal filtered list and exposes a single component for downstream screen authors.

## 8. Test strategy

### 8.1 Snapshot matrix per component

| Component | Variant × size matrix | Snapshot count |
|---|---|---|
| `Button` | 4 variants × 3 sizes | 12 |
| `Input` | 3 sizes × {default, leading icon, trailing icon, disabled} | 12 |
| `Textarea` | {default, disabled, with placeholder} | 3 |
| `Label` | {default, required, with helper} | 3 |
| `Slider` | {default, min, max, disabled} | 4 |
| `Switch` | {off, on, disabled-off, disabled-on} | 4 |
| `Checkbox` | {unchecked, checked, indeterminate, disabled} | 4 |
| `RadioGroup` | {single item, group of 3 with selection} | 2 |
| `Card` | {default, with header, with footer, with header+footer} | 4 |
| `Separator` | {horizontal, vertical} | 2 |
| `Badge` | 6 intents × 2 sizes | 12 |
| `Avatar` | 3 sizes × {image, fallback initials} | 6 |
| `Skeleton` | {default, rounded-pill, custom dimensions} | 3 |
| `Tabs` | 2 variants × {2-tab, 3-tab} | 4 |
| `Accordion` | {single, multiple} × {collapsed, expanded} | 4 |
| `Collapsible` | {collapsed, expanded} | 2 |
| `Dialog` | {open, with footer, scrollable body} | 3 |
| `AlertDialog` | {default open, destructive open} | 2 |
| `Popover` | {open default, open with arrow placement} | 2 |
| `Tooltip` | {open with short text, open with long text} | 2 |
| `Sheet` | {closed, open at first snap, open at second snap} | 3 |
| `Select` | {closed, open with 3 options, with selection} | 3 |
| `Combobox` | {closed, open empty input, open with filter applied} | 3 |
| `ContextMenu` | {open with 3 items, open with destructive item} | 2 |
| `DropdownMenu` | {open with 3 items, open with sub-menu} | 2 |
| `Progress` | 2 variants × 2 sizes (indeterminate omits one cell) | 3 |
| `Toast` | 4 intents | 4 |

**Total: 110 snapshots across 25 component files.**

### 8.2 `componentsCoverage.test.ts`

```typescript
// libs/ui/src/components/__tests__/componentsCoverage.test.ts (sketch)
import * as Components from '../index';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';

const REQUIRED = [
  'Accordion', 'AlertDialog', 'Avatar', 'Badge', 'Button',
  'Card', 'Checkbox', 'Collapsible', 'Combobox', 'ContextMenu',
  'Dialog', 'DropdownMenu', 'Input', 'Label', 'Popover',
  'Progress', 'RadioGroup', 'Select', 'Separator', 'Sheet',
  'Skeleton', 'Slider', 'Switch', 'Tabs', 'Textarea',
  'Toast', 'Tooltip',
] as const;

describe('component contract', () => {
  it.each(REQUIRED)('exports %s', (name) => {
    expect(Components).toHaveProperty(name);
    expect((Components as Record<string, unknown>)[name]).toBeDefined();
  });

  it('every component renders inside ThemeProvider', () => {
    for (const name of REQUIRED) {
      const Component = (Components as Record<string, React.ComponentType<unknown>>)[name];
      expect(() => render(
        <ThemeProvider><Component /></ThemeProvider>
      )).not.toThrow();
    }
  });
});
```

(`Toast` is the export name for the imperative API; the renderable counterpart is `ToastProvider` — the test asserts `Toast.show` is a function as the alternative shape.)

### 8.3 Tooling

- **Test runner:** Vitest, configured per `libs/ui/vitest.config.ts`.
- **RN bridge:** `@testing-library/react-native` + `react-native` test preset.
- **Snapshot stability:** date and random stubbed via Vitest setup at `libs/ui/test-setup.ts`.
- **Coverage:** not enforced numerically in v1; the contract test is the floor.

## 9. Token gaps surfaced

The author of this spec found four token gaps while drafting the catalog. Per the workflow ("propose, do NOT silently add"), they are listed here for amendment of `design-system-foundation` BEFORE implementation begins.

### 9.1 `focus.ring`

**Need.** Every interactive component requires a focus-visible ring (keyboard / external pointer). Currently `accent.default` is the only candidate, but a primary action's background is already `accent.default` — using the same token for both fill and ring eliminates the contrast boundary. A dedicated `focus.ring` token, alpha-compounded over the surface, fixes this.

**Proposed value.** `focus.ring = #7C5CFF66` (i.e., `accent.default` at 40% alpha).

**Used by.** `Button`, `Input`, `Textarea`, `Switch`, `Checkbox`, `RadioGroup`, `Tabs`, `Select`, `Combobox`, `DropdownMenu`, `Slider`.

### 9.2 `scrim`

**Need.** Modal overlays (`Dialog`, `AlertDialog`, `Sheet` backdrop) need a consistent backdrop colour. `bg-canvas` at 60% opacity is the mental model, but no token captures it.

**Proposed value.** `scrim = rgba(0, 0, 0, 0.6)`.

**Used by.** `Dialog`, `AlertDialog`, `Sheet` (backdrop layer).

### 9.3 Soft semantic fills (`{danger,warn,success,info}.muted`)

**Need.** Semantic colours (`danger`, `warn`, `success`, `info`) are stroke-grade saturation in the current contract. Components like `Badge` and `Toast` need a *fill-grade* desaturated companion to render readable chips against `bg.elevated`. Using the saturated semantic as fill is illegible at small sizes.

**Proposed values.**
- `danger.muted = #3A1818` (deep red, ~10% luminance).
- `warn.muted = #3A2810` (deep amber).
- `success.muted = #14321B` (deep green).
- `info.muted = #0F2C3F` (deep cyan).

These pair with the existing saturated tokens as stroke / icon foregrounds.

**Used by.** `Badge` (intents `success`/`warn`/`danger`/`info`), `Toast` (same intents), `AlertDialog` (`destructive` intent header strip).

### 9.4 Recommended path

Amend `design-system-foundation/design.md` §2 and `tailwind.config.js` to add:
- `colors.focus.ring`
- `colors.scrim`
- `colors.danger.muted`, `colors.warn.muted`, `colors.success.muted`, `colors.info.muted`

Also extend `ColorToken` in `libs/ui/src/theme/types.ts` (foundation spec scope) and `darkTheme` in `libs/ui/src/theme/tokens.ts`. The cross-check test in `libs/ui/src/theme/__tests__/tokens-match-tailwind.test.ts` will fail until the two are aligned — this is the right gate.

The amendment is tiny and unlocks every component's a11y / legibility floor. Recommended ordering: amend foundation FIRST, land its tasks T2 + T4 + T6 + T8 with the new tokens, THEN start `ui-component-library` T1.

## 10. Open questions

### Q1 — `cva` vs hand-rolled class composition?

**Open.** `class-variance-authority` is a popular utility (≈3 kB) for shadcn-style variant resolution. It would let us write `const buttonVariants = cva('...', { variants: { variant: {...}, size: {...} }, defaultVariants: {...} })` in one expression and infer prop types from it.

**Recommendation.** **Do not introduce** `cva`. Rationale:
- Hand-rolled records (§3.2) are 5 lines, fully typed by hand, fully greppable.
- `cva`'s value lies in reducing repetition across many variant-heavy components; we have ~10 such components.
- Adding a runtime dependency for a one-screen helper increases supply-chain surface.

If `cva` adoption becomes desirable later (e.g., `Button` grows past 10 variants), it can be retrofitted per-component without breaking the public API.

### Q2 — Variant naming consistency across components

**Open.** `Button` uses `primary`, `secondary`, `ghost`, `destructive`. `AlertDialog` exposes `default` and `destructive`. `Badge` and `Toast` use intents (`neutral`, `success`, `warn`, `danger`, `info`). Are these three vocabularies aligned or accidentally divergent?

**Recommendation.** Treat them as deliberately different:
- **Buttons / dialogs** carry an action shape (`primary` vs `secondary` vs `ghost` vs `destructive` is about action prominence).
- **Badges / toasts / tooltips** carry an intent (`success` vs `warn` vs `danger` vs `info` is about meaning).

`destructive` is the single overlap (a destructive *action* maps to a `danger` *intent*). Document the distinction in `README.md`. No code change needed.

### Q3 — Should `Tabs.segmented` and `Tabs.underlined` be two components or one with a variant prop?

**Recommendation.** **One component** (`Tabs` with `variant?: 'segmented' | 'underlined'`). The shared trigger / list / content composition is identical; only the styling of the active state differs. Two components would force screen authors to choose imports.

### Q4 — Toast as imperative vs declarative?

**Open.** `sonner-native` is imperative (`toast.success('...')`). rnr-style components are declarative.

**Recommendation.** Expose **both**:
- `<ToastProvider>` mounted once at the app root (declarative; required).
- `toast.show({...})` and `toast.success(...)` etc. (imperative; the screen author's API).

This matches `sonner-native` idiomatic usage and avoids a stale-state declarative wrapper that would re-implement the queue.

### Q5 — Should `Sheet` support `top`, `left`, `right` variants?

**Recommendation.** **No, v1 ships `bottom` only.** `@gorhom/bottom-sheet` is bottom-only by design. A side-drawer is a different component (potentially a future `Drawer` component); not in scope here.

### Q6 — Should `Combobox` lazy-load options for large datasets?

**Recommendation.** **No.** v1 `Combobox` filters in-process; it's intended for ≤ 200 options (model picker, preset picker, language picker). If a screen needs virtualised search, it composes `Popover` + a virtualised list directly — not a generic primitive concern.
