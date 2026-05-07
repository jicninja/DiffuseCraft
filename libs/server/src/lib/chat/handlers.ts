/**
 * Chat handlers (external-agent-integration FR-30..FR-36, MVP slice).
 *
 * `send_chat_message` orchestrates the sampling round-trip:
 *   1. Resolve a sampling target (calling client / configured default /
 *      first available). `SAMPLING_NOT_SUPPORTED` if none.
 *   2. Append the user message to the in-memory store.
 *   3. Build a sampling request: chat system prompt + recent history +
 *      the new user message.
 *   4. Round-trip to the agent.
 *   5. Append the agent reply (with `agent_name`) and return.
 *
 * `get_chat_history` is a pure read of the in-memory store.
 *
 * Out of scope for the MVP (post-MVP follow-ups in tasks.md):
 *   - Tool-block parsing + execution (FR-31 step 5..7).
 *   - SQLite persistence (Phase C).
 *   - `chat.message` event broadcast to other clients (FR-44).
 *   - `chat_agent_token_name` separate from `default_sampling_agent_token_name`
 *     (FR-35) — MVP shares the prompt-enhancement default.
 */

import type { ToolHandler } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import type {
  sendChatMessage as sendChatMessageTool,
  getChatHistory as getChatHistoryTool,
} from '@diffusecraft/mcp-tools';
import {
  resolveSamplingTarget,
  type SamplingClientRegistry,
} from '../prompt-enhancement/sampling-target-resolver.js';
import type {
  SamplingClient,
  SamplingMessage,
  SamplingRequest,
  SamplingResponse,
} from '../prompt-enhancement/types.js';

import { InMemoryChatStore } from './store.js';
import { renderChatSystemPrompt } from './system-prompt.js';
import type { ChatMessage } from './types.js';

const DEFAULT_HISTORY_TURNS = 10;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_SAMPLING_TIMEOUT_MS = 30_000;

export interface ChatHandlerDeps {
  chatStore: InMemoryChatStore;
  /** Sampling-capable session registry (optional; when absent, only the calling client is consulted). */
  samplingRegistry?: SamplingClientRegistry;
  /** Configured default agent token name (FR-9 / shared with prompt-enhancement). */
  defaultAgentTokenName?: string;
  /** Sampling round-trip timeout. Defaults to 30s. */
  samplingTimeoutMs?: number;
  /** Cap on agent output tokens for chat replies. Defaults to 1024. */
  maxOutputTokens?: number;
  /** Number of recent messages included as conversation context. Defaults to 10. */
  historyTurns?: number;
}

function toSamplingMessages(history: ChatMessage[]): SamplingMessage[] {
  return history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: { type: 'text', text: m.text },
  }));
}

export function createSendChatMessageHandler(
  deps: ChatHandlerDeps,
): ToolHandler<typeof sendChatMessageTool.inputSchema, typeof sendChatMessageTool.outputSchema> {
  const samplingTimeoutMs = deps.samplingTimeoutMs ?? DEFAULT_SAMPLING_TIMEOUT_MS;
  const maxOutputTokens = deps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const historyTurns = deps.historyTurns ?? DEFAULT_HISTORY_TURNS;

  return async (input, ctx) => {
    const target = resolveSamplingTarget(ctx, {
      ...(deps.defaultAgentTokenName !== undefined
        ? { default_agent_token_name: deps.defaultAgentTokenName }
        : {}),
      ...(deps.samplingRegistry !== undefined ? { registry: deps.samplingRegistry } : {}),
    });
    if (!target) {
      throw new ServerError({
        code: 'SAMPLING_NOT_SUPPORTED',
        message: 'no sampling-capable agent paired',
        cause: {
          hint: 'Pair Claude Desktop, Claude Code, OpenAI Codex, or Gemini CLI to enable chat.',
        },
      });
    }

    const documentId = input.document_id ?? ctx.document_id ?? null;

    deps.chatStore.append({
      documentId,
      role: 'user',
      text: input.message,
    });

    const recent = deps.chatStore.recent(documentId, historyTurns);

    const request: SamplingRequest = {
      messages: toSamplingMessages(recent),
      systemPrompt: renderChatSystemPrompt(),
      maxTokens: maxOutputTokens,
      temperature: 0.6,
    };

    let response: SamplingResponse;
    try {
      response = await (target.client as SamplingClient).request(request, {
        timeoutMs: samplingTimeoutMs,
      });
    } catch (err) {
      throw new ServerError({
        code: 'ENHANCEMENT_TIMEOUT',
        message: `chat sampling round-trip failed (agent=${target.agentName})`,
        cause: err,
      });
    }

    const replyText = response.text.trim();
    if (replyText.length === 0) {
      throw new ServerError({
        code: 'ENHANCEMENT_RESPONSE_INVALID',
        message: `agent ${target.agentName} returned an empty reply`,
        cause: { agent_name: target.agentName },
      });
    }

    deps.chatStore.append({
      documentId,
      role: 'agent',
      text: replyText,
      agent_name: target.agentName,
    });

    return {
      response_text: replyText,
      agent_name: target.agentName,
      used_sampling: true,
      tools_invoked: [],
    };
  };
}

export function createGetChatHistoryHandler(
  deps: Pick<ChatHandlerDeps, 'chatStore'>,
): ToolHandler<typeof getChatHistoryTool.inputSchema, typeof getChatHistoryTool.outputSchema> {
  return async (input, ctx) => {
    const documentId = input.document_id ?? ctx.document_id ?? null;
    const limit = input.limit;
    const messages = deps.chatStore.recent(documentId, limit);
    return {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        created_at: m.created_at,
        ...(m.agent_name !== undefined ? { agent_name: m.agent_name } : {}),
      })),
    };
  };
}
