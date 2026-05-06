// Implements 06a-Settings-Connection (snapshot preview missing — built from brief). v1.0.0
//
// Settings detail rendered at `/settings/connection`. Three sections:
//   1. Paired servers — Cards listing MOCK_PAIRED_SERVERS, each with a
//      MoreHorizontal DropdownMenu (Rename / Revoke / Audit log).
//   2. Pairing — single primary CTA "Pair a new server" → /pair.
//   3. This device — editable device-name Input + read-only public-key
//      fingerprint with Copy affordance.
//
// Real persistence + token revocation + clipboard wiring land in
// pairing-protocol; this file only wires chrome.

import { useRouter } from 'expo-router';
import { ChevronLeft, Copy, MoreHorizontal, Wifi } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Separator,
  tokens,
} from '@diffusecraft/ui';

import { MOCK_PAIRED_SERVERS } from '../_mock/servers';
import { SETTINGS_CONNECTION_STRINGS as S } from '../_strings/SettingsConnection';

// Static fingerprint shown until pairing-protocol provides the real value.
const DEVICE_FINGERPRINT = 'SHA256:7ZqL 9N8u 4pVx aKw2 mR1d Yc6t Hn3s Bj0e';

// ISO → "May 3, 14:21" without Date.now / locales: deterministic, render-safe.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
function formatLastSeen(iso: string): string {
  // iso is `YYYY-MM-DDTHH:mm:ssZ` — index slicing avoids tz drift.
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  const day = String(Number(iso.slice(8, 10)));
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  return `${month} ${day}, ${hh}:${mm}`;
}

export function SettingsConnectionScreen() {
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('iPad de Igna');

  const onMenuAction = (_serverId: string, _action: string) => {
    // TODO(pairing-protocol): rename / revoke token / open audit log.
    console.log('TODO(pairing-protocol)');
  };

  const onCopyFingerprint = () => {
    // TODO(pairing-protocol): expo-clipboard + toast.
    console.log('TODO(pairing-protocol)');
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* Top bar */}
      <View className="flex-row items-center gap-3 border-b border-border-subtle bg-canvas px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={20} color={tokens.colors.text.primary} />
        </Button>
        <Text className="text-text-primary text-title">{S.sectionTitle}</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-6 pb-12"
      >
        <Text className="text-text-secondary text-body">{S.subtitle}</Text>

        {/* Section 1 — Paired servers */}
        <View className="mt-8">
          <View className="flex-row items-center gap-2">
            <Wifi size={14} color={tokens.colors.text.secondary} />
            <Text className="text-text-secondary text-caption uppercase tracking-wide">
              {S.pairedServersTitle}
            </Text>
          </View>
          <Text className="text-text-tertiary text-caption mt-1">
            {S.pairedServersDescription}
          </Text>

          <View className="mt-4 gap-3">
            {MOCK_PAIRED_SERVERS.map((srv) => (
              <Card
                key={srv.id}
                className="flex-row items-center gap-4 rounded-lg border-border-subtle bg-surface px-4 py-4"
              >
                <View className="flex-1">
                  <Text className="text-text-primary text-body-strong">
                    {srv.name}
                  </Text>
                  <Text className="text-text-tertiary text-mono mt-1">
                    {srv.ip}:{srv.port}
                  </Text>

                  <View className="flex-row items-center gap-3 mt-2">
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className={
                          srv.online
                            ? 'h-2 w-2 rounded-full bg-success'
                            : 'h-2 w-2 rounded-full bg-text-tertiary'
                        }
                      />
                      <Badge
                        variant={srv.online ? 'secondary' : 'outline'}
                        className={
                          srv.online
                            ? 'bg-success-muted border-transparent px-2 py-0.5'
                            : 'border-border-subtle px-2 py-0.5'
                        }
                      >
                        <Text
                          className={
                            srv.online
                              ? 'text-success text-caption'
                              : 'text-text-tertiary text-caption'
                          }
                        >
                          {srv.online
                            ? S.serverConnectedStatus
                            : S.serverDisconnectedStatus}
                        </Text>
                      </Badge>
                    </View>
                    <Text className="text-text-tertiary text-caption">
                      {S.serverLastActivityPrefix}: {formatLastSeen(srv.lastSeen)}
                    </Text>
                  </View>
                </View>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      accessibilityLabel={S.serverMenuA11yLabel}
                    >
                      <MoreHorizontal size={18} color={tokens.colors.text.secondary} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[12rem]">
                    <DropdownMenuItem
                      onPress={() => onMenuAction(srv.id, 'rename')}
                    >
                      <Text className="text-text-primary text-body">
                        {S.serverMenuRename}
                      </Text>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onPress={() => onMenuAction(srv.id, 'revoke')}
                      variant="destructive"
                    >
                      <Text className="text-danger text-body">
                        {S.serverMenuRevokeToken}
                      </Text>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onPress={() => onMenuAction(srv.id, 'audit')}
                    >
                      <Text className="text-text-primary text-body">
                        {S.serverMenuShowAuditLog}
                      </Text>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Card>
            ))}
          </View>
        </View>

        <Separator className="mt-8 bg-border-subtle" />

        {/* Section 2 — Pairing */}
        <View className="mt-8">
          <Text className="text-text-secondary text-caption uppercase tracking-wide">
            {S.pairingTitle}
          </Text>
          <Text className="text-text-tertiary text-caption mt-1">
            {S.pairingDescription}
          </Text>

          <View className="mt-4">
            <Button
              variant="default"
              className="bg-accent-default"
              onPress={() => router.push('/pair')}
              accessibilityLabel={S.pairNewA11yLabel}
            >
              <Text className="text-primary-foreground text-body-strong">
                {S.pairNewButton}
              </Text>
            </Button>
          </View>
        </View>

        <Separator className="mt-8 bg-border-subtle" />

        {/* Section 3 — This device */}
        <View className="mt-8">
          <Text className="text-text-secondary text-caption uppercase tracking-wide">
            {S.thisDeviceTitle}
          </Text>

          <Card className="mt-4 gap-5 rounded-lg border-border-subtle bg-surface px-4 py-5">
            {/* Device name */}
            <View className="gap-2">
              <Label className="text-text-secondary text-caption">
                {S.deviceNameLabel}
              </Label>
              <Input
                value={deviceName}
                onChangeText={setDeviceName}
                placeholder={S.deviceNamePlaceholder}
                className="bg-inset border-border-subtle text-text-primary"
              />
              <Text className="text-text-tertiary text-caption">
                {S.deviceNameHelper}
              </Text>
            </View>

            <Separator className="bg-border-subtle" />

            {/* Public key fingerprint */}
            <View className="gap-2">
              <Label className="text-text-secondary text-caption">
                {S.fingerprintLabel}
              </Label>
              <View className="flex-row items-center gap-2">
                <View className="flex-1 rounded-md border border-border-subtle bg-inset px-3 py-2">
                  <Text className="text-text-primary text-mono">
                    {DEVICE_FINGERPRINT}
                  </Text>
                </View>
                <Pressable
                  onPress={onCopyFingerprint}
                  accessibilityRole="button"
                  accessibilityLabel={S.fingerprintCopyA11yLabel}
                  className="h-10 w-10 items-center justify-center rounded-md border border-border-subtle bg-elevated"
                >
                  <Copy size={16} color={tokens.colors.text.primary} />
                </Pressable>
              </View>
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
SettingsConnectionScreen.displayName = 'SettingsConnectionScreen';
