// Pairing — Manual (`02d-Pairing-Manual`).
// Form with two inputs; collapsible "What's this?" disclosure;
// footer cross-link back to discovery.

export const PAIRING_MANUAL_STRINGS = {
  title: 'Enter your server details',
  subtitle: 'Paste the URL and pairing token from your server.',

  // Server URL field
  urlLabel: 'Server URL',
  urlPlaceholder: 'http://192.168.1.50:9876',
  urlHelper: 'The URL printed by `npx @diffusecraft/server` on launch.',

  // Pairing token field
  tokenLabel: 'Pairing token',
  tokenPlaceholder: 'Paste your pairing token',
  tokenHelper: 'Long, single-use; expires after first successful pair.',
  tokenShowA11yLabel: 'Show token',
  tokenHideA11yLabel: 'Hide token',

  // Primary action
  pairButton: 'Pair',
  pairButtonBusy: 'Pairing…',

  // Disclosure
  disclosureTitle: "What's this?",
  disclosureBullets: [
    'Pairing creates a private link between this tablet and one server.',
    'Your token is stored on this device only — never sent to Anthropic, OpenAI, or any third party.',
    'You can revoke the token from Settings at any time.',
    'Use Manual when discovery is blocked by your network (e.g., Wi-Fi isolation).',
  ],

  // Footer cross-link
  footerBackToDiscovery: 'Back to discovery',
} as const;
