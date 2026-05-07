/**
 * Server-internal chat types (external-agent-integration FR-30..FR-45-h).
 *
 * The MVP shape mirrors the catalog `get_chat_history` output but stays
 * server-internal so the catalog remains the single source of truth for
 * the wire shape. SQLite persistence (Phase C of tasks.md) replaces the
 * in-memory store later without touching this contract.
 */

export type ChatRole = 'user' | 'agent';

export interface ChatMessage {
  /** Insertion-ordered, server-assigned id. */
  id: string;
  /** Per-document conversation key (`document_id` or `_global`). */
  conversation_id: string;
  role: ChatRole;
  text: string;
  /** ISO-8601. */
  created_at: string;
  /** For agent messages: the audit-display name of the responder. */
  agent_name?: string;
}
