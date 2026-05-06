// Switch — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/switch.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/switch.tsx
// Pasted: 2026-05-03
//
// Wraps `@rn-primitives/switch`. Boolean toggle.
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).

import * as SwitchPrimitives from '@rn-primitives/switch';
import { Platform } from 'react-native';

import { cn } from './_internal/utils';

type SwitchProps = React.ComponentProps<typeof SwitchPrimitives.Root>;

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'flex h-[1.15rem] w-8 shrink-0 flex-row items-center rounded-full border border-transparent shadow-sm shadow-black/5',
        Platform.select({
          web: 'focus-visible:border-ring focus-visible:ring-ring/50 peer inline-flex outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      <SwitchPrimitives.Thumb
        className={cn(
          'bg-background size-4 rounded-full transition-transform',
          Platform.select({
            web: 'pointer-events-none block ring-0',
          }),
          props.checked
            ? 'dark:bg-primary-foreground translate-x-3.5'
            : 'dark:bg-foreground translate-x-0'
        )}
      />
    </SwitchPrimitives.Root>
  );
}
Switch.displayName = 'Switch';

export { Switch };
export type { SwitchProps };
