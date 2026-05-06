# undo-redo-system — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer.** Cross-cutting; touches every editor handler.

---

## Phase A — Core: Command + stack + manager

- [x] **A.1** `Command` interface + `buildCommand` helper. **(S)**
- [x] **A.2** `ClientDocumentStack` with push/popUndo/popRedo + summary projections. **(M)**
- [x] **A.3** `UndoRedoManager` with `execute / undo / redo / discardForToken / onTokenDisconnect / onTokenReconnect`. **(L)**
- [x] **A.4** Snapshot capture + storage (full snapshot every N ops). **(M)**
- [x] **A.5** Disconnect grace timer (default 600 s). **(S)**
- [~] **A.6** ~~Tests: push/pop semantics, redo clear on fresh op, snapshot anchoring.~~ **DEFERRED per `.kiro/steering/testing.md` (testing paused until end of v1).**

## Phase B — Eviction & memory budget

- [x] **B.1** `EvictionPolicy` class with periodic run (30 s timer). **(M)**
- [x] **B.2** Snapshot eviction first; then oldest commands per deepest stack with floor (≥5 ops kept). **(M)**
- [x] **B.3** `undo.eviction` event emission. **(XS)**
- [x] **B.4** Memory estimation helpers (Command, snapshot byte estimates). **(S)**
- [~] **B.5** ~~Tests: simulate 100+ stacks ×heavy ops; confirm eviction triggers + floor maintained.~~ **DEFERRED per `.kiro/steering/testing.md`.**

## Phase C — Server tools `undo` / `redo`

- [x] **C.1** `undoHandler`. **(S)**
- [x] **C.2** `redoHandler`. **(S)**
- [x] **C.3** Default `document_id` resolution from session. **(XS)**
- [~] **C.4** ~~Tests against in-memory server.~~ **DEFERRED per `.kiro/steering/testing.md`.**

## Phase D — Resources

- [x] **D.1** `diffusecraft://undo-stack/<doc>` resource handler. **(S)**
- [x] **D.2** `diffusecraft://redo-stack/<doc>` resource handler. **(S)**
- [x] **D.3** Pagination + `since` + `fields` support. **(S)** _Note: `since` not implemented; the catalog declares `supports_since: false` for both stack resources, so this sub-task ships as `fields` + cursor pagination only._
- [~] **D.4** ~~Tests: stack content matches resource view.~~ **DEFERRED per `.kiro/steering/testing.md`.**

## Phase E — Multi-client conflict detection

- [x] **E.1** `recentEvents` helper on event bus (last N seconds). **(S)**
- [x] **E.2** `executeWithConflictDetection` wrapper around `execute`, emits `document.changed { conflict: true }` when overlap detected. **(M)** _Inlined into `UndoRedoManager.execute()` (single public entry point) per implementer/reviewer agreement; `Command<R>` gained optional `affected_layer_ids` to drive overlap detection._
- [~] **E.3** ~~Tests: two-client interleaved ops; correct conflict flag; per-client undo independence.~~ **DEFERRED per `.kiro/steering/testing.md`.**

## Phase F — Handler integration contract

- [x] **F.1** Codify the standard handler pattern in `libs/server/src/lib/handlers/_template.ts`. **(S)**
- [~] **F.2** ~~Update `add_layer`, `remove_layer`, `update_layer` handlers to use the contract.~~ **DEFERRED to `server-architecture` C.3 (handlers don't yet exist).**
- [x] **F.3** `apply_history_item` handler integrates contract. **(S)**
- [x] **F.4** `set_selection` handler. **(S)**
- [~] **F.5** ~~`add_control_layer` / `remove_control_layer` handlers.~~ **DEFERRED to `control-layers` spec (handlers don't yet exist).**
- [~] **F.6** ~~`define_region` / `remove_region` handlers.~~ **DEFERRED to `regions` spec (handlers don't yet exist).**
- [x] **F.7** `paint_strokes` migrated. **(M)** _`paint_area` handler does not yet exist; deferred to its owning spec._
- [x] **F.8** `transform_layer` migrated. **(M)** _Group-ops integration carried in transform_layer (already supports group via `affected_layer_ids`); broader group-ops handlers deferred to `canvas-fundamentals`._
- [x] **F.9** Conformance check shipped at `libs/server/src/lib/conformance/undo-redo-conformance.ts` (build-time invariant; runs in `server.start()` after `dispatcher.register` calls). **(M)** Includes `KNOWN_LEGACY_PATHS` allowlist of 10 mask/selection helpers still using the legacy `enrol` bridge — tracked for migration in their owning specs.

## Phase G — Lifecycle integration

- [x] **G.1** Server `start()` initializes `UndoRedoManager` from config. **(XS)** _Done in A.3+A.5 (`server.ts` `new UndoRedoManager({...this.config.undo, bus, snapshotProvider})`)._
- [x] **G.2** Server `stop()` discards all stacks. **(XS)** _Done in A.5 (`internals.undo.discardAll()` in both `stop()` and `rollback()`)._
- [x] **G.3** Token revocation triggers `discardForToken`. **(S)** _Done in A.5 via bus subscription to `auth.token-revoked` → `undo.discardForToken(token_id)`._
- [x] **G.4** Connection close → `onTokenDisconnect`; reconnect → `onTokenReconnect`. **(S)** _Done in A.5 via `ConnectionTracker` ref-counting on HTTP `/mcp` dispatch._

## Phase H — Tablet UX

- [x] **H.1** `useUndoRedo` hook at `libs/core/src/hooks/useUndoRedo.ts` (placed in `libs/core` rather than `libs/ui` per layering invariant — toast wired via injected adapter). **(S)**
- [x] **H.2** Toast for `args_summary` (1500 ms) wired via `registerUndoToastAdapter` from `apps/mobile/app/_layout.tsx`. **(S)**
- [x] **H.3** Hook wired into `LeftToolRail` undo/redo buttons. **(XS)** _Two/three-finger gesture detection itself depends on `canvas-fundamentals` I.5/I.6 (not yet implemented client-side); TODO marker in `useUndoRedo.ts` flags the cross-spec dependency._
- [~] **H.4** ~~Optional "Edits" panel showing undo stack list with tap-to-revert-N.~~ **DEFERRED — optional in v1.**
- [~] **H.5** ~~Tests: gestures dispatch correct tools; toast shows summary.~~ **DEFERRED per `.kiro/steering/testing.md`.**

## Phase I — Persistence boundary tests

**Phase deferred per `.kiro/steering/testing.md` (testing paused until end of v1).** The behaviors I.1–I.4 verify are still required of the implementation; only the dedicated test artifacts are deferred.

- [~] **I.1** ~~Server restart test: stacks discarded, document state intact.~~ DEFERRED.
- [~] **I.2** ~~Disconnect/reconnect within grace: stack preserved.~~ DEFERRED.
- [~] **I.3** ~~Disconnect beyond grace: stack discarded.~~ DEFERRED.
- [~] **I.4** ~~Token revocation: stack discarded immediately.~~ DEFERRED.

## Phase J — Documentation

- [x] **J.1** `libs/server/src/lib/undo-redo/README.md`: contract for handler authors. **(S)**
- [x] **J.2** `_template.ts` header TSDoc cites P27 + points at the README. **(S)** _Template body shipped in F.1._
- [x] **J.3** `principles.md` P27 Reference line appended with v1-implementation status. **(XS)**

---

## Dependency order

```
A → B → C → D
              \
               → E → F → G   (handler integration cascade)
                              \
                               → H → I → J
```

A is foundational. B/C/D parallelizable after A. E builds on C. F is the cross-cutting integration touching every editor handler — long but mechanical. G/H/I/J at the end.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Some tools have hard-to-reverse semantics (e.g., destructive flatten with quantization) | Snapshot-based revert for `weight: "large"`; mergeDown captures pre-merge layer states. |
| Memory eviction kicks at unexpected moments → user can't undo recent op | Default budget 512 MB is generous; eviction starts from oldest only; floor keeps recent. Tunable. |
| Conflict detection's "recent events" window misses slow ops | E.1 default 1 s; configurable. |
| Disconnect grace timer leaks if many clients churn | G.4 limits per-token timer count; oldest expiring drops state. |
| Conformance test fails late (after handler written without contract) | F.9 build-time check; pre-merge gate. |
| `args_summary` strings drift / inconsistent across handlers | F.1 template includes summary helpers; lint rule on length. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct (note: F integrates into many other specs; some sub-tasks live in those specs' tasks).
3. Risks acceptable.
4. Conformance test (F.9) is enforceable in CI.

After approval, implementation begins with Phase A (and F items happen in parallel as each editor handler is written).

---

## Implementation Notes

- **A.2 / design.md §4 snapshot eviction** — the literal pseudocode in design.md §4 (`this.snapshots = this.snapshots.filter((s) => s.anchor_undo_index >= 0)` after `shift()`) is incomplete on its own: surviving anchor indices must be **decremented by 1** before the filter, otherwise anchors point to the wrong undo slots after eviction. The shipped `ClientDocumentStack.push()` decrements then drops anchors that fall below 0. Future readers: do not "fix" the implementation back to the literal design line.

