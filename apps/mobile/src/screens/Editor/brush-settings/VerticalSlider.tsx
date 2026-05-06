/**
 * VerticalSlider — reusable vertical slider built on react-native-gesture-handler
 * + react-native-reanimated.
 *
 * Dragging up increases value, dragging down decreases value. The thumb is
 * positioned via `translateY` on the UI thread. A floating value label fades
 * in during drag and fades out when the gesture ends.
 *
 * Design reference: brush-settings-ui/design.md §3.1
 */

import { useCallback, useMemo } from 'react';
import { type LayoutChangeEvent, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { clampValue } from './color-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerticalSliderProps {
  /** Current value (controlled). */
  value: number;
  /** Callback when value changes during drag. */
  onValueChange: (value: number) => void;
  /** Minimum value. */
  min: number;
  /** Maximum value. */
  max: number;
  /** Step size (0 = continuous). */
  step?: number;
  /** Height of the slider track in points. */
  trackHeight?: number;
  /** Render function for the preview indicator near the thumb. */
  renderPreview?: (value: number) => React.ReactNode;
  /** Accessibility label. */
  accessibilityLabel: string;
  /** Accessibility step for VoiceOver increment/decrement. */
  accessibilityStep?: number;
  /** Format function for the value label displayed near the thumb. */
  formatLabel?: (value: number) => string;
}

// ---------------------------------------------------------------------------
// Worklet helpers
// ---------------------------------------------------------------------------

function clampWorklet(n: number, lo: number, hi: number): number {
  'worklet';
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function quantizeWorklet(n: number, step: number, min: number): number {
  'worklet';
  if (!step || step <= 0) return n;
  return Math.round((n - min) / step) * step + min;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum touch target width per accessibility guidelines (44pt). */
const MIN_TOUCH_WIDTH = 44;
const THUMB_SIZE = 20;
const TRACK_WIDTH = 6;
const DEFAULT_TRACK_HEIGHT = 200;
const LABEL_FADE_DURATION = 150;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VerticalSlider({
  value,
  onValueChange,
  min,
  max,
  step = 0,
  trackHeight = DEFAULT_TRACK_HEIGHT,
  renderPreview,
  accessibilityLabel,
  accessibilityStep,
  formatLabel,
}: VerticalSliderProps) {
  // Shared values for the UI-thread animation.
  // `thumbY` represents the pixel offset from the top of the track.
  // Top of track = max value, bottom = min value (dragging up increases).
  const thumbY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const labelOpacity = useSharedValue(0);

  // Track the measured height for layout-driven updates.
  const measuredHeight = useSharedValue(trackHeight);

  // Sync controlled `value` → `thumbY` when the parent updates.
  // Top = max, bottom = min, so ratio is inverted.
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const targetY = (1 - ratio) * trackHeight;

  // Update thumbY when not dragging (controlled mode).
  // We do this in render to keep it in sync with the prop.
  if (!isDragging.value) {
    thumbY.value = clampWorklet(targetY, 0, trackHeight);
  }

  const commit = useCallback(
    (next: number) => {
      onValueChange(clampValue(next, min, max));
    },
    [onValueChange, min, max],
  );

  const pan = useMemo(() => {
    return Gesture.Pan()
      .onBegin(() => {
        'worklet';
        isDragging.value = true;
        labelOpacity.value = withTiming(1, { duration: LABEL_FADE_DURATION });
      })
      .onChange((e) => {
        'worklet';
        const height = measuredHeight.value;
        if (height <= 0) return;

        const next = clampWorklet(thumbY.value + e.changeY, 0, height);
        thumbY.value = next;

        // Convert pixel position to value. Top = max, bottom = min.
        const posRatio = 1 - next / height;
        const raw = min + posRatio * (max - min);
        const quant = quantizeWorklet(raw, step, min);
        const clamped = clampWorklet(quant, min, max);
        runOnJS(commit)(clamped);
      })
      .onEnd(() => {
        'worklet';
        isDragging.value = false;
        labelOpacity.value = withTiming(0, { duration: LABEL_FADE_DURATION });
      })
      .onFinalize(() => {
        'worklet';
        isDragging.value = false;
        labelOpacity.value = withTiming(0, { duration: LABEL_FADE_DURATION });
      });
  }, [min, max, step, thumbY, isDragging, labelOpacity, measuredHeight, commit]);

  // Animated styles.
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: thumbY.value - THUMB_SIZE / 2 }],
  }));

  const filledStyle = useAnimatedStyle(() => ({
    height: measuredHeight.value - thumbY.value,
    bottom: 0,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ translateY: thumbY.value - 12 }],
  }));

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      measuredHeight.value = h;
      // Re-sync thumb position after layout.
      const r = max > min ? (value - min) / (max - min) : 0;
      thumbY.value = clampWorklet((1 - r) * h, 0, h);
    },
    [max, min, value, measuredHeight, thumbY],
  );

  // Compute the effective accessibility step.
  const effectiveA11yStep = accessibilityStep ?? (step > 0 ? step : (max - min) / 20);

  const handleAccessibilityIncrement = useCallback(() => {
    const next = clampValue(value + effectiveA11yStep, min, max);
    onValueChange(next);
  }, [value, effectiveA11yStep, min, max, onValueChange]);

  const handleAccessibilityDecrement = useCallback(() => {
    const next = clampValue(value - effectiveA11yStep, min, max);
    onValueChange(next);
  }, [value, effectiveA11yStep, min, max, onValueChange]);

  const formattedLabel = formatLabel ? formatLabel(value) : String(value);

  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value, text: formattedLabel }}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            handleAccessibilityIncrement();
          } else if (event.nativeEvent.actionName === 'decrement') {
            handleAccessibilityDecrement();
          }
        }}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
        ]}
        style={{ width: MIN_TOUCH_WIDTH, height: trackHeight, alignItems: 'center' }}
      >
        {/* Track container */}
        <View
          onLayout={onLayout}
          style={{
            width: TRACK_WIDTH,
            height: '100%',
            borderRadius: TRACK_WIDTH / 2,
            backgroundColor: '#242730', // border.subtle
            overflow: 'hidden',
          }}
        >
          {/* Filled range indicator (from bottom up to thumb) */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                borderRadius: TRACK_WIDTH / 2,
                backgroundColor: '#D6A33A', // accent.default
              },
              filledStyle,
            ]}
          />
        </View>

        {/* Thumb */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: '#D6A33A', // accent.default
              borderWidth: 2,
              borderColor: '#191B20', // bg.elevated
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 2,
              elevation: 3,
            },
            thumbStyle,
          ]}
        />

        {/* Floating value label — visible only during drag */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              right: MIN_TOUCH_WIDTH / 2 + 14,
              backgroundColor: '#191B20', // bg.elevated
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.3,
              shadowRadius: 3,
              elevation: 4,
            },
            labelStyle,
          ]}
          pointerEvents="none"
        >
          <Text
            style={{
              color: '#F4F4F5', // text.primary
              fontSize: 12,
              fontWeight: '500',
              textAlign: 'center',
            }}
          >
            {formattedLabel}
          </Text>
        </Animated.View>

        {/* Preview indicator (optional) */}
        {renderPreview ? (
          <View
            style={{
              position: 'absolute',
              top: trackHeight + 8,
              alignItems: 'center',
            }}
            pointerEvents="none"
          >
            {renderPreview(value)}
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

VerticalSlider.displayName = 'VerticalSlider';
