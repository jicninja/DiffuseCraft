// Paired AI agent identity for the Editor RightPanel/Chat header row.
// Vendor-neutral: the chrome reads `name` + `host` and never branches on
// vendor (per the project's agent-agnostic rule).
//
// `capability: 'sampling-capable'` is the chip the chrome shows next to
// the connection dot; future capability strings ('vision', 'tool-only',
// etc.) plug into the same slot without chrome changes.

export const MOCK_AGENT = {
  id: 'agent-claude-code',
  name: 'Claude Code',
  host: 'studio-iMac',
  online: true,
  capability: 'sampling-capable',
} as const;
