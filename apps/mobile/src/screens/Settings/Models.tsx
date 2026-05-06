// Placeholder for spec:screens-implementation
//
// Settings.Models. No .pen artboard yet; chrome lands in a future design pass.

import { useRouter } from 'expo-router';

import { Placeholder } from '../_shared/Placeholder';

export function SettingsModelsScreen() {
  const router = useRouter();
  return (
    <Placeholder
      routeName="Settings.Models"
      label="(no .pen artboard yet)"
      description="Model catalog — design lands in a future spec."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
SettingsModelsScreen.displayName = 'SettingsModelsScreen';
