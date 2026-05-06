// Settings — Connection (`06a-Settings-Connection`).
// Right-column content of Settings showing Paired servers, Pairing,
// and This device sections.

export const SETTINGS_CONNECTION_STRINGS = {
  sectionTitle: 'Connection',
  subtitle: 'Manage paired servers and this device.',

  // Paired servers section
  pairedServersTitle: 'Paired servers',
  pairedServersDescription:
    'Servers this tablet has been paired with. Tap to view details.',
  serverConnectedStatus: 'Connected',
  serverDisconnectedStatus: 'Disconnected',
  serverLastActivityPrefix: 'Last activity',
  serverMenuA11yLabel: 'Server actions',
  serverMenuRename: 'Rename',
  serverMenuRevokeToken: 'Revoke token',
  serverMenuShowAuditLog: 'Show in audit log',
  serverMenuRemove: 'Remove pairing',

  // Pairing section
  pairingTitle: 'Pairing',
  pairingDescription:
    'Add another server. You can be paired to many servers, but only one at a time is active.',
  pairNewButton: 'Pair a new server',
  pairNewA11yLabel: 'Pair a new server',

  // This device section
  thisDeviceTitle: 'This device',
  deviceNameLabel: 'Device name',
  deviceNamePlaceholder: 'iPad Pro',
  deviceNameHelper: 'Shown to your servers when this tablet is paired.',
  deviceNameSaveA11yLabel: 'Save device name',
  fingerprintLabel: 'Public key fingerprint',
  fingerprintCopyA11yLabel: 'Copy fingerprint',
  fingerprintCopiedToast: 'Fingerprint copied',

  // Empty / safety states
  emptyPairedTitle: 'No paired servers yet',
  emptyPairedDescription: 'Tap "Pair a new server" to get started.',
} as const;
