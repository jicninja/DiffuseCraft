// Placeholder for spec:screens-implementation
//
// Debug entry point used by visual-verification harnesses. Accepts a
// `cycle_to` query param (`no-paired` | `paired-no-active` | `connected`)
// and invokes the connectionStore stub's __debugSetStatus before unmounting
// so the conditional root re-renders into the requested branch.
//
// Reachable only via the deep link `diffusecraft://__debug?cycle_to=...`.
// Not visible in any stack's UI tree.

import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Placeholder } from './_shared/Placeholder';
import { useConnectionStoreStub } from '../state/connectionStore.stub';

type CycleTo = 'no-paired' | 'paired-no-active' | 'connected';

export function DebugScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cycle_to?: string }>();
  const raw = params.cycle_to;
  const cycleTo: CycleTo | undefined =
    raw === 'no-paired' || raw === 'paired-no-active' || raw === 'connected'
      ? raw
      : undefined;

  useEffect(() => {
    if (!__DEV__) return;
    if (cycleTo !== undefined) {
      useConnectionStoreStub.getState().__debugSetStatus(cycleTo);
    }
    // The conditional-root subscription will swap routes on the next render
    // (the root index route reads connectionStore and re-issues a redirect).
  }, [cycleTo]);

  return (
    <Placeholder
      routeName="Debug"
      label="__debug (cycle_to deep link)"
      description={`Requested cycle_to=${cycleTo ?? '(none)'}. Root will swap routes momentarily.`}
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
DebugScreen.displayName = 'DebugScreen';
