// Chat fixtures for the Editor's RightPanel/Chat sub-tab (`05d-Editor-Chat-Open`).
// 5 narrative messages alternating user/agent + 2 inline tool-call cards
// (so the chrome exercises the visually-distinct tool-call rendering path).
//
// Tool-call cards render `🛠 <tool>({…})` collapsibles; their args are
// inline objects (already typed; the chrome stringifies for display).

export const MOCK_CHAT = [
  {
    id: 'msg-001',
    role: 'user',
    text: 'Make the building on the right taller and add more neon signage on the lower facade.',
    when: '2026-05-03T18:10:00Z',
  },
  {
    id: 'msg-002',
    role: 'agent',
    text: "On it. I'll mask the right building, run a refine at 60% strength with a structural ControlNet anchored to your existing silhouette, and add a neon pass after.",
    when: '2026-05-03T18:10:30Z',
  },
  {
    id: 'msg-003',
    role: 'tool-call',
    tool: 'add_control_layer',
    args: { kind: 'structural', source: 'layer-character', mode: 'canny' },
    when: '2026-05-03T18:10:35Z',
  },
  {
    id: 'msg-004',
    role: 'tool-call',
    tool: 'refine',
    args: {
      selection: 'right-building',
      strength: 0.6,
      prompt: 'taller building with neon signage',
    },
    when: '2026-05-03T18:10:40Z',
  },
  {
    id: 'msg-005',
    role: 'agent',
    text: 'Done — 4 candidates in your history. The third one nailed the height; want me to apply it?',
    when: '2026-05-03T18:11:00Z',
  },
  {
    id: 'msg-006',
    role: 'user',
    text: "Yes, apply 3 and let's try a wider shot.",
    when: '2026-05-03T18:11:30Z',
  },
] as const;
