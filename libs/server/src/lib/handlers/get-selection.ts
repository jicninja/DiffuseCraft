/**
 * `get_selection` handler — reads the active selection envelope and
 * returns its bounding box. The optional `include_mask` flag is honored
 * only when the persisted shape is a `mask` reference; for rect/polygon
 * the raster bytes are derived on demand and the caller is expected to
 * generate them client-side instead. Tier 2 handlers will return the
 * blob-fetched bytes inline once the AssetStore is wired here.
 */

import { getSelection as getSelectionTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { SelectionStore } from '../selection/store.js';
import { selectionBBox } from '../selection/bounds.js';

type Input = z.infer<typeof getSelectionTool.inputSchema>;
type Output = z.infer<typeof getSelectionTool.outputSchema>;

interface DocumentRow {
  id: string;
}

const requireDocument = (db: DB, document_id: string): DocumentRow => {
  const row = db
    .prepare<string, DocumentRow>('SELECT id FROM documents WHERE id = ?')
    .get(document_id);
  if (!row) {
    throw new ServerError({
      code: 'DOCUMENT_NOT_FOUND',
      message: `document not found: ${document_id}`,
    });
  }
  return row;
};

export function createGetSelectionHandler(
  db: DB,
  store: SelectionStore,
): ToolHandler<typeof getSelectionTool.inputSchema, typeof getSelectionTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'get_selection requires a document_id (or active document on the request).',
      });
    }
    requireDocument(db, document_id);
    const sel = store.getOrNone(document_id);
    const bbox = selectionBBox(sel) ?? undefined;
    // `include_mask` is reserved for Tier 2 — when the AssetStore is
    // resolved here we'll emit the blob's `ImageEnvelope` shape. For now
    // every shape returns just the bounding box.
    return { active: sel.kind !== 'none', bbox };
  };
}
