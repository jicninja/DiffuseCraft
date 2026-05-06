// Placeholder for spec:screens-implementation
//
// Settings.Appearance. No .pen artboard yet; chrome lands in a future design pass.

import { useRouter } from 'expo-router';

import { Placeholder } from '../_shared/Placeholder';

export function SettingsAppearanceScreen() {
  const router = useRouter();
  return (
    <Placeholder
      routeName="Settings.Appearance"
      label="(no .pen artboard yet)"
      description="Theme + UI density — design lands in a future spec."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
SettingsAppearanceScreen.displayName = 'SettingsAppearanceScreen';
