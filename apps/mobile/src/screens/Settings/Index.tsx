// Implements 06-Settings (snapshot preview missing — built from brief). v1.0.0
//
// Master/detail tablet layout. Top app bar (back chevron + "Settings" title),
// then a flex-row body with a 320pt left nav column and a flex-1 right detail
// column. The right column renders the About content by default (app/version,
// build id, repo + license link buttons, footer credit, and a __DEV__ debug
// Card that drives the connectionStore stub through every state).
//
// Sub-section detail screens (Connection, Models, Agents, Speech, Appearance,
// AuditLog, About) own their own routes — tapping a master row pushes there.

import { useRouter } from 'expo-router';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitBranch,
  Info,
  type LucideIcon,
  Mic,
  Palette,
  Scale,
  Sparkles,
  Wifi,
} from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Button, Card, Separator, tokens } from '@diffusecraft/ui';

import { SETTINGS_STRINGS as S } from '../_strings/Settings';
import {
  describeConnectionState,
  useConnectionStoreStub,
} from '../../state/connectionStore.stub';

interface NavEntry {
  key: 'connection' | 'models' | 'agents' | 'speech' | 'appearance' | 'audit' | 'about';
  label: string;
  icon: LucideIcon;
  route:
    | '/settings/connection'
    | '/settings/models'
    | '/settings/agents'
    | '/settings/speech'
    | '/settings/appearance'
    | '/settings/audit'
    | '/settings/about';
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { key: 'connection', label: S.master.connection, icon: Wifi, route: '/settings/connection' },
  { key: 'models', label: S.master.modelsAndPresets, icon: Sparkles, route: '/settings/models' },
  { key: 'agents', label: S.master.agents, icon: Bot, route: '/settings/agents' },
  { key: 'speech', label: S.master.speech, icon: Mic, route: '/settings/speech' },
  { key: 'appearance', label: S.master.appearance, icon: Palette, route: '/settings/appearance' },
  { key: 'audit', label: S.master.auditLog, icon: FileText, route: '/settings/audit' },
  { key: 'about', label: S.master.about, icon: Info, route: '/settings/about' },
];

// "About" is the default-rendered detail in this master view, so its row is
// the active one until the user navigates away.
const ACTIVE_KEY: NavEntry['key'] = 'about';

export function SettingsIndexScreen() {
  const router = useRouter();
  const status = useConnectionStoreStub((s) => s.status);
  const pairedServers = useConnectionStoreStub((s) => s.pairedServers);
  const activeServerId = useConnectionStoreStub((s) => s.activeServerId);

  return (
    <View className="flex-1 bg-canvas">
      {/* Top app bar: 56pt (h-14). Back chevron + title. */}
      <View className="h-14 flex-row items-center gap-3 px-4 border-b border-border-subtle">
        <Button
          variant="ghost"
          size="icon"
          onPress={() => router.back()}
          accessibilityLabel={S.backA11yLabel}
        >
          <ChevronLeft size={20} color={tokens.colors.text.primary} />
        </Button>
        <Text className="text-title text-text-primary" numberOfLines={1}>
          {S.title}
        </Text>
      </View>

      {/* Body: master/detail two-column layout. */}
      <View className="flex-1 flex-row">
        {/* Left column — 320pt master nav. */}
        <View
          className="w-[320px] bg-surface border-r border-border-subtle"
          accessibilityLabel={S.master.a11yLabel}
        >
          <ScrollView className="flex-1" contentContainerClassName="py-2">
            {NAV_ENTRIES.map((entry, idx) => {
              const Icon = entry.icon;
              const isActive = entry.key === ACTIVE_KEY;
              const isLast = idx === NAV_ENTRIES.length - 1;
              return (
                <View key={entry.key}>
                  <Pressable
                    onPress={() => router.push(entry.route)}
                    accessibilityRole="button"
                    accessibilityLabel={entry.label}
                    accessibilityState={{ selected: isActive }}
                    className={`flex-row items-center gap-3 px-4 py-3 ${
                      isActive ? 'bg-accent-muted' : ''
                    }`}
                  >
                    <Icon
                      size={18}
                      color={
                        isActive
                          ? tokens.colors.text.primary
                          : tokens.colors.text.secondary
                      }
                    />
                    <Text
                      className={`flex-1 text-body ${
                        isActive ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                      numberOfLines={1}
                    >
                      {entry.label}
                    </Text>
                    <ChevronRight size={16} color={tokens.colors.text.tertiary} />
                  </Pressable>
                  {!isLast ? <Separator className="bg-border-subtle" /> : null}
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Right column — detail (About by default). */}
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-8 py-8 gap-6"
        >
          {/* App name + version. */}
          <View className="gap-1">
            <Text className="text-text-tertiary text-caption uppercase tracking-wide">
              {S.about.sectionTitle}
            </Text>
            <Text className="text-display-md text-text-primary">
              DiffuseCraft v0.0.0
            </Text>
          </View>

          {/* Build identifier. */}
          <View className="flex-row items-center gap-2">
            <Badge variant="secondary">
              <Text className="text-mono text-text-secondary">build 0001</Text>
            </Badge>
          </View>

          <Separator className="bg-border-subtle" />

          {/* Repo + License links. */}
          <View className="gap-3">
            <View className="flex-row items-center gap-3">
              <GitBranch size={16} color={tokens.colors.text.secondary} />
              <Button
                variant="link"
                size="sm"
                onPress={() => {
                  // TODO(screens-implementation): open external browser
                  console.log('TODO(open-repo)');
                }}
                accessibilityLabel={S.about.repoLinkA11yLabel}
              >
                <Text className="text-body text-accent-default">
                  github.com/suquia-bytes/diffusecraft
                </Text>
              </Button>
            </View>
            <View className="flex-row items-center gap-3">
              <Scale size={16} color={tokens.colors.text.secondary} />
              <Button
                variant="link"
                size="sm"
                onPress={() => {
                  // TODO(screens-implementation): open external browser
                  console.log('TODO(open-license)');
                }}
                accessibilityLabel={S.about.licenseLinkA11yLabel}
              >
                <Text className="text-body text-accent-default">MIT</Text>
              </Button>
            </View>
          </View>

          {/* __DEV__-only debug Card driving the connection-store stub. */}
          {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
          {__DEV__ ? (
            <Card className="p-4 gap-3">
              <Text className="text-body-strong text-text-primary">
                Connection stub
              </Text>
              <Separator className="bg-border-subtle" />
              <Text className="text-mono font-mono text-text-secondary">
                {describeConnectionState({ status, pairedServers, activeServerId })}
              </Text>
              <View className="flex-row flex-wrap gap-2 mt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    useConnectionStoreStub.getState().__debugSetStatus('no-paired')
                  }
                >
                  <Text className="text-body text-text-primary">no-paired</Text>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    useConnectionStoreStub
                      .getState()
                      .__debugSetStatus('paired-no-active')
                  }
                >
                  <Text className="text-body text-text-primary">paired-no-active</Text>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    useConnectionStoreStub.getState().__debugSetStatus('connected')
                  }
                >
                  <Text className="text-body text-text-primary">connected</Text>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onPress={() => useConnectionStoreStub.getState().__debugCycle()}
                >
                  <Text className="text-body text-text-on-accent">Cycle</Text>
                </Button>
              </View>
            </Card>
          ) : null}

          {/* Footer credit. */}
          <View className="mt-auto pt-6">
            <Text className="text-text-tertiary text-caption">
              {S.about.footer}
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
SettingsIndexScreen.displayName = 'SettingsIndexScreen';
