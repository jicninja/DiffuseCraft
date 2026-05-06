// Preset chip fixtures for the Editor's BottomPromptBar tiny preset row.
// 6 chips covers the typical "first-row" view; the real catalog will scroll
// horizontally in a later spec. Names are the short label; description is
// the small caption / underline string the chrome can show on tap or hover.

export const MOCK_PRESETS = [
  { id: 'preset-realistic',    name: 'Realistic',    description: 'SDXL + RealVis' },
  { id: 'preset-anime',        name: 'Anime',        description: 'Animagine v3' },
  { id: 'preset-3d',           name: '3D render',    description: 'SDXL + render LoRA' },
  { id: 'preset-illustration', name: 'Illustration', description: 'SDXL + storybook LoRA' },
  { id: 'preset-photo',        name: 'Photo',        description: 'Juggernaut XL' },
  { id: 'preset-pixel',        name: 'Pixel art',    description: 'PixelMix' },
] as const;
