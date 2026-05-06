/**
 * `refine_selection` handler (FR-9).
 *
 * Pure-geometry refinement: rasterizes the current selection, runs
 * grow / shrink / feather / blur (+ optional threshold), then reduces
 * the result back into a rect / polygon for storage. Reversible.
 */

import { refineSelection as refineSelectionTool } from '@diffusecraft/mcp-tools';
import {
  maskBounds,
  refineMask,
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

type Input = z.infer<typeof refineSelectionTool.inputSchema>;
type Output = z.infer<typeof refineSelectionTool.outputSchema>;

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

export function createRefineSelectionHandler(
  db: DB,
  store: SelectionStore,
): ToolHandler<typeof refineSelectionTool.inputSchema, typeof refineSelectionTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'refine_selection requires a document_id (or active document on the request).',
      });
    }
    const doc = requireDocument(db, document_id);
    const prior = store.getOrNone(document_id);
    if (prior.kind === 'none') {
      throw new ServerError({
        code: 'NO_SELECTION',
        message: 'refine_selection requires an active selection.',
      });
    }
    const priorMask = selectionToMask(persistedToCore(prior), doc.w, doc.h);
    const refined = refineMask(priorMask, {
      grow_px: input.grow_px,
      shrink_px: input.shrink_px,
      feather_px: input.feather_px,
      // smooth_px is reserved; map to blur_px for now (handler stub).
      blur_px: input.blur_px ?? input.smooth_px,
      threshold: input.threshold,
    });
    const bb = maskBounds(refined);
    let next: PersistedSelection;
    if (!bb) {
      next = { kind: 'none' };
    } else {
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

    store.set({ document_id, selection: next });
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: 'Refined selection',
        affected_layer_ids: [],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: 'refine_selection',
      revert: () => {
        store.set({ document_id, selection: prior });
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted refine_selection on ${document_id}`,
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
            change_summary: `Re-applied refine_selection on ${document_id}`,
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
