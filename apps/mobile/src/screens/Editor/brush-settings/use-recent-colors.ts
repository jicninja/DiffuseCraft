/**
 * Custom hook managing the recent colors list for the color picker panel.
 *
 * Maintains a session-scoped list of up to 10 recently used colors, ordered
 * most-recent-first. Colors are deduplicated case-insensitively (normalized
 * to uppercase). Not persisted across app restarts (design §D4).
 */

import { useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent colors to retain. */
const MAX_RECENT_COLORS = 10;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that tracks recently used colors in the color picker.
 *
 * @returns An object with:
 *   - `colors` — readonly array of hex strings (with `#` prefix), most-recent-first, max 10.
 *   - `pushColor` — adds a color to the front of the list, deduplicating and evicting as needed.
 */
export function useRecentColors(): {
  /** Recent colors, most-recent-first. Max 10. */
  colors: readonly string[];
  /** Push a color to the front of the list. Deduplicates and evicts oldest if > 10. */
  pushColor: (hex: string) => void;
} {
  const [colors, setColors] = useState<string[]>([]);

  const pushColor = useCallback((hex: string) => {
    setColors((prev) => {
      const normalized = hex.toUpperCase();

      // 1. Remove the color if already present (case-insensitive dedup)
      const filtered = prev.filter(
        (c) => c.toUpperCase() !== normalized,
      );

      // 2. Prepend to front
      const next = [normalized, ...filtered];

      // 3. Cap at MAX_RECENT_COLORS
      if (next.length > MAX_RECENT_COLORS) {
        return next.slice(0, MAX_RECENT_COLORS);
      }

      return next;
    });
  }, []);

  return { colors, pushColor };
}
