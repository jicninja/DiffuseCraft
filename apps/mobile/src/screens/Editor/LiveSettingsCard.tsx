// Editor/LiveSettingsCard (snapshot preview missing — built from brief). v1.0.0
//
// Live-workspace settings card rendered inside the Editor's RightPanel for
// `05c-Editor-Live`. Single Card that fills the right-panel width and
// surfaces the controls that matter while continuous regeneration is on:
// continuous-regen toggle, fixed-seed lock, latency readout, steps + CFG
// sliders, and a warning-toned "Stop Live" primary button.
//
// "Stop Live" is intentionally NOT the destructive red variant — it's a
// border + danger text treatment so the user reads it as "exit/halt", not
// "delete". The bottom prompt bar handles the canonical Stop Live primary
// for the workspace; this card mirrors the affordance inside the panel.
//
// Strings: `EDITOR_STRINGS.liveSettings.*` and `EDITOR_STRINGS.promptBar.primaryStopLive`.
// State is local-only mock in v1; real wiring lives behind the live-mode
// spec.

import * as React from 'react';
import { Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { Button, Card, Separator, Slider, Switch } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../_strings/Editor';

const STR = EDITOR_STRINGS.liveSettings;
const STOP_LIVE_LABEL = EDITOR_STRINGS.promptBar.primaryStopLive;

export interface LiveSettingsCardProps {
  // none for v1; mock state local
}

export function LiveSettingsCard(_props: LiveSettingsCardProps) {
  const [continuousRegen, setContinuousRegen] = React.useState(true);
  const [fixedSeed, setFixedSeed] = React.useState(true); // locked default ON
  const [steps, setSteps] = React.useState(6);
  const [cfg, setCfg] = React.useState(4);

  const continuousSuffix = continuousRegen
    ? STR.continuousRegenOnSuffix
    : STR.continuousRegenOffSuffix;

  return (
    <Card className="w-full p-4 gap-4">
      {/* Header — section title + continuous regen toggle */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-title text-text-primary">
          {/* TODO(strings): "Live mode" — currently aligns with sectionTitle */}
          {STR.sectionTitle}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-body text-text-secondary">
            {STR.continuousRegenLabel} {continuousSuffix}
          </Text>
          <Switch
            checked={continuousRegen}
            onCheckedChange={setContinuousRegen}
          />
        </View>
      </View>

      <Separator />

      {/* Fixed seed — locked, with Lock icon */}
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <Lock size={14} className="text-text-secondary" />
          <Text className="text-body-strong text-text-primary">
            {STR.fixedSeedLabel}
          </Text>
        </View>
        <Switch
          checked={fixedSeed}
          onCheckedChange={setFixedSeed}
          accessibilityLabel={
            fixedSeed
              ? STR.fixedSeedLockedA11yLabel
              : STR.fixedSeedUnlockedA11yLabel
          }
        />
      </View>

      {/* Latency readout */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-body-strong text-text-primary">
          {STR.latencyLabel}
        </Text>
        <Text className="text-mono text-success">
          {/* TODO(strings): live latency value is data; unit suffix from STR.latencyUnitMS */}
          230 {STR.latencyUnitMS}
        </Text>
      </View>

      <Separator />

      {/* Steps slider — 1..20, default 6 */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-body-strong text-text-primary">
            {/* TODO(strings): "Steps" sampler-step count label */}
            Steps
          </Text>
          <Text className="text-mono text-text-secondary">{steps}</Text>
        </View>
        <Slider
          value={steps}
          onValueChange={(v) => setSteps(Math.round(v))}
          min={1}
          max={20}
          step={1}
          // TODO(strings): "Steps" slider a11y label
          accessibilityLabel="Steps"
        />
      </View>

      {/* CFG slider — 1..20, default 4 */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-body-strong text-text-primary">
            {/* TODO(strings): "CFG" classifier-free guidance label */}
            CFG
          </Text>
          <Text className="text-mono text-text-secondary">{cfg}</Text>
        </View>
        <Slider
          value={cfg}
          onValueChange={(v) => setCfg(Math.round(v))}
          min={1}
          max={20}
          step={1}
          // TODO(strings): "CFG" slider a11y label
          accessibilityLabel="CFG"
        />
      </View>

      <Separator />

      {/* Stop Live — warning-toned, not full destructive */}
      <Button
        variant="outline"
        className="border border-border-strong"
        accessibilityLabel={STOP_LIVE_LABEL}
        onPress={() => {
          // eslint-disable-next-line no-console
          console.log('TODO(live): stop live mode');
        }}
      >
        <Text className="text-button text-danger">{STOP_LIVE_LABEL}</Text>
      </Button>
    </Card>
  );
}
LiveSettingsCard.displayName = 'EditorLiveSettingsCard';
