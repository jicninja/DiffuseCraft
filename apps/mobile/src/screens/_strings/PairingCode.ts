// Pairing — Code (`02c-Pairing-Code`).
// Six digit boxes + on-screen numeric pad. Wrong-attempt → shake.

export const PAIRING_CODE_STRINGS = {
  title: 'Enter the 6-digit code shown on your server',

  // Digit-box accessibility
  digitA11yLabel: 'Code digit',

  // Wrong-attempt state copy
  wrongCodeMessage: "That code didn't match. Try again.",

  // On-screen keypad
  keypadDeleteA11yLabel: 'Delete',

  // Bottom secondary cross-link
  altTryQR: 'Try QR instead',

  // Top affordances
  backA11yLabel: 'Back',
} as const;
