// Debug-only routes. Reachable exclusively via deep link in __DEV__ builds:
//   diffusecraft://__debug         → cycler
//   diffusecraft://__debug/swatch  → token swatch screen
import { Stack } from 'expo-router';

export default function DebugLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
