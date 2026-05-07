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

import { useDiffusionClient } from '@diffusecraft/core';
import { Badge, Button, Slider, Textarea, toast } from '@diffusecraft/ui';

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
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  // SDK client wired by `<StoresProvider client={...}>`. Null until the
  // user has paired with a server (the pairing screen lands separately —
  // until then, the Generate button shows a friendly "connect first"
  // toast and bails out without calling the SDK).
  const client = useDiffusionClient();

  const primaryLabel = workspace === 'inpaint' ? S.primaryFill : S.primaryGenerate;

  const handleSubmit = async () => {
    if (onSubmit) {
      onSubmit(prompt);
      return;
    }
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      // Empty prompt — silently ignore. The catalog requires `prompt:
      // .min(1)`, so calling the SDK here would throw a validation
      // error instead of giving the user actionable feedback.
      return;
    }
    if (!client) {
      toast.warn('Connect to a server to generate.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      // Snake_case catalog name (the SDK's `invokeTool` is the wire-shape
      // entry point). Job progress + completion arrive via the EventBus
      // → `editorStore` / `jobsStore` once the provider's
      // `client.events.subscribe(...)` wiring fires; this call site only
      // owns the request kickoff + the optimistic "Generating…" toast.
      await client.invokeTool('generate_image', {
        prompt: trimmed,
        strength,
        batch_size: 1,
        seed: 'random' as const,
      });
      toast.info('Generating…');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Generate failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
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
    // Outer wrapper — stretches the full width at the bottom and centers
    // an inner column capped at 720pt. The earlier `left-1/2
    // -translate-x-1/2` pattern relied on RN's percentage-transform
    // support, which fails on iOS New Architecture (Fabric) — the bar
    // collapsed off-screen and never reached pixels. `left-0 right-0` +
    // `items-center` is the bulletproof RN equivalent and matches the
    // anchor-offset pattern the other floating chrome (TopBar /
    // LeftToolRail / RightPanel) already uses.
    <View
      className="absolute bottom-3 left-0 right-0 items-center px-3"
      pointerEvents="box-none"
    >
     <View className="w-full max-w-[720px] gap-2">
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

        {/* Primary — single-accent CTA. Label switches per workspace.
            Disabled while a generate request is in flight to prevent
            duplicate kickoffs (the SDK forwards the call to the
            transport synchronously; a double-tap would queue two
            separate jobs). */}
        <Button
          variant="default"
          size="default"
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
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
    </View>
  );
}
BottomPromptBar.displayName = 'BottomPromptBar';
