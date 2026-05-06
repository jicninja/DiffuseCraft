// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/separator.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` import rewritten to `./_internal/utils`.

import * as SeparatorPrimitive from '@rn-primitives/separator';

import { cn } from './_internal/utils';

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  );
}
Separator.displayName = 'Separator';

export type SeparatorProps = React.ComponentProps<typeof SeparatorPrimitive.Root>;

export { Separator };
