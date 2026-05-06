/**
 * `invert_mask` handler (mask-system B.2, FR-9 / FR-16).
 *
 * - Painted masks: load alpha bytes, flip each (255 - v), persist new blob,
 *   update `content_blob_id`. Revert restores the prior blob id.
 *
 * - `from_layer` masks: toggle the `invert` flag in `mask_data_json`. No
 *   blob churn — the derived bytes update at use time. Revert restores the
 *   prior flag.
 */

import { invertMask as invertMaskTool } from '@diffusecraft/mcp-tools';
import {
  invertMaskBytes,
  type MaskData,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import type { Command } from '../../undo-redo/manager.js';
import {
  loadPaintedMaskBytes,
  parseMaskData,
  persistMaskBytes,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  serializeMaskData,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof invertMaskTool.inputSchema>;
type Output = z.infer<typeof invertMaskTool.outputSchema>;

export interface InvertMaskHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
}

export function createInvertMaskHandler(
  deps: InvertMaskHandlerDeps,
): ToolHandler<typeof invertMaskTool.inputSchema, typeof invertMaskTool.outputSchema> {
  const { db, assets } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = requireMaskLayer(db, input.layer_id);
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
      layer.document_id,
    );
    const meta = parseMaskData(layer.mask_data_json);

    // ---- from_layer path: toggle the invert flag ----
    if (meta && meta.subkind === 'from_layer') {
      const priorMeta: MaskData = meta;
      const nextMeta: MaskData = { ...meta, invert: !meta.invert };
      db.prepare<[string, string]>(
        'UPDATE layers SET mask_data_json = ? WHERE id = ?',
      ).run(serializeMaskData(nextMeta), layer.id);
      ctx.publish({
        name: 'document.changed',
        payload: {
          document_id,
          change_summary: `invert_mask (from_layer flag toggled) on layer ${layer.id}`,
          affected_layer_ids: [layer.id],
          originating_token_name: ctx.token_name,
          conflict: false,
        },
      });
      const command: Command = {
        label: `invert_mask ${layer.id}`,
        revert: () => {
          db.prepare<[string, string]>(
            'UPDATE layers SET mask_data_json = ? WHERE id = ?',
          ).run(serializeMaskData(priorMeta), layer.id);
          ctx.publish({
            name: 'document.changed',
            payload: {
              document_id,
              change_summary: `Reverted invert_mask on layer ${layer.id}`,
              affected_layer_ids: [layer.id],
              originating_token_name: ctx.token_name,
              conflict: false,
            },
          });
        },
        reapply: () => {
          db.prepare<[string, string]>(
            'UPDATE layers SET mask_data_json = ? WHERE id = ?',
          ).run(serializeMaskData(nextMeta), layer.id);
        },
      };
      (ctx as unknown as { document_id: string }).document_id = document_id;
      (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;
      return { layer_id: input.layer_id, applied: true } as Output;
    }

    // ---- painted path: flip alpha bytes ----
    const doc = requireDocument(db, document_id);
    const original = await loadPaintedMaskBytes(
      assets,
      layer.content_blob_id,
      doc.w,
      doc.h,
    );
    const flipped = invertMaskBytes(original);
    const { new_blob_id } = await persistMaskBytes(db, assets, layer.id, flipped);
    const priorBlobId = layer.content_blob_id;
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `invert_mask on layer ${layer.id}`,
        affected_layer_ids: [layer.id],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });
    const command: Command = {
      label: `invert_mask ${layer.id}`,
      revert: () => {
        db.prepare<[string | null, string]>(
          'UPDATE layers SET content_blob_id = ? WHERE id = ?',
        ).run(priorBlobId, layer.id);
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted invert_mask on layer ${layer.id}`,
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
