import React, { createContext, useContext, useMemo, useState } from 'react';

import { darkTheme } from './tokens';
import type { Theme, ThemeName } from './types';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  initialTheme?: ThemeName;
  children: React.ReactNode;
}

/**
 * ThemeProvider — mounts at the app root and provides typed token access.
 *
 * v1 only implements the `dark` theme. Setting `name === 'light'` falls back to
 * the dark theme with a dev-mode warning per design.md §5 / spec open question Q5.
 * Adding the light token set is explicitly out of scope for this spec (FR-14).
 */
export function ThemeProvider({ initialTheme = 'dark', children }: ThemeProviderProps) {
  const [name, setName] = useState<ThemeName>(initialTheme);

  const theme = useMemo<Theme>(() => {
    if (name === 'light') {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn(
          '[diffusecraft/ui] Light theme is not implemented in v1; falling back to dark. ' +
            'See spec design-system-foundation §5.',
        );
      }
      return darkTheme;
    }
    return darkTheme;
  }, [name]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme: setName }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * useTheme — read the current theme. Throws if used outside a ThemeProvider.
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx.theme;
}

/**
 * useSetTheme — switch theme by name. Throws if used outside a ThemeProvider.
 */
export function useSetTheme(): (name: ThemeName) => void {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useSetTheme must be used inside <ThemeProvider>');
  }
  return ctx.setTheme;
}
