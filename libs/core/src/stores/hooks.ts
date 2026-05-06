/**
 * Typed hooks for store consumers.
 *
 * Each hook reads its bound store from the matching React context (FR-5,
 * FR-21). Selectors default to `shallow` equality (FR-22) to avoid spurious
 * re-renders. Callers MAY supply a custom equality function as the second
 * argument when referential equality is required (e.g., consumers that
 * read a single object reference rather than a derived sub-shape).
 *
 * Per-slice shortcut hooks (`useSelection`, `useActiveLayer`, etc.) are
 * thin selector wrappers per design §5.
 */
import { useContext } from 'react';
import { shallow } from 'zustand/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import {
  ConnectionStoreContext,
  EditorStoreContext,
  HistoryStoreContext,
  JobsStoreContext,
  McpCatalogStoreContext,
  ModelsStoreContext,
  StoresClientContext,
} from './context';
import type { EditorState } from './editor';
import type { ConnectionState } from './connection';
import type { ModelsState } from './models';
import type { JobsState } from './jobs';
import type { HistoryState } from './history';
import type { McpCatalogState } from './mcp-catalog';
import type { DiffuseCraftClientLike } from './shared/types';

/** Equality predicate used to gate hook re-renders. */
export type EqualityFn<T> = (a: T, b: T) => boolean;

function requireStore<T>(value: T | null, hookName: string): T {
  if (value === null) {
    throw new Error(
      `${hookName} must be used inside <StoresProvider>. ` +
        'Wrap your app tree with StoresProvider from @diffusecraft/core.',
    );
  }
  return value;
}

// ---------- Editor ----------

export function useEditorStore<T>(
  selector: (state: EditorState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(EditorStoreContext), 'useEditorStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

export const useSelection = () =>
  useEditorStore((s) => ({
    selection: s.selection,
    selectionMode: s.selectionMode,
    setSelection: s.setSelection,
    setSelectionMode: s.setSelectionMode,
  }));

export const useActiveLayer = () =>
  useEditorStore((s) => ({
    layer: s.layers.find((l) => l.id === s.activeLayerId) ?? null,
    setActiveLayer: s.setActiveLayer,
  }));

export const useBrushSettings = () =>
  useEditorStore((s) => ({
    size: s.brush.size,
    hardness: s.brush.hardness,
    opacity: s.brush.opacity,
    color: s.brush.color,
    pressureCurve: s.brush.pressureCurve,
    setBrush: s.setBrush,
  }));

export const useTransform = () =>
  useEditorStore((s) => ({
    transform: s.transform,
    beginTransform: s.beginTransform,
    setTransformHandle: s.setTransformHandle,
    patchTransform: s.patchTransform,
    endTransform: s.endTransform,
  }));

export const useActiveTool = () =>
  useEditorStore((s) => ({
    activeTool: s.activeTool,
    activeToolSettings: s.activeToolSettings,
    setActiveTool: s.setActiveTool,
    setActiveToolSettings: s.setActiveToolSettings,
  }));

// ---------- Connection ----------

export function useConnectionStore<T>(
  selector: (state: ConnectionState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(ConnectionStoreContext), 'useConnectionStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

export const useConnectionStatus = () =>
  useConnectionStore((s) => ({
    status: s.connectionStatus,
    routerStatus: s.routerStatus,
    lastError: s.lastError,
  }));

// ---------- Models ----------

export function useModelsStore<T>(
  selector: (state: ModelsState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(ModelsStoreContext), 'useModelsStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

// ---------- Jobs ----------

export function useJobsStore<T>(
  selector: (state: JobsState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(JobsStoreContext), 'useJobsStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

export const useActiveJob = (jobId: string | null) =>
  useJobsStore((s) => (jobId ? s.active.get(jobId) ?? null : null));

// ---------- History ----------

export function useHistoryStore<T>(
  selector: (state: HistoryState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(HistoryStoreContext), 'useHistoryStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

// ---------- MCP catalog ----------

export function useMcpCatalogStore<T>(
  selector: (state: McpCatalogState) => T,
  eq?: EqualityFn<T>,
): T {
  const store = requireStore(useContext(McpCatalogStoreContext), 'useMcpCatalogStore');
  return useStoreWithEqualityFn(store, selector, eq ?? (shallow as EqualityFn<T>));
}

export const useHasTool = (name: string) =>
  useMcpCatalogStore((s) => s.hasTool(name));

// ---------- Client SDK accessor ----------

/**
 * Returns the SDK client wired by `<StoresProvider>`, or `null` when:
 *  - the consumer is rendered outside the provider, OR
 *  - the provider was mounted with a `null` client (cold-start, pre-pairing).
 *
 * Consumers (e.g., `useUndoRedo`) MUST handle the `null` case as a no-op.
 */
export const useStoresClient = (): DiffuseCraftClientLike | null =>
  useContext(StoresClientContext);
