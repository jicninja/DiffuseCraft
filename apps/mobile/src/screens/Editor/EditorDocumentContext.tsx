/**
 * EditorDocumentContext — owns the canvas-core `Document` for the editor
 * and exposes high-level mutation actions that keep both the document
 * model AND the editor-store layer snapshot in sync.
 *
 * Why this exists: the editor store only mirrors a UI-friendly subset of
 * each layer (id/name/visible/locked/opacity). The full canvas-core
 * `Document` — needed by `<CanvasView>` to render the per-layer `<Image>`
 * chain — used to live in component-local state inside
 * `useDocumentBootstrap`, which made it unreachable from the layers panel.
 * Mutations (add/remove/reorder/visibility/opacity) updated the snapshot
 * but never touched the document, so newly-created layers never rendered
 * and on-canvas state diverged from the panel.
 *
 * The provider is the single writer for the document. All layer mutations
 * funnel through `addPaintLayer`, `removeLayerById`, `reorderLayer`,
 * `patchLayer`; each one runs the canvas-core operation and re-derives the
 * snapshot from the resulting document.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addLayer as coreAddLayer,
  removeLayer as coreRemoveLayer,
  reorderLayer as coreReorderLayer,
  updateLayer as coreUpdateLayer,
  type Document,
  type LayerId,
  type LayerPatch,
} from '@diffusecraft/canvas-core';
import {
  EditorStoreContext,
  useEditorStore,
  type LayerSnapshot,
} from '@diffusecraft/core';
import { makeMutable, type SharedValue } from 'react-native-reanimated';

interface EditorDocumentContextValue {
  document: Document | null;
  /** Replace the entire document. Used by the bootstrap hook on first load. */
  setDocument(doc: Document | null): void;
  /** Append a new paint layer at the top of the stack and select it. */
  addPaintLayer(name?: string): { id: LayerId } | null;
  /** Remove a layer; if it was active, select the topmost remaining one. */
  removeLayerById(id: string): void;
  /** Move the layer at `fromIndex` to `toIndex` (FlatList indexing). */
  reorderLayer(fromIndex: number, toIndex: number): void;
  /** Patch a single layer (visibility, opacity, name, …) in both doc + store. */
  patchLayer(id: string, patch: LayerPatch): void;
  /**
   * Per-layer reactive opacity. Returns a `SharedValue<number>` mirrored
   * from the layer's `Layer.opacity`; the same instance is returned across
   * calls for a given `layerId` so RN-Skia subscribers (the visible
   * `<Group opacity={...}>` wrapper in `<CanvasView>`) keep their JSI
   * subscription stable across renders.
   *
   * Why this exists: routing every drag tick through React state
   * (`patchLayer` → `setDocumentState` → re-render → `<Group opacity=
   * {layer.opacity}>`) introduces a 1–2 frame visual lag on the canvas
   * because Skia repaints only after React commits the new prop. Writing
   * directly to a SharedValue lets RN-Skia repaint on the next vsync via
   * JSI without any React reconciliation in the hot path. `patchLayer`
   * still updates the canvas-core document so the persisted opacity is
   * correct; the SharedValue write happens synchronously alongside it.
   */
  liveOpacityFor(layerId: string): SharedValue<number>;
}

const EditorDocumentContext =
  createContext<EditorDocumentContextValue | null>(null);

const toSnapshot = (doc: Document): LayerSnapshot[] =>
  doc.layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
  }));

export interface EditorDocumentProviderProps {
  children: ReactNode;
}

export function EditorDocumentProvider({
  children,
}: EditorDocumentProviderProps) {
  const [document, setDocumentState] = useState<Document | null>(null);
  const setStoreLayers = useEditorStore((s) => s.setLayers);
  const setStoreActiveLayer = useEditorStore((s) => s.setActiveLayer);
  // Raw store handle — used to read `activeLayerId` imperatively inside
  // mutation callbacks (`removeLayerById`) without subscribing to it (a
  // subscription would re-bind the callback on every active-layer change).
  const editorStore = useContext(EditorStoreContext);

  // Ref mirror of the document so mutation callbacks can read the current
  // value imperatively. Reading state via the React updater (`setDocumentState((cur) => …)`)
  // is the wrong place to also call other setState functions: in StrictMode
  // the updater fires twice to verify purity, which would double-fire the
  // store sync. The ref-based pattern keeps the callbacks pure (one
  // setState call per public action) and allows them to be stable across
  // renders (no `document` in their deps array).
  const docRef = useRef<Document | null>(null);
  docRef.current = document;

  // Per-layer opacity SharedValues. Keyed by layer id (plain string —
  // canvas-core's `LayerId` brand is a TypeScript-only marker, identical
  // to a string at runtime). The map persists for the editor's lifetime;
  // entries for removed layers are pruned in `removeLayerById`. Lazy
  // allocation in `liveOpacityFor` lets CanvasView subscribe before the
  // bootstrap layer's opacity is known and avoids a subscription churn
  // when a layer is added (the SharedValue is materialized on first
  // access and re-used thereafter).
  const opacitySVs = useRef<Map<string, SharedValue<number>>>(new Map());

  /** Look up or lazily create the opacity SharedValue for `layerId`. The
   *  initial value is the layer's persisted `Layer.opacity` if the layer
   *  is currently in the document, else 1.0. */
  const liveOpacityFor = useCallback(
    (layerId: string): SharedValue<number> => {
      const existing = opacitySVs.current.get(layerId);
      if (existing !== undefined) return existing;
      const layer = docRef.current?.layers.find((l) => l.id === layerId);
      const initial = layer?.opacity ?? 1;
      const sv = makeMutable<number>(initial);
      opacitySVs.current.set(layerId, sv);
      return sv;
    },
    [],
  );

  /** Eagerly sync the SharedValue map from a document — called when the
   *  document is replaced (bootstrap or external load) so any layer that
   *  was already subscribed-to (orphan SVs) picks up the persisted value
   *  immediately, and new layers get their SV pre-seeded. */
  const syncOpacityFromDoc = useCallback((doc: Document) => {
    const seen = new Set<string>();
    for (const layer of doc.layers) {
      seen.add(layer.id);
      const existing = opacitySVs.current.get(layer.id);
      if (existing !== undefined) {
        existing.value = layer.opacity;
      } else {
        opacitySVs.current.set(
          layer.id,
          makeMutable<number>(layer.opacity),
        );
      }
    }
    // Prune SVs for layers that no longer exist (e.g., document reload).
    for (const id of opacitySVs.current.keys()) {
      if (!seen.has(id)) opacitySVs.current.delete(id);
    }
  }, []);

  const setDocument = useCallback(
    (doc: Document | null) => {
      setDocumentState(doc);
      if (doc) {
        syncOpacityFromDoc(doc);
        setStoreLayers(toSnapshot(doc));
      } else {
        opacitySVs.current.clear();
        setStoreLayers([]);
        setStoreActiveLayer(null);
      }
    },
    [setStoreLayers, setStoreActiveLayer, syncOpacityFromDoc],
  );

  const addPaintLayer = useCallback(
    (name?: string): { id: LayerId } | null => {
      const cur = docRef.current;
      if (!cur) return null;
      const { doc: next, layer } = coreAddLayer(cur, {
        kind: 'paint',
        name: name ?? `Layer ${cur.layers.length + 1}`,
        // Position above all existing layers (top of stack — highest
        // position renders last, i.e. on top of the composite).
        position: cur.layers.length,
      });
      setDocumentState(next);
      // Pre-seed the opacity SharedValue with the new layer's value
      // (defaults to 1) so the first <Group> render reads the correct
      // value without a one-frame fallback.
      opacitySVs.current.set(layer.id, makeMutable<number>(layer.opacity));
      setStoreLayers(toSnapshot(next));
      setStoreActiveLayer(layer.id);
      return { id: layer.id };
    },
    [setStoreLayers, setStoreActiveLayer],
  );

  const removeLayerById = useCallback(
    (id: string) => {
      const cur = docRef.current;
      if (!cur) return;
      // FR-13b: the bottom-most layer is the canvas itself and can never
      // be deleted (under P28 the document is raster-always; the base
      // layer is the document's only guaranteed raster surface). canvas-core
      // sorts `layers` by position ascending, so `layers[0]` is position 0
      // — the background. The UI already strips the swipe affordance from
      // this row; rejecting here is defense-in-depth so any other code
      // path (keyboard shortcut, future programmatic delete, MCP tool
      // call) hits the same guard.
      if (cur.layers[0]?.id === id) return;
      const priorActiveId = editorStore?.getState().activeLayerId ?? null;
      const { doc: next } = coreRemoveLayer(cur, id as LayerId);
      setDocumentState(next);
      opacitySVs.current.delete(id);
      setStoreLayers(toSnapshot(next));
      if (priorActiveId === id) {
        // Fall back to the topmost remaining layer (highest position).
        const fallback = next.layers[next.layers.length - 1]?.id ?? null;
        setStoreActiveLayer(fallback);
      }
    },
    [editorStore, setStoreLayers, setStoreActiveLayer],
  );

  const reorderLayer = useCallback(
    (fromIndex: number, toIndex: number) => {
      const cur = docRef.current;
      if (!cur) return;
      // The panel passes FlatList indices, which match `cur.layers` order
      // (canvas-core sorts by `position` and the store snapshot mirrors
      // that order). Translate to a target `position` for the canvas-core
      // operation — `reorderLayer` clamps internally.
      const moving = cur.layers[fromIndex];
      if (!moving) return;
      const { doc: next } = coreReorderLayer(cur, moving.id, toIndex);
      setDocumentState(next);
      setStoreLayers(toSnapshot(next));
    },
    [setStoreLayers],
  );

  const patchLayer = useCallback(
    (id: string, patch: LayerPatch) => {
      const cur = docRef.current;
      if (!cur) return;
      // Live opacity write — synchronous, JSI-reactive. Skia's
      // <Group opacity={sharedValue}> repaints on the next vsync without
      // waiting for React reconciliation to commit the new doc state.
      // We do this BEFORE the React state update so even if reconciliation
      // is slow under load, the canvas still tracks the slider 1:1.
      if (typeof patch.opacity === 'number') {
        const sv = opacitySVs.current.get(id);
        if (sv !== undefined) {
          sv.value = patch.opacity;
        } else {
          opacitySVs.current.set(
            id,
            makeMutable<number>(patch.opacity),
          );
        }
      }
      const { doc: next } = coreUpdateLayer(cur, id as LayerId, patch);
      setDocumentState(next);
      setStoreLayers(toSnapshot(next));
    },
    [setStoreLayers],
  );

  const value = useMemo<EditorDocumentContextValue>(
    () => ({
      document,
      setDocument,
      addPaintLayer,
      removeLayerById,
      reorderLayer,
      patchLayer,
      liveOpacityFor,
    }),
    [
      document,
      setDocument,
      addPaintLayer,
      removeLayerById,
      reorderLayer,
      patchLayer,
      liveOpacityFor,
    ],
  );

  return (
    <EditorDocumentContext.Provider value={value}>
      {children}
    </EditorDocumentContext.Provider>
  );
}

export function useEditorDocument(): EditorDocumentContextValue {
  const ctx = useContext(EditorDocumentContext);
  if (!ctx) {
    throw new Error(
      'useEditorDocument must be used inside <EditorDocumentProvider>',
    );
  }
  return ctx;
}
