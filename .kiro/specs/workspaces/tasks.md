# workspaces — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `core`, `server`, `mcp-tools`, or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~2–3 weeks for one engineer.** Mostly UI + tool-metadata wiring; no new heavy logic.

---

## Phase A — Types & catalog metadata

- [ ] **A.1** `Workspace` enum + `V1_WORKSPACES` + `ALWAYS_AVAILABLE_WORKSPACE_TOOLS` in `canvas-core`. **(S)**
- [ ] **A.2** `checkToolInWorkspace` helper. **(S)**
- [ ] **A.3** Add `workspace: Workspace[]` field to every tool definition in `@diffusecraft/mcp-tools` per the table in `requirements.md` §3.3. **(M)**
- [ ] **A.4** Update `set_workspace` to `reversible: false`. Update its description and output schema (return `available_tools_count`). **(S)**
- [ ] **A.5** Add `workspace.changed` event to manifest. **(XS)**
- [ ] **A.6** Add resource `diffusecraft://session/workspace`. **(S)**
- [ ] **A.7** Catalog footprint test re-run. **(XS)**
- [ ] **A.8** Tests: tool-availability checker covers all combinations. **(M)**

## Phase B — Server-side WorkspaceManager

- [ ] **B.1** `WorkspaceManager` class (per-token map + getter/setter + clear). **(S)**
- [ ] **B.2** Integrate into `server.start()` lifecycle. **(XS)**
- [ ] **B.3** Tie `clear(tokenId)` to pairing-protocol disconnect grace expiry. **(S)**
- [ ] **B.4** `WORKSPACE_NOT_AVAILABLE` error for non-v1 workspace requests. **(XS)**
- [ ] **B.5** Tests: per-token isolation; grace preservation; clear on grace expiry. **(M)**

## Phase C — Catalog filtering & enforcement

- [ ] **C.1** `filterToolsList(allTools, workspace)` helper. **(S)**
- [ ] **C.2** Wire into `tools/list` handler in HTTP + stdio + in-memory transports. **(M)**
- [ ] **C.3** `workspaceCheckMw` middleware in dispatcher. Inserted before `executeMw`. **(S)**
- [ ] **C.4** `TOOL_NOT_AVAILABLE_IN_WORKSPACE` error with `allowed_workspaces` hint. **(XS)**
- [ ] **C.5** Tests: invoking a Generate-only tool from Upscale → 4xx; switching workspace → success. **(M)**

## Phase D — Server handlers

- [ ] **D.1** `setWorkspaceHandler` updates `WorkspaceManager`, emits event, returns `{ workspace, available_tools_count }`. **(S)**
- [ ] **D.2** `getWorkspaceHandler` reads from `WorkspaceManager`. **(XS)**
- [ ] **D.3** `diffusecraft://session/workspace` resource handler returning `{ workspace, available_tools, available_resources }`. **(S)**
- [ ] **D.4** `generate_image` handler extension: in Inpaint workspace, require selection (FR-18). **(S)**
- [ ] **D.5** Tests for handlers + Inpaint validation. **(M)**

## Phase E — Tablet UX

- [ ] **E.1** `<WorkspaceTabs />` top tab bar with 3 v1 tabs. **(M)**
- [ ] **E.2** `<WorkspaceShell />` rendering the active layout via `AnimatePresence`. **(M)**
- [ ] **E.3** `<GenerateLayout />` (the existing default — extracted into named layout). **(M)**
- [ ] **E.4** `<InpaintLayout />` — Generate-derived layout with selection toolbar prominent + sub-mode picker visible + action button always Fill (disabled if no selection). **(M)**
- [ ] **E.5** `<UpscaleLayout />` — collapsed Layers, prominent Upscale settings panel, source picker. **(L)**
- [ ] **E.6** `editorStore.workspace` slice + per-workspace UI prefs nested object. **(S)**
- [ ] **E.7** Workspace switch animation 250 ms. **(S)**
- [ ] **E.8** Refresh `mcpCatalogStore` after `set_workspace` (re-fetch `tools/list`). **(S)**
- [ ] **E.9** Inpaint hint when no selection: "Make a selection to fill, or switch to Generate". **(S)**
- [ ] **E.10** Tests: switch flows; Inpaint disabled state; per-workspace prefs persist. **(M)**

## Phase F — Documentation

- [ ] **F.1** README on workspaces concept + when to use each + future Live/CustomGraph/Animation. **(M)**
- [ ] **F.2** Operator note: how to verify workspace filtering is working in the audit log. **(S)**
- [ ] **F.3** Agent integration guide: how to declare `active_workspace` in handshake; what `tools/list` returns. **(S)**

---

## Dependency order

```
A → B → C → D
            \
             → E → F
```

A (catalog metadata) → B (server state) → C (filtering + enforcement) → D (handlers) → E (tablet UX) → F (docs).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tool's `workspace` field forgotten on new tools (post-v1 tool added without thinking about workspace scope) | A.8 lint rule: tool definition without `workspace` field → CI warning. |
| Disconnect grace + workspace-clear race condition | B.3 pairing-protocol owns grace timer; on expiry, calls `WorkspaceManager.clear` synchronously. |
| Tablet switches workspace but old `tools/list` cached → stale UI | E.8 explicitly refreshes `mcpCatalogStore` after switch; test asserts UI shows correct tool buttons. |
| Inpaint validation surprises user when they had a selection that was cleared by a previous op | D.4 returns clear `INPAINT_REQUIRES_SELECTION` with hint; tablet UI keeps action button disabled with tooltip. |
| Live/CustomGraph/Animation tabs leak into v1 UI prematurely | A.1 uses `V1_WORKSPACES`; tabs render only those. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Tool-availability table from `requirements.md` §3.3 is reflected in tool definitions.
3. Catalog filter at handshake + middleware enforcement work.
4. Three v1 layouts switchable smoothly.
5. Risks acceptable.

After approval, implementation begins with Phase A.
