// Editor/RightPanel/Regions (snapshot preview missing — built from brief). v1.0.0
//
// Regions sub-tab content rendered inside the Editor's RightPanel. A scrollable
// list of region Cards, each carrying a color swatch, an editable region name,
// a small per-region prompt Textarea, and a Visible Switch. The bottom of the
// list exposes a ghost "+ Add region" button. Real wiring (region store, focus
// handling, palette management) lands in a follow-up spec — for v1 we render
// three inline mock regions and console.log focus/edit interactions as TODOs.
//
// Strings live inline per the brief; PRs to `_strings/Editor.ts` arrive in a
// later pass once the regions feature is fleshed out beyond placeholder copy.

import { ScrollView, Text, View } from 'react-native';
import { Hexagon, Plus } from 'lucide-react-native';

import { Badge, Button, Card, Separator, Switch, Textarea } from '@diffusecraft/ui';

// ─── Mock data ──────────────────────────────────────────────────────────────
//
// Three inline mock regions. The `swatch` value names a token from the
// project's accent palette (warn / info / success / danger / accent-default)
// and is mapped to a NativeWind class at render time. We picked variety —
// warn (Sky / golden hour), info (Mountains / cool blue), success (Foreground
// / green wildflowers) — to make the swatch differentiation legible at a
// glance while staying inside the calm-instrument palette.

type RegionSwatch = 'warn' | 'info' | 'success' | 'danger' | 'accent-default';

interface MockRegion {
  id: string;
  name: string;
  prompt: string;
  swatch: RegionSwatch;
  visible: boolean;
}

const MOCK_REGIONS: readonly MockRegion[] = [
  {
    id: 'sky',
    name: 'Sky',
    prompt: 'dramatic golden hour sky',
    swatch: 'warn',
    visible: true,
  },
  {
    id: 'mountains',
    name: 'Mountains',
    prompt: 'snow-capped mountains, dramatic light',
    swatch: 'info',
    visible: true,
  },
  {
    id: 'foreground',
    name: 'Foreground',
    prompt: 'rocky path with wildflowers',
    swatch: 'success',
    visible: true,
  },
];

// Palette → bg-* class mapping. Inlined as a plain record (not cva) because
// there's only the one swatch dimension and we want the class strings legible
// to the NativeWind compiler at parse time — dynamic `bg-${x}` would not be
// picked up by the safelist.
const SWATCH_BG: Record<RegionSwatch, string> = {
  warn: 'bg-warn',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-danger',
  'accent-default': 'bg-accent-default',
};

// ─── Region card ────────────────────────────────────────────────────────────

interface RegionCardProps {
  region: MockRegion;
}

function RegionCard({ region }: RegionCardProps) {
  return (
    <Card className="p-3 gap-3">
      {/* Header row: swatch + editable name + visible switch */}
      <View className="flex-row items-center gap-2">
        {/* Color swatch — h-3 w-3 rounded-full per brief ("rounded-pill" on a
            square reads as a circle, matching the krita-ai-diffusion region
            badge convention). */}
        <View
          className={`h-3 w-3 rounded-full ${SWATCH_BG[region.swatch]}`}
          accessibilityLabel={`Region color ${region.swatch}`}
        />

        {/* Editable region name. We use the Textarea primitive in single-line
            mode (`multiline={false}`) to stay inside the brief's allowed
            primitive list while keeping the field tappable + editable. */}
        <Textarea
          defaultValue={region.name}
          multiline={false}
          numberOfLines={1}
          className="flex-1 min-h-0 h-9 py-1 text-body-strong text-text-primary"
          onChangeText={(next) => {
            // eslint-disable-next-line no-console
            console.log('TODO(regions): rename', region.id, next);
          }}
          onFocus={() => {
            // eslint-disable-next-line no-console
            console.log('TODO(regions): focus region', region.id);
          }}
        />

        {/* Visible toggle */}
        <Switch
          checked={region.visible}
          onCheckedChange={(next) => {
            // eslint-disable-next-line no-console
            console.log('TODO(regions): visibility', region.id, next);
          }}
        />
      </View>

      {/* Per-region prompt — small Textarea, 2 rows */}
      <Textarea
        defaultValue={region.prompt}
        numberOfLines={2}
        className="min-h-0 h-16 text-body text-text-primary"
        placeholder="Region prompt"
        onChangeText={(next) => {
          // eslint-disable-next-line no-console
          console.log('TODO(regions): prompt', region.id, next);
        }}
        onFocus={() => {
          // eslint-disable-next-line no-console
          console.log('TODO(regions): focus region', region.id);
        }}
      />
    </Card>
  );
}

// ─── Regions panel ──────────────────────────────────────────────────────────

export function Regions() {
  const items = MOCK_REGIONS;
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
          <Hexagon size={16} className="text-text-secondary" />
          <Text className="text-body-strong text-text-primary">Regions</Text>
        </View>
        <Badge variant="secondary">
          <Text className="text-caption text-text-secondary">{String(count)}</Text>
        </Badge>
      </View>

      <Separator />

      {/* Region cards */}
      {items.map((region) => (
        <RegionCard key={region.id} region={region} />
      ))}

      {/* Add region — ghost button at the bottom of the list */}
      <Button
        variant="ghost"
        accessibilityLabel="Add region"
        onPress={() => {
          // eslint-disable-next-line no-console
          console.log('TODO(regions): add region');
        }}
      >
        <Plus size={16} className="text-text-primary" />
        <Text className="text-button text-text-primary">Add region</Text>
      </Button>
    </ScrollView>
  );
}
Regions.displayName = 'EditorRightPanelRegions';
