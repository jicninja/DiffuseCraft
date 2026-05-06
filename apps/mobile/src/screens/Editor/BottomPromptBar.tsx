// Editor/BottomPromptBar (snapshot preview missing — built from brief). v1.0.0
//
// Floating bottom-center prompt bar for `05-Editor-Generate` (HERO) and shared
// by the `05b/05c/05d` Editor variants. The bar is the single most important
// affordance on the editor surface — it must read as "voice OR text, both
// equal." That informs the "PEER" mic styling: the mic is rendered as a
// `size="default"` Button (40pt — same height ladder as the primary action
// and Enhance) on a `bg-accent-muted` plate with the warm-gold
// `text-accent-default` icon, NOT as a tiny `size="icon"` ghost.
//
// Layout (per `prompts/pencil-design-screens.md` brief #8):
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ [🎤]  [────── prompt textarea ──────]  [✨ Enhance] [Generate] │  ← 64pt bar
//   └──────────────────────────────────────────────────────────────────┘
//      Strength: 75%   ───●───────                                        ← row 2
//      [Realistic] [Anime] [3D render] [Illustration] [Photo] [Pixel art] ← row 3
//
// The bar + the strength/preset row sit inside a single absolute-positioned
// container (`bottom-3 left-1/2 -translate-x-1/2`, `max-w-[720px]`) so they
// stay glued to the bottom of the canvas across orientation/keyboard shifts.
//
// Strings: `EDITOR_STRINGS.promptBar.*`. Presets: `MOCK_PRESETS` (6 chips).
// Workspace-aware primary label: 'Fill' when `workspace === 'inpaint'` else
// 'Generate'. Upscale/Live primary labels live in the strings file but the
// brief for this component only spells out Generate vs Fill — keep the
// switch tight to the spec'd two cases for v1.

import { Mic, Sparkles } from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Badge, Button, Slider, Textarea } from '@diffusecraft/ui';

import { MOCK_PRESETS } from '../_mock/presets';
import { EDITOR_STRINGS } from '../_strings/Editor';
import type { EditorWorkspace } from './useEditorState';

const S = EDITOR_STRINGS.promptBar;

export interface BottomPromptBarProps {
  workspace: EditorWorkspace;
  onSubmit?: (prompt: string) => void;
}

export function BottomPromptBar({ workspace, onSubmit }: BottomPromptBarProps) {
  const [prompt, setPrompt] = React.useState<string>('');
  // Strength is presentation-only in v1 — the real value lives in the
  // generation pipeline once client-state-architecture lands. Default 75%
  // matches the visible "Strength: 75%" label in the brief.
  const [strength, setStrength] = React.useState<number>(75);
  const [activePreset, setActivePreset] = React.useState<string>(MOCK_PRESETS[0].id);

  const primaryLabel = workspace === 'inpaint' ? S.primaryFill : S.primaryGenerate;

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(prompt);
      return;
    }
    // TODO(client-state-architecture): dispatch generate/fill through the
    // editor state machine.
    // eslint-disable-next-line no-console
    console.log('TODO(client-state-architecture)');
  };

  const handleMic = () => {
    // TODO(client-state-architecture): toggle dictation session.
    // eslint-disable-next-line no-console
    console.log('TODO(client-state-architecture)');
  };

  const handleEnhance = () => {
    // TODO(client-state-architecture): call agent enhance-prompt skill.
    // eslint-disable-next-line no-console
    console.log('TODO(client-state-architecture)');
  };

  return (
    <View
      // Outer wrapper — centers the bar + extras row at the bottom of the
      // canvas. `left-1/2 -translate-x-1/2` keeps the 720pt-max group
      // horizontally centered without committing to a fixed width.
      className="absolute bottom-3 left-1/2 w-full max-w-[720px] -translate-x-1/2 px-3 gap-2"
      pointerEvents="box-none"
    >
      {/* ─── Row 1: the prompt bar itself (64pt) ─────────────────────── */}
      <View
        className="h-16 flex-row items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-4 py-3 shadow-sheet"
        accessibilityRole="toolbar"
      >
        {/* Mic — PEER with the keyboard. `size="default"` (40pt) so it
            shares the height ladder with Enhance + primary; the
            `bg-accent-muted` plate + `text-accent-default` icon makes the
            voice affordance visually equal-weight without competing for
            the single accent color the primary action owns. */}
        <Button
          variant="ghost"
          size="default"
          onPress={handleMic}
          accessibilityLabel={S.micA11yLabel}
          className="h-10 w-10 rounded-md bg-accent-muted px-0"
        >
          <Mic size={20} className="text-accent-default" />
        </Button>

        {/* Prompt input — flex-1, single visual row. We override the rnr
            Textarea's default `min-h-16 py-2` with a tighter `min-h-10
            py-1` so the field reads as one row inside the 64pt bar. */}
        <Textarea
          value={prompt}
          onChangeText={setPrompt}
          placeholder={S.inputPlaceholder}
          numberOfLines={1}
          accessibilityLabel={S.inputPlaceholder}
          className="flex-1 min-h-10 border-0 bg-transparent px-2 py-1 text-body shadow-none"
        />

        {/* Enhance — ghost variant, sparkles glyph + label. */}
        <Button
          variant="ghost"
          size="default"
          onPress={handleEnhance}
          accessibilityLabel={S.enhanceA11yLabel}
          className="h-10 px-3"
        >
          <Sparkles size={16} className="text-text-primary" />
          <Text className="text-body-strong text-text-primary">Enhance</Text>
        </Button>

        {/* Primary — single-accent CTA. Label switches per workspace. */}
        <Button
          variant="default"
          size="default"
          onPress={handleSubmit}
          accessibilityLabel={primaryLabel}
          className="h-10 bg-accent-default px-4"
        >
          <Text className="text-body-strong text-canvas">{primaryLabel}</Text>
        </Button>
      </View>

      {/* ─── Row 2: Strength slider ──────────────────────────────────── */}
      <View className="flex-row items-center gap-3 px-2">
        <Text className="text-caption text-text-secondary">
          {`${S.strengthLabel}: ${Math.round(strength)}${S.strengthValueSuffix}`}
        </Text>
        <View className="flex-1">
          <Slider
            value={strength}
            onValueChange={setStrength}
            min={0}
            max={100}
            step={1}
            accessibilityLabel={S.strengthLabel}
          />
        </View>
      </View>

      {/* ─── Row 3: Preset chips (horizontal scroll) ─────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, gap: 8 }}
        accessibilityLabel={S.presetsLabel}
      >
        {MOCK_PRESETS.map((preset) => {
          const isActive = activePreset === preset.id;
          return (
            <Badge
              key={preset.id}
              variant="outline"
              onTouchEnd={() => setActivePreset(preset.id)}
              accessibilityRole="button"
              accessibilityLabel={preset.name}
              accessibilityState={{ selected: isActive }}
              className={
                isActive
                  ? 'h-7 rounded-full border-transparent bg-accent-muted px-3 py-0'
                  : 'h-7 rounded-full border-border-subtle bg-surface px-3 py-0'
              }
            >
              <Text
                className={
                  isActive
                    ? 'text-caption-strong text-accent-default'
                    : 'text-caption text-text-secondary'
                }
              >
                {preset.name}
              </Text>
            </Badge>
          );
        })}
      </ScrollView>
    </View>
  );
}
BottomPromptBar.displayName = 'BottomPromptBar';
