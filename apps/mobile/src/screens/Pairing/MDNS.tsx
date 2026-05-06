// Implements 02-Pairing-mDNS from design-snapshot v1.0.0
//
// Default entry of the PairingFlow. Renders discovered servers from the
// MOCK_MDNS_DISCOVERED fixture as tappable Cards, plus a fixed row of
// alternative pairing actions (QR / Code / Manual) and a footer install
// hint. Real mDNS scan + pairing handshake land in pairing-protocol.

import { useRouter } from 'expo-router';
import { ChevronRight, HelpCircle, Wifi } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  Separator,
  tokens,
} from '@diffusecraft/ui';

import { MOCK_MDNS_DISCOVERED } from '../_mock/servers';
import { PAIRING_MDNS_STRINGS as S } from '../_strings/PairingMDNS';

export function PairingMDNSScreen() {
  const router = useRouter();

  const onTapServer = () => {
    console.log('TODO(pairing-protocol)');
  };

  const onHelp = () => {
    console.log('TODO(help-overlay)');
  };

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-10 pb-10"
      >
        {/* Header */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-text-primary text-display-md">
              {S.title}
            </Text>
            <Text className="text-text-secondary text-body mt-2">
              {S.subtitle}
            </Text>
          </View>
          <Pressable
            onPress={onHelp}
            accessibilityRole="button"
            accessibilityLabel={S.helpA11yLabel}
            className="h-10 w-10 items-center justify-center rounded-md border border-border-subtle bg-surface"
          >
            <HelpCircle size={18} color={tokens.colors.text.secondary} />
          </Pressable>
        </View>

        {/* Discovered servers section */}
        <View className="mt-8">
          <View className="flex-row items-center gap-2">
            <Wifi size={14} color={tokens.colors.text.secondary} />
            <Text className="text-text-secondary text-caption uppercase tracking-wide">
              {S.discoveredHeader}
            </Text>
          </View>

          <View className="mt-4 gap-3">
            {MOCK_MDNS_DISCOVERED.map((srv) => {
              const initial = srv.name.charAt(0).toUpperCase();
              return (
                <Pressable
                  key={srv.id}
                  onPress={onTapServer}
                  accessibilityRole="button"
                  accessibilityLabel={`${S.tapToPair}: ${srv.name}`}
                >
                  <Card className="flex-row items-center gap-4 rounded-lg border-border-subtle bg-surface px-4 py-4">
                    <Avatar alt={`${srv.name} avatar`} className="h-10 w-10 rounded-md bg-elevated">
                      <AvatarFallback className="rounded-md bg-elevated">
                        <Text className="text-text-primary text-body-strong">
                          {initial}
                        </Text>
                      </AvatarFallback>
                    </Avatar>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-text-primary text-body-strong">
                          {srv.name}
                        </Text>
                        {srv.paired ? (
                          <Text className="text-accent-default text-caption">
                            {S.pairedBadge}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-text-tertiary text-mono mt-1">
                        {srv.ip}:{srv.port}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={tokens.colors.text.tertiary} />
                  </Card>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Empty-state hint title (always visible per brief) */}
        <View className="mt-10 items-center">
          <View className="h-24 w-24 items-center justify-center rounded-xl border border-border-subtle bg-surface">
            <Wifi size={28} color={tokens.colors.text.tertiary} />
          </View>
          <Text className="text-text-primary text-body-strong mt-4">
            {S.emptyTitle}
          </Text>
        </View>

        {/* Alt action buttons (always visible) */}
        <View className="mt-6 gap-3">
          <Button
            variant="secondary"
            onPress={() => router.push('/pair/qr')}
            accessibilityLabel={S.emptyHelpQR}
          >
            <Text className="text-text-primary text-body-strong">
              {S.emptyHelpQR}
            </Text>
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.push('/pair/code')}
            accessibilityLabel={S.emptyHelpCode}
          >
            <Text className="text-text-primary text-body-strong">
              {S.emptyHelpCode}
            </Text>
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.push('/pair/manual')}
            accessibilityLabel={S.emptyHelpManual}
          >
            <Text className="text-text-primary text-body-strong">
              {S.emptyHelpManual}
            </Text>
          </Button>
        </View>

        <Separator className="mt-10 bg-border-subtle" />

        {/* Footer install hint */}
        <Text className="text-text-tertiary text-mono text-center mt-6">
          {S.footerHint}
        </Text>
      </ScrollView>
    </View>
  );
}
PairingMDNSScreen.displayName = 'PairingMDNSScreen';
