/**
 * useUndoRedo — wraps the catalog's `undo` / `redo` MCP tools and surfaces
 * a 1.5 s toast describing the reverted/reapplied command (FR-30, FR-31).
 *
 * Wire shape (mirrors `libs/mcp-tools/src/tools/undo-redo/{undo,redo}.ts`):
 *   undo  → { reverted: boolean;  command_description?: string }
 *   redo  → { reapplied: boolean; command_description?: string }
 *
 * The hook is defensive: if it is mounted outside `<StoresProvider>` or the
 * provider was wired with a `null` client (cold-start, pre-pairing), both
 * actions resolve to no-ops. This keeps screens that haven't migrated to
 * the provider yet (apps/mobile today) renderable.
 *
 * Toast adapter pattern
 * ---------------------
 * The toast UI lives in `@diffusecraft/ui`, which is `scope:client-ui` and
 * sits *above* `scope:foundation` in the dependency hierarchy. To honor the
 * documented layering rule (`steering/structure.md`: "foundation is leaf"),
 * core never imports `@diffusecraft/ui` directly. Instead the app shell
 * registers the real `toast` implementation once at startup via
 * `registerUndoToastAdapter(toast.info)`. When no adapter is registered the
 * toast is a no-op (the editor still works; the user just doesn't see the
 * 1.5 s confirmation banner).
 *
 * Cross-spec note: FR-30 requires two-finger tap → undo / three-finger tap
 * → redo. Gesture detection lives in `canvas-fundamentals` Phase I.5/I.6
 * and is NOT yet implemented client-side; once the canvas surface dispatches
 * the gestures, wire its callbacks to the same `{ undo, redo }` returned
 * here. See LeftToolRail.tsx for the current button-based wiring.
 */
import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

import { EditorStoreContext } from '../stores/context';
import { useStoresClient } from '../stores/hooks';
import type { EditorStore } from '../stores/editor';

/** Wire shape for the `undo` MCP tool. Mirrors the catalog definition. */
export interface UndoResult {
  reverted: boolean;
  command_description?: string;
}

/** Wire shape for the `redo` MCP tool. Mirrors the catalog definition. */
export interface RedoResult {
  reapplied: boolean;
  command_description?: string;
}

export interface UseUndoRedoApi {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Shape of the toast adapter the app shell registers at startup. */
export type UndoToastAdapter = (
  message: string,
  options?: { duration?: number },
) => void;

/** Per FR-31 — the toast is shown for ~1.5 s. */
const UNDO_TOAST_DURATION_MS = 1500;

let registeredToast: UndoToastAdapter | null = null;

/**
 * Register the toast surface used by `useUndoRedo`. Call this once at app
 * startup, before any editor screen mounts. In `apps/mobile` the call site
 * is `app/_layout.tsx` (or another root-level effect):
 *
 * ```ts
 * import { toast } from '@diffusecraft/ui';
 * import { registerUndoToastAdapter } from '@diffusecraft/core';
 * registerUndoToastAdapter((msg, opts) => toast.info(msg, opts));
 * ```
 *
 * Returns the previous adapter so consumers can restore it (tests,
 * Storybook, etc.).
 */
export const registerUndoToastAdapter = (
  adapter: UndoToastAdapter | null,
): UndoToastAdapter | null => {
  const previous = registeredToast;
  registeredToast = adapter;
  return previous;
};

const showUndoToast = (text: string): void => {
  registeredToast?.(text, { duration: UNDO_TOAST_DURATION_MS });
};

/** Stable empty subscriber + null reader used when no editor store is bound. */
const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined;
const NULL_READER = (): string | null => null;

const buildDocumentIdReader = (store: EditorStore) => (): string | null =>
  store.getState().document?.id ?? null;

export const useUndoRedo = (): UseUndoRedoApi => {
  // Read the active document via the editor store context directly so that
  // mounting outside `<StoresProvider>` does not throw — `requireStore` in
  // the regular `useEditorStore` hook would. This matches FR-25 (image
  // bytes never enter the store; only `document.id` is read here).
  const editorStore = useContext(EditorStoreContext);
  // Stable subscribe + snapshot fns per store identity to keep
  // `useSyncExternalStore` from warning about infinite loops.
  const subscribe = useMemo(
    () => (editorStore ? editorStore.subscribe.bind(editorStore) : EMPTY_SUBSCRIBE),
    [editorStore],
  );
  const getSnapshot = useMemo(
    () => (editorStore ? buildDocumentIdReader(editorStore) : NULL_READER),
    [editorStore],
  );
  const documentId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const client = useStoresClient();

  const undo = useCallback(async () => {
    if (!documentId || !client) return;
    const result = await client.invokeTool<{ document_id: string }, UndoResult>(
      'undo',
      { document_id: documentId },
    );
    if (result.reverted) {
      showUndoToast(`Undo: ${result.command_description ?? ''}`);
    }
  }, [documentId, client]);

  const redo = useCallback(async () => {
    if (!documentId || !client) return;
    const result = await client.invokeTool<{ document_id: string }, RedoResult>(
      'redo',
      { document_id: documentId },
    );
    if (result.reapplied) {
      showUndoToast(`Redo: ${result.command_description ?? ''}`);
    }
  }, [documentId, client]);

  return { undo, redo };
};

// TODO(canvas-fundamentals I.5/I.6): wire two-finger tap → undo and
// three-finger tap → redo once the canvas surface dispatches gesture
// callbacks. Gesture detection itself is out of scope for this spec.
