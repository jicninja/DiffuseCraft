import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId } from "../../shared/ids";

/**
 * `send_chat_message` schema (external-agent-integration FR-30/FR-31).
 *
 * MVP shape: text-only round-trip. The server forwards `message` + recent
 * chat history to the configured chat agent via MCP sampling; the agent's
 * plain-text reply is returned verbatim. Tool-block parsing (FR-31 step 5)
 * lands in a follow-up.
 *
 * - `message`: the user's natural-language request.
 * - `document_id`: optional. When omitted, the conversation is keyed under
 *   a server-side `_global` bucket. Per FR-43 the conversation is per
 *   document, so providing this is strongly recommended once a document
 *   is open.
 */
const Input = z.object({
  message: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "User-typed (or dictated) chat message. The server forwards this to the configured chat agent via MCP sampling.",
    ),
  document_id: DocumentId.optional().describe(
    "Document the chat is scoped to. Conversations are per-document (FR-43). Omit only when no document is active.",
  ),
});

/**
 * Output (FR-31 step 7). Returned synchronously: the sampling round-trip
 * is awaited within the handler. `tools_invoked` is a forward-compat slot
 * — empty in the MVP because tool-block execution is deferred.
 */
const Output = z.object({
  response_text: z
    .string()
    .describe("The agent's plain-text reply to the user message."),
  agent_name: z
    .string()
    .describe("Human-readable name of the agent that answered (audit display)."),
  used_sampling: z
    .boolean()
    .describe("True when the response came from a sampling round-trip (always true in MVP — no caching)."),
  tools_invoked: z
    .array(
      z.object({
        name: z.string(),
        result_summary: z.string(),
      }),
    )
    .default([])
    .describe(
      "Tool calls the agent invoked while answering. Empty in MVP; populated once tool-block parsing lands.",
    ),
});

export const sendChatMessage = defineTool({
  name: "send_chat_message",
  title: "Send chat message",
  description:
    "Sends a user message to the paired chat agent via **MCP sampling** (P4) and returns the agent's reply. The server holds no AI provider keys; the agent runs the LLM with its own credentials. One conversation per document (FR-43). Errors: `SAMPLING_NOT_SUPPORTED` (no sampling-capable agent paired), `ENHANCEMENT_TIMEOUT` (sampling round-trip timed out).",
  category: "job",
  idempotent: false,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
