// Placeholder for spec:screens-implementation
//
// Settings.About. Hosts the __DEV__-guarded debug Card (FR-20) that cycles
// the connectionStore stub through every state of the conditional root, so
// reviewers can observe Pairing → ServerPicker → Documents without a real
// pairing handshake.

import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, Separator } from '@diffusecraft/ui';

import { Placeholder } from '../_shared/Placeholder';
import {
  describeConnectionState,
  useConnectionStoreStub,
} from '../../state/connectionStore.stub';

export function SettingsAboutScreen() {
  const router = useRouter();
  const status = useConnectionStoreStub((s) => s.status);
  const pairedServers = useConnectionStoreStub((s) => s.pairedServers);
  const activeServerId = useConnectionStoreStub((s) => s.activeServerId);

  return (
    <Placeholder
      routeName="Settings.About"
      label="06-Settings (About detail)"
      description="App version + credits. Real chrome lands in screens-implementation."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
      detail={
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        __DEV__ ? (
          <Card className="p-4 gap-2">
            <Text className="text-body-strong text-text-primary">
              Debug — connection stub
            </Text>
            <Separator className="mb-2" />
            <Text className="text-mono font-mono text-text-secondary">
              {describeConnectionState({ status, pairedServers, activeServerId })}
            </Text>
            <View className="gap-2 mt-2">
              <Button
                variant="secondary"
                onPress={() => useConnectionStoreStub.getState().__debugCycle()}
              >
                <Text className="text-body text-text-primary">Cycle stub state</Text>
              </Button>
              <Button
                variant="ghost"
                onPress={() =>
                  useConnectionStoreStub.getState().__debugSetStatus('no-paired')
                }
              >
                <Text className="text-body text-text-primary">Force no-paired</Text>
              </Button>
              <Button
                variant="ghost"
                onPress={() =>
                  useConnectionStoreStub
                    .getState()
                    .__debugSetStatus('paired-no-active')
                }
              >
                <Text className="text-body text-text-primary">
                  Force paired-no-active
                </Text>
              </Button>
              <Button
                variant="ghost"
                onPress={() =>
                  useConnectionStoreStub.getState().__debugSetStatus('connected')
                }
              >
                <Text className="text-body text-text-primary">Force connected</Text>
              </Button>
            </View>
          </Card>
        ) : null
      }
    />
  );
}
SettingsAboutScreen.displayName = 'SettingsAboutScreen';
