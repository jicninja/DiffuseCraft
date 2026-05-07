/**
 * In-memory per-document chat store (external-agent-integration MVP).
 *
 * Keys conversations by `document_id ?? '_global'`. Append-only with a
 * soft cap (`maxPerConversation`) — when exceeded, oldest messages are
 * evicted so memory stays bounded across long sessions. SQLite persistence
 * (tasks.md Phase C) replaces this without touching the contract.
 */

import type { ChatMessage, ChatRole } from './types.js';

export const GLOBAL_CONVERSATION_KEY = '_global';

export interface AppendArgs {
  documentId?: string | null;
  role: ChatRole;
  text: string;
  agent_name?: string;
}

export class InMemoryChatStore {
  private readonly byConversation = new Map<string, ChatMessage[]>();
  private nextSeq = 1;

  constructor(private readonly maxPerConversation = 200) {}

  private key(documentId?: string | null): string {
    return documentId && documentId.length > 0 ? documentId : GLOBAL_CONVERSATION_KEY;
  }

  append(args: AppendArgs): ChatMessage {
    const conversation_id = this.key(args.documentId);
    const seq = this.nextSeq++;
    const message: ChatMessage = {
      id: `m-${Date.now().toString(36)}-${seq.toString(36)}`,
      conversation_id,
      role: args.role,
      text: args.text,
      created_at: new Date().toISOString(),
      ...(args.agent_name !== undefined ? { agent_name: args.agent_name } : {}),
    };
    const list = this.byConversation.get(conversation_id) ?? [];
    list.push(message);
    if (list.length > this.maxPerConversation) {
      list.splice(0, list.length - this.maxPerConversation);
    }
    this.byConversation.set(conversation_id, list);
    return message;
  }

  recent(documentId: string | null | undefined, limit: number): ChatMessage[] {
    const conversation_id = this.key(documentId);
    const list = this.byConversation.get(conversation_id) ?? [];
    if (list.length <= limit) return list.slice();
    return list.slice(list.length - limit);
  }

  clear(documentId?: string | null): void {
    const conversation_id = this.key(documentId);
    this.byConversation.delete(conversation_id);
  }

  /** Drop everything. Called on `server.stop()` so a restart starts clean. */
  reset(): void {
    this.byConversation.clear();
    this.nextSeq = 1;
  }
}
