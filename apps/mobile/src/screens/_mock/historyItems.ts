// Generation-history fixtures for the Editor's RightPanel/History sub-tab.
// `applied` indicates the candidate the user accepted onto the canvas.
// Six items: enough to fill the strip and exercise scroll behaviour.

export const MOCK_HISTORY = [
  {
    id: 'gen-001',
    prompt: 'cyberpunk cityscape, neon lights, rainy night',
    when: '2026-05-03T18:14:00Z',
    applied: false,
  },
  {
    id: 'gen-002',
    prompt: 'cyberpunk cityscape, neon lights, rainy night, more contrast',
    when: '2026-05-03T18:09:00Z',
    applied: true,
  },
  {
    id: 'gen-003',
    prompt: 'cyberpunk cityscape, neon lights, rainy night',
    when: '2026-05-03T18:01:00Z',
    applied: false,
  },
  {
    id: 'gen-004',
    prompt: 'cyberpunk cityscape',
    when: '2026-05-03T17:52:00Z',
    applied: false,
  },
  {
    id: 'gen-005',
    prompt: 'cyberpunk cityscape',
    when: '2026-05-03T17:48:00Z',
    applied: false,
  },
  {
    id: 'gen-006',
    prompt: 'cyberpunk cityscape, vague composition',
    when: '2026-05-03T17:42:00Z',
    applied: false,
  },
] as const;
