# external-agent-integration — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration + vendor-compat tests, TSDoc on public exports, Conventional Commits with `server`, `mobile`, or `mcp-tools` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~6–9 weeks for one engineer.** Chat orchestrator is the longest piece; vendor matrix runs in parallel.

---

## Phase A — Agent pool tracking

- [ ] **A.1** `client_kind` field added to `paired_devices` / handshake capabilities. **(S)**
- [ ] **A.2** `PoolRegistry` class with `agents()` + `samplingAgents()` queries. **(M)**
- [ ] **A.3** Resource `diffusecraft://server/agents` returning agent subset. **(S)**
- [ ] **A.4** Resource `diffusecraft://server/sampling-stats` with aggregate counts. **(S)**
- [ ] **A.5** Tests with multiple agents declaring different `client_kind`. **(M)**

## Phase B — Sampling router

- [ ] **B.1** `SamplingRouter.resolve(ctx)` per design.md §4 with priority 1–3 fallthrough. **(M)**
- [ ] **B.2** Stable hash-based deterministic pool pick (FR-11). **(S)**
- [ ] **B.3** Wire into `enhance_prompt` (replaces inline resolver from prompt-enhancement spec). **(S)**
- [ ] **B.4** Wire into `select_by_prompt` (selection-tools Tier 4). **(S)**
- [ ] **B.5** Tests: each priority case + multi-agent fallthrough + no-agent-paired. **(M)**

## Phase C — Chat persistence

- [ ] **C.1** Migration `00X-chat-messages.ts`: table per design.md §5. **(S)**
- [ ] **C.2** Indexes on `(document_id, conversation_id, created_at)`. **(XS)**
- [ ] **C.3** Chat repository class with `recentMessages`, `append`, `clear`. **(M)**

## Phase D — Chat orchestrator

- [ ] **D.1** `chat-system-prompt.md` template per design.md §7. **(S)**
- [ ] **D.2** `parseToolBlocks` lenient regex parser. **(M)**
- [ ] **D.3** `ChatOrchestrator.run` per design.md §5. **(L)**
- [ ] **D.4** `dispatchAs(token_id, tool, args)` capability on the dispatcher (executes a tool under another token's identity for chat agent's tool calls). **(M)**
- [ ] **D.5** Audit-log entries for chat tool invocations tagged with both agent_token AND triggering chat user_token. **(S)**
- [ ] **D.6** Tests: orchestrator with mock sampling responses producing valid + invalid + no-tool-blocks + many-blocks responses. **(L)**

## Phase E — Chat tools (catalog)

- [ ] **E.1** Add `send_chat_message`, `get_chat_history`, `clear_chat` to `@diffusecraft/mcp-tools`. **(M)**
- [ ] **E.2** Add `chat.message` event to manifest. **(S)**
- [ ] **E.3** Resource `diffusecraft://document/<id>/chat-history`. **(S)**
- [ ] **E.4** **Raise catalog cap from 60 → 65** in `mcp-tool-catalog/requirements.md` FR-36. **(XS)**
- [ ] **E.5** Footprint test re-run. **(XS)**

## Phase F — Server handlers

- [ ] **F.1** `sendChatMessageHandler` invoking the orchestrator. Job-based per FR-30. **(M)**
- [ ] **F.2** `getChatHistoryHandler`. **(S)**
- [ ] **F.3** `clearChatHandler` with reversible Command (revert restores cleared messages). **(S)**
- [ ] **F.4** `chat_agent_token_name` config separate from `default_sampling_agent_token_name`. **(S)**
- [ ] **F.5** Tests: end-to-end chat round-trip with mock agent producing tool blocks; tool calls executed; document updates emitted. **(L)**

## Phase G — Vendor compatibility matrix

- [ ] **G.1** Test fixture: Claude Code (stdio) + npx server scenario per FR-16 combo 1. **(M)**
- [ ] **G.2** Test fixture: Claude Desktop + iPad (mock) + npx server per combo 2. **(M)**
- [ ] **G.3** Test fixture: iPad + MeshCraft (host) per combo 3 (no agent). **(M)**
- [ ] **G.4** Test fixture: Claude Code + Gemini CLI both paired per combo 4 (deterministic routing assertion). **(M)**
- [ ] **G.5** Test fixture: custom Python agent + iPad + Claude paired per combo 5. **(M)**
- [ ] **G.6** Real-vendor smoke test on each catalog version bump. **(S)**

## Phase H — Tablet UX: agent pool visibility

- [ ] **H.1** `<DevicesAndAgentsPanel />` per design.md §10. **(M)**
- [ ] **H.2** `<AgentRow />` with name + sampling-capable badge + revoke. **(S)**
- [ ] **H.3** Empty-state when no agents paired. **(S)**
- [ ] **H.4** `<AgentBadge />` showing "via Claude Code" tag in chat / enhancement results (3s auto-fade). **(S)**

## Phase I — Tablet UX: chat panel

- [ ] **I.1** `<ChatPanel />` drawer-style component (right-side landscape, bottom-up portrait). **(M)**
- [ ] **I.2** `<ChatMessage />` with user/agent bubbles + tool-invocation summary chips. **(M)**
- [ ] **I.3** `<ChatInput />` with text + mic + optional enhance + send. **(M)**
- [ ] **I.4** `<SuggestedPromptChips />` workspace-aware. **(S)**
- [ ] **I.5** `chatStore` slice: messages-per-document, in-flight state, suggested prompts cache. **(S)**
- [ ] **I.6** Subscribe to `chat.message` events via `client.events.on`. **(S)**
- [ ] **I.7** Inline tool-execution progress (e.g., "Generating images... 60%"). **(M)**
- [ ] **I.8** Cancel button → sends cancel_job for the in-flight chat job. **(S)**
- [ ] **I.9** STT integration in chat input (reuses MicButton from speech-to-text). **(S)**
- [ ] **I.10** Optional ✨ Enhance on the chat input itself before send. **(S)**
- [ ] **I.11** Confirm-before-applying setting (Q8): toggle in user prefs; if on, each tool call shows approve/reject prompt. **(L)**
- [ ] **I.12** Tests: end-to-end chat flow against mock client. **(L)**

## Phase J — Documentation

- [ ] **J.1** `docs/agents/claude-desktop.md` per design.md §11.1. **(M)**
- [ ] **J.2** `docs/agents/claude-code.md` per §11.2. **(M)**
- [ ] **J.3** `docs/agents/codex.md` (placeholder until Codex MCP support is mature; updated when ready). **(S)**
- [ ] **J.4** `docs/agents/gemini-cli.md`. **(M)**
- [ ] **J.5** `docs/agents/custom.md` with Python + TS examples. **(L)**
- [ ] **J.6** Migration guide from "I configure agents on my tablet" mental model to "the server is the broker". **(M)**
- [ ] **J.7** Operator guide: pairing the first agent on a fresh server. **(S)**
- [ ] **J.8** Privacy doc: chat data flow (tablet → server → agent → agent's LLM provider; data leaves DiffuseCraft via the agent's credentials). **(M)**

## Phase K — Performance & validation

- [ ] **K.1** Chat round-trip ≤5 s p95 with one paired agent. **(S)**
- [ ] **K.2** Sampling router benchmarks: routing decision <1 ms. **(XS)**
- [ ] **K.3** Concurrent chat sessions on different documents don't interfere. **(M)**
- [ ] **K.4** Audit log readable / queryable per requirement. **(S)**

---

## Dependency order

```
A → B → C → D
                \
                 → E (catalog) → F (handlers) → G (vendor matrix)
                                                  \
                                                   → H + I (tablet UX, parallel) → J (docs) → K (perf)
```

A foundational. B builds on A. C/D backend pieces. E/F backend completion. G validation. H/I tablet (parallel). J/K final.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agents produce inconsistent tool-block formats across vendors (some use JSON, some prose) | D.2 lenient parser; system prompt is explicit about format; G runs vendor matrix to catch drift. |
| Chat tool calls produce unexpected document mutations a user wasn't aware of | I.11 opt-in confirm setting; clear inline summaries; full undo via P27. |
| Sampling router round-robin causes inconsistent agent behavior across consecutive chats | B.2 stable-hash makes it deterministic per session. |
| Agent's response time variance (some agents slow) blocks chat panel | F.1 job-based with timeout; cancel button; D.6 timeout test. |
| Custom Python agents lacking sampling can't drive chat | F.4 separate `chat_agent_token_name` allows splitting; pool fallthrough handles. |
| Multiple paired agents fight for the "default" — confusion | DevicesAndAgentsPanel surfaces explicit "Default sampling agent: X" with edit affordance. |
| Catalog cap raise to 65 risks footprint cap (100 KB) | E.5 enforced; if over, trim descriptions; chat tool descriptions kept concise. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Vendor matrix passes for ≥2 real vendors (Claude Desktop, Claude Code).
3. Catalog cap raise + footprint validated.
4. Tablet UX functional.
5. Documentation complete for documented agent types.
6. Risks acceptable.

After approval, implementation begins with Phase A.
