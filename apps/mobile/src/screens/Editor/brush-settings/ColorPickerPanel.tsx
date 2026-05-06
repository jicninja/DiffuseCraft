/**
 * ColorPickerPanel — floating, draggable panel containing the color disc,
 * hex input, and recent color swatches.
 *
 * Renders as an absolute-positioned View with bg-elevated, rounded-xl,
 * shadow, and z-50. Draggable via Gesture.Pan() on the entire panel.
 * Tap-outside-to-dismiss via an overlay Pressable behind the panel.
 * Accessibility escape gesture (two-finger Z-scrub) via onAccessibilityEscape.
 *
 * Design §3.4 · Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8,
 * 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.3, 9.5.
 */

import { useCallback, useRef } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { useEditorStore } from '@diffusecraft/core';

import { ColorDisc } from './ColorDisc';
import { HexColorInput } from './HexColorInput';
import { RecentColorSwatches } from './RecentColorSwatches';
import { hexToHsb, hsbToHex, resolveColorToHex } from './color-utils';
import { useRecentColors } from './use-recent-colors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Panel width (pt). */
const PANEL_WIDTH = 300;

/** Panel height (pt). */
const PANEL_HEIGHT = 420;

/** Vertical offset from top of screen (pt). */
const TOP_OFFSET = 120;

/** Background color — `bg-elevated` from theme tokens. */
const BG_ELEVATED = '#191B20';

/** Drag handle pill width (pt). */
const HANDLE_WIDTH = 40;

/** Drag handle pill height (pt). */
const HANDLE_HEIGHT = 4;

/** Drag handle color — subtle neutral. */
const HANDLE_COLOR = '#4A4F5C';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorPickerPanelProps {
  /** Whether the panel is visible. */
  visible: boolean;
  /** Callback to close the panel. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColorPickerPanel({ visible, onClose }: ColorPickerPanelProps) {
  // -----------------------------------------------------------------------
  // Store
  // -----------------------------------------------------------------------

  const brushColor = useEditorStore((s) => s.brush.color);
  const setBrush = useEditorStore((s) => s.setBrush);

  // Resolve current color to hex and HSB.
  const currentHex = resolveColorToHex(brushColor);
  // Strip leading '#' for hexToHsb and HexColorInput.
  const hexWithoutHash = currentHex.startsWith('#')
    ? currentHex.slice(1)
    : currentHex;
  const currentHsb = hexToHsb(hexWithoutHash);

  // -----------------------------------------------------------------------
  // Recent colors
  // -----------------------------------------------------------------------

  const { colors: recentColors, pushColor } = useRecentColors();

  // Track the previous color so we push it to recents when the user picks
  // a new color via the disc. We use a ref to avoid re-renders.
  const previousColorRef = useRef(currentHex);

  // -----------------------------------------------------------------------
  // Dragging
  // -----------------------------------------------------------------------

  const screenWidth = Dimensions.get('window').width;
  const initialX = (screenWidth - PANEL_WIDTH) / 2;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    });

  const animatedPanelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // -----------------------------------------------------------------------
  // Color change handlers
  // -----------------------------------------------------------------------

  /**
   * Handle color change from the ColorDisc.
   * Pushes the PREVIOUS color to recent colors, then writes the new color.
   */
  const handleDiscColorChange = useCallback(
    (hsb: { h: number; s: number; b: number }) => {
      const newHex = `#${hsbToHex(hsb)}`;

      // Push the previous color to recents (not the new one).
      const prev = previousColorRef.current;
      if (prev !== newHex) {
        pushColor(prev);
        previousColorRef.current = newHex;
      }

      setBrush({ color: newHex });
    },
    [pushColor, setBrush],
  );

  /**
   * Handle color change from the HexColorInput.
   */
  const handleHexChange = useCallback(
    (hex: string) => {
      const newHex = `#${hex}`;
      previousColorRef.current = newHex;
      setBrush({ color: newHex });
    },
    [setBrush],
  );

  /**
   * Handle color selection from RecentColorSwatches.
   */
  const handleSwatchSelect = useCallback(
    (hex: string) => {
      const newHex = hex.startsWith('#') ? hex : `#${hex}`;
      previousColorRef.current = newHex;
      setBrush({ color: newHex });
    },
    [setBrush],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!visible) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
      }}
      pointerEvents="box-none"
    >
      {/* Tap-outside-to-dismiss overlay */}
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close color picker"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* Draggable panel */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          accessible
          onAccessibilityEscape={onClose}
          style={[
            {
              position: 'absolute',
              top: TOP_OFFSET,
              left: initialX,
              width: PANEL_WIDTH,
              height: PANEL_HEIGHT,
              backgroundColor: BG_ELEVATED,
              borderRadius: 12,
              padding: 16,
              alignItems: 'center',
              // Shadow
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 12,
              elevation: 8,
            },
            animatedPanelStyle,
          ]}
        >
          {/* Drag handle bar */}
          <View
            style={{
              width: HANDLE_WIDTH,
              height: HANDLE_HEIGHT,
              borderRadius: HANDLE_HEIGHT / 2,
              backgroundColor: HANDLE_COLOR,
              marginBottom: 12,
            }}
          />

          {/* Color disc */}
          <ColorDisc hsb={currentHsb} onColorChange={handleDiscColorChange} />

          {/* Hex color input */}
          <View style={{ width: '100%', marginTop: 12 }}>
            <HexColorInput hex={hexWithoutHash} onHexChange={handleHexChange} />
          </View>

          {/* Recent color swatches */}
          <View style={{ width: '100%', marginTop: 12 }}>
            <RecentColorSwatches
              colors={recentColors}
              onSelect={handleSwatchSelect}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

ColorPickerPanel.displayName = 'ColorPickerPanel';
