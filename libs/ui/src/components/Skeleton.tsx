// Pasted from react-native-reusables.
// Source: https://github.com/founded-labs/react-native-reusables/blob/7c287b976d461b717de397e1f581ab44c8e6d72d/packages/registry/src/nativewind/components/ui/skeleton.tsx
// Pasted: 2026-05-03
//
// Deviations from upstream:
//   - `cn` import rewritten to `./_internal/utils`.

import { View } from 'react-native';

import { cn } from './_internal/utils';

function Skeleton({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  return <View className={cn('bg-accent animate-pulse rounded-md', className)} {...props} />;
}
Skeleton.displayName = 'Skeleton';

export type SkeletonProps = React.ComponentProps<typeof View> & React.RefAttributes<View>;

export { Skeleton };
