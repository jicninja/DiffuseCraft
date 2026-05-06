// Implements 04-Documents (snapshot preview missing — built from brief). v1.0.0
//
// Tablet gallery of saved documents. Top app bar (search + sort + view toggle
// + avatar) sits above a scrollable, responsive grid of document tiles drawn
// from MOCK_DOCUMENTS. Sticky `+ New` FAB lives bottom-right. Empty-state
// path is not rendered in v1 (mock has 8 items).

import { useRouter } from 'expo-router';
import {
  Image as ImageIcon,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  Input,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  tokens,
} from '@diffusecraft/ui';

import { MOCK_DOCUMENTS } from './_mock/documents';
import { DOCUMENTS_STRINGS as S } from './_strings/Documents';

// TODO(relative-time-helper): swap this for a shared "X hours ago" formatter
// once the helper lands. v1 renders ISO date as a plain locale date string.
function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

type DocTile = (typeof MOCK_DOCUMENTS)[number];

export function DocumentsScreen() {
  const router = useRouter();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');

  const userInitial = 'I'; // Avatar initial; real account info lands later.
  const itemsCount = MOCK_DOCUMENTS.length;

  const onOpenDoc = (doc: DocTile) => {
    router.push({
      pathname: '/editor/[documentId]',
      params: { documentId: doc.id },
    });
  };

  const onSort = () => {
    // TODO(sort-menu): open DropdownMenu with Recently edited / Name / Size / Workspace.
    console.log('TODO(sort-menu)');
  };

  const onNew = () => {
    // TODO(new-document): create a blank doc then navigate to the editor.
    console.log('TODO(new-document)');
  };

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Top app bar ──────────────────────────────────────────────── */}
      <View className="h-14 flex-row items-center gap-3 border-b border-border-subtle bg-surface px-4">
        {/* Left: app title + workspace badge */}
        <View className="flex-row items-center gap-3">
          <Text className="text-text-primary text-title">{S.appTitle}</Text>
          <Badge variant="secondary" className="bg-elevated">
            <Text className="text-text-secondary text-caption">
              Main Render Farm
            </Text>
          </Badge>
        </View>

        {/* Center: search */}
        <View className="flex-1 flex-row justify-center px-4">
          <View className="w-full max-w-[480px] flex-row items-center rounded-md border border-border-subtle bg-inset px-3">
            <Search size={16} color={tokens.colors.text.secondary} />
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search documents…"
              placeholderTextColor={tokens.colors.text.tertiary}
              accessibilityLabel={S.searchPlaceholder}
              className="ml-2 flex-1 border-0 bg-transparent shadow-none"
            />
          </View>
        </View>

        {/* Right: sort, view toggle, avatar */}
        <View className="flex-row items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onPress={onSort}
            accessibilityLabel={S.sortA11yLabel}
          >
            <SlidersHorizontal size={18} color={tokens.colors.text.primary} />
          </Button>

          <Tabs
            value={view}
            onValueChange={(v) => setView(v === 'list' ? 'list' : 'grid')}
          >
            <TabsList className="h-9 bg-inset">
              <TabsTrigger
                value="grid"
                accessibilityLabel={S.viewToggleGridA11yLabel}
              >
                <LayoutGrid size={16} color={tokens.colors.text.primary} />
              </TabsTrigger>
              <TabsTrigger
                value="list"
                accessibilityLabel={S.viewToggleListA11yLabel}
              >
                <List size={16} color={tokens.colors.text.primary} />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Separator
            orientation="vertical"
            className="mx-1 h-6 bg-border-subtle"
          />

          <Avatar
            alt={S.avatarA11yLabel}
            className="h-9 w-9 bg-elevated"
            accessibilityLabel={S.avatarA11yLabel}
          >
            <AvatarFallback className="bg-elevated">
              <Text className="text-text-primary text-body-strong">
                {userInitial}
              </Text>
            </AvatarFallback>
          </Avatar>
        </View>
      </View>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-8 pb-24"
      >
        {/* Section header */}
        <View className="flex-row items-center gap-3">
          <Text className="text-text-primary text-display-md">
            Recent documents
          </Text>
          <Badge variant="secondary" className="bg-elevated">
            <Text className="text-text-secondary text-caption">
              {itemsCount} items
            </Text>
          </Badge>
        </View>

        {/* Tile grid (3 columns by default; widen to 4 on landscape) */}
        <View className="mt-6 flex-row flex-wrap -mx-2">
          {MOCK_DOCUMENTS.map((doc) => (
            <DocumentTile
              key={doc.id}
              doc={doc}
              onPress={() => onOpenDoc(doc)}
            />
          ))}
        </View>
      </ScrollView>

      {/* ── Sticky `+ New` FAB ───────────────────────────────────────── */}
      <View className="absolute bottom-6 right-6">
        <Button
          variant="default"
          onPress={onNew}
          accessibilityLabel={S.newDocumentA11yLabel}
          className="shadow-sheet h-12 px-5"
        >
          <Plus size={18} color={tokens.colors.bg.canvas} />
          <Text className="text-primary-foreground text-body-strong ml-1">
            {S.newDocumentLabel}
          </Text>
        </Button>
      </View>
    </View>
  );
}
DocumentsScreen.displayName = 'DocumentsScreen';

// ── Tile ─────────────────────────────────────────────────────────────────

function DocumentTile({
  doc,
  onPress,
}: {
  doc: DocTile;
  onPress: () => void;
}) {
  const [w, h] = doc.size;
  const dims = `${w}×${h}`;
  const updated = `${S.lastEditPrefix} ${formatUpdatedAt(doc.updatedAt)}`;

  return (
    <View className="w-1/3 px-2 mb-5 lg:w-1/4">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={doc.name}
      >
        <Card className="gap-0 overflow-hidden rounded-lg border-border-subtle bg-surface p-0">
          {/* Thumbnail (3:2 placeholder; all v1 thumbs are null) */}
          <View
            className="aspect-[3/2] w-full items-center justify-center bg-inset"
            accessible={false}
          >
            <ImageIcon size={36} color={tokens.colors.border.strong} />
          </View>

          {/* Meta block */}
          <View className="gap-1 px-4 py-3">
            <Text
              className="text-text-primary text-body-strong"
              numberOfLines={1}
            >
              {doc.name}
            </Text>
            <Text className="text-text-tertiary text-caption" numberOfLines={1}>
              {updated} · {dims}
            </Text>
            <View className="mt-2 flex-row">
              <Badge variant="secondary" className="bg-elevated">
                <Text className="text-text-secondary text-caption">
                  {doc.workspace}
                </Text>
              </Badge>
            </View>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}
DocumentTile.displayName = 'DocumentTile';
