/**
 * ColorDisc — HSB color wheel rendered with @shopify/react-native-skia.
 *
 * Structure:
 * - Outer hue ring: Circle with SweepGradient cycling 0°–360°
 * - Inner SV square: Rect with overlapping horizontal (white → hue) and
 *   vertical (transparent → black) gradients
 * - Indicators: small circle on hue ring, crosshair on SV square
 *
 * Gesture handling via Gesture.Pan() from react-native-gesture-handler.
 * All position → color math runs in Reanimated worklets for zero-lag updates.
 *
 * Design reference: brush-settings-ui/design.md §3.5, decision D7 (SV-square).
 */

import {
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Rect,
  SweepGradient,
} from '@shopify/react-native-skia';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { hsbToHex, type HSBColor } from './color-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorDiscProps {
  /** Current color in HSB. */
  hsb: HSBColor;
  /** Callback when the user selects a color. */
  onColorChange: (hsb: HSBColor) => void;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Total canvas size in points. */
const CANVAS_SIZE = 260;
/** Center of the canvas. */
const CENTER = CANVAS_SIZE / 2;
/** Outer radius of the hue ring. */
const OUTER_RADIUS = CANVAS_SIZE / 2 - 4;
/** Width of the hue ring band. */
const RING_WIDTH = 24;
/** Inner radius of the hue ring (inside edge). */
const INNER_RING_RADIUS = OUTER_RADIUS - RING_WIDTH;
/** Gap between ring inner edge and SV square. */
const GAP = 6;
/** Half-side of the inscribed SV square (fits inside the inner ring circle). */
const SQUARE_HALF = (INNER_RING_RADIUS - GAP) / Math.SQRT2;
/** Top-left corner of the SV square. */
const SQ_X = CENTER - SQUARE_HALF;
const SQ_Y = CENTER - SQUARE_HALF;
/** Side length of the SV square. */
const SQ_SIZE = SQUARE_HALF * 2;

/** Radius of the hue indicator dot. */
const HUE_INDICATOR_R = RING_WIDTH / 2 - 2;
/** Crosshair arm length. */
const CROSSHAIR_ARM = 8;

// ---------------------------------------------------------------------------
// Hue ring spectrum colors (0°, 60°, 120°, 180°, 240°, 300°, 360°)
// ---------------------------------------------------------------------------

const HUE_COLORS = [
  '#FF0000', // 0° red
  '#FFFF00', // 60° yellow
  '#00FF00', // 120° green
  '#00FFFF', // 180° cyan
  '#0000FF', // 240° blue
  '#FF00FF', // 300° magenta
  '#FF0000', // 360° red (wrap)
];

// ---------------------------------------------------------------------------
// Worklet helpers
// ---------------------------------------------------------------------------

function clampW(n: number, lo: number, hi: number): number {
  'worklet';
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Convert angle in radians to degrees [0, 360). */
function radToDeg(rad: number): number {
  'worklet';
  const deg = (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Convert degrees to radians. */
function degToRad(deg: number): number {
  'worklet';
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColorDisc({ hsb, onColorChange }: ColorDiscProps) {
  // Shared values for gesture tracking.
  const activeZone = useSharedValue<'none' | 'ring' | 'square'>('none');

  const commitColor = useCallback(
    (h: number, s: number, b: number) => {
      onColorChange({ h, s, b });
    },
    [onColorChange],
  );

  // -----------------------------------------------------------------------
  // Gesture
  // -----------------------------------------------------------------------

  const pan = useMemo(() => {
    return Gesture.Pan()
      .onBegin((e) => {
        'worklet';
        const dx = e.x - CENTER;
        const dy = e.y - CENTER;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= INNER_RING_RADIUS && dist <= OUTER_RADIUS) {
          // Touch is on the hue ring.
          activeZone.value = 'ring';
          const angle = radToDeg(Math.atan2(dy, dx));
          // SweepGradient starts at 0° (3 o'clock) by default.
          const hue = ((angle % 360) + 360) % 360;
          runOnJS(commitColor)(hue, hsb.s, hsb.b);
        } else if (
          e.x >= SQ_X &&
          e.x <= SQ_X + SQ_SIZE &&
          e.y >= SQ_Y &&
          e.y <= SQ_Y + SQ_SIZE
        ) {
          // Touch is inside the SV square.
          activeZone.value = 'square';
          const sat = clampW((e.x - SQ_X) / SQ_SIZE, 0, 1);
          const bri = clampW(1 - (e.y - SQ_Y) / SQ_SIZE, 0, 1);
          runOnJS(commitColor)(hsb.h, sat, bri);
        } else {
          activeZone.value = 'none';
        }
      })
      .onChange((e) => {
        'worklet';
        if (activeZone.value === 'ring') {
          const dx = e.x - CENTER;
          const dy = e.y - CENTER;
          const angle = radToDeg(Math.atan2(dy, dx));
          const hue = ((angle % 360) + 360) % 360;
          runOnJS(commitColor)(hue, hsb.s, hsb.b);
        } else if (activeZone.value === 'square') {
          const sat = clampW((e.x - SQ_X) / SQ_SIZE, 0, 1);
          const bri = clampW(1 - (e.y - SQ_Y) / SQ_SIZE, 0, 1);
          runOnJS(commitColor)(hsb.h, sat, bri);
        }
      })
      .onEnd(() => {
        'worklet';
        activeZone.value = 'none';
      })
      .onFinalize(() => {
        'worklet';
        activeZone.value = 'none';
      });
  }, [hsb.h, hsb.s, hsb.b, activeZone, commitColor]);

  // -----------------------------------------------------------------------
  // Derived positions
  // -----------------------------------------------------------------------

  // Hue indicator position on the ring (midpoint of ring band).
  const hueRad = degToRad(hsb.h);
  const ringMidR = INNER_RING_RADIUS + RING_WIDTH / 2;
  const hueIndX = CENTER + ringMidR * Math.cos(hueRad);
  const hueIndY = CENTER + ringMidR * Math.sin(hueRad);

  // SV crosshair position inside the square.
  const crossX = SQ_X + hsb.s * SQ_SIZE;
  const crossY = SQ_Y + (1 - hsb.b) * SQ_SIZE;

  // Full-saturation color for the current hue (used in SV square gradient).
  const fullHueHex = `#${hsbToHex({ h: hsb.h, s: 1, b: 1 })}`;

  return (
    <View style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
          {/* ---- Outer hue ring ---- */}
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={INNER_RING_RADIUS + RING_WIDTH / 2}
            style="stroke"
            strokeWidth={RING_WIDTH}
          >
            <SweepGradient
              c={{ x: CENTER, y: CENTER }}
              colors={HUE_COLORS}
            />
          </Circle>

          {/* ---- Inner SV square: saturation gradient (white → hue) ---- */}
          <Group>
            <Rect
              x={SQ_X}
              y={SQ_Y}
              width={SQ_SIZE}
              height={SQ_SIZE}
            >
              <LinearGradient
                start={{ x: SQ_X, y: SQ_Y }}
                end={{ x: SQ_X + SQ_SIZE, y: SQ_Y }}
                colors={['#FFFFFF', fullHueHex]}
              />
            </Rect>

            {/* Brightness gradient (transparent → black), blended on top */}
            <Rect
              x={SQ_X}
              y={SQ_Y}
              width={SQ_SIZE}
              height={SQ_SIZE}
            >
              <LinearGradient
                start={{ x: SQ_X, y: SQ_Y }}
                end={{ x: SQ_X, y: SQ_Y + SQ_SIZE }}
                colors={['transparent', '#000000']}
              />
            </Rect>
          </Group>

          {/* ---- Hue indicator (small circle on ring) ---- */}
          <Circle
            cx={hueIndX}
            cy={hueIndY}
            r={HUE_INDICATOR_R}
            color="#FFFFFF"
          />
          <Circle
            cx={hueIndX}
            cy={hueIndY}
            r={HUE_INDICATOR_R - 2}
            color={fullHueHex}
          />

          {/* ---- SV crosshair indicator ---- */}
          {/* Horizontal line */}
          <Line
            p1={{ x: crossX - CROSSHAIR_ARM, y: crossY }}
            p2={{ x: crossX + CROSSHAIR_ARM, y: crossY }}
            color="#FFFFFF"
            strokeWidth={2}
            style="stroke"
          />
          {/* Vertical line */}
          <Line
            p1={{ x: crossX, y: crossY - CROSSHAIR_ARM }}
            p2={{ x: crossX, y: crossY + CROSSHAIR_ARM }}
            color="#FFFFFF"
            strokeWidth={2}
            style="stroke"
          />
          {/* Crosshair center dot */}
          <Circle
            cx={crossX}
            cy={crossY}
            r={4}
            color="#FFFFFF"
            style="stroke"
            strokeWidth={2}
          />
        </Canvas>
      </GestureDetector>
    </View>
  );
}

ColorDisc.displayName = 'ColorDisc';
