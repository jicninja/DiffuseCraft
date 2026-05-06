/**
 * Canvas slice — active document descriptor.
 *
 * Per FR-25, image bytes are NEVER stored here. Only the document id, its
 * dimensions, and a metadata reference to the last-applied result.
 */
import type { StateCreator } from 'zustand';

import type { CanvasSlice, EditorState } from './types';

export const createCanvasSlice: StateCreator<
  EditorState,
  [],
  [],
  CanvasSlice
> = (set) => ({
  document: null,
  setDocument: (document) => set({ document }),
});
