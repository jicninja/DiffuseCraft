// Settings — master/detail (`06-Settings`) + About content shown by default
// in the right column. Sub-section detail screens (Models, Agents, Speech,
// Appearance, AuditLog, Connection) own their own copy elsewhere.

export const SETTINGS_STRINGS = {
  // Top app bar
  title: 'Settings',
  backA11yLabel: 'Back',

  // Master list (left column, 320pt) — order matches the brief.
  master: {
    a11yLabel: 'Settings sections',
    connection: 'Connection',
    modelsAndPresets: 'Models & Presets',
    agents: 'Agents',
    speech: 'Speech',
    appearance: 'Appearance',
    auditLog: 'Audit log',
    about: 'About',
  },

  // Default-detail content: About card on the right column.
  about: {
    sectionTitle: 'About',
    versionLabel: 'Version',
    versionValue: '0.1.0',
    buildLabel: 'Build',
    buildValue: 'preview',
    repoLinkLabel: 'Repository',
    repoLinkA11yLabel: 'Open repository in browser',
    licenseLinkLabel: 'License',
    licenseLinkA11yLabel: 'Open license in browser',
    debugTitle: 'Debug',
    debugToggleLabel: 'Show debug screen',
    footer: 'Made by Suquía Bytes',
  },

  // Empty-state copy if no master row is selected (defensive — by Q3 the
  // default detail is always About inline).
  emptyDetailTitle: 'Select a section',
  emptyDetailDescription: 'Pick a settings section from the list on the left.',
} as const;
