// Editor screen + sub-components (`05-Editor-Generate`, `05b-Editor-Inpaint`,
// `05c-Editor-Live`, `05d-Editor-Chat-Open`).
//
// One constant exported per visible string surface, grouped by sub-component
// so a future i18n pass can split this file by namespace if it ever grows.
// Today it stays in one file because Editor is the densest screen and
// cross-referencing helps reviewers.
//
// Sub-component groups:
// - TopBar
// - LeftToolRail
// - WorkspaceTabs
// - CanvasPlaceholder
// - BottomPromptBar
// - InpaintModeChips
// - RightPanel (container + 5 sub-tabs)
// - LiveSettingsCard

export const EDITOR_STRINGS = {
  // ---- TopBar -------------------------------------------------------------
  topbar: {
    backA11yLabel: 'Back to documents',
    documentNamePlaceholder: 'Untitled document',
    savedIndicator: 'Saved',
    savingIndicator: 'Saving…',
    unsavedIndicator: 'Unsaved changes',
    connectionChipA11yLabelPrefix: 'Connected to',
    connectionDotOnline: 'Online',
    connectionDotOffline: 'Offline',
    shareA11yLabel: 'Share',
    moreA11yLabel: 'More',
  },

  // ---- LeftToolRail -------------------------------------------------------
  // Tool order is verbatim from `05-Editor-Generate` brief and Q2 in design §10.
  toolRail: {
    brushPen: 'Pen',
    brushPencil: 'Pencil',
    brushMarker: 'Marker',
    brushEraser: 'Eraser',
    brushSmooth: 'Smooth',

    selection: 'Selection',
    transform: 'Transform',
    mask: 'Mask',
    eyedropper: 'Eyedropper',

    layersToggleA11yLabel: 'Toggle layers panel',
    undoA11yLabel: 'Undo',
    redoA11yLabel: 'Redo',
  },

  // ---- WorkspaceTabs ------------------------------------------------------
  workspaces: {
    generate: 'Generate',
    inpaint: 'Inpaint',
    upscale: 'Upscale',
    live: 'Live',
    a11yLabel: 'Workspace',
  },

  // ---- CanvasPlaceholder --------------------------------------------------
  canvas: {
    placeholderText: 'Canvas — see canvas-fundamentals spec',
    selectionMockA11yLabel: 'Selection mock',
    zoomFit: 'Fit',
    zoomActual: '1:1',
    zoomA11yLabel: 'Zoom',
    livePreviewA11yLabel: 'Live preview',
  },

  // ---- BottomPromptBar ----------------------------------------------------
  promptBar: {
    micA11yLabel: 'Dictate prompt',
    micActiveA11yLabel: 'Stop dictation',
    inputPlaceholder: 'Describe what to generate…',
    enhanceA11yLabel: 'Enhance prompt',

    // Primary action label by workspace (and live-stop variant)
    primaryGenerate: 'Generate',
    primaryFill: 'Fill',
    primaryUpscale: 'Upscale',
    primaryStartLive: 'Start Live',
    primaryStopLive: 'Stop Live',

    // Strength slider + presets row
    strengthLabel: 'Strength',
    strengthValueSuffix: '%',
    presetsLabel: 'Style',
  },

  // ---- InpaintModeChips ---------------------------------------------------
  inpaintModes: {
    fill: 'Fill',
    expand: 'Expand',
    add: 'Add',
    remove: 'Remove',
    replaceBg: 'Replace bg',
    a11yLabel: 'Inpaint mode',
  },

  // ---- RightPanel container + sub-tabs ------------------------------------
  rightPanel: {
    // Sub-tab labels (used by the Tabs primitive)
    tabLayers: 'Layers',
    tabHistory: 'History',
    tabControls: 'Controls',
    tabRegions: 'Regions',
    tabChat: 'Chat',

    a11yLabel: 'Side panel',
  },

  // Layers sub-tab
  layersPanel: {
    sectionTitle: 'Layers',
    addLayer: 'Add layer',
    addLayerA11yLabel: 'Add layer',
    visibilityA11yLabel: 'Toggle visibility',
    opacityLabel: 'Opacity',
    kindBadgePaint: 'Paint',
    kindBadgeControl: 'Control',
    kindBadgeReference: 'Reference',
    emptyTitle: 'No layers yet',
  },

  // History sub-tab
  historyPanel: {
    sectionTitle: 'History',
    appliedBadge: 'Applied',
    applyButton: 'Apply',
    applyA11yLabel: 'Apply this candidate',
    discardA11yLabel: 'Discard',
    emptyTitle: 'No generations yet',
    emptyDescription: 'Your prompts and results will appear here.',
  },

  // Controls (ControlNet / structural) sub-tab
  controlsPanel: {
    sectionTitle: 'Control layers',
    addControl: 'Add control',
    addControlA11yLabel: 'Add control layer',
    weightLabel: 'Weight',
    rangeLabel: 'Range',
    modeCanny: 'Canny',
    modeDepth: 'Depth',
    modePose: 'Pose',
    modeScribble: 'Scribble',
    emptyTitle: 'No control layers',
    emptyDescription: 'Add a structural control to anchor your generation.',
  },

  // Regions sub-tab
  regionsPanel: {
    sectionTitle: 'Regions',
    addRegion: 'Add region',
    addRegionA11yLabel: 'Add region',
    promptLabel: 'Prompt',
    weightLabel: 'Weight',
    emptyTitle: 'No regions',
    emptyDescription: 'Paint a region to give part of the canvas its own prompt.',
  },

  // Chat sub-tab
  chatPanel: {
    sectionTitle: 'Chat',
    agentNameSeparator: '@',
    agentDotOnline: 'Online',
    agentDotOffline: 'Offline',

    // Message roles
    userBubbleA11yPrefix: 'You said',
    agentBubbleA11yPrefix: 'Agent said',
    toolCallBubbleA11yPrefix: 'Tool call',
    toolCallExpandA11yLabel: 'Expand tool call',
    toolCallCollapseA11yLabel: 'Collapse tool call',

    // Composer
    inputPlaceholder: 'Ask the agent or describe a change…',
    micA11yLabel: 'Dictate message',
    sendA11yLabel: 'Send message',
    sendButton: 'Send',
  },

  // Live workspace card (rendered inside RightPanel when workspace === 'Live')
  liveSettings: {
    sectionTitle: 'Live settings',
    continuousRegenLabel: 'Continuous regen',
    continuousRegenOnSuffix: 'ON',
    continuousRegenOffSuffix: 'OFF',
    fixedSeedLabel: 'Fixed seed',
    fixedSeedLockedA11yLabel: 'Seed is locked',
    fixedSeedUnlockedA11yLabel: 'Seed is free',
    latencyLabel: 'Latency',
    latencyUnitMS: 'ms',
  },
} as const;
