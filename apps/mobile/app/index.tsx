// Root index route (`/`). Conditional-routing logic that used to live in
// src/navigation/RootRouter.tsx. Subscribes to the shared connection store
// and emits a <Redirect> to the appropriate top-level route:
//
//   status='unknown'                                         → render Splash
//   status='no-paired'                                       → /pair
//   status='paired-no-active' (>1 paired)                    → /servers
//   status='paired-no-active' (1 paired) | 'connected'       → /documents

import { Redirect } from 'expo-router';

import { useConnectionStoreStub } from '../src/state/connectionStore.stub';
import { SplashScreen } from '../src/screens/Splash';

export default function Index() {
  const status = useConnectionStoreStub((s) => s.status);
  const pairedCount = useConnectionStoreStub((s) => s.pairedServers.length);
  const activeServerId = useConnectionStoreStub((s) => s.activeServerId);

  if (status === 'unknown') {
    // Cold-start: render Splash until the store dispatches a real status.
    return <SplashScreen />;
  }
  if (status === 'no-paired') {
    return <Redirect href="/pair" />;
  }

  // status === 'paired-no-active' || 'connected'
  // Show ServerPicker only when 2+ paired servers and none active. With 1
  // paired server we skip ServerPicker; with 'connected' we go straight to
  // Documents regardless of count.
  const showServerPicker =
    status === 'paired-no-active' && pairedCount > 1 && activeServerId === null;

  if (showServerPicker) {
    return <Redirect href="/servers" />;
  }
  return <Redirect href="/documents" />;
}
