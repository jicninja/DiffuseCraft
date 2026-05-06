// @diffusecraft/core
// Owns shared types, events, contracts, and Zustand store factories per
// .kiro/steering/tech.md §"Internal packages" and the
// `client-state-architecture` spec.
export * from './stores';

// Cross-store hooks (e.g., useUndoRedo) live here because they need the
// editor store + the SDK client. The toast surface is injected by the
// app shell via `registerUndoToastAdapter` to keep `core` (foundation)
// from depending on `@diffusecraft/ui` (client-ui).
export {
  useUndoRedo,
  registerUndoToastAdapter,
  type UndoResult,
  type RedoResult,
  type UseUndoRedoApi,
  type UndoToastAdapter,
} from './hooks/useUndoRedo';
