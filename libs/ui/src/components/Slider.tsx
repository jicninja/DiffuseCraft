// Slider — custom DiffuseCraft component (rnr v4 does NOT ship a Slider).
//
// rnr v4 dropped the `slider.tsx` paste from its registry; this file is
// therefore *not* a paste of an upstream rnr file. Instead it follows the
// rnr API conventions (`className`, NativeWind classes, `@rn-primitives/*`
// for a11y semantics) over `@rn-primitives/slider` (a presentation-only
// primitive) plus `react-native-gesture-handler` + `react-native-reanimated`
// for the drag interaction, per design.md §2.1 ("uses `@rn-primitives/slider`
// (+ Reanimated drag)").
//
// rnr commit referenced for shadcn-style class palette: 7c287b976d461b717de397e1f581ab44c8e6d72d
// Repo: https://github.com/founded-labs/react-native-reusables
// rn-primitives slider source: https://github.com/roninoss/rn-primitives/blob/main/packages/slider/src/slider.tsx
// Pasted: 2026-05-03
//
// TODO(spec:ui-component-library): align Slider visuals with the
// design-system-foundation token contract once Group 2/3 land. v1 ships
// the structural piece so screens that need a slider compile; final
// styling polish (track gradient, thumb shadow) is a follow-up.

import * as SliderPrimitive from '@rn-primitives/slider';
import * as React from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { cn } from './_internal/utils';

type SliderProps = {
  value: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  trackClassName?: string;
  rangeClassName?: string;
  thumbClassName?: string;
  accessibilityLabel?: string;
};

function clamp(n: number, lo: number, hi: number): number {
  'worklet';
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function quantize(n: number, step: number, min: number): number {
  'worklet';
  if (!step || step <= 0) return n;
  return Math.round((n - min) / step) * step + min;
}

function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0,
  disabled,
  className,
  trackClassName,
  rangeClassName,
  thumbClassName,
  accessibilityLabel,
}: SliderProps) {
  const [width, setWidth] = React.useState(0);
  const offset = useSharedValue(0);
  // Guard for the controlled-value mirror effect below. While the user is
  // dragging the thumb, the worklet `offset.value` is the source of truth
  // and incoming `value` prop updates (echoes of our own `onValueChange`
  // calls round-tripping through the parent state) must NOT clobber it.
  // Without this guard, every drag tick produces:
  //   worklet sets offset → runOnJS(commit) → parent re-renders → mirror
  //   effect resets offset to the stale committed value → next worklet
  //   tick adds `e.changeX` to the snapped-back offset → thumb stutters.
  const dragging = React.useRef(false);

  // Mirror controlled `value` -> `offset` whenever the parent updates it,
  // EXCEPT during an active drag — see `dragging` ref above.
  React.useEffect(() => {
    if (width <= 0) return;
    if (dragging.current) return;
    const ratio = (value - min) / Math.max(1e-9, max - min);
    offset.value = clamp(ratio * width, 0, width);
  }, [value, min, max, width, offset]);

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const commit = React.useCallback(
    (next: number) => {
      onValueChange?.(next);
    },
    [onValueChange]
  );

  // JS-thread setters for `dragging`. Worklets must reach the JS-thread
  // ref via `runOnJS`; capturing a ref directly inside the worklet body
  // would freeze it under Reanimated's serialization model.
  const setDraggingTrue = React.useCallback(() => {
    dragging.current = true;
  }, []);
  const setDraggingFalse = React.useCallback(() => {
    dragging.current = false;
  }, []);

  const pan = React.useMemo(() => {
    return Gesture.Pan()
      .enabled(!disabled)
      .onBegin(() => {
        'worklet';
        runOnJS(setDraggingTrue)();
      })
      .onChange((e) => {
        'worklet';
        if (width <= 0) return;
        const next = clamp(offset.value + e.changeX, 0, width);
        offset.value = next;
        const ratio = next / width;
        const raw = min + ratio * (max - min);
        const quant = quantize(raw, step, min);
        runOnJS(commit)(clamp(quant, min, max));
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(setDraggingFalse)();
      });
  }, [
    disabled,
    width,
    min,
    max,
    step,
    offset,
    commit,
    setDraggingTrue,
    setDraggingFalse,
  ]);

  const rangeStyle = useAnimatedStyle(() => ({ width: offset.value }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value - 8 }] }));

  return (
    <SliderPrimitive.Root
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      className={cn('w-full', disabled && 'opacity-50', className)}>
      <GestureDetector gesture={pan}>
        <View
          onLayout={onLayout}
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min, max, now: value }}
          className="h-6 w-full justify-center">
          <SliderPrimitive.Track asChild>
            <View
              className={cn(
                'bg-input h-1.5 w-full overflow-hidden rounded-full',
                trackClassName
              )}>
              <SliderPrimitive.Range asChild>
                <Animated.View
                  className={cn('bg-primary h-full rounded-full', rangeClassName)}
                  style={rangeStyle}
                />
              </SliderPrimitive.Range>
            </View>
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb asChild>
            <Animated.View
              className={cn(
                'bg-primary border-background absolute size-4 rounded-full border-2 shadow-sm shadow-black/20',
                thumbClassName
              )}
              style={thumbStyle}
            />
          </SliderPrimitive.Thumb>
        </View>
      </GestureDetector>
    </SliderPrimitive.Root>
  );
}
Slider.displayName = 'Slider';

export { Slider };
export type { SliderProps };
