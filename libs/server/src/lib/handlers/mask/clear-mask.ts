/**
 * `clear_mask` handler (mask-system B.3, FR-10).
 *
 * Replaces a painted mask's alpha bytes with all zeros. Reversible: undo
 * restores the prior `content_blob_id`.
 */

import { clearMask as clearMaskTool } from '@diffusecraft/mcp-tools';
import { clearMaskBytes } from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import { ServerError } from '../../../types/errors.js';
import type { Command } from '../../undo-redo/manager.js';
import {
  parseMaskData,
  persistMaskBytes,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof clearMaskTool.inputSchema>;
type Output = z.infer<typeof clearMaskTool.outputSchema>;

export interface ClearMaskHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
}

export function createClearMaskHandler(
  deps: ClearMaskHandlerDeps,
): ToolHandler<typeof clearMaskTool.inputSchema, typeof clearMaskTool.outputSchema> {
  const { db, assets } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = requireMaskLayer(db, input.layer_id);
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
      layer.document_id,
    );
    const meta = parseMaskData(layer.mask_data_json);
    if (meta && meta.subkind !== 'painted') {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `clear_mask requires a painted mask; layer ${layer.id} is subkind=${meta.subkind}`,
      });
    }
    const doc = requireDocument(db, document_id);
    const cleared = clearMaskBytes(doc.w * doc.h);
    const { new_blob_id } = await persistMaskBytes(db, assets, layer.id, cleared);
    const priorBlobId = layer.content_blob_id;
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `clear_mask on layer ${layer.id}`,
        affected_layer_ids: [layer.id],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });
    const command: Command = {
      label: `clear_mask ${layer.id}`,
      revert: () => {
        db.prepare<[string | null, string]>(
          'UPDATE layers SET content_blob_id = ? WHERE id = ?',
        ).run(priorBlobId, layer.id);
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted clear_mask on layer ${layer.id}`,
            affected_layer_ids: [layer.id],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
      reapply: () => {
        db.prepare<[string, string]>(
          'UPDATE layers SET content_blob_id = ? WHERE id = ?',
        ).run(new_blob_id, layer.id);
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;
    return { layer_id: input.layer_id, applied: true } as Output;
  };
}
