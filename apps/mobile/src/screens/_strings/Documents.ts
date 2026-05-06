// Documents gallery (`04-Documents`).
// Tablet gallery; top app bar (search + sort + view toggle + avatar);
// responsive grid; sticky "+ New" bottom-right; empty state with 2 CTAs.

export const DOCUMENTS_STRINGS = {
  appTitle: 'DiffuseCraft',

  // Top app bar
  searchPlaceholder: 'Search your documents',
  sortA11yLabel: 'Sort',
  viewToggleGridA11yLabel: 'Grid view',
  viewToggleListA11yLabel: 'List view',
  avatarA11yLabel: 'Account',

  // Sort menu items
  sortRecent: 'Recently edited',
  sortName: 'Name',
  sortSize: 'Size',
  sortWorkspace: 'Workspace',

  // Per-tile chrome
  workspaceBadgeGenerate: 'Generate',
  workspaceBadgeInpaint: 'Inpaint',
  workspaceBadgeUpscale: 'Upscale',
  workspaceBadgeLive: 'Live',
  lastEditPrefix: 'Edited',

  // Sticky FAB
  newDocumentLabel: 'New',
  newDocumentA11yLabel: 'New document',

  // Empty state
  emptyTitle: 'No documents yet',
  emptyDescription: 'Start blank or import an image to begin.',
  emptyCTAStartBlank: 'Start blank',
  emptyCTAImport: 'Import image',
} as const;
