// Placeholder for spec:screens-implementation
//
// Settings.Speech. No .pen artboard yet; chrome lands in a future design pass.

import { useRouter } from 'expo-router';

import { Placeholder } from '../_shared/Placeholder';

export function SettingsSpeechScreen() {
  const router = useRouter();
  return (
    <Placeholder
      routeName="Settings.Speech"
      label="(no .pen artboard yet)"
      description="Speech (STT/TTS) configuration — design lands in a future spec."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
SettingsSpeechScreen.displayName = 'SettingsSpeechScreen';
