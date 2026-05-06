# external-agent-integration — Design

> **Companion to:** `requirements.md`. **References:** `pairing-protocol`, `prompt-enhancement` (sampling routing pattern), `selection-tools` Tier 4, `client-sdk` (sampling forwarder), `tech.md` Backends class 2.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No `add_agent_token` MCP tool in v1.** CLI / MeshCraft UI only. |
| Q2 | **No fall-through on agent refusal.** Refusal propagates as-is. |
| Q3 | **No agent-supplied tools in v1.** Only hosts (MeshCraft via `addCustomTool`). |
| Q4 | **Tablet displays `agent_name` for transparency.** "via Claude Code" tag for ~3s. |
| Q5 | **Scoped event subscriptions only** (no cross-client snooping). |
| Q6 | **Support latest two MCP SDK majors** with deprecation warning. |
| Q7 | **Raise catalog cap 60 → 65.** Footprint NFR-3 still the hard gate. |
| Q8 | **Confirm-before-applying as opt-in setting.** Default off. |
| Q9 | **Chat agent and sampling agent same by default**, configurable separately. |

## 2. Module layout

```
libs/server/src/lib/agent-pool/
├── pool-registry.ts             # tracks paired agents; client_kind="agent"
├── sampling-router.ts           # priority resolver + fallback (FR-10..12)
├── client-kind-detector.ts      # capability handshake → client_kind labeling
└── stats.ts                     # for diffusecraft://server/sampling-stats

libs/server/src/lib/chat/
├── handler-send.ts              # send_chat_message handler
├── handler-history.ts
├── handler-clear.ts
├── chat-orchestrator.ts         # builds sampling request, parses response, executes tools
├── tool-block-parser.ts         # parses <tool>...</tool> blocks from agent reply
└── chat-system-prompt.md        # the "co-pilot" system prompt template

libs/ui/src/agent-pool/
├── DevicesAndAgentsPanel.tsx    # tablet "Server & Devices" panel showing agent pool
└── AgentBadge.tsx               # "via Claude Code" tag in chat / enhancement results

libs/ui/src/chat/
├── ChatPanel.tsx                # main panel (sidebar in landscape, sheet in portrait)
├── ChatMessage.tsx              # user/agent bubbles + tool-invocation summaries
├── ChatInput.tsx                # text + mic + enhance + send
├── SuggestedPromptChips.tsx
└── chat-store-slice.ts          # conversation per document, in-flight state

docs/agents/
├── claude-desktop.md
├── claude-code.md
├── codex.md
├── gemini-cli.md
└── custom.md
```

## 3. Agent pool tracking

```typescript
// libs/server/src/lib/agent-pool/pool-registry.ts
export interface PairedClient {
  token_id: string;
  token_name: string;
  client_kind: "tablet" | "agent" | "host" | "unknown";
  supports_sampling: boolean;
  client_user_agent?: string;
  pairing_method: "stdio" | "qr" | "mdns" | "code" | "manual" | "in_memory";
  created_at: string;
  last_used_at: string;
}

export class PoolRegistry {
  agents(): PairedClient[] {
    return this.db.query<PairedClient>(
      "SELECT * FROM tokens t JOIN client_capabilities c ON t.id = c.token_id " +
      "WHERE t.status = 'active' AND c.client_kind = 'agent'"
    );
  }
  samplingAgents(): PairedClient[] {
    return this.agents().filter((a) => a.supports_sampling);
  }
}
```

`client_kind` is captured at handshake from the client's declared capabilities. Default `"unknown"` if not declared.

## 4. Sampling router

```typescript
// libs/server/src/lib/agent-pool/sampling-router.ts
export class SamplingRouter {
  resolve(ctx: HandlerContext): SamplingTarget | null {
    // 1. Calling client itself
    if (ctx.client.supportsSampling) {
      return { agent_name: ctx.tokenName, sampling: ctx.client.sampling };
    }
    // 2. Configured default
    const defaultName = ctx.config.sampling.default_agent_token_name;
    if (defaultName) {
      const sess = ctx.sessions.findByTokenName(defaultName);
      if (sess?.supportsSampling) return { agent_name: defaultName, sampling: sess.sampling };
    }
    // 3. Deterministic-pick from pool (round-robin or hash)
    const pool = this.pool.samplingAgents().filter((a) => ctx.sessions.isActive(a.token_id));
    if (pool.length === 0) return null;
    const idx = stableHash(ctx.tokenId + this.salt) % pool.length;
    const picked = pool[idx];
    const sess = ctx.sessions.findByTokenId(picked.token_id);
    return sess ? { agent_name: picked.token_name, sampling: sess.sampling } : null;
  }
}
```

Used by `enhance_prompt`, `select_by_prompt`, and the new chat handler.

## 5. Chat orchestrator (the centerpiece)

```typescript
// libs/server/src/lib/chat/chat-orchestrator.ts
export class ChatOrchestrator {
  async run(input: SendChatMessageInput, ctx: HandlerContext): Promise<ChatResponse> {
    // 1. Persist user message
    const userMsgId = ulid();
    ctx.db.exec("INSERT INTO chat_messages (id, document_id, conversation_id, role, text, created_at) VALUES (?,?,?,?,?,?)",
      userMsgId, input.document_id, input.conversation_id ?? input.document_id, "user", input.message, now());

    // 2. Resolve target chat agent
    const target = ctx.samplingRouter.resolve({ ...ctx, prefer_token_name: ctx.config.sampling.chat_agent_token_name });
    if (!target) throw new ServerError({ code: "SAMPLING_NOT_SUPPORTED", message: "No chat-capable agent paired", hint: "Pair Claude Code, Codex, or Gemini CLI." });

    // 3. Build sampling request
    const canvas = await ctx.documents.summarize(input.document_id);
    const history = await ctx.chat.recentMessages(input.document_id, { limit: 20 });
    const filtered_catalog = await ctx.workspaces.filteredTools(ctx.tokenId);
    const systemPrompt = renderTemplate(loadTemplateFile("chat-system-prompt"), {
      canvas, history, filtered_catalog, active_workspace: ctx.workspaceManager.get(ctx.tokenId),
    });

    // 4. Sampling round-trip
    const samplingResponse = await target.sampling.request({
      messages: [{ role: "user", content: input.message }],
      system_prompt: systemPrompt,
      max_tokens: 2048,
      temperature: 0.4,
    }, { timeout_ms: 60_000 });

    // 5. Parse response: text + <tool>...</tool> blocks
    const { text, tool_blocks } = parseToolBlocks(samplingResponse);

    // 6. Execute tool calls under the agent's identity
    const tools_invoked = [];
    for (const block of tool_blocks) {
      try {
        const result = await ctx.dispatcher.dispatchAs(target.agent_token_id, block.name, block.args);
        tools_invoked.push({ name: block.name, args: block.args, result_summary: summarize(result), outcome: "success" });
      } catch (err) {
        tools_invoked.push({ name: block.name, args: block.args, outcome: "failure", error: err.message });
      }
    }

    // 7. Persist agent message
    const agentMsgId = ulid();
    ctx.db.exec("INSERT INTO chat_messages (id, document_id, conversation_id, role, text, tool_invocations_json, created_at) VALUES (?,?,?,?,?,?,?)",
      agentMsgId, input.document_id, input.conversation_id ?? input.document_id, "agent", text, JSON.stringify(tools_invoked), now());

    // 8. Emit chat.message events for all paired clients on this document
    ctx.bus.publish({
      name: "chat.message",
      payload: { document_id: input.document_id, role: "agent", text, tools_invoked, agent_name: target.agent_name },
    });

    return { response_text: text, tools_invoked, agent_name: target.agent_name };
  }
}
```

## 6. Tool-block parser

```typescript
// libs/server/src/lib/chat/tool-block-parser.ts
export function parseToolBlocks(raw: string): { text: string; tool_blocks: ToolBlock[] } {
  const blocks: ToolBlock[] = [];
  // Match <tool>{...}</tool> blocks via regex (lenient)
  const re = /<tool>([\s\S]*?)<\/tool>/g;
  let stripped = raw;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && typeof parsed.args === "object") {
        blocks.push({ name: parsed.name, args: parsed.args });
      }
    } catch { /* malformed block; skip silently — agent might re-explain */ }
    stripped = stripped.replace(match[0], "");
  }
  return { text: stripped.trim(), tool_blocks: blocks };
}
```

## 7. Chat system prompt template

```markdown
# chat-system-prompt.md

You are a co-pilot for DiffuseCraft, a tablet-first AI image editor.

The user is editing this canvas:
- Dimensions: {{canvas.width}}×{{canvas.height}}
- Active workspace: {{active_workspace}}
- Layer count: {{canvas.layer_count}}
- Active control layers: {{canvas.control_layers}}
- Active regions: {{canvas.regions}}
- Existing root prompt: "{{canvas.root_prompt}}"

Recent chat history:
{{#each history}}
- {{role}}: {{text}}
{{/each}}

Available tools (filtered to active workspace):
{{#each filtered_catalog}}
- {{name}}: {{description_one_line}}
{{/each}}

Rules:
- Respond conversationally with a brief text reply (≤2 sentences).
- To execute tools, include `<tool>{"name": "<tool_name>", "args": {...}}</tool>` blocks in your response.
- You can include multiple tool blocks; they execute in order.
- Tool results are NOT shown back to you; if you need to verify, the user will tell you.
- Be concise. Don't explain what tools you're calling unless asked.

User said: "{{user_message}}"
```

## 8. Chat tools (catalog additions)

```typescript
// libs/mcp-tools/src/tools/chat/send-chat-message.ts
export const sendChatMessage = defineTool({
  name: "send_chat_message",
  title: "Send a message to the chat agent",
  description:
    "Sends a natural-language message to the configured chat agent. The agent reasons about the canvas " +
    "state and either responds with text and/or invokes other tools to modify the document. Returns the " +
    "agent's text reply plus a summary of any tools it invoked.\n\n" +
    "Requires a paired sampling-capable agent (Claude / Codex / Gemini / custom). " +
    "Without one, returns SAMPLING_NOT_SUPPORTED.",
  category: "job",
  idempotent: false,
  reversible: false,    // the underlying tool calls are reversible individually
  inputSchema: z.object({
    message: z.string().min(1).max(4000),
    document_id: DocumentId.optional(),
    conversation_id: z.string().optional(),
  }),
  outputSchema: z.object({
    job_id: JobId,
  }),
  workspace: ["Generate", "Inpaint", "Upscale"],
  since: "1.0.0",
});

// get_chat_history and clear_chat follow standard CRUD-style schemas.
```

## 9. Tablet chat UX

```typescript
// libs/ui/src/chat/ChatPanel.tsx
export const ChatPanel: React.FC = () => {
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const messages = useChatStore((s) => s.messagesForDocument(documentId));
  const inFlight = useChatStore((s) => s.inFlight);
  const [input, setInput] = useState("");

  useEffect(() => {
    // subscribe to chat.message events for this document
    return client.events.on("chat.message", (event) => {
      if (event.document_id === documentId) chatStore.appendMessage(event);
    });
  }, [documentId]);

  const onSend = async () => {
    if (!input.trim()) return;
    chatStore.markInFlight(true);
    try {
      const job = await client.tools.sendChatMessage({ message: input, document_id: documentId });
      await waitForJob(job.job_id);
      setInput("");
    } finally {
      chatStore.markInFlight(false);
    }
  };

  return (
    <Drawer position="right">
      <Header title="Co-pilot" />
      <SuggestedPromptChips visible={messages.length === 0} onPick={(p) => setInput(p)} />
      <FlatList data={messages} renderItem={({ item }) => <ChatMessage message={item} />} />
      {inFlight && <ThinkingIndicator />}
      <ChatInput
        value={input}
        onChange={setInput}
        onMicResult={(text) => setInput(input + (input ? " " : "") + text)}
        onSend={onSend}
        canEnhance
      />
    </Drawer>
  );
};
```

`<ChatInput />` includes the same `<MicButton />` from `speech-to-text` spec — STT result lands in the input string, user can edit, then sends. Optional ✨ button on the chat input runs `enhance_prompt` on the chat input itself before send.

## 10. Devices & Agents panel

```typescript
// libs/ui/src/agent-pool/DevicesAndAgentsPanel.tsx
export const DevicesAndAgentsPanel: React.FC = () => {
  const devices = useResource("diffusecraft://server/paired-devices");
  const agents = devices.filter((d) => d.client_kind === "agent");
  const tablets = devices.filter((d) => d.client_kind === "tablet");

  return (
    <Panel title="Server & Devices">
      <Section title="This server">{/* server info */}</Section>
      <Section title="Paired devices">
        {tablets.map((d) => <DeviceRow device={d} />)}
      </Section>
      <Section title="Agent pool">
        {agents.map((a) => <AgentRow agent={a} />)}
        {agents.length === 0 && (
          <EmptyState>
            <Text>No AI agents paired. Pair Claude Code, Codex, or Gemini CLI on the server to enable chat and enhancement.</Text>
            <Link href="docs/agents">Learn how →</Link>
          </EmptyState>
        )}
      </Section>
    </Panel>
  );
};
```

The tablet does NOT offer "add agent" buttons — that's a server-side action.

## 11. Agent pairing recipes (excerpts; full in `docs/agents/*.md`)

### 11.1 Claude Desktop

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "diffusecraft": {
      "command": "npx",
      "args": ["@diffusecraft/server", "--stdio"]
    }
  }
}
```

OR (HTTP transport, paired):

```json
{
  "mcpServers": {
    "diffusecraft": {
      "url": "http://192.168.1.42:7860/mcp",
      "auth": { "type": "bearer", "token": "dcft_<token>" }
    }
  }
}
```

### 11.2 Claude Code (CLI)

```bash
claude mcp add diffusecraft 'http://192.168.1.42:7860/mcp' --auth-bearer 'dcft_<token>'
```

The token is obtained from the server CLI:

```bash
npx @diffusecraft/server token create --name 'Claude Code on iMac'
# prints: dcft_ABCDEF... (URL+token line)
```

### 11.3 Gemini CLI / Codex / Custom

Analogous; full configs in `docs/agents/`.

## 12. Catalog impact summary

After this spec:

| Spec | Tools added |
|---|---|
| (running total before) | ~57 |
| `send_chat_message`, `get_chat_history`, `clear_chat` | +3 |
| **Total v1 catalog** | **~60 tools** |
| Cap raised | 60 → 65 |

Footprint NFR-3 (≤100 KB) re-verified after addition.

## 13. Cross-spec touches (impact summary)

| Spec | Impact |
|---|---|
| `mcp-tool-catalog` | +3 chat tools; cap raised. New events `chat.message`. |
| `pairing-protocol` | Agents are clients; same pairing primitives; this spec adds vendor-specific recipes. |
| `prompt-enhancement` | Sampling-routing is unified across `enhance_prompt`, `select_by_prompt`, and `send_chat_message`. |
| `selection-tools` | Tier 4 (`select_by_prompt`) reuses the same router. |
| `speech-to-text` | Reused for chat input via `<MicButton />`. |
| `workspaces` | Chat panel respects active workspace; suggested prompts vary. |
| `client-state-architecture` | New `chatStore` slice. |
| `server-architecture` | `dispatchAs(token_id, ...)` capability for the chat orchestrator to invoke tools as the agent. |

## 14. Acceptance criteria

1. Six user stories from `requirements.md` realized.
2. Three chat tools work end-to-end with at least one paired agent.
3. Sampling router deterministically picks from pool.
4. Tablet's chat panel + Devices panel surface state correctly.
5. STT in chat input works (reuses speech-to-text infrastructure).
6. Vendor matrix passes (FR-16) for at least Claude Desktop + Claude Code.
7. Privacy/audit invariants preserved.
