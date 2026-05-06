// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/avatar.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` import rewritten to `./_internal/utils`.

import * as AvatarPrimitive from '@rn-primitives/avatar';

import { cn } from './_internal/utils';

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}
Avatar.displayName = 'Avatar';

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn('aspect-square size-full', className)} {...props} />;
}
AvatarImage.displayName = 'AvatarImage';

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'bg-muted flex size-full flex-row items-center justify-center rounded-full',
        className,
      )}
      {...props}
    />
  );
}
AvatarFallback.displayName = 'AvatarFallback';

export type AvatarProps = React.ComponentProps<typeof AvatarPrimitive.Root>;

export { Avatar, AvatarFallback, AvatarImage };
