// RadioGroup — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/radio-group.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/radio-group.tsx
// Pasted: 2026-05-03
//
// Wraps `@rn-primitives/radio-group`. Exports the group root and its item.
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).

import * as RadioGroupPrimitive from '@rn-primitives/radio-group';
import { Platform } from 'react-native';

import { cn } from './_internal/utils';

type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive.Root>;
type RadioGroupItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item>;

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return <RadioGroupPrimitive.Root className={cn('gap-3', className)} {...props} />;
}
RadioGroup.displayName = 'RadioGroup';

function RadioGroupItem({ className, ...props }: RadioGroupItemProps) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'border-input dark:bg-input/30 aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-sm shadow-black/5',
        Platform.select({
          web: 'focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      <RadioGroupPrimitive.Indicator className="bg-primary size-2 rounded-full" />
    </RadioGroupPrimitive.Item>
  );
}
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };
export type { RadioGroupProps, RadioGroupItemProps };
