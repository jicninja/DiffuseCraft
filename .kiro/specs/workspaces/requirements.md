# workspaces — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (`set_workspace` / `get_workspace` already in v1 catalog), `server-architecture` (catalog filtering at handshake), all editor specs (which tools belong to which workspace).
> **References:** P12 (workspaces-as-modes), krita-ai-diffusion `ai_diffusion/ui/*` workspace mode logic, FR-38 of `mcp-tool-catalog` (workspace-based catalog filtering).

## 1. Purpose

Define the **workspace system** — the editor's modal lenses. A workspace determines:
- Which **MCP tools are surfaced** in `tools/list` for the calling client.
- Which **UI panels and tools** are visible in the tablet app.
- Which **action button labels** and **default behaviors** apply.

Workspaces reduce cognitive load by showing only what's relevant to the current task. Same document, different lens.

## 2. Stakeholders & user stories

### S1 — Illustrator switching modes
> **Story 1.** As an illustrator working on a generative composition, I'm in **Generate** workspace by default. After producing the result I want, I tap "Upscale" tab → workspace switches; the prompt panel collapses, an upscale settings panel appears, and the action button becomes "Upscale to 2x". I tap; the upscale runs.

### S2 — Illustrator focused on inpainting
> **Story 2.** As an illustrator polishing details, I switch to **Inpaint** workspace. The history strip is still visible but de-emphasized; selection sub-mode picker is prominent; the action button is always "Fill" (selection required). Generate without selection is suppressed in this mode.

### S3 — Agent activating a specific mode
> **Story 3.** As Claude Code orchestrating a session, I `set_workspace({ workspace: "Upscale" })` to constrain my available tools and reduce context noise. `tools/list` returns ~10 tools instead of 60. I `upscale_image` and exit.

### S4 — Two clients on same document, different workspaces
> **Story 4.** As a user with my tablet in **Generate** workspace AND my Claude Code agent paired in **Upscale** workspace, both work on the same document without conflict. Workspaces are per-client, not per-document.

### S5 — Persistence across reconnect
> **Story 5.** As an illustrator, my tablet drops Wi-Fi briefly and reconnects within the grace window. My workspace selection persists; I'm still in Generate where I left off.

## 3. Functional requirements (EARS)

### 3.1 Workspace enum

**FR-1 (Ubiquitous).** v1 SHALL define six workspace values:

| Workspace | v1 ships? | Notes |
|---|---|---|
| `Generate` | ✅ Yes (default) | Primary mode for txt2img / img2img / fill / refine |
| `Inpaint` | ✅ Yes | Sub-flavor of Generate, selection-required, action button always "Fill" |
| `Upscale` | ✅ Yes | Specialized for upscaling; simplified UI |
| `Live` | ❌ Deferred to v0.2 | Server returns `WORKSPACE_NOT_AVAILABLE` if attempted |
| `CustomGraph` | ❌ Post-v1 | Server returns `WORKSPACE_NOT_AVAILABLE` |
| `Animation` | ❌ Post-v1 | Server returns `WORKSPACE_NOT_AVAILABLE` |

**FR-2 (Ubiquitous).** Default workspace on a fresh client session: `Generate`.

### 3.2 Per-client per-session state

**FR-3 (Ubiquitous).** Workspace is **per-token per-session**, not per-document. Two clients on the same document can be in different workspaces simultaneously without interference.

**FR-4 (Ubiquitous).** Workspace state is in-memory on the server, keyed by `token_id`. Server restart resets all workspaces to default.

**FR-5 (Ubiquitous).** Workspace persists across the disconnect grace window (reconnect within `pairing.retain_after_disconnect_seconds`, default 600s, per `pairing-protocol`).

### 3.3 Tools available per workspace

**FR-6 (Ubiquitous).** Each tool in `@diffusecraft/mcp-tools` SHALL declare its `workspace` field listing the workspaces in which it is **active**. Tool invocation in a non-matching workspace returns `TOOL_NOT_AVAILABLE_IN_WORKSPACE`.

**FR-7 (Ubiquitous).** Per-workspace tool availability for v1:

| Tool group | Generate | Inpaint | Upscale |
|---|---|---|---|
| Server / session (3) | ✅ | ✅ | ✅ |
| Documents (3) | ✅ | ✅ | ✅ |
| Layers (3) | ✅ | ✅ | ✅ |
| Selection (5) | ✅ | ✅ | ✅ |
| Generation (`generate_image`, `cancel_job`, `get_job_status`) | ✅ | ✅ (selection required by client UX) | ❌ |
| History (3) | ✅ | ✅ | ✅ |
| Control layers (3) | ✅ | ✅ | ❌ |
| Regions (4) | ✅ | ✅ | ❌ |
| Workspaces (`set_workspace`, `get_workspace`) | ✅ | ✅ | ✅ |
| Upscale (`upscale_image`) | ✅ | ✅ | ✅ (primary) |
| Models / presets (4) | ✅ | ✅ | ✅ |
| Speech / enhance (2) | ✅ | ✅ | ❌ |
| Undo / redo (2) | ✅ | ✅ | ✅ |
| Image read (2) | ✅ | ✅ | ✅ |
| Image edit (3) | ✅ | ✅ | ❌ |
| Export (1) | ✅ | ✅ | ✅ |
| `apply_script` | ✅ | ✅ | ❌ |
| `import_brush`, `delete_brush` | ✅ | ✅ | ❌ |

**FR-8 (Ubiquitous).** Tools always available regardless of workspace: `get_server_info`, `get_audit_log`, `revoke_token`, `set_active_document`, `set_workspace`, `get_workspace`, `undo`, `redo`, `cancel_job`, `get_job_status`. (Cross-cutting essentials.)

### 3.4 `tools/list` filtering

**FR-9 (Ubiquitous).** During MCP handshake, when the client declares an `active_workspace` capability, the server SHALL return `tools/list` filtered to only include tools active in that workspace. Same for `resources/list`.

**FR-10 (Event-driven).** WHEN the client calls `set_workspace({ workspace: <new> })`, the server SHALL update the per-token workspace AND emit a `workspace.changed` event so the client knows to refresh `tools/list`.

**FR-11 (Ubiquitous).** Clients that don't declare `active_workspace` capability receive the **full** catalog (workspace filtering doesn't apply). This matches the catalog defaults for backward compatibility.

### 3.5 UI behavior per workspace (tablet)

**FR-12 (Ubiquitous).** **Generate workspace UI:**
- Top bar: workspace tabs (Generate / Inpaint / Upscale visible).
- Right panel: Layers + Regions tabs.
- Bottom: history strip + prompt input.
- Action button: dynamic label (Generate / Refine / Fill / Constrained variation per `generation-workflow` FR-12).
- All editor tools (selection, brush, transform) accessible.

**FR-13 (Ubiquitous).** **Inpaint workspace UI:**
- Same as Generate but:
  - Selection toolbar prominent (top of canvas).
  - Selection sub-mode picker always visible (Fill / Expand / AddContent / RemoveContent / ReplaceBackground).
  - Action button is **always "Fill"** (or sub-mode label); disabled when no selection active.
  - History strip de-emphasized.

**FR-14 (Ubiquitous).** **Upscale workspace UI:**
- Top bar: workspace tabs.
- Right panel: Upscale settings (target factor 2x/4x/8x, model picker, tile size, seam blending).
- Canvas: shows preview of last result; tap-to-zoom for inspection.
- Action button: "Upscale to Nx" with current factor.
- Layers panel collapsed; minimal tools.

**FR-15 (Ubiquitous).** Workspace switch animations: smooth panel slide-out / slide-in over ~250 ms. Visual indicator on the active tab.

### 3.6 Server enforcement

**FR-16 (Unwanted).** IF an agent invokes a tool not active in its workspace, THE server SHALL respond with `TOOL_NOT_AVAILABLE_IN_WORKSPACE { tool, current_workspace, allowed_workspaces }`. Agent can switch via `set_workspace` and retry.

**FR-17 (Unwanted).** IF an agent attempts to set a workspace not available in v1 (Live, CustomGraph, Animation), the server SHALL respond with `WORKSPACE_NOT_AVAILABLE { workspace, available }` listing v1 workspaces.

### 3.7 Inpaint workspace semantics

**FR-18 (Ubiquitous).** Inpaint is functionally a **constrained Generate**. The same `generate_image` tool runs, but:
- Server-side, when called in Inpaint workspace, the input is validated to require an active selection → if absent, returns `INPAINT_REQUIRES_SELECTION`.
- The default `selection_mode` is `Fill` (was implicit in Generate).
- The default `strength` is `100` (Fill behavior).

**FR-19 (Ubiquitous).** Tablet UI in Inpaint hides the strength slider beyond a fixed 100; user cannot accidentally make a Refine call. To Refine, switch to Generate workspace.

### 3.8 Upscale workspace semantics

**FR-20 (Ubiquitous).** Upscale workspace is for committing the document or a selected layer to a higher resolution via tile-based upscaling. Detailed flow lives in `upscale-and-tiling` spec; this spec defines the workspace shell.

**FR-21 (Ubiquitous).** Upscale workspace SHALL provide quick access to:
- Target factor (2x / 4x / 8x).
- Model picker (default 4x-UltraSharp or similar).
- Tile size + overlap (advanced).
- Source picker (Active document / specific history item / specific layer).

### 3.9 MCP tools and resources

**FR-22 (Ubiquitous).** `set_workspace({ workspace })` and `get_workspace()` already in v1 catalog. This spec extends:
- `set_workspace` returns `{ workspace, available_tools_count }` — informational; helps agents calibrate.
- Resource `diffusecraft://session/workspace` returns `{ workspace, available_tools, available_resources }` — agent can read without invoking a tool.

**FR-23 (Ubiquitous).** Catalog impact: 0 new tools. The existing `set_workspace` / `get_workspace` get richer schemas but the count stays. Catalog stays at ~57 (within cap of 60).

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Workspace switch latency: server response ≤ 50 ms; tablet UI animation ~250 ms (smooth, not instant).

**NFR-2 (Ubiquitous).** `tools/list` filtering does NOT require a re-handshake; client can call `tools/list` again after `set_workspace` to refresh.

**NFR-3 (Ubiquitous).** Workspace state SHALL NOT persist across server restart (per FR-4); clients restart in `Generate` after restart.

## 5. Out of scope

- **Live, Custom Graph, Animation workspaces** — explicitly post-v1.
- **Per-document workspace persistence** — workspace is per-client per-session.
- **Workspace presets / saved configurations** (e.g., "save my Inpaint settings"). Post-v1 if at all.
- **Workspace-specific keyboard shortcuts** when keyboard available — could be added post-v1.
- **Multi-tab workspaces** (multiple workspaces simultaneously per client) — out of scope; one active at a time.

## 6. Open questions

### Q1 — Should workspace selection survive server restart?
v1 says no (in-memory). Persisting would require SQLite + cleanup on token revocation.

**Recommendation:** **no in v1.** Restart back to default Generate. Trivial and avoids a stale-state class of bugs. Post-v1 if user demand exists.

### Q2 — When a client is in Inpaint and it has no selection, should we auto-switch to Generate?
Auto-switching feels magical and might confuse users.

**Recommendation:** **no auto-switch.** Inpaint without selection shows a clear hint: "Make a selection to fill, or switch to Generate for full-canvas". The action button is disabled with explanation tooltip.

### Q3 — Catalog filtering: hard-fail or soft-warn when tool not in workspace?
Hard-fail = `TOOL_NOT_AVAILABLE_IN_WORKSPACE`. Soft-warn = execute but emit a warning.

**Recommendation:** **hard-fail.** Cleaner contract for agents. They `set_workspace` first if they need a different tool.

### Q4 — Should `set_workspace` be reversible (undoable)?
It's a session navigation, not document state.

**Recommendation:** **no — non-reversible**. Workspace switching shouldn't show in undo stack. The catalog has `set_workspace` marked `reversible: yes` currently — this spec changes it to `reversible: no` (session-state, not document-state). Update `mcp-tool-catalog` accordingly.

### Q5 — Are workspace-specific UIs persistent (e.g., does Upscale's last factor remember)?
Some persistence is convenient.

**Recommendation:** **per-session UI prefs persist** (in `editorStore` UI prefs slice — already in `client-state-architecture`). Upscale factor, tile size, etc., remembered for the session. Cleared on reconnect grace expiry or explicit reset.

### Q6 — Live workspace — when does it land?
Per `mcp-tool-catalog` §3.3.11 Live tools deferred to v0.2.

**Recommendation:** ship `Live` workspace + tools together post-v0.1 in v0.2 sprint. Spec hints at the integration but doesn't include it in v1 implementation.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized.
2. The 3 v1 workspaces (Generate, Inpaint, Upscale) work end-to-end.
3. Tool filtering at MCP handshake works correctly per workspace.
4. UI panels reorganize per workspace within the latency budget.
5. Per-token state persistence across reconnect grace.
6. Open questions have acceptable recommendations.
