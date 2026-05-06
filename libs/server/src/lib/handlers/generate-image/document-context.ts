/**
 * Document-context resolver (generation-workflow A.3 helper).
 *
 * Translates the inbound `generate_image` document handle into the slimmer
 * `GraphContext.document` shape (width × height) and, for verb-resolved
 * `refine` / `fill`, locates the active source-image blob the builder needs
 * to feed to `ETN_LoadImageBase64`.
 *
 * The resolver reads SQLite directly because no `DocumentService` exists
 * yet — when the `documents` spec lands a real service, this module will
 * be the single seam to update. Until then we keep the surface minimal.
 */

import type { Database as DB } from 'better-sqlite3';

export interface ResolvedDocument {
  document_id: string;
  width: number;
  height: number;
  /**
   * Latest paint-layer blob id, used by `refine` / `fill` as the source
   * image. `null` when the canvas is blank (no paint layers).
   */
  source_image_blob_id: string | null;
  /**
   * Active selection mask blob id, when the document has a selection set
   * via `set_selection`. `null` when there is no selection.
   */
  selection_blob_id: string | null;
}

export class DocumentNotFoundError extends Error {
  public readonly code = 'DOCUMENT_NOT_FOUND' as const;
  public readonly document_id: string;
  constructor(document_id: string) {
    super(`document not found: ${document_id}`);
    this.name = 'DocumentNotFoundError';
    this.document_id = document_id;
  }
}

interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

interface LayerRow {
  content_blob_id: string | null;
}

interface SelectionRow {
  mask_blob_id: string | null;
}

/** Look up the document row + the latest paint layer and selection. */
export function resolveDocumentContext(db: DB, document_id: string): ResolvedDocument {
  const row = db
    .prepare<string, DocumentRow>('SELECT id, w, h FROM documents WHERE id = ?')
    .get(document_id);
  if (!row) throw new DocumentNotFoundError(document_id);

  // Source image: top-most paint layer's content_blob_id. The full document
  // model surfaces this with proper compositing; the scaffold is enough for
  // refine / fill round-trips.
  const layer = db
    .prepare<string, LayerRow>(
      "SELECT content_blob_id FROM layers WHERE document_id = ? AND kind = 'paint' AND content_blob_id IS NOT NULL ORDER BY position DESC LIMIT 1",
    )
    .get(document_id);

  const selection = db
    .prepare<string, SelectionRow>('SELECT mask_blob_id FROM selections WHERE document_id = ?')
    .get(document_id);

  return {
    document_id: row.id,
    width: row.w,
    height: row.h,
    source_image_blob_id: layer?.content_blob_id ?? null,
    selection_blob_id: selection?.mask_blob_id ?? null,
  };
}
