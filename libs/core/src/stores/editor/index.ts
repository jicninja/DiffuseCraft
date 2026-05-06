/**
 * Composed editor store factory.
 *
 * Per FR-2, the editor store uses the slices pattern. Each slice file owns a
 * disjoint subset of the state; orchestration actions (`loadDocument`,
 * `clearDocument`, `applyDocumentChanged`) live here at the composition root.
 *
 * Per P21, this is a factory function: each call returns a fresh store. Apps
 * instantiate one per provider; tests instantiate one per case.
 */
import { createStore, type StoreApi } from 'zustand';

import type { DiffuseCraftClientLike, DocumentChangedPayload } from '../shared/types';
import { createCanvasSlice } from './canvas-slice';
import { createLayersSlice } from './layers-slice';
import { createSelectionSlice } from './selection-slice';
import { createActiveToolSlice } from './active-tool-slice';
import { createBrushSlice, DEFAULT_BRUSH_SETTINGS } from './brush-slice';
import { createTransformSlice, DEFAULT_TRANSFORM_STATE } from './transform-slice';
import type { EditorState } from './types';

export type EditorStore = StoreApi<EditorState>;

interface ClientHandle {
  client: DiffuseCraftClientLike;
}

export const createEditorStore = (): EditorStore => {
  let attached: ClientHandle | null = null;

  return createStore<EditorState>()((set, get, store) => ({
    ...createCanvasSlice(set, get, store),
    ...createLayersSlice(set, get, store),
    ...createSelectionSlice(set, get, store),
    ...createActiveToolSlice(set, get, store),
    ...createBrushSlice(set, get, store),
    ...createTransformSlice(set, get, store),

    attachClient: (client) => {
      attached = { client };
    },
    detachClient: () => {
      attached = null;
    },

    loadDocument: async (documentId) => {
      // TODO(client-sdk): replace this stub with
      //   const state = await attached?.client.invokeTool('get_document_state', { document_id: documentId });
      // and populate slices from the response.
      if (!attached) {
        // Without a wired client, place a sentinel document so UI can render.
        set({
          document: { id: documentId, width: 0, height: 0, last_applied_result_uri: null },
          layers: [],
          activeLayerId: null,
          selection: { kind: 'none' },
        });
        return;
      }
      // Future shape (kept here so the call site is greppable post-SDK):
      // const state = await attached.client.invokeTool<{ document_id: string }, EditorDocumentSnapshot>(
      //   'get_document_state', { document_id: documentId },
      // );
      set({
        document: { id: documentId, width: 0, height: 0, last_applied_result_uri: null },
        layers: [],
        activeLayerId: null,
        selection: { kind: 'none' },
      });
    },

    clearDocument: () => {
      set({
        document: null,
        layers: [],
        activeLayerId: null,
        selection: { kind: 'none' },
        selectionMode: 'replace',
        activeTool: 'brush',
        activeToolSettings: {},
        brush: DEFAULT_BRUSH_SETTINGS,
        transform: DEFAULT_TRANSFORM_STATE,
      });
    },

    applyDocumentChanged: (payload: DocumentChangedPayload) => {
      const current = get().document;
      if (!current || current.id !== payload.document_id) return;
      switch (payload.change.kind) {
        case 'layers': {
          set({ layers: payload.change.layers });
          // If the active layer was removed, clear it.
          const activeId = get().activeLayerId;
          if (activeId && !payload.change.layers.some((l) => l.id === activeId)) {
            set({ activeLayerId: null });
          }
          return;
        }
        case 'selection': {
          set({ selection: payload.change.selection });
          return;
        }
        case 'history': {
          // History changes are mirrored by historyStore, not editorStore.
          return;
        }
        default:
          // exhaustiveness guard
          return;
      }
    },
  }));
};

export type { EditorState } from './types';
