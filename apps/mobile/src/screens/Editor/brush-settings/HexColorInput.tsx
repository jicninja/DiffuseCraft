/**
 * HexColorInput — text input for entering hex color codes.
 *
 * Renders a non-editable `#` prefix as a `Text` sibling to the left of the
 * `Input` from `@diffusecraft/ui`. The component is controlled: `hex` prop
 * is the current value (without `#`), `onHexChange` fires when a valid hex
 * is committed (on blur or Enter).
 *
 * Validation uses `isValidHex` from `./color-utils`. Invalid input shows a
 * red border (`border-danger`) and retains the previous color. The internal
 * editing state is synced from the `hex` prop via `useEffect` so external
 * changes (disc drag, eyedropper, swatch tap) are reflected immediately.
 *
 * Design §3.6 · Requirements 6.1, 6.2, 6.3, 6.4.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NativeSyntheticEvent,
  Text,
  type TextInputSubmitEditingEventData,
  View,
} from 'react-native';

import { Input } from '@diffusecraft/ui';

import { isValidHex } from './color-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Border color for the error state — `danger.default` from theme tokens. */
const DANGER_BORDER_COLOR = '#D94A4A';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HexColorInputProps {
  /** Current hex value (without #). */
  hex: string;
  /** Callback when a valid hex is entered. */
  onHexChange: (hex: string) => void;
  /** Whether the input is in an error state (externally controlled). */
  error?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HexColorInput({ hex, onHexChange, error: externalError }: HexColorInputProps) {
  // Internal editing state — allows intermediate typing without committing.
  const [draft, setDraft] = useState(hex);
  const [internalError, setInternalError] = useState(false);

  // Track the last committed hex so we can revert on invalid blur.
  const lastCommittedHex = useRef(hex);

  // Sync internal state when the hex prop changes externally
  // (disc drag, eyedropper, swatch tap).
  useEffect(() => {
    setDraft(hex);
    lastCommittedHex.current = hex;
    setInternalError(false);
  }, [hex]);

  const showError = externalError || internalError;

  /**
   * Attempt to commit the current draft. If valid, fire `onHexChange` and
   * clear error state. If invalid, show the error border and keep the
   * previous color in the store.
   */
  const commitValue = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (isValidHex(trimmed)) {
        const normalized = trimmed.toUpperCase();
        onHexChange(normalized);
        lastCommittedHex.current = normalized;
        setDraft(normalized);
        setInternalError(false);
      } else {
        setInternalError(true);
      }
    },
    [onHexChange],
  );

  const handleBlur = useCallback(() => {
    commitValue(draft);
  }, [commitValue, draft]);

  const handleSubmitEditing = useCallback(
    (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      commitValue(e.nativeEvent.text);
    },
    [commitValue],
  );

  const handleChangeText = useCallback((text: string) => {
    setDraft(text);
    // Clear error as the user types — re-validated on commit.
    setInternalError(false);
  }, []);

  return (
    <View className="flex-row items-center gap-1">
      {/* Non-editable # prefix */}
      <Text className="text-text-secondary text-base font-medium">#</Text>

      <Input
        value={draft}
        onChangeText={handleChangeText}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmitEditing}
        maxLength={6}
        autoCapitalize="characters"
        keyboardType="ascii-capable"
        autoCorrect={false}
        style={showError ? { flex: 1, borderColor: DANGER_BORDER_COLOR } : { flex: 1 }}
        accessibilityLabel="Hex color code"
      />
    </View>
  );
}

HexColorInput.displayName = 'HexColorInput';
