// Theme types — derived from the shape declared in `tokens.ts`.
// Per FR-6 / NFR-4 the return shape of `useTheme()` is exhaustively typed;
// adding a token to `tokens.ts` without updating these types must fail tsc.

export type ThemeName = 'dark' | 'light';

export type ColorToken =
  | 'bg.canvas'
  | 'bg.surface'
  | 'bg.elevated'
  | 'bg.inset'
  | 'border.subtle'
  | 'border.strong'
  | 'text.primary'
  | 'text.secondary'
  | 'text.tertiary'
  | 'accent.default'
  | 'accent.hover'
  | 'accent.muted'
  | 'danger.default'
  | 'danger.muted'
  | 'warn.default'
  | 'warn.muted'
  | 'success.default'
  | 'success.muted'
  | 'info.default'
  | 'info.muted'
  | 'scrim'
  | 'focus.ring';

export type RadiusToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'pill';

export type SpacingToken = 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 56 | 72;

export type TypeToken =
  | 'display.lg'
  | 'display.md'
  | 'title'
  | 'body'
  | 'body-strong'
  | 'mono'
  | 'caption';

export type ElevationToken = 'sheet';

export type FontWeight = '400' | '500' | '600';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  fontFamily: 'sans' | 'mono';
}

export interface ShadowStyle {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
}

export interface Theme {
  name: ThemeName;
  /** Snapshot version this theme was generated from. */
  snapshotVersion: string;
  color: Record<ColorToken, string>;
  radius: Record<RadiusToken, number>;
  spacing: Record<SpacingToken, number>;
  type: Record<TypeToken, TypeStyle>;
  elevation: Record<ElevationToken, ShadowStyle>;
}
