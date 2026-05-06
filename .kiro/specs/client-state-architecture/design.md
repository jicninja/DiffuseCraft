# client-state-architecture — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `client-sdk` (next spec).

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Per-slice selector hooks exposed.** `useSelection()`, `useActiveLayer()`, `useBrushSettings()`, `useTransform()`, `useActiveTool()` are thin wrappers around `useEditorStore` with slice selectors. |
| Q2 | **`editorStore.loadDocument(id)` action.** Fetches `get_document_state(id)`, populates all slices in one `set()` call. Subsequent `document.changed` events reconcile. |
| Q3 | **Single active document in v1.** `set_active_document` server tool drives the swap; client clears slices and reloads. |
| Q4 | **`StoresProvider` accepts a `client` prop.** Wires via `store.attachClient(client)` method on each store after construction. |
| Q5 | **Optimistic for fast/reversible mutations; server-confirmed for jobs/history.** Reconciliation via `document.changed`. |

## 2. Module layout

```
libs/core/src/stores/
├── index.ts                    # exports all factories + types + hooks
├── provider.tsx                # StoresProvider component (consumed by apps/mobile)
├── context.ts                  # React contexts for each store
├── hooks.ts                    # use<Store>() and per-slice hooks
├── editor/
│   ├── index.ts                # createEditorStore() — composes slices
│   ├── canvas-slice.ts
│   ├── layers-slice.ts
│   ├── selection-slice.ts
│   ├── active-tool-slice.ts
│   ├── brush-slice.ts
│   ├── transform-slice.ts
│   └── types.ts
├── connection/
│   ├── index.ts                # createConnectionStore()
│   ├── secure-token.ts         # expo-secure-store wrapper (RN only; falls back to dev keychain in tests)
│   └── types.ts
├── models/
│   └── index.ts                # createModelsStore()
├── jobs/
│   └── index.ts                # createJobsStore()
├── history/
│   └── index.ts                # createHistoryStore()
├── mcp-catalog/
│   └── index.ts                # createMcpCatalogStore()
└── shared/
    ├── persist-config.ts       # persist middleware factory
    ├── version.ts              # persistence schema version
    └── types.ts
```

## 3. Public API (representative)

### 3.1 `createEditorStore`

```typescript
// libs/core/src/stores/editor/index.ts
import { create } from "zustand";
import { canvasSlice, type CanvasSlice } from "./canvas-slice";
import { layersSlice, type LayersSlice } from "./layers-slice";
// ...etc

export type EditorState = CanvasSlice & LayersSlice & SelectionSlice
  & ActiveToolSlice & BrushSlice & TransformSlice & {
    /** Wired by StoresProvider after construction. */
    attachClient(client: DiffuseCraftClient): void;
    detachClient(): void;
    /** Action: load document from server. */
    loadDocument(documentId: string): Promise<void>;
    /** Action: clear current document. */
    clearDocument(): void;
  };

export const createEditorStore = () =>
  create<EditorState>()((set, get, store) => ({
    ...canvasSlice(set, get, store),
    ...layersSlice(set, get, store),
    ...selectionSlice(set, get, store),
    ...activeToolSlice(set, get, store),
    ...brushSlice(set, get, store),
    ...transformSlice(set, get, store),
    attachClient(client) { /* register event subscriptions */ },
    detachClient() { /* tear down */ },
    loadDocument: async (id) => { /* fetch + populate */ },
    clearDocument() { /* reset slices */ },
  }));
```

### 3.2 `createConnectionStore` (with persist + secure token)

```typescript
// libs/core/src/stores/connection/index.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ConnectionState = {
  pairedBackends: PairedBackend[];
  currentBackendId: string | null;
  connectionStatus: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  lastError: ConnectionError | null;
  discoveredBackends: DiscoveredBackend[];

  /** Persisted setters (handle only — token lives in secure store) */
  pairBackend(backend: NewPairedBackend, rawToken: string): Promise<void>;
  removeBackend(id: string): Promise<void>;
  setCurrentBackend(id: string | null): void;
  /** Async token retrieval from expo-secure-store */
  getToken(backendId: string): Promise<string>;
};

export const createConnectionStore = () =>
  create<ConnectionState>()(
    persist(
      (set, get) => ({
        // ...state and actions
      }),
      {
        name: "diffusecraft-connection",
        version: 1,
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (s) => ({
          pairedBackends: s.pairedBackends,
          currentBackendId: s.currentBackendId,
          // tokens are NEVER in persisted state
        }),
      }
    )
  );
```

### 3.3 `createMcpCatalogStore`

```typescript
export type McpCatalogState = {
  catalogVersion: string | null;
  tools: ToolDescriptor[];
  resources: ResourceDescriptor[];
  prompts: PromptDescriptor[];
  capabilities: ServerCapabilities | null;
  loadFromHandshake(handshake: HandshakeResult): void;
  hasTool(name: string): boolean;     // selector helper
};
```

### 3.4 `createJobsStore`

```typescript
export type JobsState = {
  active: Map<string, Job>;             // job_id → Job
  recent: Job[];                        // last N completed/failed/cancelled
  /** Updated by SDK event dispatch */
  applyProgress(payload: JobProgressPayload): void;
  applyCompleted(payload: JobCompletedPayload): void;
  trackJob(job: Job): void;
};
```

### 3.5 `createHistoryStore`

```typescript
export type HistoryState = {
  items: HistoryItem[];                 // mirror of server history
  loadFor(documentId: string): Promise<void>;
  applyDocumentChanged(payload: DocumentChangedPayload): void;
};
```

### 3.6 `createModelsStore`

```typescript
export type ModelsState = {
  models: Model[];
  presets: Preset[];
  lastRefresh: string | null;
  refresh(): Promise<void>;
};
```

## 4. Provider

```typescript
// libs/core/src/stores/provider.tsx
import React, { useMemo, useEffect } from "react";

export interface StoresProviderProps {
  client: DiffuseCraftClient;
  children: React.ReactNode;
}

export const StoresProvider: React.FC<StoresProviderProps> = ({ client, children }) => {
  const editor = useMemo(() => createEditorStore(), []);
  const connection = useMemo(() => createConnectionStore(), []);
  const models = useMemo(() => createModelsStore(), []);
  const jobs = useMemo(() => createJobsStore(), []);
  const history = useMemo(() => createHistoryStore(), []);
  const mcpCatalog = useMemo(() => createMcpCatalogStore(), []);

  useEffect(() => {
    // wire client → stores
    editor.getState().attachClient(client);
    // jobs/history/models subscribe to client events
    const unsub = client.events.subscribe((event) => {
      switch (event.name) {
        case "job.progress":      jobs.getState().applyProgress(event.payload); break;
        case "job.completed":     jobs.getState().applyCompleted(event.payload); break;
        case "document.changed":  history.getState().applyDocumentChanged(event.payload); break;
        case "model.download.progress": models.getState().applyProgress?.(event.payload); break;
      }
    });
    return () => { editor.getState().detachClient(); unsub(); };
  }, [client]);

  return (
    <EditorContext.Provider value={editor}>
      <ConnectionContext.Provider value={connection}>
        <ModelsContext.Provider value={models}>
          <JobsContext.Provider value={jobs}>
            <HistoryContext.Provider value={history}>
              <McpCatalogContext.Provider value={mcpCatalog}>
                {children}
              </McpCatalogContext.Provider>
            </HistoryContext.Provider>
          </JobsContext.Provider>
        </ModelsContext.Provider>
      </ConnectionContext.Provider>
    </EditorContext.Provider>
  );
};
```

## 5. Hooks

```typescript
// libs/core/src/stores/hooks.ts
import { useStore } from "zustand";
import { shallow } from "zustand/shallow";

export function useEditorStore<T>(selector: (s: EditorState) => T, eq = shallow): T {
  const store = useContext(EditorContext);
  if (!store) throw new Error("useEditorStore must be used inside StoresProvider");
  return useStore(store, selector, eq);
}

// Slice shortcuts
export const useSelection = () =>
  useEditorStore((s) => ({ selection: s.selection, setSelection: s.setSelection }));

export const useActiveLayer = () =>
  useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId) ?? null);

export const useBrushSettings = () =>
  useEditorStore((s) => ({
    size: s.brush.size, hardness: s.brush.hardness,
    opacity: s.brush.opacity, color: s.brush.color,
  }));

// Connection / models / jobs / history / mcp-catalog hooks follow same pattern.
```

## 6. Optimistic update pattern (Q5)

```typescript
// Example: toggle layer visibility (fast, reversible — optimistic)
async function toggleLayerVisibility(layerId: string) {
  const previous = get().layers.find((l) => l.id === layerId)?.visible;
  set((s) => ({
    layers: s.layers.map((l) =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ),
  }));
  try {
    await client.updateLayer({ layer_id: layerId, visible: !previous });
  } catch (err) {
    // revert on failure
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, visible: previous } : l
      ),
    }));
    throw err;
  }
}
```

For job/history mutations, **no optimistic**: the UI shows a queued state until `job.completed` arrives.

## 7. Cross-store reactions

```typescript
// inside StoresProvider effect:
useEffect(() => {
  // when connection drops, clear ephemeral mirrors
  return connection.subscribe(
    (s) => s.connectionStatus,
    (status) => {
      if (status === "disconnected") {
        jobs.getState().clear();
        history.getState().clear();
        models.getState().clearCache();
        editor.getState().clearDocument();
      }
    }
  );
}, []);
```

## 8. Persistence schema versioning

`persist-config.ts` exports a factory:

```typescript
export const persistedSlice = (name: string, version: number, partialize: (s: any) => any) => ({
  name: `diffusecraft-${name}`,
  version,
  storage: createJSONStorage(() => AsyncStorage),
  partialize,
  migrate: (persisted: unknown, fromVersion: number) => {
    // version 1: no migrations yet
    if (fromVersion < version) return undefined; // discard, start fresh
    return persisted;
  },
});
```

## 9. Acceptance criteria

1. Four user stories realized via the proposed factories + provider.
2. Module layout in §2 is consistent with `structure.md`.
3. Persistence boundaries match requirements §3.3 exactly (no leaks; no missing).
4. Optimistic vs server-confirmed pattern documented for at least the canonical examples (visibility, brush, generate, apply).
5. Cross-store reactions handled inside provider, not in components.
