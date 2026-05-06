/**
 * `select_all` handler (FR-14).
 *
 * Sets the selection to a rect covering the whole document. Reversible:
 * the prior selection is restored on undo.
 */

import { selectAll as selectAllTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import type { Command } from '../undo-redo/manager.js';
import { SelectionStore, type PersistedSelection } from '../selection/store.js';
import { selectionBBox } from '../selection/bounds.js';

type Input = z.infer<typeof selectAllTool.inputSchema>;
type Output = z.infer<typeof selectAllTool.outputSchema>;

interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

const requireDocument = (db: DB, document_id: string): DocumentRow => {
  const row = db
    .prepare<string, DocumentRow>('SELECT id, w, h FROM documents WHERE id = ?')
    .get(document_id);
  if (!row) {
    throw new ServerError({
      code: 'DOCUMENT_NOT_FOUND',
      message: `document not found: ${document_id}`,
    });
  }
  return row;
};

export function createSelectAllHandler(
  db: DB,
  store: SelectionStore,
): ToolHandler<typeof selectAllTool.inputSchema, typeof selectAllTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'select_all requires a document_id (or active document on the request).',
      });
    }
    const doc = requireDocument(db, document_id);
    const prior = store.getOrNone(document_id);
    const next: PersistedSelection = {
      kind: 'rect',
      rect: { x: 0, y: 0, w: doc.w, h: doc.h },
    };
    store.set({ document_id, selection: next });
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: 'Selected all',
        affected_layer_ids: [],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: 'select_all',
      revert: () => {
        store.set({ document_id, selection: prior });
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted select_all on ${document_id}`,
            affected_layer_ids: [],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
      reapply: () => {
        store.set({ document_id, selection: next });
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Re-applied select_all on ${document_id}`,
            affected_layer_ids: [],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;

    const bbox = selectionBBox(next) ?? undefined;
    return { active: true, bbox };
  };
}
