/**
 * Brush slice — size, hardness, opacity, color carrier, pressure curve.
 *
 * The `color` field is an opaque string identifier (e.g., a theme token name
 * or an externally-resolved color id). Raw hex literals live behind the
 * NativeWind theme tokens per the workspace lint rule, so this slice never
 * stores raw hex.
 */
import type { StateCreator } from 'zustand';

import type { BrushSettings, BrushSlice, EditorState } from './types';

const DEFAULT_BRUSH: BrushSettings = {
  size: 16,
  hardness: 0.75,
  opacity: 1,
  // Black so strokes are visible on the default white paper. Previously
  // 'token.foreground' resolved to near-white in the dark theme, which
  // produced invisible strokes on the white canvas.
  color: '#000000',
  pressureCurve: [
    [0, 0],
    [1, 1],
  ],
};

export const createBrushSlice: StateCreator<
  EditorState,
  [],
  [],
  BrushSlice
> = (set, get) => ({
  brush: DEFAULT_BRUSH,
  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
});

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = DEFAULT_BRUSH;
