// Label — pasted from react-native-reusables (rnr).
//
// Source: react-native-reusables @ commit 7c287b976d461b717de397e1f581ab44c8e6d72d
// Path:   packages/registry/src/nativewind/components/ui/label.tsx
// URL:    https://github.com/founded-labs/react-native-reusables/blob/main/packages/registry/src/nativewind/components/ui/label.tsx
// Pasted: 2026-05-03
//
// Wraps `@rn-primitives/label`. Accepts `nativeID`-style pairing via the
// underlying primitive.
//
// Deviations from the canonical paste:
//   - `@/registry/nativewind/lib/utils` -> `./_internal/utils` (cn).

import * as LabelPrimitive from '@rn-primitives/label';
import { Platform } from 'react-native';

import { cn } from './_internal/utils';

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Text>;

function Label({
  className,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'flex select-none flex-row items-center gap-2',
        Platform.select({
          web: 'cursor-default leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        }),
        disabled && 'opacity-50'
      )}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}>
      <LabelPrimitive.Text
        className={cn(
          'text-foreground text-sm font-medium',
          Platform.select({ web: 'leading-none' }),
          className
        )}
        {...props}
      />
    </LabelPrimitive.Root>
  );
}
Label.displayName = 'Label';

export { Label };
export type { LabelProps };
