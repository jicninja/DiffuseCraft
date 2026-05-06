// Placeholder for spec:screens-implementation
//
// Settings.AuditLog. No .pen artboard yet; chrome lands in a future design pass.

import { useRouter } from 'expo-router';

import { Placeholder } from '../_shared/Placeholder';

export function SettingsAuditLogScreen() {
  const router = useRouter();
  return (
    <Placeholder
      routeName="Settings.AuditLog"
      label="(no .pen artboard yet)"
      description="Audit log of MCP tool calls + agent actions — design lands in a future spec."
      actions={[
        { label: 'Back', onPress: () => router.back(), variant: 'secondary' },
      ]}
    />
  );
}
SettingsAuditLogScreen.displayName = 'SettingsAuditLogScreen';
