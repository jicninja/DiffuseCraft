// Editor/LeftToolRail (snapshot preview missing — built from brief). v1.0.0
//
// Floating vertical tool rail for `05-Editor-Generate` (and shared by the
// 05b/05c/05d Editor variants). 48–72pt wide, runs the full editor height,
// positioned absolute on the left edge. The active tool tile uses the single
// `accent/default` color per the project's "single-accent / calm instrument"
// rule; everything else is `text/secondary` over `bg/elevated`.
//
// Tool order is verbatim from EDITOR_STRINGS.toolRail and the
// `prompts/pencil-design-screens.md` HERO brief:
//   1. 5 brush presets (pen, pencil, marker, eraser, smooth)
//   2. separator
//   3. selection, transform, mask, eyedropper
//   4. separator
//   5. layers toggle, undo, redo
//
// The rail reads `activeTool` from `editorStore` and dispatches tool changes
// via `setActiveTool` + `setBrush`. Undo/redo use the `useUndoRedo` hook.

import { useState } from 'react';
import {
  Eraser,
  Highlighter,
  Layers,
  Lasso,
  Move,
  Pencil as PencilIcon,
  PenTool,
  Pipette,
  Redo2,
  Sparkles,
  SquareDashed,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useEditorStore, useUndoRedo, type EditorTool } from '@diffusecraft/core';
import { getBrushPreset, type BrushPresetId } from '@diffusecraft/canvas-core';
import { Separator, tokens } from '@diffusecraft/ui';

import { ColorSwatch } from './brush-settings/ColorSwatch';
import { EDITOR_STRINGS } from '../_strings/Editor';

const S = EDITOR_STRINGS.toolRail;

// ─── TOOL_MAP — maps rail button IDs to store actions (design §4.8) ─────────
//
// Each selectable rail button maps to an `EditorTool` and optionally a
// `BrushPresetId`. When a brush preset is selected, the handler calls
// `setBrush` with the preset's settings in addition to `setActiveTool`.

interface ToolMapping {
  tool: EditorTool;
  preset?: BrushPresetId;
}

const TOOL_MAP: Record<string, ToolMapping> = {
  'brush-pen': { tool: 'brush', preset: 'pen' },
  'brush-pencil': { tool: 'brush', preset: 'pencil' },
  'brush-marker': { tool: 'brush', preset: 'marker' },
  'brush-eraser': { tool: 'eraser', preset: 'eraser' },
  'brush-smooth': { tool: 'brush', preset: 'smooth' },
  'selection': { tool: 'lasso' },
  'transform': { tool: 'transform' },
  'mask': { tool: 'brush' }, // mask painting uses brush tool on mask layer
  'eyedropper': { tool: 'eyedropper' },
};

// ─── Tool descriptors ───────────────────────────────────────────────────────

interface ToolDescriptor {
  id: string;
  Icon: LucideIcon;
  a11yLabel: string;
}

const BRUSH_TOOLS: readonly ToolDescriptor[] = [
  { id: 'brush-pen', Icon: PenTool, a11yLabel: S.brushPen },
  { id: 'brush-pencil', Icon: PencilIcon, a11yLabel: S.brushPencil },
  { id: 'brush-marker', Icon: Highlighter, a11yLabel: S.brushMarker },
  { id: 'brush-eraser', Icon: Eraser, a11yLabel: S.brushEraser },
  // `Sparkles` stands in for the "smooth" brush — there's no perfect lucide
  // glyph for a smudge/smooth tool and Sparkles reads as "soften / refine".
  { id: 'brush-smooth', Icon: Sparkles, a11yLabel: S.brushSmooth },
];

const SELECTION_TOOLS: readonly ToolDescriptor[] = [
  { id: 'selection', Icon: Lasso, a11yLabel: S.selection },
  // Brief allows `Move3d` or `Move`; `Move` reads cleaner at 20pt.
  { id: 'transform', Icon: Move, a11yLabel: S.transform },
  // Brief allows `SquareDashed` or `SquareDashedBottom`; `SquareDashed` is the
  // unambiguous "marching-ants region" glyph and lands in the icon set we
  // already pull from in lucide-react-native ^0.452.0.
  { id: 'mask', Icon: SquareDashed, a11yLabel: S.mask },
  { id: 'eyedropper', Icon: Pipette, a11yLabel: S.eyedropper },
];

// ─── ToolButton ─────────────────────────────────────────────────────────────

interface ToolButtonProps {
  Icon: LucideIcon;
  active: boolean;
  a11yLabel: string;
  onPress: () => void;
}

function ToolButton({ Icon, active, a11yLabel, onPress }: ToolButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={
        active
          ? 'h-10 w-10 items-center justify-center rounded-md bg-accent-default'
          : 'h-10 w-10 items-center justify-center rounded-md active:bg-surface'
      }
    >
      <Icon
        size={20}
        color={active ? tokens.colors.bg.canvas : tokens.colors.text.primary}
      />
    </Pressable>
  );
}

// ─── LeftToolRail ───────────────────────────────────────────────────────────

export interface LeftToolRailProps {
  onToggleLayers?: () => void;
  /** Callback when the color swatch is tapped — parent handles color picker panel visibility. */
  onColorSwatchPress?: () => void;
}

export function LeftToolRail({ onToggleLayers, onColorSwatchPress }: LeftToolRailProps) {
  // Read canonical tool from editorStore (FR-36, FR-38).
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setBrush = useEditorStore((s) => s.setBrush);

  // Track which rail button was last selected so we can highlight the
  // correct brush-preset button (the store only knows `'brush'`, not
  // `'brush-pen'` vs `'brush-pencil'`).
  const [activeRailId, setActiveRailId] = useState('brush-pen');

  // undo/redo wire through the `useUndoRedo` hook from `@diffusecraft/core`.
  // The hook is defensive when `<StoresProvider>` isn't yet mounted —
  // both calls become no-ops and the rail still renders.
  const { undo, redo } = useUndoRedo();

  // Internal tool-change handler (FR-15, FR-36): updates the store's
  // `activeTool` and, when a brush preset is selected, applies the
  // preset's settings to the brush slice.
  const handleToolChange = (railId: string) => {
    const mapping = TOOL_MAP[railId];
    if (!mapping) return;

    setActiveRailId(railId);
    setActiveTool(mapping.tool);

    if (mapping.preset) {
      const preset = getBrushPreset(mapping.preset);
      setBrush({
        size: preset.size,
        hardness: preset.hardness,
        opacity: preset.opacity,
        pressureCurve: [...preset.pressureCurve],
      });
    }
  };

  // Determine which rail button is visually active. For tools that map
  // 1:1 to an EditorTool (selection, transform, mask, eyedropper), we
  // derive the active state from the store's `activeTool`. For brush
  // presets, we use the locally tracked `activeRailId` because multiple
  // rail buttons map to the same `'brush'` EditorTool.
  const isActive = (railId: string): boolean => {
    const mapping = TOOL_MAP[railId];
    if (!mapping) return false;

    // Brush presets: check both that the store tool matches AND that
    // this specific rail button was the one selected.
    if (mapping.preset) {
      return activeTool === mapping.tool && activeRailId === railId;
    }

    // Non-preset tools: derive directly from the store.
    return activeTool === mapping.tool;
  };

  const handleToggleLayers = () => {
    if (onToggleLayers) {
      onToggleLayers();
    } else {
      // eslint-disable-next-line no-console
      console.log('[LeftToolRail] TODO: onToggleLayers not wired');
    }
  };

  return (
    <View
      // Absolute-positioned floating rail: 56pt wide (mid-point of the 48–72pt
      // window from the brief), runs full editor height, p-2 padding, gap-1
      // between tiles. `bg-elevated` is the calm panel surface; we don't apply
      // a backdrop blur since RN's NativeWind layer doesn't ship one and the
      // brief explicitly allows the plain `bg-elevated` fallback.
      className="absolute left-3 top-3 bottom-3 w-14 rounded-xl bg-elevated p-2 gap-1 items-center"
      accessibilityRole="toolbar"
    >
      {/* 0. Color swatch — active brush color indicator (Req 3.1, 3.3) -- */}
      <ColorSwatch onPress={onColorSwatchPress ?? (() => {})} />

      {/* 1. Brush presets ------------------------------------------------- */}
      {BRUSH_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          Icon={t.Icon}
          active={isActive(t.id)}
          a11yLabel={t.a11yLabel}
          onPress={() => handleToolChange(t.id)}
        />
      ))}

      <Separator className="my-1 w-8" />

      {/* 2. Selection / transform / mask / eyedropper -------------------- */}
      {SELECTION_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          Icon={t.Icon}
          active={isActive(t.id)}
          a11yLabel={t.a11yLabel}
          onPress={() => handleToolChange(t.id)}
        />
      ))}

      <Separator className="my-1 w-8" />

      {/* 3. Layers toggle + undo/redo pair ------------------------------- */}
      {/* These three are momentary actions, not selectable tools, so they
          never carry the `active` accent treatment. */}
      <ToolButton
        Icon={Layers}
        active={false}
        a11yLabel={S.layersToggleA11yLabel}
        onPress={handleToggleLayers}
      />
      <ToolButton
        Icon={Undo2}
        active={false}
        a11yLabel={S.undoA11yLabel}
        onPress={() => void undo()}
      />
      <ToolButton
        Icon={Redo2}
        active={false}
        a11yLabel={S.redoA11yLabel}
        onPress={() => void redo()}
      />
    </View>
  );
}

LeftToolRail.displayName = 'LeftToolRail';
