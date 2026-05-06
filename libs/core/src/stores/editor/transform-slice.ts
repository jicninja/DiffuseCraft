/**
 * Transform slice — handles, pivot, in-progress transform state.
 */
import type { StateCreator } from 'zustand';

import type { EditorState, TransformSlice, TransformState } from './types';

const DEFAULT_TRANSFORM: TransformState = {
  active: false,
  pivot: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  translate: { x: 0, y: 0 },
  activeHandle: null,
};

export const createTransformSlice: StateCreator<
  EditorState,
  [],
  [],
  TransformSlice
> = (set, get) => ({
  transform: DEFAULT_TRANSFORM,
  beginTransform: (pivot) =>
    set({
      transform: {
        ...DEFAULT_TRANSFORM,
        pivot,
        active: true,
      },
    }),
  setTransformHandle: (handle) =>
    set({ transform: { ...get().transform, activeHandle: handle } }),
  patchTransform: (patch) =>
    set({ transform: { ...get().transform, ...patch } }),
  endTransform: () => set({ transform: DEFAULT_TRANSFORM }),
});

export const DEFAULT_TRANSFORM_STATE: TransformState = DEFAULT_TRANSFORM;
