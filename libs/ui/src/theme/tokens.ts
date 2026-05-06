// Tokens mirrored from apps/mobile/design-snapshot/tokens.json (snapshot v1.0.0).
// If the .pen changes, re-run `pnpm snapshot:pen` and update both this file
// and `tailwind.config.js` to keep the contract in sync.
//
// Per FR-2 / NFR-2 the workspace-root tailwind.config.js is the single source
// of truth for Tailwind class resolution; this TS module mirrors the same
// values for non-Tailwind code paths (Skia paint, Reanimated values, snapshot
// metadata, etc.).

import type { Theme } from './types';

export const tokens = {
  colors: {
    bg: {
      canvas: '#08090B',
      surface: '#111316',
      elevated: '#191B20',
      inset: '#0C0D10',
    },
    border: {
      subtle: '#242730',
      strong: '#363B46',
    },
    text: {
      primary: '#F4F4F5',
      secondary: '#969AA3',
      tertiary: '#656A73',
    },
    accent: {
      default: '#D6A33A',
      hover: '#E2B653',
      muted: '#2E2616',
    },
    danger: { default: '#D94A4A', muted: '#3A1A1A' },
    warn: { default: '#C9892B', muted: '#3A2810' },
    success: { default: '#42A66A', muted: '#14321B' },
    info: { default: '#3F8FBF', muted: '#0F2C3F' },
    scrim: 'rgba(0,0,0,0.6)',
    focusRing: 'rgba(214,163,58,0.4)', // accent at 40% alpha
  },
  radii: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 9999,
  },
  spacing: {
    2: 2,
    4: 4,
    6: 6,
    8: 8,
    12: 12,
    16: 16,
    20: 20,
    24: 24,
    32: 32,
    40: 40,
    56: 56,
    72: 72,
  },
  type: {
    'display-lg': { size: 32, line: 40, weight: '600' as const },
    'display-md': { size: 24, line: 32, weight: '600' as const },
    title: { size: 18, line: 24, weight: '600' as const },
    body: { size: 14, line: 20, weight: '400' as const },
    'body-strong': { size: 14, line: 20, weight: '500' as const },
    mono: { size: 13, line: 18, weight: '400' as const },
    caption: { size: 12, line: 16, weight: '400' as const },
  },
  fonts: {
    sans: 'Inter, SF Pro Text, -apple-system, sans-serif',
    mono: 'SF Mono, ui-monospace, Menlo, monospace',
  },
  elevation: {
    sheet: {
      offsetX: 0,
      offsetY: -8,
      blur: 24,
      color: 'rgba(0,0,0,0.4)',
    },
  },
} as const;

// `darkTheme` is the v1 implementation. Light theme is structurally supported
// (the type signature accepts a ThemeName) but only `dark` is implemented per
// FR-14.
export const darkTheme: Theme = {
  name: 'dark',
  snapshotVersion: '1.0.0',
  color: {
    'bg.canvas': tokens.colors.bg.canvas,
    'bg.surface': tokens.colors.bg.surface,
    'bg.elevated': tokens.colors.bg.elevated,
    'bg.inset': tokens.colors.bg.inset,
    'border.subtle': tokens.colors.border.subtle,
    'border.strong': tokens.colors.border.strong,
    'text.primary': tokens.colors.text.primary,
    'text.secondary': tokens.colors.text.secondary,
    'text.tertiary': tokens.colors.text.tertiary,
    'accent.default': tokens.colors.accent.default,
    'accent.hover': tokens.colors.accent.hover,
    'accent.muted': tokens.colors.accent.muted,
    'danger.default': tokens.colors.danger.default,
    'danger.muted': tokens.colors.danger.muted,
    'warn.default': tokens.colors.warn.default,
    'warn.muted': tokens.colors.warn.muted,
    'success.default': tokens.colors.success.default,
    'success.muted': tokens.colors.success.muted,
    'info.default': tokens.colors.info.default,
    'info.muted': tokens.colors.info.muted,
    scrim: tokens.colors.scrim,
    'focus.ring': tokens.colors.focusRing,
  },
  radius: {
    xs: tokens.radii.xs,
    sm: tokens.radii.sm,
    md: tokens.radii.md,
    lg: tokens.radii.lg,
    xl: tokens.radii.xl,
    pill: tokens.radii.pill,
  },
  spacing: {
    2: tokens.spacing[2],
    4: tokens.spacing[4],
    6: tokens.spacing[6],
    8: tokens.spacing[8],
    12: tokens.spacing[12],
    16: tokens.spacing[16],
    20: tokens.spacing[20],
    24: tokens.spacing[24],
    32: tokens.spacing[32],
    40: tokens.spacing[40],
    56: tokens.spacing[56],
    72: tokens.spacing[72],
  },
  type: {
    'display.lg': {
      fontSize: tokens.type['display-lg'].size,
      lineHeight: tokens.type['display-lg'].line,
      fontWeight: tokens.type['display-lg'].weight,
      fontFamily: 'sans',
    },
    'display.md': {
      fontSize: tokens.type['display-md'].size,
      lineHeight: tokens.type['display-md'].line,
      fontWeight: tokens.type['display-md'].weight,
      fontFamily: 'sans',
    },
    title: {
      fontSize: tokens.type.title.size,
      lineHeight: tokens.type.title.line,
      fontWeight: tokens.type.title.weight,
      fontFamily: 'sans',
    },
    body: {
      fontSize: tokens.type.body.size,
      lineHeight: tokens.type.body.line,
      fontWeight: tokens.type.body.weight,
      fontFamily: 'sans',
    },
    'body-strong': {
      fontSize: tokens.type['body-strong'].size,
      lineHeight: tokens.type['body-strong'].line,
      fontWeight: tokens.type['body-strong'].weight,
      fontFamily: 'sans',
    },
    mono: {
      fontSize: tokens.type.mono.size,
      lineHeight: tokens.type.mono.line,
      fontWeight: tokens.type.mono.weight,
      fontFamily: 'mono',
    },
    caption: {
      fontSize: tokens.type.caption.size,
      lineHeight: tokens.type.caption.line,
      fontWeight: tokens.type.caption.weight,
      fontFamily: 'sans',
    },
  },
  elevation: {
    sheet: tokens.elevation.sheet,
  },
};
