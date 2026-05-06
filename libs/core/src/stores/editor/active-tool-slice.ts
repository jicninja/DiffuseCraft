/**
 * Active-tool slice — current tool enum + per-tool settings bag.
 */
import type { StateCreator } from 'zustand';

import type { ActiveToolSlice, EditorState } from './types';

export const createActiveToolSlice: StateCreator<
  EditorState,
  [],
  [],
  ActiveToolSlice
> = (set) => ({
  activeTool: 'brush',
  activeToolSettings: {},
  setActiveTool: (tool) => set({ activeTool: tool }),
  setActiveToolSettings: (settings) => set({ activeToolSettings: { ...settings } }),
});
