/**
 * Selection slice — current selection (rect | mask | none) + mode.
 */
import type { StateCreator } from 'zustand';

import type { EditorState, SelectionSlice } from './types';

export const createSelectionSlice: StateCreator<
  EditorState,
  [],
  [],
  SelectionSlice
> = (set) => ({
  selection: { kind: 'none' },
  selectionMode: 'replace',
  setSelection: (selection) => set({ selection }),
  setSelectionMode: (mode) => set({ selectionMode: mode }),
});
