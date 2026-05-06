/**
 * `invert_selection` handler (FR-13).
 *
 * Swaps selected ↔ unselected on the active selection. `none` becomes
 * the entire canvas (a rect covering it); any other shape is rasterized
 * via canvas-core's `invertMask` and reduced back to a rect/polygon.
 * Reversible.
 */

import { invertSelection as invertSelectionTool } from '@diffusecraft/mcp-tools';
import {
  invertMask,
  maskBounds,
  selectionToMask,
} from '@diffusecraft/canvas-core';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import type { Command } from '../undo-redo/manager.js';
import { SelectionStore, type PersistedSelection } from '../selection/store.js';
import { selectionBBox } from '../selection/bounds.js';
import { persistedToCore } from '../selection/encoding.js';

type Input = z.infer<typeof invertSelectionTool.inputSchema>;
type Output = z.infer<typeof invertSelectionTool.outputSchema>;

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

export function createInvertSelectionHandler(
  db: DB,
  store: SelectionStore,
): ToolHandler<typeof invertSelectionTool.inputSchema, typeof invertSelectionTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'invert_selection requires a document_id (or active document on the request).',
      });
    }
    const doc = requireDocument(db, document_id);
    const prior = store.getOrNone(document_id);

    // `none` → entire canvas; otherwise raster invert and reduce.
    let next: PersistedSelection;
    if (prior.kind === 'none') {
      next = { kind: 'rect', rect: { x: 0, y: 0, w: doc.w, h: doc.h } };
    } else {
      const priorMask = selectionToMask(persistedToCore(prior), doc.w, doc.h);
      const inverted = invertMask(priorMask);
      const bb = maskBounds(inverted);
      if (!bb) {
        next = { kind: 'none' };
      } else {
        // Rect-detect: invert of a rect covering [0,0,w,h] is empty;
        // invert of an arbitrary rect is "everything but". The reduced
        // form is a polygon of the bbox.
        next = {
          kind: 'polygon',
          points: [
            { x: bb.x, y: bb.y },
            { x: bb.x + bb.w, y: bb.y },
            { x: bb.x + bb.w, y: bb.y + bb.h },
            { x: bb.x, y: bb.y + bb.h },
          ],
        };
      }
    }

    store.set({ document_id, selection: next });
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: 'Inverted selection',
        affected_layer_ids: [],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: 'invert_selection',
      revert: () => {
        store.set({ document_id, selection: prior });
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted invert_selection on ${document_id}`,
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
            change_summary: `Re-applied invert_selection on ${document_id}`,
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
    return { active: next.kind !== 'none', bbox };
  };
}
