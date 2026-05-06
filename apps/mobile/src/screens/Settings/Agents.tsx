// Placeholder for spec:screens-implementation
//
// Settings.Agents. No .pen artboard yet; chrome lands in a future design pass.

import { useRouter } from 'expo-router';

import { Placeholder } from '../_shared/Placeholder';

export function SettingsAgentsScreen() {
  const router = useRouter();
  return (
    <Placeholder
      routeName="Settings.Agents"
      label="(no .pen artboard yet)"
      description="Agent (LLM/VLM) configuration — design lands in a future spec."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
SettingsAgentsScreen.displayName = 'SettingsAgentsScreen';
