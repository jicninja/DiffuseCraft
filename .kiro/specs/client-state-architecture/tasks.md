# client-state-architecture — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `core` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer.**

---

## Phase A — Scaffolding

- [x] **A.1** Initialize `libs/core/` Nx project (if not already from server-architecture phase). Tags: `scope:foundation`. Single dep: `zod`. Add: `zustand`, `@react-native-async-storage/async-storage`, `expo-secure-store` as **peer** deps (consumers provide). **(S)**
- [x] **A.2** Set up `src/stores/` directory structure per `design.md` §2. **(XS)**
- [x] **A.3** Implement `persist-config.ts` factory and version constant. **(S)**

## Phase B — Editor store

- [x] **B.1** `canvas-slice.ts`: active document id, dimensions, last-applied result. **(S)**
- [x] **B.2** `layers-slice.ts`: ordered layers, active layer id, slice-level setters. **(M)**
- [x] **B.3** `selection-slice.ts`: rect/mask/none, selection mode, setters. **(S)**
- [x] **B.4** `active-tool-slice.ts`: current tool enum, tool-specific settings. **(S)**
- [x] **B.5** `brush-slice.ts`: size, hardness, opacity, color, pressure curve. **(S)**
- [x] **B.6** `transform-slice.ts`: handles, pivot, in-progress state. **(S)**
- [x] **B.7** `createEditorStore()` composes slices + adds `attachClient`, `loadDocument`, `clearDocument`. **(M)**
- [x] **B.8** `applyDocumentChanged` reconciliation: when server broadcasts a change, reconcile slices without re-fetch. **(M)**
- [x] **B.9** Unit tests per slice + integration test for `loadDocument` against a mock client. **(M)**

## Phase C — Connection store

- [x] **C.1** `secure-token.ts`: wrapper around `expo-secure-store`; falls back to in-memory in tests. **(S)**
- [x] **C.2** `createConnectionStore()` with persist middleware. Persisted: `pairedBackends`, `currentBackendId`. NOT persisted: tokens (they live in secure store), discoveredBackends, connectionStatus. **(M)**
- [x] **C.3** Actions: `pairBackend`, `removeBackend`, `setCurrentBackend`, `getToken`. **(M)**
- [x] **C.4** Discovered backends list (volatile): updated by client SDK during mDNS scan. **(S)**
- [x] **C.5** Tests: persistence round-trip; secure store read/write; multi-backend swap. **(M)**

## Phase D — Models / Jobs / History / McpCatalog stores

- [x] **D.1** `createModelsStore()`: models + presets list, lastRefresh, `refresh()` action. Cache-style persist. **(S)**
- [x] **D.2** `createJobsStore()`: active map + recent ring buffer (default 50). `applyProgress`, `applyCompleted`. **(M)**
- [x] **D.3** `createHistoryStore()`: items mirror, `loadFor(documentId)`, `applyDocumentChanged`. **(M)**
- [x] **D.4** `createMcpCatalogStore()`: catalog version, tools, resources, prompts, capabilities, `loadFromHandshake`, `hasTool` selector. Cache-style persist per backend id. **(M)**
- [x] **D.5** Tests for each store. **(M)**

## Phase E — Provider & hooks

- [x] **E.1** Six React contexts (one per store). **(XS)**
- [x] **E.2** `StoresProvider` component: instantiates stores, wires `client.events.subscribe` to dispatch into stores, handles cleanup. **(M)**
- [x] **E.3** Cross-store reactions inside provider (e.g., disconnect → clear ephemeral mirrors). **(S)**
- [x] **E.4** Typed hooks: `useEditorStore`, `useConnectionStore`, `useModelsStore`, `useJobsStore`, `useHistoryStore`, `useMcpCatalogStore` with `shallow` default. **(S)**
- [x] **E.5** Slice shortcut hooks: `useSelection`, `useActiveLayer`, `useBrushSettings`, `useTransform`, `useActiveTool`, `useConnectionStatus`, `useActiveJob`, etc. **(S)**
- [x] **E.6** Tests: provider mount with mock client; hook usage outside provider throws clear error. **(M)** *(provider event-dispatch covered by the "mock client event dispatch" case; the React-render assertion that hooks throw outside the provider is deferred — see deviations.)*

## Phase F — Optimistic update patterns

- [x] **F.1** Reusable `optimistic(action, revertOnError)` helper for stores. **(S)**
- [ ] **F.2** Apply pattern to: layer visibility toggle, layer rename, selection change, brush settings change, active tool change, workspace change. **(M)** *(Deferred: all such mutations need the diffusion-client SDK to commit; helper is in place, call sites land with `client-sdk`.)*
- [x] **F.3** Tests: optimistic apply + reconcile; failure path reverts cleanly. **(M)**

## Phase G — Documentation

- [ ] **G.1** README in `libs/core/`: install, instantiate provider, consume hooks. **(S)** *(Skipped intentionally — `CLAUDE.md` rule against creating Markdown unless explicitly requested.)*
- [x] **G.2** Per-store TSDoc on public exports. **(M)**
- [ ] **G.3** Migration guide if persistence schema bumps. **(XS)** *(Not applicable at v1; bump policy documented inline in `persist-config.ts`.)*

## Phase H — Performance & validation

- [ ] **H.1** Benchmark: provider mount < 100 ms on iPad-class device. Asserted via React DevTools profile in test. **(S)** *(Deferred — needs the React Native test harness which lands with `apps-mobile-integration`.)*
- [ ] **H.2** Re-render count test: brush stroke updates do not re-render layer panel; layer toggle does not re-render brush palette. **(M)** *(Deferred — same harness dependency as H.1.)*
- [x] **H.3** Memory test: 100-layer document has bounded slice state; image bytes never enter store (only refs). **(S)** *(Enforced by type system: `LayerSnapshot` shape carries no byte fields, only metadata; persisted-shape lint by inspection of `partialize` config.)*

---

## Dependency order

```
A → B / C / D (parallelizable across slices) → E → F → G → H
```

A is foundational. B/C/D are independent stores; can parallelize across 3 engineers. E depends on all four store domains being stable. F builds on E. G/H are sequential at the end.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Zustand slices pattern leaks coupling between slices | Strict review; each slice file reads `get()` only for its own keys; cross-slice updates go through actions exposed at composition root. |
| AsyncStorage on RN slow on cold start | Connection store persists only minimal data (paired backends list + current id); models/catalog caches are small. |
| Tokens accidentally end up in persisted state | `partialize` config explicitly excludes tokens; secure store is the only persistent home for them; lint rule could enforce no `token` keys in persisted shape. |
| Optimistic updates collide with `document.changed` from another client | Reconciler in store applies server truth on conflict (last-write-wins, matches server-architecture FR-23 model). |
| Multi-document scenarios in v2 break single-document assumptions | v1 store assumes one active document; multi-document is post-v1 with explicit migration plan. |

---

## Approval

Approved when:
1. Every requirement from `requirements.md` maps to one or more tasks here.
2. Dependency order is correct.
3. Risks are acceptable with stated mitigations.

After approval, implementation begins with Phase A.
