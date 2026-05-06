/**
 * RecentColorSwatches — horizontal row of recently used color circles.
 *
 * Renders up to 10 circular swatches (24pt diameter, 4pt gap) in a
 * horizontal row. Each swatch is a `Pressable` with an accessibility label
 * showing the hex value. The swatch matching the current `brush.color`
 * (resolved to hex) gets a 2pt accent ring.
 *
 * Design §3.7 · Requirements 5.1, 5.3.
 */

import { Pressable, View } from 'react-native';

import { useEditorStore } from '@diffusecraft/core';

import { resolveColorToHex } from './color-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Diameter of each recent color swatch (pt). */
const SWATCH_DIAMETER = 24;

/** Gap between swatches (pt). */
const SWATCH_GAP = 4;

/** Border width for the active-color accent ring (pt). */
const ACTIVE_RING_WIDTH = 2;

/** Accent color for the active swatch ring — `accent.default` from theme tokens. */
const ACCENT_COLOR = '#D6A33A';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentColorSwatchesProps {
  /** List of recent hex colors, most-recent-first. */
  colors: readonly string[];
  /** Callback when a swatch is tapped. */
  onSelect: (hex: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a hex color string for comparison: strip leading `#` and
 * convert to uppercase.
 */
function normalizeHex(hex: string): string {
  const stripped = hex.startsWith('#') ? hex.slice(1) : hex;
  return stripped.toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecentColorSwatches({ colors, onSelect }: RecentColorSwatchesProps) {
  const brushColor = useEditorStore((s) => s.brush.color);
  const activeHex = normalizeHex(resolveColorToHex(brushColor));

  // Only render up to 10 swatches.
  const visibleColors = colors.slice(0, 10);

  return (
    <View style={{ flexDirection: 'row', gap: SWATCH_GAP }}>
      {visibleColors.map((hex) => {
        const normalized = normalizeHex(hex);
        const isActive = normalized === activeHex;
        // Ensure the fill color has a `#` prefix for RN styles.
        const fillColor = hex.startsWith('#') ? hex : `#${hex}`;

        return (
          <Pressable
            key={normalized}
            onPress={() => onSelect(hex)}
            accessibilityLabel={`Recent color ${fillColor}`}
            style={{
              width: SWATCH_DIAMETER,
              height: SWATCH_DIAMETER,
              borderRadius: SWATCH_DIAMETER / 2,
              backgroundColor: fillColor,
              borderWidth: isActive ? ACTIVE_RING_WIDTH : 0,
              borderColor: isActive ? ACCENT_COLOR : 'transparent',
            }}
          />
        );
      })}
    </View>
  );
}

RecentColorSwatches.displayName = 'RecentColorSwatches';
