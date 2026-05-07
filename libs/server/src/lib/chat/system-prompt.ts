/**
 * MVP chat system prompt (external-agent-integration FR-31).
 *
 * Kept intentionally short and tool-block-free — the MVP forwards the
 * agent's plain-text reply verbatim. Tool-block parsing + execution
 * (FR-31 step 5..7) lands in a follow-up; once it does, the system
 * prompt grows the `<tool>{name, args}</tool>` instructions and an
 * available-tools listing.
 */

const BASE_SYSTEM_PROMPT = [
  'You are a DiffuseCraft co-pilot — a conversational assistant helping an illustrator',
  'edit images on a tablet. Keep replies brief, concrete, and friendly. Do NOT include',
  'preambles ("Sure!", "Of course!"). Do NOT propose tool invocations or code blocks —',
  'reply with conversational text only. If the user asks for an action you would normally',
  'apply via a tool, describe what you would do and ask them to confirm; tool execution',
  'is not yet wired in this build.',
].join(' ');

export function renderChatSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT;
}
