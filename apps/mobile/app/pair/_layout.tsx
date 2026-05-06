// Pairing flow — nested stack. Mirrors the old PairingFlow stack: MDNS is
// the initial route at /pair, with QR / Code / Manual pushed on top.
import { Stack } from 'expo-router';

export default function PairLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
