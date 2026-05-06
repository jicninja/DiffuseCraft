// Layer fixtures for the Editor's RightPanel/Layers sub-tab.
// `kind` is one of: 'paint' (regular pixel layer) | 'control' (ControlNet
// reference / structural input). The chrome renders a small badge based
// on this when kind !== 'paint'.

export const MOCK_LAYERS = [
  {
    id: 'layer-bg',
    name: 'Background',
    visible: true,
    opacity: 1,
    kind: 'paint',
  },
  {
    id: 'layer-character',
    name: 'Character',
    visible: true,
    opacity: 1,
    kind: 'paint',
  },
  {
    id: 'layer-detail',
    name: 'Detail pass',
    visible: true,
    opacity: 0.85,
    kind: 'paint',
  },
  {
    id: 'layer-control',
    name: 'Pose ref',
    visible: true,
    opacity: 0.7,
    kind: 'control',
  },
] as const;
