// Splash screen (`01-Splash`).
// Branding moment on cold launch while we check for prior pairing.
// No buttons; just wordmark + caption + indeterminate progress hairline.

export const SPLASH_STRINGS = {
  brand: 'DiffuseCraft',
  caption: 'Connecting to your studio…',
  // accessibilityLabel for the indeterminate progress hairline
  progressLabel: 'Loading',
} as const;
