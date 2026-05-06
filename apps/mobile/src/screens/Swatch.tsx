import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens, useTheme } from '@diffusecraft/ui';

// Swatch screen — visual smoke test for every token in the design system.
// Class names use the flat tailwind aliases declared in `tailwind.config.js`
// so the same names work across rnr-style components and DiffuseCraft chrome.

const COLOR_GROUPS: Array<{
  title: string;
  swatches: Array<{ name: string; hex: string; className: string }>;
}> = [
  {
    title: 'Background',
    swatches: [
      { name: 'canvas', hex: tokens.colors.bg.canvas, className: 'bg-canvas' },
      { name: 'surface', hex: tokens.colors.bg.surface, className: 'bg-surface' },
      { name: 'elevated', hex: tokens.colors.bg.elevated, className: 'bg-elevated' },
      { name: 'inset', hex: tokens.colors.bg.inset, className: 'bg-inset' },
    ],
  },
  {
    title: 'Border',
    swatches: [
      { name: 'border-subtle', hex: tokens.colors.border.subtle, className: 'bg-border-subtle' },
      { name: 'border-strong', hex: tokens.colors.border.strong, className: 'bg-border-strong' },
    ],
  },
  {
    title: 'Text (foreground)',
    swatches: [
      { name: 'text-primary', hex: tokens.colors.text.primary, className: 'bg-text-primary' },
      { name: 'text-secondary', hex: tokens.colors.text.secondary, className: 'bg-text-secondary' },
      { name: 'text-tertiary', hex: tokens.colors.text.tertiary, className: 'bg-text-tertiary' },
    ],
  },
  {
    title: 'Accent',
    swatches: [
      { name: 'accent-default', hex: tokens.colors.accent.default, className: 'bg-accent-default' },
      { name: 'accent-hover', hex: tokens.colors.accent.hover, className: 'bg-accent-hover' },
      { name: 'accent-muted', hex: tokens.colors.accent.muted, className: 'bg-accent-muted' },
    ],
  },
  {
    title: 'Semantic',
    swatches: [
      { name: 'danger', hex: tokens.colors.danger.default, className: 'bg-danger' },
      { name: 'danger-muted', hex: tokens.colors.danger.muted, className: 'bg-danger-muted' },
      { name: 'warn', hex: tokens.colors.warn.default, className: 'bg-warn' },
      { name: 'warn-muted', hex: tokens.colors.warn.muted, className: 'bg-warn-muted' },
      { name: 'success', hex: tokens.colors.success.default, className: 'bg-success' },
      { name: 'success-muted', hex: tokens.colors.success.muted, className: 'bg-success-muted' },
      { name: 'info', hex: tokens.colors.info.default, className: 'bg-info' },
      { name: 'info-muted', hex: tokens.colors.info.muted, className: 'bg-info-muted' },
    ],
  },
  {
    title: 'Overlay & focus',
    swatches: [
      { name: 'scrim', hex: tokens.colors.scrim, className: 'bg-scrim' },
      { name: 'focus-ring', hex: tokens.colors.focusRing, className: 'bg-focus-ring' },
    ],
  },
];

const RADII: Array<{ name: keyof typeof tokens.radii; className: string }> = [
  { name: 'xs', className: 'rounded-xs' },
  { name: 'sm', className: 'rounded-sm' },
  { name: 'md', className: 'rounded-md' },
  { name: 'lg', className: 'rounded-lg' },
  { name: 'xl', className: 'rounded-xl' },
  { name: 'pill', className: 'rounded-pill' },
];

const SPACING_KEYS: Array<keyof typeof tokens.spacing> = [
  2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72,
];

const TYPE_KEYS: Array<keyof typeof tokens.type> = [
  'display-lg',
  'display-md',
  'title',
  'body',
  'body-strong',
  'mono',
  'caption',
];

const TYPE_CLASS: Record<keyof typeof tokens.type, string> = {
  'display-lg': 'text-display-lg',
  'display-md': 'text-display-md',
  title: 'text-title',
  body: 'text-body',
  'body-strong': 'text-body-strong',
  mono: 'text-mono font-mono',
  caption: 'text-caption',
};

const SAMPLE_TEXT = 'DiffuseCraft is a tablet-first AI image editor.';

export function Swatch() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerStyle={{
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 96,
        paddingHorizontal: 24,
      }}
    >
      <Text className="text-display-lg text-text-primary mb-2">DiffuseCraft Tokens</Text>
      <Text className="text-body text-text-secondary mb-8">
        Snapshot v{theme.snapshotVersion} — dark theme. Read at runtime via useTheme() and styled
        via NativeWind classes.
      </Text>

      {/* COLORS */}
      <View className="mb-8">
        <Text className="text-display-md text-text-primary mb-3">Colors</Text>
        {COLOR_GROUPS.map((group) => (
          <View key={group.title} className="mb-4">
            <Text className="text-body-strong text-text-secondary mb-2">{group.title}</Text>
            <View className="flex-row flex-wrap gap-3">
              {group.swatches.map((s) => (
                <View key={s.name} className="w-32">
                  <View
                    className={`${s.className} h-16 rounded-md border border-border-subtle`}
                  />
                  <Text className="text-caption text-text-primary mt-1.5">{s.name}</Text>
                  <Text className="text-mono font-mono text-text-tertiary">{s.hex}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* RADII */}
      <View className="mb-8">
        <Text className="text-display-md text-text-primary mb-3">Radii</Text>
        <View className="flex-row flex-wrap gap-3">
          {RADII.map((r) => (
            <View key={r.name} className="w-20 items-center">
              <View
                className={`${r.className} h-16 w-16 bg-elevated border border-border-strong`}
              />
              <Text className="text-caption text-text-primary mt-1.5">{r.name}</Text>
              <Text className="text-mono font-mono text-text-tertiary">
                {tokens.radii[r.name]}px
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* SPACING */}
      <View className="mb-8">
        <Text className="text-display-md text-text-primary mb-3">Spacing</Text>
        <View className="bg-surface rounded-md p-4 border border-border-subtle">
          {SPACING_KEYS.map((key) => (
            <View key={String(key)} className="flex-row items-center mb-2">
              <Text className="text-mono font-mono text-text-tertiary w-12">{String(key)}px</Text>
              <View
                style={{ width: tokens.spacing[key], height: 12 }}
                className="bg-accent-default rounded-xs"
              />
            </View>
          ))}
        </View>
      </View>

      {/* TYPE */}
      <View className="mb-8">
        <Text className="text-display-md text-text-primary mb-3">Type</Text>
        <View className="bg-surface rounded-md p-4 border border-border-subtle">
          {TYPE_KEYS.map((key) => {
            const t = tokens.type[key];
            return (
              <View key={key} className="mb-3">
                <Text className="text-caption text-text-tertiary mb-1">
                  {key} · {t.size}/{t.line}px · {t.weight}
                </Text>
                <Text className={`${TYPE_CLASS[key]} text-text-primary`}>{SAMPLE_TEXT}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ELEVATION */}
      <View className="mb-8">
        <Text className="text-display-md text-text-primary mb-3">Elevation</Text>
        <Text className="text-body text-text-secondary mb-3">
          shadow/sheet — used by bottom sheets entering from below.
        </Text>
        <View
          className="bg-elevated rounded-lg p-6 border border-border-subtle"
          style={{
            shadowColor: tokens.colors.bg.canvas,
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.4,
            shadowRadius: 24,
            elevation: 12,
          }}
        >
          <Text className="text-title text-text-primary">Sheet preview</Text>
          <Text className="text-body text-text-secondary mt-1">0 -8 24 rgba(0,0,0,0.4)</Text>
        </View>
      </View>
    </ScrollView>
  );
}
