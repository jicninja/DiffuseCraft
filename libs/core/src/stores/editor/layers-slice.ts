/**
 * Layers slice — ordered layers + active layer id.
 *
 * Cross-slice access is forbidden (FR-15). Setters here only touch
 * layers / activeLayerId. Higher-level orchestration (e.g., loading from
 * server) lives in the composed editor store.
 */
import type { StateCreator } from 'zustand';

import type { EditorState, LayersSlice } from './types';

export const createLayersSlice: StateCreator<
  EditorState,
  [],
  [],
  LayersSlice
> = (set, get) => ({
  layers: [],
  activeLayerId: null,
  setLayers: (layers) => set({ layers }),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  patchLayer: (id, patch) =>
    set({
      layers: get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }),
});
