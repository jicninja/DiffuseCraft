// Editor/TopBar (snapshot preview missing — built from brief). v1.0.0
//
// Floating top bar for `05-Editor-*` screens. Spans the canvas top with a
// `top-3 left-3 right-3` margin, sits at h-10 (40pt) on a `bg-elevated`
// surface (the brief calls for a subtle blur — we use the solid elevated
// token in v1 and revisit when the BlurView primitive lands), and packs:
// back chevron / inline-editable document name + saved indicator / centered
// workspace tabs / spacer / connection chip / share / more (⋯).
//
// Inline-rename is a v1 lo-fi morph: tap the name → swap Text for Input,
// blur or submit to commit. Real document rename plumbing (persistence,
// optimistic update, server echo) lands in client-state-architecture.
//
// Strings: `EDITOR_STRINGS.topbar.*` and `EDITOR_STRINGS.workspaces.*`.
// Active server: `MOCK_ACTIVE_SERVER` from `../_mock/servers`.

import { useRouter } from 'expo-router';
import { Check, MoreHorizontal, Share2, ChevronLeft } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  tokens,
} from '@diffusecraft/ui';

import { MOCK_ACTIVE_SERVER } from '../_mock/servers';
import { EDITOR_STRINGS } from '../_strings/Editor';
import type { EditorWorkspace } from './useEditorState';

export interface TopBarProps {
  documentId: string;
  documentName?: string;
  workspace: EditorWorkspace;
  onWorkspaceChange: (w: EditorWorkspace) => void;
  onBack?: () => void;
}

const WORKSPACE_TABS: ReadonlyArray<{ value: EditorWorkspace; label: string }> = [
  { value: 'generate', label: EDITOR_STRINGS.workspaces.generate },
  { value: 'inpaint', label: EDITOR_STRINGS.workspaces.inpaint },
  { value: 'upscale', label: EDITOR_STRINGS.workspaces.upscale },
  { value: 'live', label: EDITOR_STRINGS.workspaces.live },
];

export function TopBar({
  documentId,
  documentName,
  workspace,
  onWorkspaceChange,
  onBack,
}: TopBarProps) {
  const router = useRouter();
  const initialName = documentName ?? documentId;

  const [name, setName] = React.useState<string>(initialName);
  const [editing, setEditing] = React.useState<boolean>(false);
  const [draft, setDraft] = React.useState<string>(initialName);

  // Re-sync if the parent swaps documents under us.
  React.useEffect(() => {
    setName(documentName ?? documentId);
  }, [documentId, documentName]);

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  };

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commitEdit = () => {
    const next = draft.trim();
    if (next.length > 0) {
      setName(next);
    }
    setEditing(false);
    // TODO(client-state-architecture): persist rename through document store.
    console.log('TODO(client-state-architecture)');
  };

  const cancelEdit = () => {
    setDraft(name);
    setEditing(false);
  };

  const onMenuAction = (action: 'rename' | 'duplicate' | 'export' | 'delete') => {
    if (action === 'rename') {
      startEdit();
      return;
    }
    // TODO(client-state-architecture): wire duplicate / export / delete.
    console.log('TODO(client-state-architecture)');
    void action;
  };

  return (
    <View
      className="absolute top-3 left-3 right-3 h-10 flex-row items-center gap-2 rounded-md bg-elevated px-3"
      accessibilityRole="header"
    >
      {/* Back chevron */}
      <Button
        variant="ghost"
        size="icon"
        onPress={handleBack}
        accessibilityLabel={EDITOR_STRINGS.topbar.backA11yLabel}
        className="h-8 w-8"
      >
        <ChevronLeft size={18} color={tokens.colors.text.primary} />
      </Button>

      {/* Document name + saved indicator */}
      <View className="flex-row items-center gap-1.5">
        {editing ? (
          <Input
            value={draft}
            onChangeText={setDraft}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Escape') cancelEdit();
            }}
            autoFocus
            placeholder={EDITOR_STRINGS.topbar.documentNamePlaceholder}
            accessibilityLabel={EDITOR_STRINGS.topbar.documentNamePlaceholder}
            className="h-7 w-48 px-2 py-0 text-body-strong"
          />
        ) : (
          <Pressable
            onPress={startEdit}
            accessibilityRole="button"
            accessibilityLabel={`${EDITOR_STRINGS.topbar.documentNamePlaceholder}: ${name}`}
            className="px-1 py-0.5"
          >
            <Text
              className="text-body-strong text-text-primary"
              numberOfLines={1}
            >
              {name}
            </Text>
          </Pressable>
        )}

        {/* Saved indicator (lucide Check, success token) */}
        <View
          accessibilityLabel={EDITOR_STRINGS.topbar.savedIndicator}
          className="flex-row items-center"
        >
          <Check size={14} color={tokens.colors.success.default} />
        </View>
      </View>

      {/* Center workspace tabs */}
      <View className="flex-1 items-center">
        <Tabs
          value={workspace}
          onValueChange={(v) => onWorkspaceChange(v as EditorWorkspace)}
          accessibilityLabel={EDITOR_STRINGS.workspaces.a11yLabel}
        >
          <TabsList className="h-8 bg-inset">
            {WORKSPACE_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-3">
                <Text
                  className={
                    tab.value === workspace
                      ? 'text-body-strong text-text-primary'
                      : 'text-body text-text-secondary'
                  }
                >
                  {tab.label}
                </Text>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </View>

      {/* Connection chip */}
      <Badge
        variant="outline"
        accessibilityLabel={`${EDITOR_STRINGS.topbar.connectionChipA11yLabelPrefix} ${MOCK_ACTIVE_SERVER.name}`}
        className="h-7 flex-row items-center gap-1.5 rounded-md border-border-subtle bg-surface px-2 py-0"
      >
        <View
          className={`h-2 w-2 rounded-full ${MOCK_ACTIVE_SERVER.online ? 'bg-success' : 'bg-text-tertiary'}`}
          accessibilityLabel={
            MOCK_ACTIVE_SERVER.online
              ? EDITOR_STRINGS.topbar.connectionDotOnline
              : EDITOR_STRINGS.topbar.connectionDotOffline
          }
        />
        <Text className="text-text-primary text-caption">
          {MOCK_ACTIVE_SERVER.name}
        </Text>
      </Badge>

      {/* Share */}
      <Button
        variant="ghost"
        size="icon"
        onPress={() => {
          // TODO(client-state-architecture): open share sheet.
          console.log('TODO(client-state-architecture)');
        }}
        accessibilityLabel={EDITOR_STRINGS.topbar.shareA11yLabel}
        className="h-8 w-8"
      >
        <Share2 size={16} color={tokens.colors.text.primary} />
      </Button>

      {/* More (⋯) — DropdownMenu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={EDITOR_STRINGS.topbar.moreA11yLabel}
            className="h-8 w-8"
          >
            <MoreHorizontal size={16} color={tokens.colors.text.primary} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[180px] bg-elevated border-border-subtle"
        >
          <DropdownMenuItem onPress={() => onMenuAction('rename')}>
            <Text className="text-text-primary text-body">Rename</Text>
          </DropdownMenuItem>
          <DropdownMenuItem onPress={() => onMenuAction('duplicate')}>
            <Text className="text-text-primary text-body">Duplicate</Text>
          </DropdownMenuItem>
          <DropdownMenuItem onPress={() => onMenuAction('export')}>
            <Text className="text-text-primary text-body">Export</Text>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onPress={() => onMenuAction('delete')}
          >
            <Text className="text-danger text-body">Delete</Text>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}
TopBar.displayName = 'TopBar';
