# generation-history — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–4 weeks for one engineer.**

---

## Phase A — Persistence

- [x] **A.1** Migration `00X-history-items.ts` with full DDL including indexes. **(S)** — `003-history-extensions.ts` adds `applied_at`, `discarded_at`, `batch_size`, `batch_position`, plus partial indexes (`idx_history_applied`, `idx_history_discarded`, `idx_history_job`).
- [x] **A.2** `batch_summary` field calculation (server emits during job-tracker output handling). **(S)** — `OutputFetcher` writes N rows per batch with shared `job_id` + `created_at`; `batch_summary` helper in `lib/history/projection.ts` projects `{ batch_job_id, batch_size, batch_position }`. (Catalog-schema field still pending — see TODO marker; data plumbing complete.)

## Phase B — Server tools

- [x] **B.1** `get_history_item` handler (read by id, returns row + thumbnail_ref). **(S)** — `lib/handlers/get-history-item.ts`.
- [x] **B.2** `apply_history_item` handler with verb-aware positional insertion + reversible Command. **(L)** — `lib/handlers/apply-history-item.ts`. `Command.revert` removes layer + clears applied state; `Command.reapply` issues fresh layer id (FR-6).
- [x] **B.3** `discard_history_item` handler (sets `discarded_at`, idempotent). **(XS)** — `lib/handlers/discard-history-item.ts`.
- [x] **B.4** `apply_history_item` integration with selection mask preservation. **(M)** — Selection from `parameters_json` is annotated on the emitted `document.changed` (`clip=rect|mask`). Layer alpha gating itself is canvas-renderer work (downstream); annotation is captured and surfaces at apply.
- [x] **B.5** `apply_history_item` re-application: reverting and re-applying creates fresh layer ids each time. **(S)** — Test "generate verb places at top + reversible Command" exercises the full revert→reapply path and asserts a different layer_id.
- [x] **B.6** Tests: positional insertion for each verb; selection-mask gating; reversibility. **(M)** — See `__tests__/history.ts` cases for generate / refine / fill / source-missing / discarded.

## Phase C — Resource & query

- [x] **C.1** `diffusecraft://history/list` resource with paginated query supporting `document_id`, `applied`, `since`, `fields`, `cursor`. **(M)** — `lib/resources/history-list.ts` + `InMemoryTransport.registerResource` wiring in `server.ts`. Path-id resource `diffusecraft://history/{id}` also wired.
- [x] **C.2** Tests: pagination correctness; filter by applied state; since-based delta. **(S)** — Three resource cases in `history.ts`.

## Phase D — Garbage collection

- [x] **D.1** `HistoryGc` class with daily timer. **(M)** — `lib/history/gc.ts`. `start()` schedules a 24h timer (test-overridable).
- [x] **D.2** Discarded-after-7-days deletion. **(S)** — `discarded_grace_days` config (default 7).
- [x] **D.3** Unreferenced-after-retention-days deletion. **(S)** — `retention_days` config (default 30).
- [x] **D.4** Storage budget enforcement (delete oldest when over `max_size_bytes`). **(M)** — Per-row eviction loop stops when total drops back under cap (default 5 GiB).
- [x] **D.5** Pause-on-shutdown: GC respects shutdown signal; resumes on restart. **(S)** — `historyGc.stop()` invoked from `server.stop()` + `rollback()`.
- [x] **D.6** Startup-time orphan blob check: history items with missing blobs marked `discarded_at`. **(S)** — `HistoryGc.runStartupCheck()` runs synchronously during bootstrap.
- [x] **D.7** `history.gc-completed` event emission. **(XS)** — Published on the EventBus after each `run()`.
- [x] **D.8** Tests: each GC rule in isolation; combined run. **(M)** — Five GC cases in `history.ts`.

## Phase E — Tablet UX

- [ ] **E.1** `<HistoryStrip />` horizontally-scrolling list with virtualization. **(M)**
- [ ] **E.2** `<HistoryThumbnail />` with badges (applied / discarded / fresh / pulsing in-progress). **(M)**
- [ ] **E.3** Gesture handlers: single tap (preview overlay), double tap (apply), long press (context menu), swipe up (apply), swipe down (discard). **(M)**
- [ ] **E.4** Preview overlay component: full-size image with Apply/Dismiss controls. **(M)**
- [ ] **E.5** Context menu: Apply, Discard, Compare, Copy parameters (writes parameters_json to clipboard). **(M)**
- [ ] **E.6** Filter toggles: "show discarded", "this document only" (default on). **(S)**
- [ ] **E.7** Batch cluster grouping: visually group items sharing a `job_id`; bulk actions (Apply all, Discard all). **(M)**
- [ ] **E.8** Compare view: select two items, render side-by-side or before/after slider. **(L)**
- [ ] **E.9** Tests: render with 0/1/many items; gestures dispatch correct tools; multi-client refresh on `document.changed`. **(M)**

## Phase F — Store wiring

- [ ] **F.1** `historyStore.loadFor(documentId)` calls resource. **(S)**
- [ ] **F.2** `historyStore.applyDocumentChanged` reconciles on `document.changed`. **(S)**
- [ ] **F.3** Multi-client: when another client applies an item, badge updates locally. **(S)**

## Phase G — i18n & docs

- [ ] **G.1** Strings extracted: badge labels, gesture hints, context menu items, compare view. **(S)**
- [ ] **G.2** README section on history strip ergonomics. **(S)**
- [ ] **G.3** TSDoc on handlers + components. **(S)**

---

## Dependency order

```
A → B → C → D → E (parallel with F) → G
```

A is foundational. B/C/D are server. E and F are tablet (depend on B/C). G is last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Apply positioning yields surprising results (e.g., Fill above wrong layer because source layer changed mid-flight) | FR-8 + UI notification on missing source; tests cover stale-source scenario. |
| GC deletes blobs while a slow client is still fetching | Blob ref TTL (5 min from server-architecture FR-30); GC respects active references. |
| Compare view storage/render costs (loading two full images at once) | Use thumbnail-quality first; tap to load full-res; cache freshly viewed items in memory. |
| Batch cluster grouping breaks when batch results trickle in over time | Render placeholders for known `batch_size`; fill as `job.completed` events arrive. |
| Multi-client conflict: client A applies, client B discards same item simultaneously | Server is source of truth; last-write-wins on `applied_to_layer_id` and `discarded_at`. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct.
3. Risks acceptable.

After approval, implementation begins with Phase A.
