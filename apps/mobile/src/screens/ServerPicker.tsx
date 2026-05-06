// Implements 03-ServerPicker from design-snapshot v1.0.0
//
// Initial entry of RootStack when the operator has paired 2+ servers and
// none is active. Renders MOCK_PAIRED_SERVERS as a vertical list of Cards
// with avatar / name / last-connected / online-dot / capability chips.
// Tap a card → console.log('TODO(client-state-architecture)') + push to
// /documents. Long-press → DropdownMenu (Rename / Revoke token / Show
// audit log). Top-right cog → /settings. Bottom-right FAB → /pair.
//
// Real connection switching, rename, revoke, and audit log surfaces land
// in client-state-architecture / pairing-protocol; this screen is chrome
// over the deterministic _mock/ fixture per NFR-4.

import { useRouter } from 'expo-router';
import {
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Server,
  Settings,
  ShieldOff,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

type DropdownTriggerHandle = { open: () => void; close: () => void };

import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  tokens,
} from '@diffusecraft/ui';

import { MOCK_PAIRED_SERVERS } from './_mock/servers';
import { SERVER_PICKER_STRINGS as S } from './_strings/ServerPicker';

type PairedServer = (typeof MOCK_PAIRED_SERVERS)[number];

// TODO(intl): replace with real relative-time formatter (date-fns or Intl.RelativeTimeFormat)
// once i18n lands. For now we render a tiny deterministic helper that handles
// the common buckets shown in the design ("14 min ago", "1 h ago", "yesterday
// 18:20", "Apr 27"). Reference instant matches the latest fixture timestamp
// (NFR-4: no Date.now()).
const NOW_ISO = '2026-05-03T18:35:00Z';

function formatLastSeen(iso: string): string {
  const now = new Date(NOW_ISO).getTime();
  const then = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((now - then) / 60_000));
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h ago`;
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (diffH < 48) return `yesterday ${hh}:${mm}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function ServerPickerScreen() {
  const router = useRouter();

  // One DropdownMenuTrigger ref per server card. Long-press on the card
  // calls `.open()` on the trigger so the menu anchors to the ⋯ button
  // (the rn-primitives Root is uncontrolled w.r.t. `open` — only the
  // Trigger ref exposes imperative open/close).
  const triggerRefs = React.useRef<Record<string, DropdownTriggerHandle | null>>({});

  const onlineCount = MOCK_PAIRED_SERVERS.filter((s) => s.online).length;
  const totalCount = MOCK_PAIRED_SERVERS.length;

  const onConnect = (srv: PairedServer) => {
    console.log('TODO(client-state-architecture)');
    void srv;
    router.push('/documents');
  };

  const onLongPress = (id: string) => {
    triggerRefs.current[id]?.open();
  };

  const onMenuAction = (action: 'rename' | 'revoke' | 'audit', srv: PairedServer) => {
    console.log('TODO(client-state-architecture)');
    void action;
    void srv;
  };

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-10 pb-32"
      >
        {/* Header */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-4">
            <View className="flex-row items-center gap-2">
              <Server size={12} color={tokens.colors.text.tertiary} />
              <Text className="text-text-tertiary text-caption uppercase tracking-wide">
                Paired ComfyUI studios
              </Text>
            </View>
            <Text className="text-text-primary text-display-md mt-2">
              {S.title}
            </Text>
            <Text className="text-text-secondary text-body mt-1">
              {S.subtitle}
            </Text>
          </View>

          <View className="flex-row items-center gap-3">
            {/* Online / paired stat pill */}
            <View className="flex-row items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 h-10">
              <View className="h-2 w-2 rounded-full bg-success" />
              <Text className="text-text-secondary text-caption uppercase tracking-wide">
                {onlineCount} online / {totalCount} paired
              </Text>
            </View>

            {/* Settings cog */}
            <Button
              variant="outline"
              size="icon"
              onPress={() => router.push('/settings')}
              accessibilityLabel={S.settingsA11yLabel}
              className="border-border-subtle bg-surface"
            >
              <Settings size={18} color={tokens.colors.text.secondary} />
            </Button>
          </View>
        </View>

        <Separator className="mt-6 bg-border-subtle" />

        {/* Server list */}
        <View className="mt-6 gap-3">
          {MOCK_PAIRED_SERVERS.map((srv) => {
            const initial = srv.name.charAt(0).toUpperCase();
            const lastSeen = formatLastSeen(srv.lastSeen);
            const dotClass = srv.online ? 'bg-success' : 'bg-text-tertiary';
            const statusLabel = srv.online ? S.online : S.offline;
            const statusClass = srv.online ? 'text-success' : 'text-text-tertiary';

            return (
              <Pressable
                key={srv.id}
                onPress={() => onConnect(srv)}
                onLongPress={() => onLongPress(srv.id)}
                delayLongPress={400}
                accessibilityRole="button"
                accessibilityLabel={`${S.tapToConnect}: ${srv.name}`}
              >
                <Card className="flex-row items-center gap-4 rounded-lg border-border-subtle bg-surface px-4 py-4">
                  {/* Avatar */}
                  <Avatar
                    alt={`${srv.name} avatar`}
                    className="h-12 w-12 rounded-md bg-elevated"
                  >
                    <AvatarFallback className="rounded-md bg-elevated">
                      <Text className="text-text-primary text-title">
                        {initial}
                      </Text>
                    </AvatarFallback>
                  </Avatar>

                  {/* Name + meta */}
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-text-primary text-title">
                        {srv.name}
                      </Text>
                      <View className={`h-2 w-2 rounded-full ${dotClass}`} />
                      <Text
                        className={`${statusClass} text-caption uppercase tracking-wide`}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                    <Text className="text-text-tertiary text-caption mt-1">
                      {S.lastConnectedPrefix} {lastSeen}
                    </Text>

                    {/* Capability chips */}
                    <View className="flex-row gap-2 mt-2">
                      {srv.capabilities.comfyui ? (
                        <Badge
                          variant="outline"
                          className="rounded-md border-border-subtle bg-inset px-2 py-0.5"
                        >
                          <Text className="text-text-secondary text-caption">
                            {S.capabilityComfyUI} ✓
                          </Text>
                        </Badge>
                      ) : null}
                      <Badge
                        variant="outline"
                        className="rounded-md border-border-subtle bg-inset px-2 py-0.5"
                      >
                        <Text className="text-text-secondary text-caption">
                          {S.capabilityModelsPrefix}: {srv.capabilities.models}
                        </Text>
                      </Badge>
                    </View>
                  </View>

                  {/* Right-side actions: Connect + ⋯ menu */}
                  <View className="flex-row items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => onConnect(srv)}
                      accessibilityLabel={`${S.tapToConnect}: ${srv.name}`}
                      className="border-border-subtle bg-elevated"
                    >
                      <Text className="text-text-primary text-body-strong">
                        Connect
                      </Text>
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        ref={(r) => {
                          triggerRefs.current[srv.id] = r as DropdownTriggerHandle | null;
                        }}
                        asChild
                      >
                        <Button
                          variant="outline"
                          size="icon"
                          accessibilityLabel={`More actions for ${srv.name}`}
                          className="border-border-subtle bg-elevated"
                        >
                          <MoreHorizontal size={18} color={tokens.colors.text.secondary} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-[200px] bg-elevated border-border-subtle"
                      >
                        <DropdownMenuItem onPress={() => onMenuAction('rename', srv)}>
                          <Pencil size={14} color={tokens.colors.text.primary} />
                          <Text className="text-text-primary text-body ml-1">
                            {S.contextRename}
                          </Text>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onPress={() => onMenuAction('revoke', srv)}
                        >
                          <ShieldOff size={14} color={tokens.colors.danger.default} />
                          <Text className="text-danger text-body ml-1">
                            {S.contextRevokeToken}
                          </Text>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onPress={() => onMenuAction('audit', srv)}>
                          <FileText size={14} color={tokens.colors.text.primary} />
                          <Text className="text-text-primary text-body ml-1">
                            {S.contextShowAuditLog}
                          </Text>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* FAB-style "+ Pair new" — bottom-right */}
      <View className="absolute bottom-6 right-6">
        <Button
          onPress={() => router.push('/pair')}
          accessibilityLabel={S.pairNewA11yLabel}
          className="rounded-pill bg-accent-default p-4 h-14 px-6 flex-row items-center gap-2 shadow-sm shadow-black/20"
        >
          <Plus size={18} color={tokens.colors.bg.canvas} />
          <Text className="text-primary-foreground text-body-strong">
            {S.pairNewLabel}
          </Text>
        </Button>
      </View>
    </View>
  );
}
ServerPickerScreen.displayName = 'ServerPickerScreen';
