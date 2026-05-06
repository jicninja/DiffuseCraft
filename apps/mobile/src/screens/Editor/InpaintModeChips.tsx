// Editor/InpaintModeChips (snapshot preview missing — built from brief). v1.0.0
//
// Sub-mode pill set for the Inpaint workspace (`05b-Editor-Inpaint`). Renders
// directly above the BottomPromptBar when `workspace === 'inpaint'`, scoping
// the primary "Fill" action to one of five sub-modes:
//
//   Fill | Expand | Add | Remove | Replace bg
//
// Built on the rnr `Tabs` primitive in pill mode (TabsList background plate
// + active TabsTrigger gets the elevated `bg-background` highlight straight
// from the upstream rnr token map). Bound to `mode` / `onModeChange` from
// `useEditorState` — this component is purely presentational.
//
// The 5 IDs mirror the `InpaintMode` union in `useEditorState.ts`:
//   'fill' | 'expand' | 'add' | 'remove' | 'replace-bg'
//
// Strings: `EDITOR_STRINGS.inpaintModes.*`.

import { Text, View } from 'react-native';

import { Tabs, TabsList, TabsTrigger } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../_strings/Editor';
import type { InpaintMode } from './useEditorState';

const S = EDITOR_STRINGS.inpaintModes;

export interface InpaintModeChipsProps {
  mode: InpaintMode;
  onModeChange: (mode: InpaintMode) => void;
}

const INPAINT_MODES: ReadonlyArray<{ value: InpaintMode; label: string }> = [
  { value: 'fill', label: S.fill },
  { value: 'expand', label: S.expand },
  { value: 'add', label: S.add },
  { value: 'remove', label: S.remove },
  { value: 'replace-bg', label: S.replaceBg },
];

export function InpaintModeChips({ mode, onModeChange }: InpaintModeChipsProps) {
  return (
    <View
      // Same horizontal envelope as the BottomPromptBar so the chip row
      // visually anchors to the bar above it. Centered, max-w-[720px].
      className="items-center"
      accessibilityRole="tablist"
    >
      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as InpaintMode)}
        accessibilityLabel={S.a11yLabel}
      >
        <TabsList className="h-9 rounded-full bg-elevated border border-border-subtle px-1">
          {INPAINT_MODES.map((m) => (
            <TabsTrigger
              key={m.value}
              value={m.value}
              className="h-7 rounded-full px-3"
            >
              <Text
                className={
                  m.value === mode
                    ? 'text-caption-strong text-text-primary'
                    : 'text-caption text-text-secondary'
                }
              >
                {m.label}
              </Text>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </View>
  );
}
InpaintModeChips.displayName = 'InpaintModeChips';
