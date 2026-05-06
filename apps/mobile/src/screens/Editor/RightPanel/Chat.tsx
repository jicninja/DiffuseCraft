// Editor/Chat (snapshot preview missing — built from brief). v1.0.0
//
// Chat sub-tab content rendered inside the Editor's RightPanel for
// `05d-Editor-Chat-Open`. Vendor-neutral agent collaborator surface:
// header (agent identity + connection dot + settings cog), scrollable
// message list (user / agent bubbles + visually-distinct tool-call cards),
// and a composer row (mic + autogrow textarea + send). Reads MOCK_CHAT
// and MOCK_AGENT directly — no props in v1. Real agent wiring (MCP
// transport, streaming, tool-call confirmation) lands in a follow-up spec.
//
// Tool-call cards intentionally render as a Card (not a chat bubble): they
// represent agent ACTIONS, not utterances, and need the stronger surface
// + monospace tool name to read as "this is something the agent did/will
// do" rather than "this is something the agent said".
//
// Strings: `EDITOR_STRINGS.chatPanel.*`.
// Agent: `MOCK_AGENT` from `../../_mock/agent`.
// Messages: `MOCK_CHAT` from `../../_mock/chatMessages`.

import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Mic, Send, Settings, Sparkles, Wrench } from 'lucide-react-native';

import { Button, Card, Separator, Textarea } from '@diffusecraft/ui';

import { EDITOR_STRINGS } from '../../_strings/Editor';
import { MOCK_AGENT } from '../../_mock/agent';
import { MOCK_CHAT } from '../../_mock/chatMessages';

const STR = EDITOR_STRINGS.chatPanel;

export interface ChatProps {}

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

function ToolCallCard({
  tool,
  args,
}: {
  tool: string;
  args: Record<string, unknown>;
}) {
  const [open, setOpen] = React.useState(false);
  // Pretty-print args; chrome stringifies for display per fixture comment.
  const argsJson = React.useMemo(() => JSON.stringify(args, null, 2), [args]);
  const toggleA11yLabel = open
    ? STR.toolCallCollapseA11yLabel
    : STR.toolCallExpandA11yLabel;

  return (
    <Card
      className="self-stretch border border-border-strong bg-inset p-3 gap-2"
      accessibilityLabel={`${STR.toolCallBubbleA11yPrefix}: ${tool}`}
    >
      <Pressable
        className="flex-row items-center gap-2"
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={toggleA11yLabel}
      >
        <Wrench size={14} className="text-text-secondary" />
        <Text className="text-mono text-text-primary flex-1">{tool}</Text>
        <Text className="text-caption text-text-tertiary">
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <View className="rounded-sm bg-canvas p-2">
          <Text className="text-mono text-text-secondary">{argsJson}</Text>
        </View>
      ) : null}
    </Card>
  );
}

// ---- Main component ------------------------------------------------------

export function Chat(_props: ChatProps) {
  const [draft, setDraft] = React.useState('');
  const canSend = draft.trim().length > 0;

  const agentSubtitle = `${MOCK_AGENT.name} ${STR.agentNameSeparator} ${MOCK_AGENT.host}`;
  const dotLabel = MOCK_AGENT.online ? STR.agentDotOnline : STR.agentDotOffline;

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
          className="h-2 w-2 rounded-full bg-success"
          accessibilityLabel={dotLabel}
        />
        <Button
          variant="ghost"
          size="icon"
          // TODO(strings): chat header settings cog a11y label
          accessibilityLabel="Chat settings"
          onPress={() => {
            // eslint-disable-next-line no-console
            console.log('TODO(chat): open chat settings');
          }}
        >
          <Settings size={18} className="text-text-secondary" />
        </Button>
      </View>

      {/* Message list — flex-1 scrollable */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-3"
        showsVerticalScrollIndicator={false}
      >
        {MOCK_CHAT.map((msg) => {
          if (msg.role === 'user') {
            return <UserBubble key={msg.id} text={msg.text} />;
          }
          if (msg.role === 'agent') {
            return <AgentBubble key={msg.id} text={msg.text} />;
          }
          // tool-call
          return (
            <ToolCallCard
              key={msg.id}
              tool={msg.tool}
              args={msg.args as Record<string, unknown>}
            />
          );
        })}
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
            // TODO(strings): chat composer placeholder localization
            placeholder="Talk to your agent…"
            value={draft}
            onChangeText={setDraft}
            numberOfLines={1}
            className="min-h-10"
          />
        </View>
        <Button
          variant="default"
          size="icon"
          disabled={!canSend}
          accessibilityLabel={STR.sendA11yLabel}
          onPress={() => {
            // eslint-disable-next-line no-console
            console.log('TODO(chat): send message', draft);
            setDraft('');
          }}
        >
          <Send size={18} className="text-text-on-accent" />
        </Button>
      </View>
    </View>
  );
}
Chat.displayName = 'EditorRightPanelChat';
