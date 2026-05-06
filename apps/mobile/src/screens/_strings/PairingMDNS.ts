// Pairing — mDNS (`02-Pairing-mDNS`).
// Full-screen onboarding. Lists discovered servers; offers QR/Code/Manual
// fallbacks in the empty state and as cross-links.

export const PAIRING_MDNS_STRINGS = {
  title: 'Find your DiffuseCraft server',
  subtitle: "We'll look on your network",

  // List section
  discoveredHeader: 'Found on your network',
  pairedBadge: 'Paired',
  tapToPair: 'Tap to pair',

  // Empty state
  emptyTitle: 'No servers nearby',
  emptyHelpQR: 'Scan QR',
  emptyHelpCode: 'Enter code',
  emptyHelpManual: 'Paste URL',

  // Top-right help affordance
  helpA11yLabel: 'Help',

  // Footer / install hint (mono)
  footerHint:
    "Don't have a server yet? Run `npx @diffusecraft/server` on your PC.",
} as const;
