// Server Picker (`03-ServerPicker`).
// "Your studios" — vertical list of paired servers as cards;
// FAB-style "Pair new" bottom-right; cog top-right.

export const SERVER_PICKER_STRINGS = {
  title: 'Your studios',
  subtitle: 'Pick a server to connect this tablet to.',

  // Per-card chrome
  online: 'Online',
  offline: 'Offline',
  lastConnectedPrefix: 'Last connected',
  capabilityComfyUI: 'ComfyUI',
  capabilityModelsPrefix: 'Models',

  // Tap affordances
  tapToConnect: 'Tap to connect',

  // Long-press context menu
  contextRename: 'Rename',
  contextRevokeToken: 'Revoke token',
  contextShowAuditLog: 'Show audit log',

  // FAB
  pairNewLabel: 'Pair new',
  pairNewA11yLabel: 'Pair a new server',

  // Top-right
  settingsA11yLabel: 'Settings',

  // Empty state (no paired servers — fallback)
  emptyTitle: 'No paired servers yet',
  emptyDescription: 'Pair a server to get started.',
} as const;
