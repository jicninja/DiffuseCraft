// Settings — nested stack. /settings is the master list; sibling routes
// push detail screens on top.
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
