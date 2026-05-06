// Implements 02c-Pairing-Code from design-snapshot v1.0.0
//
// Full-screen numeric pairing. Six digit boxes + on-screen 3x4 numeric keypad.
// Local-only state: a 0-6 char string of entered digits. Real handshake (and
// the wrong-attempt shake state declared in PAIRING_CODE_STRINGS) lands in
// pairing-protocol — we do not simulate it here.

import { useRouter } from 'expo-router';
import { ChevronLeft, Delete } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card } from '@diffusecraft/ui';

import { PAIRING_CODE_STRINGS as S } from '../_strings/PairingCode';

const CODE_LENGTH = 6;

// 3x4 keypad layout. `null` is the empty bottom-left slot. `'del'` is the
// backspace key (rendered with a lucide Delete icon instead of a digit).
type KeypadKey = number | 'del' | null;
const KEYPAD: ReadonlyArray<KeypadKey> = [
  1, 2, 3,
  4, 5, 6,
  7, 8, 9,
  null, 0, 'del',
];

// Single digit cell. Renders the entered character (or empty) inside an
// `lg`-rounded `bg-inset` box with a `border-border-subtle` border.
// 56x64pt per the brief.
function DigitBox({ char, index }: { char: string; index: number }) {
  return (
    <View
      accessibilityLabel={`${S.digitA11yLabel} ${index + 1}`}
      className="h-16 w-14 items-center justify-center rounded-lg border border-border-subtle bg-inset"
    >
      <Text className="text-display-md text-text-primary">{char}</Text>
    </View>
  );
}

export function PairingCodeScreen() {
  const router = useRouter();
  const [code, setCode] = useState<string>('');

  const appendDigit = (digit: number) => {
    setCode((prev) => (prev.length >= CODE_LENGTH ? prev : prev + String(digit)));
  };

  const deleteLast = () => {
    setCode((prev) => prev.slice(0, -1));
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* Top bar: 56pt back-chevron row. */}
      <View className="h-14 flex-row items-center px-4">
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          accessibilityLabel={S.backA11yLabel}
        >
          <ChevronLeft size={20} className="text-text-primary" />
        </Button>
      </View>

      {/* Body: title, digit row, keypad. Centered column with breathing room. */}
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-display-md text-text-primary text-center">
          {S.title}
        </Text>

        {/* Six digit boxes — wrapped in a Card to group the entry surface. */}
        <Card className="mt-8 w-full max-w-[480px] items-center px-6">
          <View className="flex-row items-center justify-center gap-3">
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <DigitBox key={i} char={code[i] ?? ''} index={i} />
            ))}
          </View>
        </Card>

        {/* On-screen numeric keypad: 3 columns x 4 rows. Each key >=56pt tall. */}
        <View className="mt-8 w-full max-w-[360px]">
          <View className="flex-row flex-wrap">
            {KEYPAD.map((key, i) => {
              // Empty slot: a non-pressable spacer that preserves the grid.
              if (key === null) {
                return <View key={`empty-${i}`} className="h-14 w-1/3 p-1.5" />;
              }
              const isDelete = key === 'del';
              return (
                <View key={isDelete ? 'del' : `n-${key}`} className="w-1/3 p-1.5">
                  <Pressable
                    onPress={() => (isDelete ? deleteLast() : appendDigit(key as number))}
                    accessibilityLabel={isDelete ? S.keypadDeleteA11yLabel : `${key}`}
                    className="h-14 items-center justify-center rounded-lg bg-inset active:bg-elevated"
                  >
                    {isDelete ? (
                      <Delete size={24} className="text-text-primary" />
                    ) : (
                      <Text className="text-display-md text-text-primary">{key}</Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* Bottom secondary cross-link. */}
      <View className="items-center pb-8">
        <Button variant="link" onPress={() => router.push('/pair/qr')}>
          <Text className="text-body text-text-primary">{S.altTryQR}</Text>
        </Button>
      </View>
    </View>
  );
}
PairingCodeScreen.displayName = 'PairingCodeScreen';
