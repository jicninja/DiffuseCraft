# `undo-redo` — handler-author guide

## What this module is

This is the in-memory undo/redo subsystem implementing the [`undo-redo-system`](../../../../../.kiro/specs/undo-redo-system/) spec. It is the single load-bearing path for [P27 — Universal undo/redo](../../../../../.kiro/steering/principles.md#p27--universal-undoredo): every state-mutating MCP tool flagged `reversible: true` in the catalog routes through this module's `UndoRedoManager`. FR-34 (`requirements.md` §3.10) defines the handler-author contract; FR-35 codifies the build-time conformance gate that enforces it. Read this file before writing or migrating any reversible handler.

## Core types

- `Command<R>` — the parametric reversible operation (`apply()` / `revert()` plus metadata: `id`, `tool_name`, `document_id`, `args_summary`, `weight`, `created_at`, `affected_layer_ids`, `_result`). See [`command.ts`](./command.ts).
- `CommandSpec<R>` — the partial input shape passed to `buildCommand` (everything except `id`, `created_at`, `_result`). See [`command.ts`](./command.ts).
- `buildCommand<R>(spec)` — constructs a `Command<R>`, populating `id` (ULID), `created_at`, and an `apply` wrapper that captures the result for redo. See [`command.ts`](./command.ts).
- `UndoRedoManager` — the per-server instance that owns every `(token_id, document_id)` stack, the eviction policy, the disconnect-grace timers, and the conflict detector. Single public write-path: `execute()`. See [`manager.ts`](./manager.ts).

The barrel [`index.ts`](./index.ts) re-exports the public surface; downstream code should import from `@diffusecraft/server/lib/undo-redo` rather than individual files.

## The handler contract (FR-34)

Every reversible handler MUST follow this shape:

1. **Resolve `document_id`.** Read from `input.document_id ?? ctx.document_id`. Throw `ServerError({ code: 'INVALID_INPUT', ... })` when neither is present — reversible operations are document-scoped (FR-1, FR-5).
2. **Capture pre-state in handler scope, BEFORE the apply closure.** `apply()` runs inside `manager.execute()`; by the time `revert()` is called, the post-state has already been written. Anything `revert()` will need to restore must be read up front in the handler closure.
3. **Build the Command with `buildCommand({ ... })`** populating:
   - `tool_name` — catalog tool name (`add_layer`, `set_selection`, ...).
   - `document_id` — the resolved id from step 1.
   - `args_summary` — human-readable hint for the toast / audit log; ≤120 chars.
   - `weight` — `'small'` (visibility / name / 1-pixel mask), `'medium'` (layer add/remove, transform, paint stroke), or `'large'` (flatten, group transform, history-item apply). Drives snapshot policy.
   - `affected_layer_ids` — list of layer IDs the apply touches, when known. Used by conflict detection; empty / `undefined` means "scope unknown" and never overlaps.
   - `apply` — the mutation. Returns the catalog wire-shape result.
   - `revert` — the inverse, restoring the captured pre-state.
4. **Hand the Command to the manager.** Call `await ctx.undoRedo.execute(ctx.token_name, ctx.token_id ?? ctx.token_name, document_id, command)` and return its result verbatim. The stdio fallback (`ctx.token_id ?? ctx.token_name`) is required because stdio carries `token_id === null` (auth-trusted-by-process); HTTP / in-memory always carry a real id.

**Forbidden:**

- Do NOT call `ctx.publish('document.changed', ...)` for the same mutation — `manager.execute()` owns the emission and stamps `affected_layer_ids` + `originating_token_name` + `conflict` consistently.
- Do NOT mutate state outside `apply()`. Anything written before `execute()` runs will not be undone by `revert()` and the redo will reproduce a stale picture.
- Do NOT set `ctx.scratch.command` from new code. That is the legacy bridge; see "Legacy bridge" below.
- Do NOT call `apply()` yourself before handing the Command to the manager — the manager invokes it exactly once on enrolment and again on every redo.

## Reference template

The canonical reversible-handler shape lives at [`../handlers/_template.ts`](../handlers/_template.ts). It is documentation-only (never registered with the dispatcher) and exists so every reversible handler in `libs/server/src/lib/handlers/` has a single typecheck-clean reference. Copy it, swap the synthetic Zod stub for the catalog `inputSchema` / `outputSchema`, and replace the `apply` / `revert` bodies with spec-specific logic.

## Conformance check

Every catalog tool with `reversible: true` MUST have a registered handler whose source contains the literal string `ctx.undoRedo.execute(`. The check runs at `server.start()`, after every `dispatcher.register(...)` call has executed, via `assertUndoRedoConformance` in [`../conformance/undo-redo-conformance.ts`](../conformance/undo-redo-conformance.ts). A reversible tool whose handler file does NOT contain that string AND is NOT on the `KNOWN_LEGACY_PATHS` allowlist fails conformance and aborts the boot. The grep is source-level rather than runtime-tagged so the contract has zero handler-side friction (mirrors `libs/mcp-tools/src/conformance/catalog-conformance.ts`).

## Legacy bridge (transitional)

Ten handlers — the mask suite (`clear_mask`, `fill_mask`, `bake_mask`, `selection_to_mask`, `invert_mask`, `mask_to_selection`, `refine_mask`) and three selection helpers (`select_all`, `invert_selection`, `refine_selection`) — still ride the legacy `ctx.scratch.command` bridge through [`../middleware/reversible-command.ts`](../middleware/reversible-command.ts), which calls `manager.enrol(...)` after the handler has already mutated state. They are explicitly listed in `KNOWN_LEGACY_PATHS` in the conformance file. Do NOT add new handlers to that allowlist; migration of the existing entries is tracked in the `mask-system` and `selection-tools` specs respectively.

## Memory budget and eviction

Phase B caps the manager's total in-memory footprint at `max_total_memory_bytes` (default 512 MiB). A 30-second `setInterval` invokes `EvictionPolicy.run`, which (a) drops snapshot anchors first, then (b) shifts oldest commands off the deepest stack until the budget is met, never going below `floor_ops_per_stack` (default 5) per stack. Each command-eviction emits `undo.eviction { token_id, document_id, ops_evicted }` on the bus for observability (FR-28). Setting `max_total_memory_bytes <= 0` disables the periodic timer entirely; the policy stays instantiated for manual `eviction.run()` from tests.

## Conflict detection

When two clients edit overlapping `affected_layer_ids` within `conflict_window_ms` (default 1000), `manager.execute()` detects the overlap by reading recent `document.changed` events from the bus *before* applying the new Command. The second emit carries `conflict: true` and an `args_summary` augmented with the prior token's name (e.g., `"… (conflicts with prior edit by alice)"`). FR-15 last-write-wins applies to the canvas; both Commands stay in their respective stacks and remain independently undoable. Commands without `affected_layer_ids` (or with empty lists) never trigger conflict — that is the deliberate "scope unknown" sentinel for legacy and incremental migrations.

## Disconnect grace

`retain_after_disconnect_seconds` (default 600) keeps a token's stacks alive across transient disconnects. The transports' [`ConnectionTracker`](../transports/connection-tracker.ts) ref-counts live HTTP / stdio dispatches per token; on the first reconnect the manager calls `onTokenReconnect(token_id)` to cancel the pending discard, and on the last disconnect it calls `onTokenDisconnect(token_id)` to schedule one. Token revocation (`auth.token-revoked` bus event) calls `discardForToken` immediately, ignoring the grace window — revoked tokens never recover their stacks.

## MCP surface

- Tools — `undo` and `redo` live in [`libs/mcp-tools/src/tools/undo-redo/`](../../../../mcp-tools/src/tools/undo-redo/). Both default `document_id` from session state when the input omits it (Phase C.3).
- Resources — `diffusecraft://undo-stack/<doc>` and `diffusecraft://redo-stack/<doc>` expose the per-stack `CommandSummary` projection with `fields` + cursor pagination (Phase D.3 ships without `since` because the catalog declares `supports_since: false`).

## Tablet UX

The `useUndoRedo` hook (Phase H.1) lives at [`libs/core/src/hooks/useUndoRedo.ts`](../../../../core/src/hooks/useUndoRedo.ts) — placed in `libs/core` rather than `libs/ui` to honour the layering invariant (UI imports from core, never the reverse). Toast surfacing of `args_summary` is wired via `registerUndoToastAdapter`, which `apps/mobile/app/_layout.tsx` calls at boot to inject the platform-specific toast implementation. Two- / three-finger gesture detection is deferred to `canvas-fundamentals` Phases I.5/I.6; the hook flags the cross-spec dependency with an inline TODO. The undo/redo buttons in `LeftToolRail` are already wired to the hook (Phase H.3).
