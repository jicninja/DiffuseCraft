// Editor/Chat — wired to the real paired agent via the SDK. v1.1.0
//
// Chat sub-tab content rendered inside the Editor's RightPanel for
// `05d-Editor-Chat-Open`. Vendor-neutral agent collaborator surface:
// header (agent identity + connection dot + settings cog), scrollable
// message list (user / agent bubbles), and a composer row (mic + textarea
// + send).
//
// Sources:
//   - SDK client via `useDiffusionClient()` (null until a server is paired
//     and the handshake resolves; in that state the panel renders an empty
//     state and the Send button is disabled).
//   - Connection status via `useConnectionStore` for the online dot.
//   - Active backend's display name as the "host" half of the subtitle.
//   - Initial chat history hydrated from `get_chat_history` on mount /
//     when the client identity changes.
//   - Send: optimistic user bubble → `send_chat_message` → append the
//     agent's reply on success. On failure, the user message stays
//     visible (so the user can read what they tried to send) and a toast
//     surfaces the error.
//
// Out of scope for this slice (post-MVP from external-agent-integration):
//   - Tool-block parsing / execution (FR-31 step 5..7) — agent replies are
//     plain text only, so the tool-call card path is dead.
//   - SQLite persistence on the server side; reloading the app drops the
//     thread.
//   - Cross-client `chat.message` event broadcast (FR-44).
//   - STT, suggested prompts, enhance-on-chat-input, confirm-before-apply.

import * as React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Mic, Send, Settings, Sparkles } from 'lucide-react-native';

import { useConnectionStore, useDiffusionClient } from '@diffusecraft/core';
import { Button, Separator, Textarea, toast } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../../_strings/Editor';

const STR = EDITOR_STRINGS.chatPanel;

export interface ChatProps {}

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  agent_name?: string;
}

interface ChatHistoryResponse {
  messages: Array<{
    id: string;
    role: 'user' | 'agent';
    text: string;
    created_at: string;
    agent_name?: string;
  }>;
}

interface SendChatResponse {
  response_text: string;
  agent_name: string;
  used_sampling: boolean;
  tools_invoked: Array<{ name: string; result_summary: string }>;
}

// ---- Sub-renders ---------------------------------------------------------

function UserBubble({ text }: { text: string }) {
  return (
    <View
      className="self-end max-w-[85%] rounded-md bg-accent-muted p-3"
      accessibilityLabel={`${STR.userBubbleA11yPrefix}: ${text}`}
    >
      <Text className="text-body text-text-primary">{text}</Text>
    </View>
  );
}

function AgentBubble({ text }: { text: string }) {
  return (
    <View
      className="self-start max-w-[85%] rounded-md bg-elevated p-3"
      accessibilityLabel={`${STR.agentBubbleA11yPrefix}: ${text}`}
    >
      <Text className="text-body text-text-primary">{text}</Text>
    </View>
  );
}

function ThinkingBubble() {
  return (
    <View className="self-start max-w-[85%] rounded-md bg-elevated p-3 flex-row items-center gap-2">
      <ActivityIndicator size="small" />
      <Text className="text-body text-text-secondary">{STR.thinkingLabel}</Text>
    </View>
  );
}

// ---- Main component ------------------------------------------------------

export function Chat(_props: ChatProps) {
  const client = useDiffusionClient();
  const connectionStatus = useConnectionStore((s) => s.connectionStatus);
  const currentBackendId = useConnectionStore((s) => s.currentBackendId);
  const pairedBackends = useConnectionStore((s) => s.pairedBackends);

  const [draft, setDraft] = React.useState('');
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [sending, setSending] = React.useState(false);

  const currentBackend = currentBackendId
    ? pairedBackends.find((b) => b.id === currentBackendId) ?? null
    : null;
  const host = currentBackend?.name ?? STR.noClientHostFallback;

  // Track the most recent agent name so the header reflects "who's answering".
  const lastAgentName = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'agent' && m.agent_name) return m.agent_name;
    }
    return null;
  }, [messages]);

  const agentName =
    lastAgentName ?? (client ? STR.defaultAgentName : STR.noAgentName);
  const isOnline = connectionStatus === 'connected' && client !== null;

  // Hydrate history when the client becomes available (or changes identity).
  React.useEffect(() => {
    if (!client) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await client.invokeTool<
          Record<string, never>,
          ChatHistoryResponse
        >('get_chat_history', {});
        if (cancelled) return;
        setMessages(
          response.messages.map((m) => {
            const base: ChatMessage = { id: m.id, role: m.role, text: m.text };
            if (m.agent_name !== undefined) base.agent_name = m.agent_name;
            return base;
          }),
        );
      } catch {
        // Empty thread is the safe fallback — first send still works.
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && client !== null && !sending;

  const handleSend = async () => {
    if (trimmed.length === 0) return;
    if (!client) {
      toast.warn(STR.connectFirstWarn);
      return;
    }
    if (sending) return;

    const optimisticId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: 'user', text: trimmed },
    ]);
    setDraft('');
    setSending(true);
    try {
      const response = await client.invokeTool<
        { message: string },
        SendChatResponse
      >('send_chat_message', { message: trimmed });
      setMessages((prev) => [
        ...prev,
        {
          id: `${optimisticId}-r`,
          role: 'agent',
          text: response.response_text,
          agent_name: response.agent_name,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${STR.sendFailedPrefix}: ${message}`);
    } finally {
      setSending(false);
    }
  };

  const dotLabel = isOnline ? STR.agentDotOnline : STR.agentDotOffline;
  const agentSubtitle = `${agentName} ${STR.agentNameSeparator} ${host}`;
  const emptyMessage = client
    ? STR.emptyTitleConnected
    : STR.emptyTitleDisconnected;

  return (
    <View className="flex-1">
      {/* Header row — agent identity + connection dot + settings cog */}
      <View className="h-12 flex-row items-center gap-2 px-4 border-b border-border-subtle">
        <Sparkles size={16} className="text-text-secondary" />
        <View className="flex-1">
          <Text
            className="text-body-strong text-text-primary"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {agentSubtitle}
          </Text>
        </View>
        <View
          className={`h-2 w-2 rounded-full ${isOnline ? 'bg-success' : 'bg-text-tertiary'}`}
          accessibilityLabel={dotLabel}
        />
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={STR.settingsA11yLabel}
          onPress={() => {
            // eslint-disable-next-line no-console
            console.log('TODO(chat): open chat settings');
          }}
        >
          <Settings size={18} className="text-text-secondary" />
        </Button>
      </View>

      {/* Message list */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-3"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && !sending ? (
          <View className="items-center py-8 gap-2">
            <Sparkles size={24} className="text-text-tertiary" />
            <Text className="text-body text-text-secondary text-center">
              {emptyMessage}
            </Text>
          </View>
        ) : null}
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} text={msg.text} />
          ) : (
            <AgentBubble key={msg.id} text={msg.text} />
          ),
        )}
        {sending ? <ThinkingBubble /> : null}
      </ScrollView>

      <Separator />

      {/* Composer row — mic + autogrow textarea + send */}
      <View className="h-14 flex-row items-center gap-2 px-3 border-t border-border-subtle">
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={STR.micA11yLabel}
          onPress={() => {
            // eslint-disable-next-line no-console
            console.log('TODO(chat): start dictation');
          }}
        >
          <Mic size={18} className="text-text-secondary" />
        </Button>
        <View className="flex-1">
          <Textarea
            placeholder={STR.inputPlaceholder}
            value={draft}
            onChangeText={setDraft}
            numberOfLines={1}
            className="min-h-10"
            editable={client !== null && !sending}
          />
        </View>
        <Button
          variant="default"
          size="icon"
          disabled={!canSend}
          accessibilityLabel={STR.sendA11yLabel}
          onPress={handleSend}
        >
          <Send size={18} className="text-text-on-accent" />
        </Button>
      </View>
    </View>
  );
}
Chat.displayName = 'EditorRightPanelChat';
