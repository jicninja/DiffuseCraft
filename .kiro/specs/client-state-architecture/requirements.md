# client-state-architecture — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (the surface stores mirror), `server-architecture` (events stores subscribe to), `client-sdk` (the layer between transport and stores — specced next).
> **References:** P21 (Stores are factories), P5 (State is queryable), P22 (Tablet reference form factor), Q8 in clarifying questions.

## 1. Purpose

This spec defines the **client-side state architecture** for `apps/mobile` and any future host that consumes `@diffusecraft/diffusion-client`. It specifies:

- The Zustand store layout: which stores exist, what each owns.
- The factory pattern: stores are instantiated, not module-level singletons.
- Persistence boundaries: what survives restart, what doesn't.
- Server-state mirroring: how MCP tool results and events become store updates.
- Component interaction rules: components subscribe to stores, never call `diffusion-client` directly.

The store factories live in `@diffusecraft/core` so they can be reused by tests and future host apps with their own provider wiring.

## 2. Stakeholders & user stories

### S1 — `apps/mobile` developer
> **Story 1.** As a tablet-app developer, I import store factories from `@diffusecraft/core`, instantiate them in a root provider, wire them to the `diffusion-client` instance, and consume them from screens via standard Zustand hooks.

### S2 — Test author
> **Story 2.** As a test, I instantiate fresh store instances (not shared module state), drive them with mock client events, and assert UI behavior in isolation.

### S3 — Future host (Electron-like) reusing the stores
> **Story 3.** As a future Electron-based host that wraps the mobile UI for desktop, I instantiate one set of stores per window and share none of the runtime state across windows.

### S4 — `@diffusecraft/diffusion-client` (the layer below)
> **Story 4.** As the client SDK, I receive MCP events from the server and translate them into store updates via a typed dispatcher, without knowing which screen or component will react.

## 3. Functional requirements (EARS)

### 3.1 Store granularity

**FR-1 (Ubiquitous).** Six stores SHALL exist in `@diffusecraft/core`, exported as factory functions. Naming pattern: `create<Noun>Store()`.

| Store | Owns |
|---|---|
| `editorStore` (slices: canvas, layers, selection, activeTool, brush, transform) | Document state in active session: layers, active layer, selection, current tool, brush settings, transform handles. |
| `connectionStore` | Paired backends list, current connection, tokens (handles), last-known server name. |
| `modelsStore` | Mirror of server's `models` and `presets` lists, last refresh timestamp. |
| `jobsStore` | Active jobs, recent jobs, in-flight requests, progress, ETA. |
| `historyStore` | Mirror of server's history items list, thumbnail refs, applied/discarded flags. |
| `mcpCatalogStore` | Tools and resources known on the current server, schemas, negotiated catalog version, capabilities. |

**FR-2 (Ubiquitous).** The `editorStore` SHALL use Zustand's slices pattern internally; the other five SHALL be flat single-create stores.

**FR-3 (Ubiquitous).** Every store factory SHALL return a Zustand store object compatible with `useStore` hooks, including shallow-equality selectors.

### 3.2 Factory pattern (P21)

**FR-4 (Ubiquitous).** Stores SHALL be instantiated by calling their factory function. Module-level singletons are forbidden. Example:

```typescript
// libs/core/src/stores/editor.ts
export const createEditorStore = () => create<EditorState>()(...);

// apps/mobile/src/providers/StoresProvider.tsx
const editorStore = useMemo(() => createEditorStore(), []);
```

**FR-5 (Ubiquitous).** Apps SHALL provide stores via React context. A `StoresProvider` component holds all six instances; consumer hooks (`useEditorStore`, `useConnectionStore`, etc.) read from context.

**FR-6 (Ubiquitous).** Stores SHALL be safely re-instantiable per test or per window; no shared static state across instances.

### 3.3 Persistence

**FR-7 (Ubiquitous).** Persistence SHALL be applied selectively via Zustand's `persist` middleware:

| Store | Persisted? | Storage |
|---|---|---|
| `editorStore` | **No** (session-scoped; documents persist via filesystem/server, not local store) | — |
| `connectionStore` | **Yes** | AsyncStorage in RN (FUTURE: electron-store on Electron) |
| `modelsStore` | **Cache-style** (last list + ETag, refreshed on connect) | AsyncStorage |
| `jobsStore` | **No** (jobs are server-owned; client mirror is ephemeral) | — |
| `historyStore` | **No** (history is server-owned; client mirror is ephemeral) | — |
| `mcpCatalogStore` | **Cache-style** (catalog version + tool list per server, refreshed on handshake) | AsyncStorage |

**FR-8 (Ubiquitous).** Persisted state SHALL include a schema version. On version mismatch at load, the migration runs; if no migration exists, the persisted slice is discarded (not corrupted-loaded).

**FR-9 (Ubiquitous).** Sensitive data (raw tokens) SHALL NOT be stored in plain AsyncStorage. Tokens SHALL be stored using the platform's secure store: `expo-secure-store` on iOS/Android.

### 3.4 Server-state mirroring (FR from Q8 clarifying)

**FR-10 (Ubiquitous).** Components SHALL NOT invoke `diffusion-client` methods directly. All client invocations SHALL go through store actions, which call the SDK and update local state on response.

**FR-11 (Ubiquitous).** The `diffusion-client` SDK SHALL receive a typed event dispatcher at construction. Server events (`job.progress`, `job.completed`, `document.changed`, `model.download.progress`, `audit.entry`) SHALL be routed through the dispatcher to the appropriate store's update method.

**FR-12 (Ubiquitous).** State changes triggered by another client (received via `document.changed` events) SHALL update the local mirror without re-invoking the server. The mirror is the truth as broadcast; tools that originate locally also update the mirror to keep UI snappy (optimistic update with reconciliation).

**FR-13 (Event-driven).** WHEN a tool invocation fails server-side, THE store action SHALL revert any optimistic update and surface the error to the calling component.

### 3.5 Editor store details

**FR-14 (Ubiquitous).** `editorStore` slices and ownership:

- `canvasSlice`: active document id, dimensions, last-applied result.
- `layersSlice`: ordered layers, active layer id.
- `selectionSlice`: current selection (rect | mask | none), selection mode.
- `activeToolSlice`: current tool (brush, eraser, lasso, rect-select, transform, etc.), tool-specific settings.
- `brushSlice`: brush size, hardness, opacity, current color, pressure curve.
- `transformSlice`: active transform handles, pivot, in-progress transform state.

**FR-15 (Ubiquitous).** Slices SHALL be composed via the slices pattern (Zustand official guidance). No prop-drilling between slices; cross-slice access via the parent state object passed to each slice.

**FR-16 (Ubiquitous).** Undo/redo SHALL NOT be reimplemented in the editor store. Per P27, undo/redo is server-side and queried via MCP tools (`undo`, `redo`) and resources (`diffusecraft://undo-stack/<doc-id>`). The editor store mirrors the result of those tools — it does not maintain its own command stack.

### 3.6 Connection store details

**FR-17 (Ubiquitous).** `connectionStore` owns:

- `pairedBackends: PairedBackend[]` — list of all paired servers (id, name, last connected, mDNS/QR origin).
- `currentBackendId: string | null` — the active connection.
- `connectionStatus: "disconnected" | "connecting" | "connected" | "reconnecting" | "error"`.
- `lastError: ConnectionError | null`.
- `discoveredBackends: DiscoveredBackend[]` — current mDNS scan results, refreshed on demand.

**FR-18 (Ubiquitous).** Token retrieval SHALL be via `connectionStore.getToken(backendId): Promise<string>` which fetches from `expo-secure-store` on demand. Tokens SHALL NOT live in the in-memory state; only handles do.

### 3.7 mcpCatalogStore details

**FR-19 (Ubiquitous).** `mcpCatalogStore` owns:

- `catalogVersion: string` — server's negotiated catalog version.
- `tools: ToolDescriptor[]` — full tool list received at handshake.
- `resources: ResourceDescriptor[]` — full resource list.
- `prompts: PromptDescriptor[]` — MCP prompt templates.
- `capabilities: ServerCapabilities` — server-declared caps.

**FR-20 (Ubiquitous).** UI screens that conditionally show features based on tool availability (e.g., hide "Live mode" panel when `start_live_session` isn't in the catalog) SHALL read from this store, not from a hardcoded feature flag.

### 3.8 Hooks and selectors

**FR-21 (Ubiquitous).** Each store exports a typed `use<Store>(selector?)` hook usable in any component under `StoresProvider`.

**FR-22 (Ubiquitous).** All multi-field selectors SHALL use Zustand's `shallow` equality function to avoid spurious re-renders.

**FR-23 (Ubiquitous).** Cross-store reactions (e.g., when the connection drops, clear jobs and history) SHALL be implemented via store middleware (subscriptions across stores) inside `StoresProvider`, not inside individual components.

### 3.9 Performance

**FR-24 (Ubiquitous).** Editor-store updates from rapid input (brush strokes, selection drags) SHALL NOT trigger re-renders of unrelated panels. Per-slice subscriptions + `shallow` selectors enforce this.

**FR-25 (Ubiquitous).** Image bytes SHALL NEVER live in any Zustand store. Images live in component-local refs (e.g., Skia surface) or in cached blob refs from the server. Stores hold metadata + URIs only.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** All stores live in `@diffusecraft/core` (not in `apps/mobile`) so they can be reused.

**NFR-2 (Ubiquitous).** No store SHALL depend on `react-native-skia`, `expo`, or any platform-specific package. Adapters live in `apps/mobile`.

**NFR-3 (Ubiquitous).** Cold-start time of `StoresProvider` mount in `apps/mobile` SHALL be < 100 ms on a typical iPad (M-class).

**NFR-4 (Ubiquitous).** TypeScript types for store states SHALL be exported alongside factories.

## 5. Out of scope

- **The diffusion-client SDK itself** — `client-sdk` spec.
- **Specific UI components and screens** — feature specs.
- **Persistence schema migrations beyond v1** — handled per-version.
- **Offline mode / queueing client requests when disconnected** — post-v1; mentioned in `connection-management` spec.

## 6. Open questions

### Q1 — Should `editorStore` slices be exported separately for fine-grained subscriptions?
Some screens only care about `selectionSlice`. Should `useSelection()` be a thin wrapper that subscribes to only that slice?

**Recommendation:** **yes**. Provide per-slice selector hooks (`useSelection()`, `useActiveLayer()`, `useBrushSettings()`) as ergonomic shortcuts. Internally they're `useEditorStore` with slice selectors. No additional stores; just thin wrappers. Document in `design.md`.

### Q2 — How is the document loaded into `editorStore`?
A user opens a document. The store needs to populate from server state.

**Recommendation:** an action `editorStore.loadDocument(documentId)` calls `client.getDocumentState(documentId)`, then populates all slices in one update. Subsequent `document.changed` events from the server reconcile.

### Q3 — Multiple documents open?
v1 allows one active document per session. The server supports multiple, but the tablet UX is single-document at a time.

**Recommendation:** **single active document in v1.** `set_active_document` swaps which document the editor store mirrors. Multi-document UI is post-v1.

### Q4 — How is the SDK constructed and provided to stores?
Stores need a reference to the client to invoke tools.

**Recommendation:** `StoresProvider` accepts a `client` prop (an instance of `DiffuseCraftClient` from `client-sdk`). It wires the client into each store via the factory or a `connect(client)` method. Confirm in `design.md`.

### Q5 — Optimistic vs server-confirmed updates
For local edits (e.g., toggling layer visibility), should the store update immediately and reconcile on server confirmation, or wait for the server?

**Recommendation:** **optimistic for read-style mutations** (visibility toggle, layer rename, selection change — anything fast and reversible). **Server-confirmed for jobs and history** (no preview before the server says it exists). Reconcile on `document.changed` if optimistic value differs.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The four user stories (§2) can be expressed using the store layout in §3.1.
2. The factory pattern (§3.2) is reflected in the proposed module layout.
3. Persistence boundaries (§3.3) cover every piece of state with a clear yes/no.
4. Open questions (§6) have recommendations acceptable as defaults for `design.md`.
