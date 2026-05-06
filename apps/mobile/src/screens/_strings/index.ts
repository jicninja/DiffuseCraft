// Barrel for screen-local English string constants.
// One file per screen; each exports a single named `<SCREEN>_STRINGS` const.
// A future i18n spec replaces these imports with a `t()` wrapper without
// touching JSX (per design.md §8).

export { SPLASH_STRINGS } from './Splash';
export { PAIRING_MDNS_STRINGS } from './PairingMDNS';
export { PAIRING_QR_STRINGS } from './PairingQR';
export { PAIRING_CODE_STRINGS } from './PairingCode';
export { PAIRING_MANUAL_STRINGS } from './PairingManual';
export { SERVER_PICKER_STRINGS } from './ServerPicker';
export { DOCUMENTS_STRINGS } from './Documents';
export { EDITOR_STRINGS } from './Editor';
export { SETTINGS_STRINGS } from './Settings';
export { SETTINGS_CONNECTION_STRINGS } from './SettingsConnection';
