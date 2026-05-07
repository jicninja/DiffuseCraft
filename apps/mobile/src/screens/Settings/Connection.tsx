// Settings — Connection (`06a-Settings-Connection`).
//
// Three sections:
//   1. Paired servers — Cards listing the live connection store's
//      `pairedBackends`, each with a MoreHorizontal DropdownMenu
//      (Rename / Revoke / Audit log).
//   2. Pairing — single primary CTA "Pair a new server" → /pair.
//   3. This device — editable device-name Input (persisted via
//      pairing-flow.ts) + read-only fingerprint with Copy affordance.
//
// Real persistence + token revocation + clipboard wiring live here now;
// the only TODO left is the audit-log deep link.

import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Copy, MoreHorizontal, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useConnectionStore } from '@diffusecraft/core';
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
  toast,
  tokens,
} from '@diffusecraft/ui';

import {
  getDeviceFingerprint,
  getDeviceName,
  setDeviceName as persistDeviceName,
} from '../../sdk/pairing-flow';
import { SETTINGS_CONNECTION_STRINGS as S } from '../_strings/SettingsConnection';

const FINGERPRINT_PLACEHOLDER = 'SHA256: …';

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
function formatLastSeen(iso: string | null): string {
  if (!iso) return 'never';
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  const day = String(Number(iso.slice(8, 10)));
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  return `${month} ${day}, ${hh}:${mm}`;
}

export function SettingsConnectionScreen() {
  const router = useRouter();
  const pairedBackends = useConnectionStore((s) => s.pairedBackends);
  const currentBackendId = useConnectionStore((s) => s.currentBackendId);
  const connectionStatus = useConnectionStore((s) => s.connectionStatus);
  const removeBackend = useConnectionStore((s) => s.removeBackend);
  const setCurrentBackend = useConnectionStore((s) => s.setCurrentBackend);

  const [deviceName, setDeviceNameLocal] = useState('');
  const [fingerprint, setFingerprint] = useState(FINGERPRINT_PLACEHOLDER);

  useEffect(() => {
    void getDeviceName().then(setDeviceNameLocal);
    void getDeviceFingerprint().then(setFingerprint);
  }, []);

  const onSaveDeviceName = (next: string) => {
    setDeviceNameLocal(next);
    void persistDeviceName(next);
  };

  const onMenuAction = async (serverId: string, action: string) => {
    if (action === 'revoke') {
      try {
        await removeBackend(serverId);
        if (currentBackendId === serverId) {
          setCurrentBackend(null);
        }
        toast.info('Server unpaired');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to revoke');
      }
      return;
    }
    if (action === 'audit') {
      router.push('/settings/audit');
      return;
    }
    if (action === 'rename') {
      // Rename UI is part of the design but the store does not yet
      // expose a per-backend rename action. Surface as info so the
      // affordance is honest about its current scope.
      toast.info('Rename is coming soon.');
      return;
    }
  };

  const onCopyFingerprint = async () => {
    try {
      await Clipboard.setStringAsync(fingerprint);
      toast.info(S.fingerprintCopiedToast);
    } catch {
      toast.error('Could not copy fingerprint');
    }
  };

  const isOnline = (id: string): boolean =>
    id === currentBackendId && connectionStatus === 'connected';

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

          {pairedBackends.length === 0 ? (
            <View className="mt-4 rounded-lg border border-border-subtle bg-surface px-4 py-6">
              <Text className="text-text-primary text-body-strong">
                {S.emptyPairedTitle}
              </Text>
              <Text className="text-text-tertiary text-caption mt-1">
                {S.emptyPairedDescription}
              </Text>
            </View>
          ) : (
            <View className="mt-4 gap-3">
              {pairedBackends.map((srv) => {
                const online = isOnline(srv.id);
                let host = srv.url;
                try {
                  host = new URL(srv.url).host;
                } catch {
                  /* fall through */
                }
                return (
                  <Card
                    key={srv.id}
                    className="flex-row items-center gap-4 rounded-lg border-border-subtle bg-surface px-4 py-4"
                  >
                    <View className="flex-1">
                      <Text className="text-text-primary text-body-strong">
                        {srv.name}
                      </Text>
                      <Text className="text-text-tertiary text-mono mt-1">
                        {host}
                      </Text>

                      <View className="flex-row items-center gap-3 mt-2">
                        <View className="flex-row items-center gap-1.5">
                          <View
                            className={
                              online
                                ? 'h-2 w-2 rounded-full bg-success'
                                : 'h-2 w-2 rounded-full bg-text-tertiary'
                            }
                          />
                          <Badge
                            variant={online ? 'secondary' : 'outline'}
                            className={
                              online
                                ? 'bg-success-muted border-transparent px-2 py-0.5'
                                : 'border-border-subtle px-2 py-0.5'
                            }
                          >
                            <Text
                              className={
                                online
                                  ? 'text-success text-caption'
                                  : 'text-text-tertiary text-caption'
                              }
                            >
                              {online
                                ? S.serverConnectedStatus
                                : S.serverDisconnectedStatus}
                            </Text>
                          </Badge>
                        </View>
                        <Text className="text-text-tertiary text-caption">
                          {S.serverLastActivityPrefix}: {formatLastSeen(srv.lastConnectedAt)}
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
                          onPress={() => void onMenuAction(srv.id, 'revoke')}
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
                );
              })}
            </View>
          )}
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
            <View className="gap-2">
              <Label className="text-text-secondary text-caption">
                {S.deviceNameLabel}
              </Label>
              <Input
                value={deviceName}
                onChangeText={onSaveDeviceName}
                placeholder={S.deviceNamePlaceholder}
                className="bg-inset border-border-subtle text-text-primary"
              />
              <Text className="text-text-tertiary text-caption">
                {S.deviceNameHelper}
              </Text>
            </View>

            <Separator className="bg-border-subtle" />

            <View className="gap-2">
              <Label className="text-text-secondary text-caption">
                {S.fingerprintLabel}
              </Label>
              <View className="flex-row items-center gap-2">
                <View className="flex-1 rounded-md border border-border-subtle bg-inset px-3 py-2">
                  <Text className="text-text-primary text-mono">
                    {fingerprint}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void onCopyFingerprint()}
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
