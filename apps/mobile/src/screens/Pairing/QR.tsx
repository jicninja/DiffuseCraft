// Implements 02b-Pairing-QR from design-snapshot v1.0.0
//
// Full-screen camera viewfinder mock. No real camera scan — that lands in
// pairing-protocol. Static "idle" state: brackets render in `text-text-primary`
// at 60% opacity. The "detecting" state (brackets in `accent-default`) is
// declared in PAIRING_QR_STRINGS but not simulated here.

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Text, View } from 'react-native';

import { Button } from '@diffusecraft/ui';

import { PAIRING_QR_STRINGS as S } from '../_strings/PairingQR';

const CUTOUT_SIZE = 512;
const HALF_CUTOUT = CUTOUT_SIZE / 2;

// 24×24 corner with two borders. Each corner picks the two edges that face
// inward toward the cutout so the four together read as brackets.
//
// Color: `border-text-text-primary` at 60% opacity. Swap `border-text-text-primary`
// for `border-accent-default` and drop `opacity-60` to render the "detecting"
// state when wired up later.
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

function CornerBracket({ variant }: { variant: CornerVariant }) {
  return (
    <View
      className={`absolute h-6 w-6 border-text-text-primary opacity-60 ${CORNER_BORDER_CLASS[variant]} ${CORNER_POSITION_CLASS[variant]}`}
    />
  );
}

export function PairingQRScreen() {
  const router = useRouter();

  // RN supports percentage strings for top/left/right/bottom and width/height.
  // Combining `top: '50%'` with `marginTop: -HALF_CUTOUT` is the canonical
  // RN pattern for absolute centering relative to the parent.
  const dimRectClass = 'absolute bg-canvas/[0.76]';

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar: 56pt (h-14). Back chevron + title. */}
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

      {/* Viewfinder body: `bg-inset` fills the area. The square cutout sits
          absolutely centered. Four `bg-canvas/0.76` rectangles dim everything
          outside the cutout. Brackets render last so they sit on top. */}
      <View className="relative flex-1 bg-inset">
        {/* Top dim rectangle: from frame top down to cutout top edge. */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} left-0 right-0 top-0`}
          style={{ bottom: '50%', marginBottom: HALF_CUTOUT }}
        />
        {/* Bottom dim rectangle: from cutout bottom edge to frame bottom. */}
        <View
          pointerEvents="none"
          className={`${dimRectClass} bottom-0 left-0 right-0`}
          style={{ top: '50%', marginTop: HALF_CUTOUT }}
        />
        {/* Left dim rectangle: spans the cutout's vertical band. */}
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
        {/* Right dim rectangle: spans the cutout's vertical band. */}
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

        {/* Cutout wrapper: 512×512, absolutely centered. Holds the 4 corner
            brackets. No background — the underlying `bg-inset` shows through
            and reads as the (mock) camera viewfinder. */}
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
          <CornerBracket variant="tl" />
          <CornerBracket variant="tr" />
          <CornerBracket variant="bl" />
          <CornerBracket variant="br" />
        </View>
      </View>

      {/* Helper text under the viewfinder. */}
      <View className="items-center px-4 pb-6 pt-4">
        <Text className="text-body text-text-secondary">{S.helper}</Text>
      </View>

      {/* Bottom row: alt links as ghost buttons. */}
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
