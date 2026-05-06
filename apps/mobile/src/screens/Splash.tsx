// Implements 01-Splash from design-snapshot v1.0.0
//
// Transient screen rendered by the root index route while the connectionStore
// probe is still 'unknown'. Once status resolves, the index route emits a
// <Redirect> and Splash unmounts. No business logic lives here — just chrome.

import { Text, View } from 'react-native';

import { Progress } from '@diffusecraft/ui';

import { SPLASH_STRINGS } from './_strings/Splash';

export function SplashScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6">
      <View className="w-full max-w-[320px] items-center">
        <Text className="text-text-primary text-display-lg text-center">
          {SPLASH_STRINGS.brand}
        </Text>
        <Text className="text-text-secondary text-body text-center mt-3">
          {SPLASH_STRINGS.caption}
        </Text>
        <Progress
          className="mt-5 h-px w-full bg-border-subtle"
          indicatorClassName="bg-accent-default"
          accessibilityLabel={SPLASH_STRINGS.progressLabel}
        />
      </View>
    </View>
  );
}
SplashScreen.displayName = 'SplashScreen';
