// DiffuseCraft design tokens — the single source of truth for the client UI.
//
// Values are mirrored from `apps/mobile/design-snapshot/tokens.json` (snapshot
// version 1.0.0, extracted from `untitled.pen` via the pencil MCP). When the
// .pen changes, re-run `pnpm snapshot:pen` and update both this file and
// `libs/ui/src/theme/tokens.ts` to keep the contract in sync.
//
// Color naming uses two parallel namespaces:
//   1. shadcn-style aliases (background, foreground, card, popover, primary,
//      secondary, muted, accent, destructive, border, input, ring) so
//      react-native-reusables components paste in unchanged.
//   2. DiffuseCraft domain names (canvas, surface, elevated, inset, accent-*,
//      semantic-*-muted, scrim, focus-ring) for app-specific surfaces.
//
// Both resolve to the same .pen tokens — pick whichever reads better at the
// call site. Per FR-2, no package may declare a private Tailwind config.

const path = require('path');

// Content paths use absolute paths so the config works whether NativeWind /
// PostCSS picks it up from the workspace root or from `apps/mobile/`. With
// relative paths Tailwind resolves them against the config-file location;
// when apps/mobile re-requires this file, relatives like './apps/mobile/...'
// silently resolve to `apps/mobile/apps/mobile/...` (non-existent) and the
// scanner finds zero JSX → zero classes → no styling.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'apps/mobile/app/**/*.{js,jsx,ts,tsx}'),
    path.join(__dirname, 'apps/mobile/src/**/*.{js,jsx,ts,tsx}'),
    path.join(__dirname, 'libs/ui/src/**/*.{js,jsx,ts,tsx}'),
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class', // future light theme via class swap; v1 is dark-only
  theme: {
    extend: {
      colors: {
        // ── shadcn-style aliases (rnr components consume these) ──────────
        background: '#08090B', // ↔ canvas
        foreground: '#F4F4F5', // ↔ text-primary

        card: '#111316', // ↔ surface
        'card-foreground': '#F4F4F5',

        popover: '#191B20', // ↔ elevated
        'popover-foreground': '#F4F4F5',

        primary: '#D6A33A', // ↔ accent (warm gold from .pen)
        'primary-foreground': '#08090B',

        secondary: '#111316', // surface-tone for secondary buttons
        'secondary-foreground': '#F4F4F5',

        muted: '#0C0D10', // ↔ inset
        'muted-foreground': '#969AA3', // ↔ text-secondary

        // shadcn's "accent" is the hover/active subtle bg; we map to elevated
        accent: '#191B20',
        'accent-foreground': '#F4F4F5',

        destructive: '#D94A4A', // ↔ danger
        'destructive-foreground': '#F4F4F5',

        border: '#242730', // ↔ border-subtle
        input: '#242730',
        ring: '#D6A33A', // ↔ accent (focus ring uses primary)

        // ── DiffuseCraft domain tokens ───────────────────────────────────
        canvas: '#08090B',
        surface: '#111316',
        elevated: '#191B20',
        inset: '#0C0D10',
        'border-subtle': '#242730',
        'border-strong': '#363B46',
        'text-primary': '#F4F4F5',
        'text-secondary': '#969AA3',
        'text-tertiary': '#656A73',

        'accent-default': '#D6A33A',
        'accent-hover': '#E2B653',
        'accent-muted': '#2E2616',

        danger: '#D94A4A',
        'danger-muted': '#3A1A1A',
        warn: '#C9892B',
        'warn-muted': '#3A2810',
        success: '#42A66A',
        'success-muted': '#14321B',
        info: '#3F8FBF',
        'info-muted': '#0F2C3F',

        scrim: 'rgba(0,0,0,0.6)',
        'focus-ring': 'rgba(214,163,58,0.4)', // accent at 40% alpha
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '9999px',
      },
      spacing: {
        0.5: '2px',
        1: '4px',
        1.5: '6px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
        14: '56px',
        18: '72px',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Text', '-apple-system', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-lg': ['32px', { lineHeight: '40px', fontWeight: '600' }],
        'display-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        title: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-strong': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        mono: ['13px', { lineHeight: '18px', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '400' }],
      },
      boxShadow: {
        sheet: '0 -8px 24px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};
