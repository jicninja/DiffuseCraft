// Progress — determinate / indeterminate bar over @rn-primitives/progress.
//
// Modeled after react-native-reusables' Progress recipe at
// packages/registry/src/nativewind/components/ui/progress.tsx (commit
// 7c287b976d461b717de397e1f581ab44c8e6d72d) — see
// https://github.com/founded-labs/react-native-reusables.
// Pasted/adapted: 2026-05-03. Native-only: web branches dropped per FR-3.

import * as ProgressPrimitive from '@rn-primitives/progress';
import * as React from 'react';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { cn } from './_internal';

export type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * Numeric progress 0..100. Pass `null` (or omit) to render an
   * indeterminate animation that loops independently of `value`.
   */
  value?: number | null;
  indicatorClassName?: string;
};

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ProgressProps) {
  const indeterminate = value === null || value === undefined;
  return (
    <ProgressPrimitive.Root
      className={cn(
        'bg-primary/20 relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      {...props}
    >
      {indeterminate ? (
        <IndeterminateIndicator className={indicatorClassName} />
      ) : (
        <DeterminateIndicator value={value} className={indicatorClassName} />
      )}
    </ProgressPrimitive.Root>
  );
}
Progress.displayName = 'Progress';

type DeterminateProps = {
  value: number;
  className?: string;
};

function DeterminateIndicator({ value, className }: DeterminateProps) {
  const progress = useDerivedValue(() => value);

  const indicator = useAnimatedStyle(() => {
    return {
      width: withSpring(
        `${interpolate(progress.value, [0, 100], [1, 100], Extrapolation.CLAMP)}%`,
        { overshootClamping: true },
      ),
    };
  }, [value]);

  return (
    <ProgressPrimitive.Indicator asChild>
      <Animated.View style={indicator} className={cn('bg-foreground h-full', className)} />
    </ProgressPrimitive.Indicator>
  );
}

function IndeterminateIndicator({ className }: { className?: string }) {
  const offset = useSharedValue(0);

  React.useEffect(() => {
    offset.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(offset);
    };
  }, [offset]);

  const indicator = useAnimatedStyle(() => {
    // Slide a 35%-wide bar from -35% to 100%.
    return {
      width: '35%',
      transform: [
        { translateX: `${interpolate(offset.value, [0, 1], [-35, 100])}%` },
      ],
    };
  });

  return (
    <ProgressPrimitive.Indicator asChild>
      <Animated.View style={indicator} className={cn('bg-foreground h-full', className)} />
    </ProgressPrimitive.Indicator>
  );
}

export { Progress };
