import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";

/**
 * `get_chat_history` schema (external-agent-integration FR-30, FR-34).
 *
 * MVP: in-memory per-document store. Returns the most-recent N messages
 * in chronological order (oldest first) so the chat panel can render
 * a scrollable thread without further sorting.
 */
const Input = z.object({
  document_id: DocumentId.optional().describe(
    "Document scope. When omitted, reads the `_global` bucket used when no document is active.",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of most-recent messages to return. Default 50."),
});

const ChatMessage = z.object({
  id: z.string().describe("Stable id assigned by the server (insertion order)."),
  role: z.enum(["user", "agent"]).describe("Who sent the message."),
  text: z.string().describe("Message body."),
  created_at: z.string().describe("ISO-8601 timestamp the message was persisted."),
  agent_name: z
    .string()
    .optional()
    .describe("For agent messages, the audit-display name of the responder."),
});

const Output = z.object({
  messages: z
    .array(ChatMessage)
    .describe("Messages in chronological order (oldest → newest)."),
});

export const getChatHistory = defineTool({
  name: "get_chat_history",
  title: "Get chat history",
  description:
    "Returns recent chat messages for a document's conversation. Pure read — does not consume sampling. Conversations are per-document (FR-43). MVP store is in-memory; persistence to SQLite lands in a follow-up.",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
