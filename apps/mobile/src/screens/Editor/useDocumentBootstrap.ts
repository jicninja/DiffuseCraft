/**
 * useDocumentBootstrap — creates an in-memory bootstrap document on Editor
 * mount when no server-side document is available (design §4.2).
 *
 * Flow:
 *   1. Call `loadDocument(documentId)` on the editor store.
 *   2. Detect the sentinel (width=0, height=0) indicating no server connection.
 *   3. Create a bootstrap document via `createDocument` from canvas-core.
 *   4. Add an initial paint layer via `addLayer` from canvas-core.
 *   5. Populate the editor store with document metadata, layers, and active layer.
 *   6. Return the full `Document` object for `<CanvasView />`.
 *
 * Pixel data stays out of Zustand per NFR-6 — the store receives only
 * metadata (dimensions, layer snapshots, active layer id).
 *
 * Requirements: FR-2, FR-43, FR-44, FR-45.
 */

import { useContext, useEffect } from 'react';
import {
  createDocument,
  addLayer,
  type Document,
} from '@diffusecraft/canvas-core';
import { EditorStoreContext, useEditorStore } from '@diffusecraft/core';

import { useEditorDocument } from './EditorDocumentContext';

export function useDocumentBootstrap(documentId: string): Document | null {
  // The canvas-core `Document` lives in `EditorDocumentContext` so that
  // every layer mutation (add/remove/reorder/visibility/opacity) flows
  // through one source of truth — see EditorDocumentContext.tsx for the
  // motivation. The bootstrap hook is the document's first writer; from
  // mount onward, the layers panel takes over via the same context.
  const { document: doc, setDocument: setEditorDocument } = useEditorDocument();

  // Store actions — stable references from Zustand selectors.
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const setDocument = useEditorStore((s) => s.setDocument);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  // Raw store handle for imperative getState() after loadDocument resolves.
  const editorStore = useContext(EditorStoreContext);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Step 1: attempt server load (returns sentinel when client is null).
      await loadDocument(documentId);

      if (cancelled) return;

      // Step 2: detect sentinel — width=0 means no server connection (FR-43).
      const storeState = editorStore?.getState();
      const currentDoc = storeState?.document;
      const isSentinel = currentDoc?.width === 0 && currentDoc?.height === 0;

      if (!isSentinel) {
        // A real document was loaded from the server — nothing to bootstrap.
        // Future: populate local doc state from server response.
        return;
      }

      // Step 3: create bootstrap document (FR-44).
      const bootstrapDoc = createDocument({
        preset: 'square',
        name: 'Untitled',
      });

      // Step 4: add initial paint layer (FR-44).
      const { doc: withLayer, layer } = addLayer(bootstrapDoc, {
        kind: 'paint',
        name: 'Layer 1',
      });

      if (cancelled) return;

      // Step 5: populate editor store with metadata (FR-45).
      // Document metadata — pixel data stays out of Zustand (NFR-6).
      setDocument({
        id: withLayer.id,
        width: withLayer.width,
        height: withLayer.height,
        last_applied_result_uri: null,
      });

      // Step 6: hand the full Document to the editor-document context.
      // The provider derives the store's layer snapshot from the document
      // and is the single writer from this point onward.
      setEditorDocument(withLayer);
      setActiveLayer(layer.id);
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [
    documentId,
    loadDocument,
    setDocument,
    setActiveLayer,
    setEditorDocument,
    editorStore,
  ]);

  return doc;
}
