// Pairing — QR (`02b-Pairing-QR`).
// Full-screen camera viewfinder mock. Square cutout with corner brackets;
// brackets switch to accent only when "detecting".

export const PAIRING_QR_STRINGS = {
  title: 'Scan the QR on your server screen',
  helper: 'Hold steady — auto-detects',

  // State strings the chrome can swap into the helper line.
  helperDetecting: 'Detecting…',

  // Bottom-row alt links
  altUseCode: 'Use a code instead',
  altPasteURL: 'Paste URL',

  // Top affordances
  backA11yLabel: 'Back',
} as const;
