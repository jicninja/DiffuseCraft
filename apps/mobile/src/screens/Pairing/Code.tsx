// Pairing — Code (`02c-Pairing-Code`).
//
// Six digit boxes + on-screen 3x4 numeric keypad. When the 6th digit
// lands the screen iterates through every backend currently known to
// the connection store's `discoveredBackends` slot (populated in the
// background by the mDNS hook) and POSTs `/pair` with `method: 'code'`.
// The first backend whose `/pair` accepts the code wins; the rest are
// skipped. If no backend on the LAN matches the code, we surface the
// `wrongCodeMessage` and clear the digits so the user can retry.

import { useRouter } from 'expo-router';
import { ChevronLeft, Delete } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useConnectionStore } from '@diffusecraft/core';
import {
  PairingClient,
  PairingRejectedError,
} from '@diffusecraft/diffusion-client';
import { Button, Card, toast } from '@diffusecraft/ui';

import { completePairing, getDeviceName } from '../../sdk/pairing-flow';
import { useMdnsScan } from '../../sdk/zeroconf-mdns';
import { PAIRING_CODE_STRINGS as S } from '../_strings/PairingCode';

const CODE_LENGTH = 6;

type KeypadKey = number | 'del' | null;
const KEYPAD: ReadonlyArray<KeypadKey> = [
  1, 2, 3,
  4, 5, 6,
  7, 8, 9,
  null, 0, 'del',
];

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
  const pairBackend = useConnectionStore((s) => s.pairBackend);
  const setCurrentBackend = useConnectionStore((s) => s.setCurrentBackend);
  const discoveredBackends = useConnectionStore((s) => s.discoveredBackends);
  const { available: mdnsAvailable } = useMdnsScan();

  const [code, setCode] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const appendDigit = (digit: number) => {
    if (submitting) return;
    setCode((prev) => (prev.length >= CODE_LENGTH ? prev : prev + String(digit)));
  };

  const deleteLast = () => {
    if (submitting) return;
    setCode((prev) => prev.slice(0, -1));
  };

  // Auto-submit when the 6th digit lands.
  useEffect(() => {
    if (code.length !== CODE_LENGTH || submitting) return;

    let cancelled = false;
    void (async () => {
      setSubmitting(true);
      try {
        const candidates = discoveredBackends;
        if (candidates.length === 0) {
          toast.error(
            mdnsAvailable
              ? 'No servers found on the network. Try Manual instead.'
              : 'Discovery unavailable. Try Manual instead.',
          );
          setCode('');
          return;
        }

        const candidateName = await getDeviceName();
        const client = new PairingClient({});

        let lastError: unknown = null;
        for (const backend of candidates) {
          if (cancelled) return;
          const url = `http://${backend.host}:${backend.port}`;
          try {
            const result = await client.requestPair(
              { url },
              { method: 'code', code, candidate_name: candidateName },
            );
            if (cancelled) return;
            await completePairing(
              { pairBackend, setCurrentBackend },
              'code',
              { url, token: result.token, serverName: result.server_name },
            );
            return;
          } catch (err: unknown) {
            // Skip "wrong code for this server, try the next one" so a
            // tablet sitting on a LAN with two servers still pairs.
            if (
              err instanceof PairingRejectedError &&
              err.message.toLowerCase().includes('numeric code')
            ) {
              lastError = err;
              continue;
            }
            // Anything else (network error, server 5xx, JSON shape
            // mismatch) is a hard fail — surface and stop the loop.
            lastError = err;
            break;
          }
        }

        if (!cancelled) {
          const message =
            lastError instanceof Error ? lastError.message : S.wrongCodeMessage;
          toast.error(message);
          setCode('');
        }
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    code,
    submitting,
    discoveredBackends,
    mdnsAvailable,
    pairBackend,
    setCurrentBackend,
  ]);

  return (
    <View className="flex-1 bg-canvas">
      {/* Top bar */}
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

      {/* Body: title, digit row, keypad */}
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-display-md text-text-primary text-center">
          {S.title}
        </Text>

        <Card className="mt-8 w-full max-w-[480px] items-center px-6">
          <View className="flex-row items-center justify-center gap-3">
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <DigitBox key={i} char={code[i] ?? ''} index={i} />
            ))}
          </View>
        </Card>

        <View className="mt-8 w-full max-w-[360px]">
          <View className="flex-row flex-wrap">
            {KEYPAD.map((key, i) => {
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

      <View className="items-center pb-8">
        <Button variant="link" onPress={() => router.push('/pair/qr')}>
          <Text className="text-body text-text-primary">{S.altTryQR}</Text>
        </Button>
      </View>
    </View>
  );
}
PairingCodeScreen.displayName = 'PairingCodeScreen';
