/**
 * ColorSwatch — circular indicator showing the active brush color.
 *
 * Mounted inside `LeftToolRail` above the brush preset buttons (design §3.3).
 * Reads `brush.color` from `useEditorStore`, resolves it to a display hex
 * via `resolveColorToHex`, and renders a 36pt filled circle with a 2pt
 * `border-strong` ring. Tapping opens the color picker panel.
 *
 * Touch target is 44×44pt minimum (padding around the 36pt circle) per
 * Requirement 3.5 / 9.3.
 */

import { Pressable, View } from 'react-native';

import { useEditorStore } from '@diffusecraft/core';

import { resolveColorToHex } from './color-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Diameter of the visible color circle (pt). */
const SWATCH_DIAMETER = 36;

/** Width of the border ring (pt). */
const BORDER_WIDTH = 2;

/** Minimum touch target dimension (pt) — Apple HIG / WCAG. */
const TOUCH_TARGET = 44;

/** Border color — `border.strong` from theme tokens. */
const BORDER_COLOR = '#363B46';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorSwatchProps {
  /** Callback when the swatch is tapped (opens color picker). */
  onPress: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColorSwatch({ onPress }: ColorSwatchProps) {
  const brushColor = useEditorStore((s) => s.brush.color);
  const displayHex = resolveColorToHex(brushColor);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Brush color: ${displayHex}`}
      style={{
        width: TOUCH_TARGET,
        height: TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: SWATCH_DIAMETER,
          height: SWATCH_DIAMETER,
          borderRadius: SWATCH_DIAMETER / 2,
          backgroundColor: displayHex,
          borderWidth: BORDER_WIDTH,
          borderColor: BORDER_COLOR,
        }}
      />
    </Pressable>
  );
}

ColorSwatch.displayName = 'ColorSwatch';
