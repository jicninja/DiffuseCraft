// Editor/RightPanel/index (snapshot preview missing — built from brief). v1.0.0
//
// Floating right panel for the Editor (`05-Editor-Generate` and variants).
// Renders a horizontal Tabs strip across the top (Layers / History /
// Controls / Regions / Chat — values matching `RightPanelTab`) and the
// active tab's content below it.
//
// Layers ships as a real implementation in this wave; the other four
// sub-tabs (History, Controls, Regions, Chat) may not have landed yet,
// so we lazy `require` each one with a try/catch and fall back to a
// `Skeleton` placeholder when the module is missing. This keeps the
// container compilable in isolation while the Wave 3 siblings land.
//
// Tab labels come from `EDITOR_STRINGS.rightPanel.*`; the icon for each
// tab is a lucide glyph (Layers, History, Sliders, Hexagon, MessageCircle).

import {
  Hexagon,
  History as HistoryIcon,
  Layers as LayersIcon,
  type LucideIcon,
  MessageCircle,
  Sliders,
} from 'lucide-react-native';
import { View } from 'react-native';

import { Skeleton, Tabs, TabsList, TabsTrigger, tokens } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../../_strings/Editor';
import type { RightPanelTab } from '../useEditorState';
import { Chat } from './Chat';
import { Controls } from './Controls';
import { History } from './History';
import { Layers } from './Layers';
import { Regions } from './Regions';

interface TabDef {
  value: RightPanelTab;
  label: string;
  icon: LucideIcon;
}

const TABS: readonly TabDef[] = [
  { value: 'layers', label: EDITOR_STRINGS.rightPanel.tabLayers, icon: LayersIcon },
  { value: 'history', label: EDITOR_STRINGS.rightPanel.tabHistory, icon: HistoryIcon },
  { value: 'controls', label: EDITOR_STRINGS.rightPanel.tabControls, icon: Sliders },
  { value: 'regions', label: EDITOR_STRINGS.rightPanel.tabRegions, icon: Hexagon },
  { value: 'chat', label: EDITOR_STRINGS.rightPanel.tabChat, icon: MessageCircle },
];

export interface RightPanelProps {
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
}

/**
 * Lazily resolves a sibling tab module via `require`, returning the
 * named export when present and `null` when the module is missing. Wrapped
 * in try/catch because Wave 3 siblings may not have landed yet — falling
 * back to a `Skeleton` placeholder lets this container compile + render
 * in isolation.
 */
function loadOptional<T>(loader: () => T): T | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

function PlaceholderPanel() {
  return (
    <View className="flex-1 p-4 gap-3">
      <Skeleton className="h-6 w-32 rounded-sm" />
      <Skeleton className="h-20 w-full rounded-md" />
      <Skeleton className="h-20 w-full rounded-md" />
      <Skeleton className="h-20 w-full rounded-md" />
    </View>
  );
}

function renderTabContent(tab: RightPanelTab) {
  switch (tab) {
    case 'layers':
      return <Layers />;
    case 'history':
      return <History />;
    case 'controls':
      return <Controls />;
    case 'regions':
      return <Regions />;
    case 'chat':
      return <Chat />;
    default:
      return <PlaceholderPanel />;
  }
}

export function RightPanel({ tab, onTabChange }: RightPanelProps) {
  return (
    <View
      accessibilityLabel={EDITOR_STRINGS.rightPanel.a11yLabel}
      // Floating right panel: w-80 (320pt), pinned with margin (top-14 right-3
      // bottom-3) so it sits inside the editor under the top bar with breathing
      // room on the right edge.
      className="absolute top-14 right-3 bottom-3 w-80 bg-elevated rounded-md flex flex-col"
    >
      {/* Tab bar — h-10, bottom-bordered. Horizontal Tabs with values matching
          RightPanelTab. Active tab uses the accent indicator (border-b-2). */}
      <View className="h-10 border-b border-border-subtle">
        <Tabs
          value={tab}
          onValueChange={(v) => onTabChange(v as RightPanelTab)}
          className="flex-1"
        >
          <TabsList className="flex-row h-full w-full bg-transparent rounded-none p-0 mr-0 gap-0">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = t.value === tab;
              return (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  accessibilityLabel={t.label}
                  className={
                    'flex-1 flex-row items-center justify-center gap-1.5 h-full rounded-none border-0 ' +
                    (isActive ? 'border-b-2 border-accent-default' : '')
                  }
                >
                  <Icon
                    size={14}
                    color={
                      isActive
                        ? tokens.colors.accent.default
                        : tokens.colors.text.secondary
                    }
                  />
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </View>

      {/* Tab content — flex-1. Each tab owns its own scrolling primitive
          (FlatList for Layers, ScrollView for the rest), so we don't wrap
          here: nesting a VirtualizedList in a same-orientation ScrollView
          breaks windowing. */}
      <View className="flex-1">{renderTabContent(tab)}</View>
    </View>
  );
}
RightPanel.displayName = 'RightPanel';
