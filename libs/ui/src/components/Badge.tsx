// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/badge.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` and `TextClassContext` imports rewritten to `./_internal/utils`.
//   - Web-only `Platform.select({ web: ... })` branches removed; we keep the
//     native-only class set (rules of paste: drop web variants).

import { Slot } from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { cn, TextClassContext } from './_internal/utils';

const badgeVariants = cva(
  'border-border group shrink-0 flex-row items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5',
  {
    variants: {
      variant: {
        default: 'bg-primary border-transparent',
        secondary: 'bg-secondary border-transparent',
        destructive: 'bg-destructive border-transparent',
        outline: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const badgeTextVariants = cva('text-xs font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-white',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type BadgeProps = React.ComponentProps<typeof View> &
  React.RefAttributes<View> & {
    asChild?: boolean;
  } & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, asChild, ...props }: BadgeProps) {
  const Component = asChild ? Slot : View;
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <Component className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  );
}
Badge.displayName = 'Badge';

export { Badge, badgeTextVariants, badgeVariants };
export type { BadgeProps };
