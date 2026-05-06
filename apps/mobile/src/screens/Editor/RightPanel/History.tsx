// Editor/RightPanel/History (snapshot preview missing — built from brief). v1.0.0
//
// Generation-history sub-tab content rendered inside the Editor's RightPanel.
// Vertical scroll list of past generations with preview thumbnail, prompt,
// timestamp, status badge and per-card "Apply" action. Reads MOCK_HISTORY
// directly — no props in v1. Real data wiring lands in a follow-up spec.

import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Image as ImageIcon, Sparkles } from 'lucide-react-native';

import { Badge, Button, Card, Separator } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../../_strings/Editor';
import { MOCK_HISTORY } from '../../_mock/historyItems';

const STR = EDITOR_STRINGS.historyPanel;

export function History() {
  const items = MOCK_HISTORY;
  const count = items.length;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="p-4 gap-4"
      showsVerticalScrollIndicator={false}
    >
      {/* Section heading + count badge */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Sparkles size={16} className="text-text-secondary" />
          <Text className="text-body-strong text-text-primary">
            Generation history
          </Text>
        </View>
        <Badge variant="secondary">
          <Text className="text-caption text-text-secondary">{String(count)}</Text>
        </Badge>
      </View>

      <Separator />

      {/* History cards */}
      {items.map((item) => {
        const statusLabel = item.applied ? STR.appliedBadge : 'Preview';
        return (
          <Pressable
            key={item.id}
            onPress={() => {
              // eslint-disable-next-line no-console
              console.log('TODO(generation-history): item id', item.id);
            }}
          >
            <Card className="p-3 gap-3">
              {/* Preview thumbnail — full-width, aspect 16:10 */}
              <View
                className="w-full bg-inset rounded-md items-center justify-center"
                style={{ aspectRatio: 16 / 10 }}
              >
                <ImageIcon size={32} className="text-text-tertiary" />
                {item.applied ? (
                  <View className="absolute top-2 right-2 bg-card rounded-full p-1">
                    <Check size={14} className="text-text-primary" />
                  </View>
                ) : null}
              </View>

              {/* Truncated prompt */}
              <Text
                className="text-body text-text-primary"
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {item.prompt}
              </Text>

              {/* Footer row: relative time + status badge + apply button */}
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-row items-center gap-2 flex-1">
                  {/* TODO(generation-history): compute real relative time from item.when */}
                  <Text className="text-caption text-text-tertiary">
                    5 min ago
                  </Text>
                  <Badge variant="outline">
                    <Text className="text-caption text-text-secondary">
                      {statusLabel}
                    </Text>
                  </Badge>
                </View>
                <Button
                  variant="default"
                  size="sm"
                  accessibilityLabel={STR.applyA11yLabel}
                  onPress={() => {
                    // eslint-disable-next-line no-console
                    console.log('TODO(generation-history): item id', item.id);
                  }}
                >
                  <Text className="text-button text-text-on-accent">
                    {STR.applyButton}
                  </Text>
                </Button>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
History.displayName = 'EditorRightPanelHistory';
