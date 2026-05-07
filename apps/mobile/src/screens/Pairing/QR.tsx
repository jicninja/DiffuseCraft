// Pairing — QR (`02b-Pairing-QR`).
//
// Live camera viewfinder backed by `expo-camera`'s `CameraView`. The first
// QR detected is decoded with the SDK's `PairingClient.parseQr`; on
// success the backend is persisted via `pairBackend` and the user is
// routed back to `/`. The corner brackets switch from `text-text-primary`
// (idle) to `accent-default` (decoding) for a moment of feedback.
//
// Permission states:
//   - undetermined → shows a "Enable camera" CTA that triggers the OS
//     permission prompt.
//   - denied → same CTA + a hint to open Settings (we don't try to deep-
//     link there; expo-camera exposes no direct "open Settings" helper
//     and the iOS path is gated behind `Linking.openSettings`).
//   - granted → CameraView fills the cutout area.

import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { useConnectionStore } from '@diffusecraft/core';
import { PairingClient } from '@diffusecraft/diffusion-client';
import { Button, toast } from '@diffusecraft/ui';

import { completePairing } from '../../sdk/pairing-flow';
import { PAIRING_QR_STRINGS as S } from '../_strings/PairingQR';

const CUTOUT_SIZE = 512;
const HALF_CUTOUT = CUTOUT_SIZE / 2;

type CornerVariant = 'tl' | 'tr' | 'bl' | 'br';

const CORNER_BORDER_CLASS: Record<CornerVariant, string> = {
  tl: 'border-t-2 border-l-2',
  tr: 'border-t-2 border-r-2',
  bl: 'border-b-2 border-l-2',
  br: 'border-b-2 border-r-2',
};

const CORNER_POSITION_CLASS: Record<CornerVariant, string> = {
  tl: 'top-0 left-0',
  tr: 'top-0 right-0',
  bl: 'bottom-0 left-0',
  br: 'bottom-0 right-0',
};

function CornerBracket({ variant, accent }: { variant: CornerVariant; accent: boolean }) {
  const colorClass = accent
    ? 'border-accent-default'
    : 'border-text-text-primary opacity-60';
  return (
    <View
      className={`absolute h-6 w-6 ${colorClass} ${CORNER_BORDER_CLASS[variant]} ${CORNER_POSITION_CLASS[variant]}`}
    />
  );
}

export function PairingQRScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const pairBackend = useConnectionStore((s) => s.pairBackend);
  const setCurrentBackend = useConnectionStore((s) => s.setCurrentBackend);

  const [decoding, setDecoding] = useState(false);
  // We keep the gate in a ref so the camera callback (which fires on the
  // JS thread but can be invoked many times before React re-renders) can
  // short-circuit immediately without waiting for state to flush.
  const handledRef = useRef(false);

  const onBarcode = useCallback(
    async (event: { data?: string; type?: string }) => {
      if (handledRef.current) return;
      const data = event.data;
      if (!data || typeof data !== 'string' || data.length === 0) return;
      handledRef.current = true;
      setDecoding(true);
      try {
        const payload = new PairingClient({}).parseQr(data);
        await completePairing(
          { pairBackend, setCurrentBackend },
          'qr',
          {
            url: payload.url,
            token: payload.token,
            serverName: payload.server_name,
            tokenId: payload.token_id,
          },
        );
      } catch (err: unknown) {
        // Reset so the camera can pick up another (valid) code.
        handledRef.current = false;
        setDecoding(false);
        toast.error(err instanceof Error ? err.message : 'Invalid QR');
      }
    },
    [pairBackend, setCurrentBackend],
  );

  const dimRectClass = 'absolute bg-canvas/[0.76]';

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar */}
      <View className="h-14 flex-row items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          accessibilityLabel={S.backA11yLabel}
        >
          <ChevronLeft size={20} className="text-text-primary" />
        </Button>
        <Text className="text-title text-text-primary" numberOfLines={1}>
          {S.title}
        </Text>
      </View>

      {/* Viewfinder body */}
      <View className="relative flex-1 bg-inset">
        {/* Live camera fills the entire frame; dim rectangles + brackets
            sit on top so the user sees a square "scan area" cut into the
            viewfinder. We only mount CameraView when permission is
            granted, otherwise the OS will throw on iOS. */}
        {permission?.granted ? (
          <CameraView
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handledRef.current ? undefined : onBarcode}
          />
        ) : null}

        {/* Top dim rectangle */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} left-0 right-0 top-0`}
          style={{ bottom: '50%', marginBottom: HALF_CUTOUT }}
        />
        {/* Bottom dim rectangle */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} bottom-0 left-0 right-0`}
          style={{ top: '50%', marginTop: HALF_CUTOUT }}
        />
        {/* Left dim rectangle */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} left-0`}
          style={{
            top: '50%',
            marginTop: -HALF_CUTOUT,
            height: CUTOUT_SIZE,
            right: '50%',
            marginRight: HALF_CUTOUT,
          }}
        />
        {/* Right dim rectangle */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} right-0`}
          style={{
            top: '50%',
            marginTop: -HALF_CUTOUT,
            height: CUTOUT_SIZE,
            left: '50%',
            marginLeft: HALF_CUTOUT,
          }}
        />

        {/* Cutout brackets */}
        <View
          pointerEvents="none"
          className="absolute"
          style={{
            top: '50%',
            left: '50%',
            marginTop: -HALF_CUTOUT,
            marginLeft: -HALF_CUTOUT,
            width: CUTOUT_SIZE,
            height: CUTOUT_SIZE,
          }}
        >
          <CornerBracket variant="tl" accent={decoding} />
          <CornerBracket variant="tr" accent={decoding} />
          <CornerBracket variant="bl" accent={decoding} />
          <CornerBracket variant="br" accent={decoding} />
        </View>

        {/* Permission gate overlay */}
        {!permission?.granted ? (
          <View className="absolute inset-0 items-center justify-center px-8">
            <Text className="text-text-primary text-body-strong text-center">
              {permission && !permission.canAskAgain
                ? 'Enable camera access in Settings to scan QR codes.'
                : 'DiffuseCraft needs camera access to scan the pairing QR.'}
            </Text>
            <View className="mt-4 flex-row gap-3">
              <Button
                variant="default"
                onPress={() => {
                  if (permission && !permission.canAskAgain) {
                    Linking.openSettings();
                  } else {
                    void requestPermission();
                  }
                }}
              >
                <Text className="text-primary-foreground text-body-strong">
                  {permission && !permission.canAskAgain
                    ? 'Open Settings'
                    : 'Enable camera'}
                </Text>
              </Button>
            </View>
          </View>
        ) : null}
      </View>

      {/* Helper text under the viewfinder */}
      <View className="items-center px-4 pb-6 pt-4">
        <Text className="text-body text-text-secondary">
          {decoding ? S.helperDetecting : S.helper}
        </Text>
      </View>

      {/* Bottom row: alt links */}
      <View className="flex-row items-center justify-center gap-3 pb-8">
        <Button variant="ghost" onPress={() => router.push('/pair/code')}>
          <Text className="text-body text-text-primary">{S.altUseCode}</Text>
        </Button>
        <Button variant="ghost" onPress={() => router.push('/pair/manual')}>
          <Text className="text-body text-text-primary">{S.altPasteURL}</Text>
        </Button>
      </View>
    </View>
  );
}
PairingQRScreen.displayName = 'PairingQRScreen';
