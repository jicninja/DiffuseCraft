// Editor/RightPanel/Controls (snapshot preview missing — built from brief). v1.0.0
//
// Control-layers tab content for the Editor right panel.
//
// Two stacked sections in a single vertical ScrollView:
//   1. Reference (creative)  — IP-Adapter style guidance. Rich Cards with
//      icon, name, strength slider (0–100, default 50), on/off Switch and
//      a tap/long-press DropdownMenu (Edit, Duplicate, Remove).
//   2. Structural (per-pixel) — ControlNet guidance. Compact rows with
//      icon + name + on/off Switch only.
// Each section ends with a "+ Add control layer" Button.
//
// Strings are inlined verbatim (PRs to `_strings/Editor.ts` later — the
// existing `controlsPanel` namespace is intentionally not reused yet
// because the brief's two-section taxonomy doesn't match it 1:1).

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
  Separator,
  Slider,
  Switch,
  tokens,
} from '@diffusecraft/ui';
import {
  Copy,
  Edit3,
  Image as ImageIcon,
  Layout,
  Mountain,
  Palette,
  Plus,
  Smile,
  Spline,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react-native';

// -----------------------------------------------------------------------------
// Mock state shapes
// -----------------------------------------------------------------------------

interface ReferenceLayer {
  id: string;
  name: string;
  Icon: LucideIcon;
  strength: number;
  enabled: boolean;
}

interface StructuralLayer {
  id: string;
  name: string;
  Icon: LucideIcon;
  enabled: boolean;
}

const INITIAL_REFERENCE: readonly ReferenceLayer[] = [
  { id: 'reference', name: 'Reference', Icon: ImageIcon, strength: 50, enabled: true },
  { id: 'style', name: 'Style', Icon: Palette, strength: 50, enabled: false },
  { id: 'composition', name: 'Composition', Icon: Layout, strength: 50, enabled: false },
  { id: 'face', name: 'Face', Icon: Smile, strength: 50, enabled: false },
];

const INITIAL_STRUCTURAL: readonly StructuralLayer[] = [
  { id: 'scribble', name: 'Scribble', Icon: Spline, enabled: false },
  { id: 'lineart', name: 'Line Art', Icon: Edit3, enabled: false },
  { id: 'depth', name: 'Depth', Icon: Mountain, enabled: false },
  { id: 'pose', name: 'Pose', Icon: User, enabled: false },
];

// -----------------------------------------------------------------------------
// Reference card (rich)
// -----------------------------------------------------------------------------

interface ReferenceCardProps {
  layer: ReferenceLayer;
  onStrengthChange: (next: number) => void;
  onToggle: (next: boolean) => void;
}

function ReferenceCard({ layer, onStrengthChange, onToggle }: ReferenceCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { Icon } = layer;
  // TODO(rn-primitives-dropdown-controlled): @rn-primitives/dropdown-menu's
  // Root types onOpenChange but not the controlled `open` prop. Cast for now.
  const DropdownMenuControlled = DropdownMenu as unknown as React.ComponentType<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }>;

  return (
    <DropdownMenuControlled open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Pressable
          onLongPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${layer.name} control layer options`}
        >
          <Card className="p-4 gap-3">
            {/* Header row: icon + name + Switch */}
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 rounded-md bg-elevated items-center justify-center border border-border-subtle">
                <Icon size={18} color={tokens.colors.text.secondary} />
              </View>
              <View className="flex-1">
                <Text className="text-body-strong text-text-primary">{layer.name}</Text>
                <Badge variant="secondary" className="self-start mt-1">
                  <Text className="text-caption text-text-secondary">Reference</Text>
                </Badge>
              </View>
              <Switch
                checked={layer.enabled}
                onCheckedChange={onToggle}
                accessibilityLabel={`Toggle ${layer.name}`}
              />
            </View>

            {/* Strength slider row */}
            <View className="gap-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-caption text-text-secondary">Strength</Text>
                <Text className="text-caption text-text-primary">
                  {Math.round(layer.strength)}%
                </Text>
              </View>
              <Slider
                value={layer.strength}
                onValueChange={onStrengthChange}
                min={0}
                max={100}
                step={1}
              />
            </View>
          </Card>
        </Pressable>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuItem onPress={() => setMenuOpen(false)}>
          <Edit3 size={14} color={tokens.colors.text.secondary} />
          <Text className="text-body text-text-primary ml-2">Edit</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => setMenuOpen(false)}>
          <Copy size={14} color={tokens.colors.text.secondary} />
          <Text className="text-body text-text-primary ml-2">Duplicate</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => setMenuOpen(false)}>
          <Trash2 size={14} color={tokens.colors.danger.default} />
          <Text className="text-body text-danger ml-2">Remove</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuControlled>
  );
}

// -----------------------------------------------------------------------------
// Structural row (compact)
// -----------------------------------------------------------------------------

interface StructuralRowProps {
  layer: StructuralLayer;
  onToggle: (next: boolean) => void;
}

function StructuralRow({ layer, onToggle }: StructuralRowProps) {
  const { Icon } = layer;
  return (
    <View className="flex-row items-center gap-3 px-3 py-2 rounded-md bg-elevated border border-border-subtle">
      <View className="h-7 w-7 rounded items-center justify-center">
        <Icon size={16} color={tokens.colors.text.secondary} />
      </View>
      <Text className="flex-1 text-body text-text-primary">{layer.name}</Text>
      <Switch
        checked={layer.enabled}
        onCheckedChange={onToggle}
        accessibilityLabel={`Toggle ${layer.name}`}
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Section header
// -----------------------------------------------------------------------------

interface SectionHeaderProps {
  title: string;
  subtitle: string;
}

function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <View className="gap-1">
      <Text className="text-body-strong text-text-primary">{title}</Text>
      <Text className="text-caption text-text-tertiary">{subtitle}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Controls — main export
// -----------------------------------------------------------------------------

export function Controls() {
  const [referenceLayers, setReferenceLayers] =
    useState<readonly ReferenceLayer[]>(INITIAL_REFERENCE);
  const [structuralLayers, setStructuralLayers] =
    useState<readonly StructuralLayer[]>(INITIAL_STRUCTURAL);

  const updateReference = (id: string, patch: Partial<ReferenceLayer>) => {
    setReferenceLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  };

  const updateStructural = (id: string, patch: Partial<StructuralLayer>) => {
    setStructuralLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="p-3 gap-5"
      showsVerticalScrollIndicator={false}
    >
      {/* ---- Section 1: Reference (creative) ------------------------------ */}
      <View className="gap-3">
        <SectionHeader
          title="Reference"
          subtitle="Creative guidance — IP-Adapter style images."
        />
        <View className="gap-3">
          {referenceLayers.map((layer) => (
            <ReferenceCard
              key={layer.id}
              layer={layer}
              onStrengthChange={(strength) => updateReference(layer.id, { strength })}
              onToggle={(enabled) => updateReference(layer.id, { enabled })}
            />
          ))}
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            /* mock: would append a new reference layer */
          }}
          accessibilityLabel="Add reference control layer"
        >
          <Plus size={14} color={tokens.colors.text.secondary} />
          <Text className="text-body text-text-primary ml-2">Add control layer</Text>
        </Button>
      </View>

      <Separator />

      {/* ---- Section 2: Structural (per-pixel) ---------------------------- */}
      <View className="gap-3">
        <SectionHeader
          title="Structural"
          subtitle="Per-pixel guidance — ControlNet anchors."
        />
        <View className="gap-2">
          {structuralLayers.map((layer) => (
            <StructuralRow
              key={layer.id}
              layer={layer}
              onToggle={(enabled) => updateStructural(layer.id, { enabled })}
            />
          ))}
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            /* mock: would append a new structural layer */
          }}
          accessibilityLabel="Add structural control layer"
        >
          <Plus size={14} color={tokens.colors.text.secondary} />
          <Text className="text-body text-text-primary ml-2">Add control layer</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
Controls.displayName = 'Controls';
