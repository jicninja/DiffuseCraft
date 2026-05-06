/**
 * History store factory.
 *
 * Mirrors the server's per-document generation history. Per FR-7, NOT
 * persisted: history is server-owned and re-fetched on connect / document
 * activation.
 *
 * Image bytes never enter this store (FR-25); thumbnails are URI references.
 */
import { createStore, type StoreApi } from 'zustand';

import type {
  DiffuseCraftClientLike,
  DocumentChangedPayload,
  HistoryItemSnapshot,
} from '../shared/types';

export interface HistoryState {
  items: ReadonlyArray<HistoryItemSnapshot>;
  documentId: string | null;

  attachClient(client: DiffuseCraftClientLike): void;
  detachClient(): void;
  /** Load history for a document. Replaces in-memory items. */
  loadFor(documentId: string): Promise<void>;
  /** Reconcile a `document.changed` event whose change is `kind: 'history'`. */
  applyDocumentChanged(payload: DocumentChangedPayload): void;
  /** Mark an item applied (optimistic; reverts on server error). */
  markApplied(itemId: string, applied: boolean): void;
  /** Mark an item discarded (optimistic; reverts on server error). */
  markDiscarded(itemId: string, discarded: boolean): void;
  /** Drop all items. Called on disconnect. */
  clear(): void;
}

export type HistoryStore = StoreApi<HistoryState>;

export function createHistoryStore(): HistoryStore {
  let attached: DiffuseCraftClientLike | null = null;

  return createStore<HistoryState>()((set, get) => ({
    items: [],
    documentId: null,

    attachClient: (client) => {
      attached = client;
    },
    detachClient: () => {
      attached = null;
    },

    loadFor: async (documentId) => {
      // TODO(client-sdk): replace with `client.invokeTool('list_history_items', { document_id })`.
      if (!attached) {
        set({ documentId, items: [] });
        return;
      }
      set({ documentId, items: [] });
    },

    applyDocumentChanged: (payload) => {
      if (get().documentId !== payload.document_id) return;
      if (payload.change.kind !== 'history') return;
      const incoming = payload.change.itemsAdded;
      // Append while deduplicating by id; preserve existing order then append new ones.
      const seen = new Set(get().items.map((i) => i.id));
      const additions = incoming.filter((i) => !seen.has(i.id));
      set({ items: [...get().items, ...additions] });
    },

    markApplied: (itemId, applied) => {
      set({
        items: get().items.map((i) => (i.id === itemId ? { ...i, applied } : i)),
      });
    },

    markDiscarded: (itemId, discarded) => {
      set({
        items: get().items.map((i) => (i.id === itemId ? { ...i, discarded } : i)),
      });
    },

    clear: () => {
      set({ items: [], documentId: null });
    },
  }));
}
