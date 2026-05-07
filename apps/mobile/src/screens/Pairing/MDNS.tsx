// Pairing — mDNS (`02-Pairing-mDNS`).
//
// Default entry of the PairingFlow. Scans for `_diffusecraft._tcp.local`
// on the LAN via `react-native-zeroconf` and renders each resolved
// service as a tappable Card. Tapping a server POSTs `/pair` with
// `method: 'mdns'`; the server's host hook approves (or denies), then
// the result is persisted via the connection store and the user is
// routed back to the editor.

import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, HelpCircle, Wifi } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConnectionStore, type DiscoveredBackend } from '@diffusecraft/core';
import { PairingClient } from '@diffusecraft/diffusion-client';
import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  Separator,
  toast,
  tokens,
} from '@diffusecraft/ui';

import { completePairing, getDeviceName } from '../../sdk/pairing-flow';
import { useMdnsScan } from '../../sdk/zeroconf-mdns';
import { PAIRING_MDNS_STRINGS as S } from '../_strings/PairingMDNS';

export function PairingMDNSScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canGoBack = router.canGoBack();
  const pairBackend = useConnectionStore((s) => s.pairBackend);
  const setCurrentBackend = useConnectionStore((s) => s.setCurrentBackend);
  const pairedBackends = useConnectionStore((s) => s.pairedBackends);
  const discoveredBackends = useConnectionStore((s) => s.discoveredBackends);
  const { available: mdnsAvailable } = useMdnsScan();

  const [pairing, setPairing] = useState<string | null>(null);

  const onTapServer = async (backend: DiscoveredBackend) => {
    if (pairing) return;
    setPairing(backend.id);
    try {
      const url = `http://${backend.host}:${backend.port}`;
      const candidateName = await getDeviceName();
      const result = await new PairingClient({}).requestPair(
        { url },
        { method: 'mdns', candidate_name: candidateName },
      );
      await completePairing(
        { pairBackend, setCurrentBackend },
        'mdns',
        { url, token: result.token, serverName: result.server_name },
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairing(null);
    }
  };

  const onHelp = () => {
    toast.info('Help is coming soon.');
  };

  // The store records paired backends by id; mDNS yields a different id
  // (`<service>.<port>`), so we match on `host:port` substring of the
  // paired entry's `url` to surface the "Paired" badge.
  const isPaired = (backend: DiscoveredBackend): boolean => {
    const target = `${backend.host}:${backend.port}`;
    return pairedBackends.some((p) => p.url.includes(target));
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar — back chevron only when there is history (e.g.
          arrived from /servers via the FAB). When this screen is the
          root entry of /pair (no paired servers), the chevron is
          hidden but we still render the bar so the safe-area inset is
          honoured and the page lines up with QR/Code/Manual. */}
      <View style={{ paddingTop: insets.top }}>
        <View className="h-14 flex-row items-center px-4">
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon"
              onPress={() => router.back()}
              accessibilityLabel="Back"
            >
              <ChevronLeft size={20} color={tokens.colors.text.primary} />
            </Button>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-2 pb-10"
      >
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

        {/* Discovered servers */}
        <View className="mt-8">
          <View className="flex-row items-center gap-2">
            <Wifi size={14} color={tokens.colors.text.secondary} />
            <Text className="text-text-secondary text-caption uppercase tracking-wide">
              {S.discoveredHeader}
            </Text>
          </View>

          <View className="mt-4 gap-3">
            {discoveredBackends.map((srv) => {
              const initial = srv.name.charAt(0).toUpperCase();
              const paired = isPaired(srv);
              const isPairing = pairing === srv.id;
              return (
                <Pressable
                  key={srv.id}
                  onPress={() => onTapServer(srv)}
                  disabled={pairing !== null}
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
                        {paired ? (
                          <Text className="text-accent-default text-caption">
                            {S.pairedBadge}
                          </Text>
                        ) : null}
                        {isPairing ? (
                          <Text className="text-text-secondary text-caption">
                            Pairing…
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-text-tertiary text-mono mt-1">
                        {srv.host}:{srv.port}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={tokens.colors.text.tertiary} />
                  </Card>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Empty state */}
        {discoveredBackends.length === 0 ? (
          <View className="mt-10 items-center">
            <View className="h-24 w-24 items-center justify-center rounded-xl border border-border-subtle bg-surface">
              <Wifi size={28} color={tokens.colors.text.tertiary} />
            </View>
            <Text className="text-text-primary text-body-strong mt-4">
              {S.emptyTitle}
            </Text>
            {!mdnsAvailable ? (
              <Text className="text-text-tertiary text-caption mt-2 text-center">
                Discovery unavailable on this build. Use QR or Manual.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Alt action buttons */}
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

        <Text className="text-text-tertiary text-mono text-center mt-6">
          {S.footerHint}
        </Text>
      </ScrollView>
    </View>
  );
}
PairingMDNSScreen.displayName = 'PairingMDNSScreen';
