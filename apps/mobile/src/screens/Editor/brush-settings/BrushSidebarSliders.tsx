/**
 * BrushSidebarSliders — container rendering two VerticalSlider instances
 * (size + opacity) stacked vertically on the left edge of the editor.
 *
 * Positioned absolutely at `left-[76px]`, vertically centered, adjacent to
 * the LeftToolRail (design §3.2, D6).
 *
 * Reads `brush.size` and `brush.opacity` from `useEditorStore` and writes
 * via `setBrush`.
 */

import { useCallback } from 'react';
import { View } from 'react-native';

import { useEditorStore } from '@diffusecraft/core';

import { VerticalSlider } from './VerticalSlider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrushSidebarSlidersProps {
  /** Optional className for the outer container (NativeWind). */
  className?: string;
}

// ---------------------------------------------------------------------------
// Preview constants
// ---------------------------------------------------------------------------

/** Maximum diameter (pt) for the size preview circle. */
const MAX_PREVIEW_DIAMETER = 40;
/** Diameter (pt) for the opacity preview circle. */
const OPACITY_PREVIEW_DIAMETER = 24;

// ---------------------------------------------------------------------------
// Label formatters
// ---------------------------------------------------------------------------

function formatSizeLabel(value: number): string {
  return `${Math.round(value)} px`;
}

function formatOpacityLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrushSidebarSliders({ className }: BrushSidebarSlidersProps) {
  const size = useEditorStore((s) => s.brush.size);
  const opacity = useEditorStore((s) => s.brush.opacity);
  const setBrush = useEditorStore((s) => s.setBrush);

  const handleSizeChange = useCallback(
    (next: number) => setBrush({ size: next }),
    [setBrush],
  );

  const handleOpacityChange = useCallback(
    (next: number) => setBrush({ opacity: next }),
    [setBrush],
  );

  const renderSizePreview = useCallback((value: number) => {
    // Scale proportionally: 1 → ~2pt, 512 → MAX_PREVIEW_DIAMETER.
    const diameter = Math.min(
      MAX_PREVIEW_DIAMETER,
      2 + ((value - 1) / (512 - 1)) * (MAX_PREVIEW_DIAMETER - 2),
    );
    return (
      <View
        style={{
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: '#F4F4F5', // text.primary
        }}
      />
    );
  }, []);

  const renderOpacityPreview = useCallback((value: number) => {
    return (
      <View
        style={{
          width: OPACITY_PREVIEW_DIAMETER,
          height: OPACITY_PREVIEW_DIAMETER,
          borderRadius: OPACITY_PREVIEW_DIAMETER / 2,
          backgroundColor: '#F4F4F5', // text.primary
          opacity: value,
        }}
      />
    );
  }, []);

  return (
    <View
      className={className}
      style={{
        position: 'absolute',
        left: 76,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
      }}
      pointerEvents="box-none"
    >
      {/* Size slider */}
      <VerticalSlider
        value={size}
        onValueChange={handleSizeChange}
        min={1}
        max={512}
        step={1}
        accessibilityLabel="Brush size"
        accessibilityStep={1}
        formatLabel={formatSizeLabel}
        renderPreview={renderSizePreview}
      />

      {/* Opacity slider */}
      <VerticalSlider
        value={opacity}
        onValueChange={handleOpacityChange}
        min={0.01}
        max={1.0}
        step={0.01}
        accessibilityLabel="Brush opacity"
        accessibilityStep={0.05}
        formatLabel={formatOpacityLabel}
        renderPreview={renderOpacityPreview}
      />
    </View>
  );
}

BrushSidebarSliders.displayName = 'BrushSidebarSliders';
