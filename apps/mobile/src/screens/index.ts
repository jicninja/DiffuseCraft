// Screens barrel. Re-exports every screen registered in any route under app/
// so the route files can import a single module if they prefer named imports
// over per-file paths. Order: alphabetical by route hierarchy.

export { DebugScreen } from './Debug';
export { DocumentsScreen } from './Documents';
export { EditorScreen } from './Editor';
export type { EditorWorkspace, EditorScreenProps } from './Editor';
export { PairingCodeScreen } from './Pairing/Code';
export { PairingMDNSScreen } from './Pairing/MDNS';
export { PairingManualScreen } from './Pairing/Manual';
export { PairingQRScreen } from './Pairing/QR';
export { ServerPickerScreen } from './ServerPicker';
export { SettingsAboutScreen } from './Settings/About';
export { SettingsAgentsScreen } from './Settings/Agents';
export { SettingsAppearanceScreen } from './Settings/Appearance';
export { SettingsAuditLogScreen } from './Settings/AuditLog';
export { SettingsConnectionScreen } from './Settings/Connection';
export { SettingsIndexScreen } from './Settings/Index';
export { SettingsModelsScreen } from './Settings/Models';
export { SettingsSpeechScreen } from './Settings/Speech';
export { SplashScreen } from './Splash';
export { Swatch } from './Swatch';
export { Placeholder } from './_shared/Placeholder';
export type { PlaceholderProps, PlaceholderAction } from './_shared/Placeholder';
