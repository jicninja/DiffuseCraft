/**
 * `get_history_item` handler (B.1, FR-3 §3.2).
 *
 * Returns the full `HistoryItemFull` projection for a single item. The
 * `image_ref` and `thumbnail_ref` fields are populated as `diffusecraft://blob/<id>`
 * URIs the caller can resolve via the blob resource. Inline payloads are
 * deliberately avoided here — for large generation outputs the catalog
 * encourages `get_image({ scope: 'history_item', id })` for inline bytes.
 *
 * Idempotent and reversible=false (read-only).
 */

import { getHistoryItem as getHistoryItemTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';
import type { ToolHandler } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import type { HistoryStore, HistoryItemRow } from '../history/store.js';
import { projectHistoryItemFull } from '../history/projection.js';

type Input = z.infer<typeof getHistoryItemTool.inputSchema>;
type Output = z.infer<typeof getHistoryItemTool.outputSchema>;

interface BlobMetaRow {
  bytes: number;
  mime: string;
}

export function createGetHistoryItemHandler(
  db: DB,
  store: HistoryStore,
): ToolHandler<typeof getHistoryItemTool.inputSchema, typeof getHistoryItemTool.outputSchema> {
  return async (input: Input, _ctx): Promise<Output> => {
    const row: HistoryItemRow | null = store.getById(input.history_item_id);
    if (!row) {
      throw new ServerError({
        code: 'HISTORY_ITEM_NOT_FOUND',
        message: `history_item not found: ${input.history_item_id}`,
      });
    }
    const blobMeta = (id: string | null): BlobMetaRow | null =>
      id
        ? db
            .prepare<string, BlobMetaRow>('SELECT bytes, mime FROM blobs WHERE id = ?')
            .get(id) ?? null
        : null;
    const imageBlob = blobMeta(row.image_blob_id);
    const thumbBlob = blobMeta(row.thumbnail_blob_id);
    return projectHistoryItemFull(row, {
      image_blob: imageBlob,
      thumbnail_blob: thumbBlob,
    }) as Output;
  };
}
