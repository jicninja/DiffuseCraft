# external-agent-integration — Requirements

> **Status:** Draft v0.1.
> **Type:** Integration spec covering the **complete dual role of agents** (clients AND backends).
> **Depends on:** `pairing-protocol`, `server-architecture` (transports + hooks), `mcp-tool-catalog`, `prompt-enhancement` (sampling routing), `selection-tools` (Tier 4 sampling), `tech.md` Backends class 2.
> **References:** P3 (Agent-agnostic; agents are clients AND backends), P4 (zero AI provider keys in server), `project_diffusecraft_two_backends.md` memory.

## 1. Purpose

Define how external AI agents — **Claude Desktop, Claude Code (CLI), OpenAI Codex / ChatGPT Desktop, Gemini CLI, and custom MCP-conformant agents** — integrate with a DiffuseCraft server. The integration covers two roles **simultaneously**:

1. **Agent as MCP client**: the agent connects to the server's MCP catalog and invokes tools (`generate_image`, `apply_history_item`, etc.) to orchestrate workflows.
2. **Agent as MCP-sampling backend**: when the server (or another client) needs LLM/VLM-class reasoning (for `enhance_prompt`, `select_by_prompt`, `transcribe_audio` interpretation), the server requests it from a paired agent via MCP sampling.

**One key insight that this spec makes explicit:** when an illustrator's tablet pairs with a DiffuseCraft server, the QR/mDNS pairing grants the tablet access to **every backend the server hosts** — including ComfyUI (image inference), the scripting sandbox, AND the **agent pool** the server has paired (Claude Code, Codex, Gemini, etc.). The tablet user never configures agents on the tablet; the server does it once, and every paired client benefits via sampling.

This spec defines:
- How each agent type pairs with the server (transport + UX).
- How the agent pool is managed server-side.
- Sampling routing rules across multiple paired agents.
- Vendor-specific configuration examples and compatibility matrix.
- Recommended usage patterns for orchestration and assistance.

## 2. Stakeholders & user stories

### S1 — Illustrator with one server + one agent + one tablet
> **Story 1.** As an illustrator: I run `npx @diffusecraft/server` on my laptop. I pair Claude Code CLI to it (one-time setup with a token paste). I pair my iPad by scanning the QR. From my iPad I tap ✨ Enhance on a Spanish prompt; the server routes the sampling request to Claude Code; Claude Code returns the rewritten English; I see the result on my iPad. **The iPad never knew about Claude Code; it just got service through the server.**

### S2 — Illustrator with multiple agents
> **Story 2.** As an illustrator who has both Claude Desktop AND Gemini CLI paired to the server, I configure server-side that Claude Desktop is the default sampling agent. My iPad's Enhance always routes to Claude Desktop. I can override per-call via tool input if needed.

### S3 — Power user: agent driving the session
> **Story 3.** As Claude Code paired to the server (acting as MCP client), I receive the user's brief. I orchestrate: `set_workspace("Generate")` → `generate_image(batch=4)` → wait → `get_image(thumbnails)` → pick → `apply_history_item`. The user watches from their tablet (also paired); both see the same document state.

### S4 — Agent reflexive call
> **Story 4.** As Claude Code orchestrating, I invoke `enhance_prompt` myself (because I want the server to translate the user's mixed-language brief). The server's sampling target resolution (per `prompt-enhancement` FR-10) picks me — the calling client — as the sampling backend. I receive the sampling request, respond, get the result. **Self-loop is normal MCP behavior.**

### S5 — Custom agent without sampling support
> **Story 5.** As a custom agent (e.g., a local Python orchestration script using `@modelcontextprotocol/sdk` Python client) without MCP sampling support, I can still invoke tools. When I call `enhance_prompt`, the server routes the sampling to a different agent (Claude Code) that does support sampling. If no sampling-capable agent is paired, the server returns `SAMPLING_NOT_SUPPORTED`.

### S6 — User pairing a new agent to an existing server
> **Story 6.** As a user with the server already running and a tablet paired, I want to add Claude Code CLI to the agent pool. I run `claude mcp add diffusecraft 'http://192.168.1.42:7860'` (Claude Code's MCP-add command) with a token from the server's CLI. Claude Code is now paired and visible in the server's "Devices & Agents" panel. From my tablet, ✨ Enhance now works.

## 3. Functional requirements (EARS)

### 3.1 Agent types and connection methods

**FR-1 (Ubiquitous).** v1 SHALL document and test integration with at least the following agent types:

| Agent | Connection method | Sampling support | Notes |
|---|---|---|---|
| **Claude Desktop** | stdio (spawn locally) OR Streamable HTTP | Yes (full MCP sampling) | The flagship desktop agent |
| **Claude Code (CLI)** | stdio OR Streamable HTTP | Yes | Headless orchestration use case |
| **OpenAI Codex / ChatGPT Desktop** | Streamable HTTP (when MCP client mature) | Likely (Anthropic-led MCP spec adoption ongoing) | Matrix-tested |
| **Gemini CLI** | Streamable HTTP | Likely | Matrix-tested |
| **Custom agents** (Python/TS scripts using MCP SDK) | Any of stdio / HTTP / in-memory | Optional per client | Lowest common denominator: tool invocation only |

**FR-2 (Ubiquitous).** Per P3, the server SHALL NOT special-case any agent vendor. Detection of "is this Claude or Codex?" is forbidden in handler logic. The audit log records `client_user_agent` (reported by client) for forensics only.

### 3.2 Pairing flow per agent type

**FR-3 (Ubiquitous).** **stdio agents (typical: Claude Desktop, Claude Code spawning the server)**:
- Agent invokes the server as a subprocess: `npx @diffusecraft/server --stdio`.
- Trust-by-process: no token presented; the OS-level permission to execute the binary is the auth boundary.
- Audit log entries tagged with `_stdio_<process_name>`.

**FR-4 (Ubiquitous).** **HTTP agents (typical: Claude Desktop with remote-MCP, Claude Code CLI with `mcp add`, Codex, Gemini CLI)**:
- User pairs agent via standard pairing flow (per `pairing-protocol`):
  - Most common path: user runs a server CLI command (`npx @diffusecraft/server token create --name "Claude Code"`) which prints a URL+token line (FR-15 of `pairing-protocol`). User pastes into the agent's MCP-add command.
  - mDNS / QR are also valid entry points for HTTP agents that have a UI to scan.
- Token-based auth, single-tier (per P18).

**FR-5 (Ubiquitous).** **In-memory agents (typical: MeshCraft pipeline; same-process)**:
- Auth is trust-in-process (per `meshcraft-integration`). No token.

**FR-6 (Ubiquitous).** **Custom agents**:
- Use any of the above transports. Same pairing semantics as documented agents.

### 3.3 Server-side agent pool

**FR-7 (Ubiquitous).** The server tracks paired clients in a `paired_devices` table (per `pairing-protocol`); each entry has a `client_kind` field: `"tablet" | "agent" | "host" | "unknown"`. Agents declare `client_kind: "agent"` in their handshake capabilities.

**FR-8 (Ubiquitous).** Server resource `diffusecraft://server/agents` returns the subset of paired devices where `client_kind === "agent"`, along with their `supportsSampling` flag and `last_used_at`.

**FR-9 (Ubiquitous).** A server config `default_sampling_agent_token_name` MAY designate one paired agent as the default sampling backend (per `prompt-enhancement` FR-10). When set, sampling routes to that agent first.

### 3.4 Sampling routing across the pool

**FR-10 (Ubiquitous).** When the server needs to perform sampling (`enhance_prompt`, `select_by_prompt`, future tools), the resolver (per `prompt-enhancement` FR-10) walks priority:

1. **Calling client itself** — if the current request is from a sampling-capable agent. (Self-loop case.)
2. **Configured default sampling agent** — `default_sampling_agent_token_name`.
3. **First active sampling-capable session** in the pool — round-robin or first-found, per server config.
4. **None available** → `SAMPLING_NOT_SUPPORTED`.

**FR-11 (Ubiquitous).** When multiple agents are eligible (priority 3 fallthrough), the server SHALL pick **deterministically** within a session (stable hash of the requesting token + a salt) so repeat invocations from the same client hit the same agent (improving cache effectiveness).

**FR-12 (Ubiquitous).** Sampling timeout 30s default. On timeout, the server tries the next-priority agent before returning `ENHANCEMENT_TIMEOUT` / `SAMPLING_NOT_SUPPORTED`.

### 3.5 The QR-grants-everything invariant

**FR-13 (Ubiquitous).** A tablet scanning the server's QR (or mDNS-pairing) SHALL gain access to:
- ComfyUI image inference (via tools like `generate_image`)
- Script execution sandbox (via `apply_script`)
- The **agent pool** the server has paired (via tools like `enhance_prompt` and `select_by_prompt`, which route to sampling)
- All other server-hosted capabilities (history, layers, transforms, etc.)

**FR-14 (Ubiquitous).** The tablet user **does NOT need to configure agents on the tablet**. Any agent setup happens on the server. From the tablet's perspective, sampling-driven features either work (because at least one agent is paired) or don't (with a clear error).

**FR-15 (Ubiquitous).** This is reflected in the tablet UX: the ✨ Enhance button is enabled iff `mcpCatalogStore` reports `enhance_prompt` available AND `server.has_sampling_agent === true` (returned by `get_server_info` per `prompt-enhancement` FR Q server-info field).

### 3.6 Compatibility matrix (tested combinations)

**FR-16 (Ubiquitous).** v1 release SHALL include a tested matrix asserting end-to-end function for at least these combos:

| Combo | Agent | Tablet | Server | Use case |
|---|---|---|---|---|
| 1 | Claude Code (stdio) | absent | npx server | agent-only headless orchestration |
| 2 | Claude Desktop (HTTP) | iPad | npx server | typical user setup |
| 3 | absent | iPad | MeshCraft (host) | tablet ↔ MeshCraft, no agent assistance (Tier 4 select-by-prompt unavailable) |
| 4 | Claude Code + Gemini CLI (both HTTP) | iPad | npx server | multi-agent pool with default routing |
| 5 | Custom Python agent | iPad | npx server | custom agent invokes tools; tablet uses sampling via Claude (must be co-paired) |

**FR-17 (Ubiquitous).** CI runs the matrix against simulator agents (mock MCP clients with sampling-response stubs). Real-vendor smoke tests run on each catalog version bump.

### 3.7 Per-agent configuration recipes (documented)

**FR-18 (Ubiquitous).** v1 SHALL document concrete configuration recipes for each supported agent in `docs/agents/`:

- `docs/agents/claude-desktop.md`: how to add the DiffuseCraft MCP server to Claude Desktop config (`claude_desktop_config.json`).
- `docs/agents/claude-code.md`: `claude mcp add diffusecraft <url-token>` command-line.
- `docs/agents/codex.md`: equivalent for OpenAI Codex (when MCP client matures).
- `docs/agents/gemini-cli.md`: equivalent for Gemini CLI.
- `docs/agents/custom.md`: how to write a custom client using `@modelcontextprotocol/sdk` (Python or TS).

Each doc includes: pairing command, sampling-handler boilerplate (for clients that support sampling), recommended-usage section.

### 3.8 Tablet UX: visualizing the agent pool

**FR-19 (Ubiquitous).** The tablet's "Server & Devices" panel SHALL show:
- The server (the box this user is paired to).
- Other paired tablets / phones / hosts.
- **The agent pool**: each paired agent with name, sampling-capable flag, last-used timestamp, and a revoke button.

**FR-20 (Ubiquitous).** When no sampling-capable agent is paired, the tablet UI surfaces a clear hint near the ✨ Enhance button: "Pair an AI agent on the server to enable enhancement. See server-side instructions."

**FR-21 (Ubiquitous).** Tablet UI does NOT offer to "add an agent from the tablet". Adding agents is a server-side operation (CLI on the server host or MeshCraft's "Devices & Agents" panel). This keeps the tablet UX simple.

### 3.9 Recommended usage patterns

**FR-22 (Ubiquitous).** Documented patterns for agents acting as orchestrators:
- **Generate-and-iterate**: per the MCP prompt template `generate-and-iterate`.
- **Refine-with-control**: per the prompt template `refine-with-control`.
- **Inpaint-region**: per `inpaint-region` template.
- **Batch-variations**: per `batch-variations` template.

(Templates already specced in `mcp-tool-catalog/design.md` §8.)

**FR-23 (Ubiquitous).** Documented patterns for agents serving sampling:
- Respond with the rewritten prompt **only**, no preamble (per `prompt-enhancement` FR-5).
- Respond to vision-grounding requests with bounding-box JSON only (per `selection-tools` FR Tier 4).
- Respect the system prompt's format expectations.

### 3.10-bis Chat panel: tablet → agent → tools → document

The tablet has a **chat panel** where the illustrator types or dictates natural-language requests; the message routes through the server to a paired agent (sampling-routed); the agent reasons about the canvas + replies + invokes DiffuseCraft tools to apply changes; the tablet sees both the agent's text response AND the document-change events.

This is **agent-driven editing from the tablet** — the user doesn't need to know about MCP tools; they just describe what they want.

**FR-30 (Ubiquitous).** New MCP tools added by this spec:

| Tool | Category | Purpose |
|---|---|---|
| `send_chat_message` | job | Send a message to the chat agent. Returns chat response text + summary of invoked tools. |
| `get_chat_history` | read | Read recent chat messages for the active document. |
| `clear_chat` | write | Clear chat history for a document. |

**FR-31 (Ubiquitous).** `send_chat_message({ message, document_id?, conversation_id? })`. Server:
1. Stores the message in the document's chat history (SQLite `chat_messages` table).
2. Builds a sampling request to the configured **chat-agent** (= default sampling agent unless overridden via `chat_agent_token_name` config).
3. Sampling system prompt: "You are a DiffuseCraft co-pilot. The user is editing this canvas: {canvas_summary}. Recent chat history: {history}. Available tools: {filtered_catalog}. Respond with a brief text reply, AND include `<tool>{name, args}</tool>` blocks for any tools you want to invoke. The server will execute them under your identity."
4. Receives the sampling response.
5. Parses out text response + tool blocks.
6. Executes each parsed tool call as the agent (using the agent's token, which is what's already paired).
7. Returns to the tablet: `{ response_text, tools_invoked: [{ name, args, result_summary }] }`.

**FR-32 (Ubiquitous).** Tool calls invoked by the chat agent flow through the **same pipeline** as direct calls — same audit log, same undo/redo Commands, same document.changed events. The tablet (and any other paired client) sees the changes.

**FR-33 (Ubiquitous).** Conversation history is persisted in `chat_messages` table:
- `id` (ULID), `document_id`, `conversation_id` (per-document; one ongoing conversation per document by default), `role: "user" | "agent"`, `text`, `tool_invocations_json?` (for agent role), `created_at`.

**FR-34 (Ubiquitous).** Resource `diffusecraft://document/<id>/chat-history` returns paginated `chat_messages` for a document.

**FR-35 (Ubiquitous).** Chat agent SHALL be configurable per-server: `ServerConfig.sampling.chat_agent_token_name`. Defaults to the same as `default_sampling_agent_token_name`.

**FR-36 (Unwanted).** IF the chat-agent is unavailable, `send_chat_message` returns `SAMPLING_NOT_SUPPORTED`. Tablet UI shows: "Pair an AI agent to chat. See Server settings."

**FR-37 (Ubiquitous).** **Chat input supports speech-to-text** via the same `<MicButton />` from `speech-to-text` spec. STT result lands in the chat input as plain text; user can edit before sending or send immediately. Per P24, STT and chat composition are independent — tapping mic doesn't auto-send.

**FR-38 (Ubiquitous).** Chat catalog impact: 3 new tools (`send_chat_message`, `get_chat_history`, `clear_chat`). After this spec, v1 catalog reaches ~60 tools (at cap). Cap raised to **65** to allow headroom (per Q7 below).

### 3.10-ter Tablet UX: chat panel

**FR-39 (Ubiquitous).** A persistent **chat panel** SHALL be available in the tablet UI:
- Sidebar / drawer (right-side in landscape, bottom-up sheet in portrait).
- Toggle via icon in top bar; remembered per session.
- Conversation thread with user / agent message bubbles.
- Tool-invocation summaries shown inline ("✓ Generated 4 variations / Applied preview B").
- Input at bottom: text input + 🎤 mic button + ✨ enhance (optional, for the chat input — same enhancement pipeline) + send button.

**FR-40 (Ubiquitous).** Live state during a chat turn:
- "Thinking…" indicator while sampling round-trip in flight.
- Inline tool-execution progress (e.g., "Generating images... 60%").
- Final response when complete.
- User can interrupt via cancel; sends `cancel_job` for the underlying chat job.

**FR-41 (Ubiquitous).** Suggested-prompt chips above input on first chat-panel open (one-time per document):
- "Make this brighter"
- "Generate 4 variations"
- "Refine the face"
- User can dismiss / customize.

**FR-42 (Ubiquitous).** Chat panel respects active workspace per `workspaces`: in Inpaint workspace, chat hints favor selection-driven phrasing; in Upscale workspace, hints favor "make this 4x" style.

### 3.10-quat Multi-client coordination of chat

**FR-43 (Ubiquitous).** Chat is per-document. Two clients on the same document share the same chat thread; both see all messages.

**FR-44 (Ubiquitous).** When client A sends a chat message and the agent runs, client B sees the agent's tool invocations as `document.changed` events, AND sees the chat messages in the shared thread.

**FR-45 (Ubiquitous).** Token-name shows on each user message ("iPad de Igna asked: ...") so multi-user collaboration is legible.

### 3.10-quint Chat authorization

**FR-45-a (Ubiquitous).** A paired token (tablet, agent, host-internal) MAY invoke `send_chat_message` against any document the token can otherwise access (no per-document chat authorization tier in v1 — single-tier model per P18). The conversation is per-document, so cross-document leakage is structural impossibility, not a permission rule.

**FR-45-b (Ubiquitous).** `get_chat_history` and `clear_chat` follow the same access model: any paired token can read/clear history of any document it can read/write. Audit log records each access with `{ token_name, document_id, operation, ts }`.

**FR-45-c (Ubiquitous).** When `send_chat_message` is invoked, the chat-orchestrator routes sampling to the configured chat-agent (FR-35). The chat-agent receives messages it didn't originate; this is by design (the chat-agent serves all paired clients on the document). The audit log records `triggering_token_name` (who sent the message) AND `agent_token_name` (who answered) so the trail is clear.

**FR-45-d (Unwanted).** IF the calling token does not have access to the target document (e.g., document was deleted or token revoked mid-flight), the server SHALL respond with `NOT_FOUND { document_id }` or `UNAUTHORIZED` as appropriate.

### 3.10-sext Chat transaction atomicity

**FR-45-e (Ubiquitous).** Chat turns are **eventually consistent, not transactional**: each step in `ChatOrchestrator.run` (persist user msg → sampling → execute tools → persist agent msg) is best-effort. If sampling or tool execution fails mid-flight, the user message remains persisted; the server emits a partial result.

**FR-45-f (Ubiquitous).** When sampling/tool execution fails after the user message is stored, the orchestrator SHALL persist a synthetic agent message with `role: "agent"`, `text: ""`, `tool_invocations_json: { error: <reason> }`, marking the turn as terminated. This keeps the chat history legible (no orphan user messages with no reply).

**FR-45-g (Ubiquitous).** When SOME tool calls succeed and others fail within one turn, the agent message is persisted with the partial `tool_invocations_json` array; the agent's text response is preserved. Document state mutations from successful tool calls remain (each is its own reversible Command per P27); failed tool calls are reported in the chat thread and do not roll back the successful ones.

**FR-45-h (Ubiquitous).** Cancellation mid-turn (`cancel_job`) cleanly stops further tool execution; partial state is persisted as in FR-45-g. The user can re-issue or undo individually.

### 3.10 Audit & observability

**FR-24 (Ubiquitous).** Agent invocations are audit-logged with `{ token_name, client_kind, operation, ts, outcome, latency_ms }`. Same shape as other clients.

**FR-25 (Ubiquitous).** Sampling requests routed to an agent are audit-logged with `{ source_token, target_agent_token_name, operation, ts, latency_ms }` so the user can see "iPad asked for enhancement → routed to Claude Code → 1.2s latency".

**FR-26 (Ubiquitous).** Server resource `diffusecraft://server/sampling-stats` returns aggregate counts per agent (helpful for debugging "why is enhancement slow?").

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Agent compatibility doc updates SHALL be part of the release checklist; new vendor support requires running the test matrix.

**NFR-2 (Ubiquitous).** The catalog format MUST be the official MCP spec — no vendor extensions. Output parsing SHOULD tolerate minor stylistic variations across vendors but reject material non-compliance.

**NFR-3 (Ubiquitous).** Sampling round-trip latency budget across pool: 95th percentile ≤ 5 s for `enhance_prompt`-class requests on a good agent.

**NFR-4 (Ubiquitous).** No vendor SDK is bundled in the server. The server speaks pure MCP via `@modelcontextprotocol/sdk`. Each vendor agent brings its own SDK and credentials.

## 5. Out of scope

- **Vendor-specific tool customization** (Anthropic-only or OpenAI-only tools surfacing). Forbidden by P3.
- **Server-managed agent lifecycle** (server spawning Claude Code as subprocess). The server doesn't launch agents; users do.
- **Agent reputation / quality scoring** across the pool. v2 if useful.
- **Agent billing / cost tracking** (each agent invocation costs the agent's owner's tokens with their provider). Not DiffuseCraft's concern.
- **Unattended agent token rotation**. Agents follow standard rotation per `pairing-protocol`.

## 6. Open questions

### Q1 — Should the server expose `add_agent_token` as an MCP tool for admin agents to issue sub-tokens to other agents?
Useful for orchestrators that want to spawn sub-agents.

**Recommendation:** **post-v1**. v1 keeps token issuance to the server CLI / MeshCraft UI. Programmatic issuance opens a vector for token-permission proliferation that needs careful design.

### Q2 — Should sampling routing fall through if the chosen agent refuses?
A refusal isn't a timeout; should we try the next agent?

**Recommendation:** **no in v1**. Refusals propagate as `ENHANCEMENT_REFUSED` with the agent's reason. Falling through risks bypassing intentional refusals. User can explicitly retry with a different agent via `target_model` config or by switching default.

### Q3 — Should we support agent capabilities beyond sampling (e.g., agent-provided tools the server exposes)?
An agent could register tools that the rest of the pool can invoke.

**Recommendation:** **post-v1**. v1 the server is the catalog source of truth; agents can register custom tools only via `addCustomTool` (typically reserved for hosts like MeshCraft, not external agents).

### Q4 — Tablet displays which agent answered ✨ Enhance for trust / transparency?
Some users want to know which model rewrote.

**Recommendation:** **yes**. Tablet shows `agent_name` from the result (per `prompt-enhancement` FR-2 output). Small "via Claude Code" tag near the rewritten field for ~3s.

### Q5 — Should agents be able to subscribe to events scoped to other clients (e.g., monitor what the tablet user is doing)?
Privacy and consent concern.

**Recommendation:** **scoped subscriptions only** in v1. Agents see events for documents they have an active context on (i.e., they have invoked tools touching that document). Cross-client snooping requires explicit human approval (post-v1 spec).

### Q6 — Compatibility window: how long does the server support older agents?
SDK versions evolve.

**Recommendation:** support the latest two MCP SDK majors. Older agents get a friendly deprecation warning at handshake. Documented per release.

### Q7 — Catalog cap raise to accommodate chat tools
Adding `send_chat_message`, `get_chat_history`, `clear_chat` pushes total catalog to ~60 (at current cap).

**Recommendation:** **raise cap to 65** in `mcp-tool-catalog` FR-36. Footprint NFR-3 (≤100 KB) remains the actual hard gate; verify in CI.

### Q8 — Should chat tool invocations require explicit user confirmation before executing on canvas?
"Approve before applying" mode.

**Recommendation:** **opt-in setting**, default OFF (agents execute directly). Power users / cautious workflows can toggle "Confirm before applying" → tablet shows a "Approve" prompt for each tool call. Documented as power-user setting.

### Q9 — Chat agent vs sampling agent: same or different?
The "chat agent" (FR-35) might warrant being a different paired agent than the "default sampling agent" used for `enhance_prompt`.

**Recommendation:** **same by default; configurable separately**. `chat_agent_token_name` defaults to `default_sampling_agent_token_name`; user can split if they want one model for translation and a different one for orchestration.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The six user stories (§2) are achievable.
2. Each agent type has a documented pairing recipe (FR-18).
3. The QR-grants-everything invariant (FR-13..15) is preserved across all paths.
4. Sampling routing is deterministic within a session (FR-11).
5. The compatibility matrix (FR-16) covers the listed agents and is testable.
6. Tablet UX surfaces agent-pool state without exposing agent setup (FR-19..21).
7. Open questions have acceptable recommendations.
