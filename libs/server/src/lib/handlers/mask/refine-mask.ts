/**
 * `refine_mask` handler (mask-system B.1, FR-8).
 *
 * Loads the target painted mask's alpha bytes, runs canvas-core's
 * `refineMaskBytes` (threshold → grow → shrink → feather → blur), writes
 * the result as a new blob, and updates `layers.content_blob_id`.
 *
 * Reversibility: the prior blob id is captured at apply time; revert
 * restores the layer's `content_blob_id` to that id. Reapply re-runs the
 * full op against the layer's current bytes (so the user gets the
 * authoritative effect even if other ops touched the layer in the
 * meantime).
 */

import { refineMask as refineMaskTool } from '@diffusecraft/mcp-tools';
import {
  refineMaskBytes,
  type RefineMaskOps,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import { ServerError } from '../../../types/errors.js';
import type { Command } from '../../undo-redo/manager.js';
import {
  loadPaintedMaskBytes,
  parseMaskData,
  persistMaskBytes,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof refineMaskTool.inputSchema>;
type Output = z.infer<typeof refineMaskTool.outputSchema>;

const summarizeOps = (ops: RefineMaskOps): string => {
  const parts: string[] = [];
  if (ops.threshold !== undefined) parts.push(`threshold=${ops.threshold}`);
  if (ops.grow_px) parts.push(`grow=${ops.grow_px}`);
  if (ops.shrink_px) parts.push(`shrink=${ops.shrink_px}`);
  if (ops.feather_px) parts.push(`feather=${ops.feather_px}`);
  if (ops.blur_px) parts.push(`blur=${ops.blur_px}`);
  return parts.length === 0 ? 'no-op' : parts.join(', ');
};

export interface RefineMaskHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
}

export function createRefineMaskHandler(
  deps: RefineMaskHandlerDeps,
): ToolHandler<typeof refineMaskTool.inputSchema, typeof refineMaskTool.outputSchema> {
  const { db, assets } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = requireMaskLayer(db, input.layer_id);
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
      layer.document_id,
    );
    if (document_id !== layer.document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `layer ${layer.id} belongs to document ${layer.document_id}, not ${document_id}`,
      });
    }
    const meta = parseMaskData(layer.mask_data_json);
    if (meta && meta.subkind !== 'painted') {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `refine_mask requires a painted mask; layer ${layer.id} is subkind=${meta.subkind}`,
      });
    }
    const doc = requireDocument(db, document_id);
    const ops: RefineMaskOps = {
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
      ...(input.grow_px ? { grow_px: input.grow_px } : {}),
      ...(input.shrink_px ? { shrink_px: input.shrink_px } : {}),
      ...(input.feather_px ? { feather_px: input.feather_px } : {}),
      ...(input.blur_px ? { blur_px: input.blur_px } : {}),
    };

    const original = await loadPaintedMaskBytes(
      assets,
      layer.content_blob_id,
      doc.w,
      doc.h,
    );
    const refined = refineMaskBytes(original, doc.w, doc.h, ops);
    const { new_blob_id } = await persistMaskBytes(db, assets, layer.id, refined);

    const priorBlobId = layer.content_blob_id;
    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `refine_mask on layer ${layer.id} (${summarizeOps(ops)})`,
        affected_layer_ids: [layer.id],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: `refine_mask ${layer.id}`,
      revert: () => {
        db.prepare<[string | null, string]>(
          'UPDATE layers SET content_blob_id = ? WHERE id = ?',
        ).run(priorBlobId, layer.id);
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted refine_mask on layer ${layer.id}`,
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
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Re-applied refine_mask on layer ${layer.id}`,
            affected_layer_ids: [layer.id],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;

    return { layer_id: input.layer_id, applied: true } as Output;
  };
}
