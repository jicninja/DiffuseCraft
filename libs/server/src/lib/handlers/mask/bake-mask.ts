/**
 * `bake_mask` handler (mask-system B.7, FR-18).
 *
 * Converts a `from_layer` mask into a `painted` mask by snapshotting the
 * current derived bytes:
 *
 *   1. Load the source layer's RGBA blob.
 *   2. Apply `deriveFromLayer` with the recorded channel + invert flag.
 *   3. Persist the resulting alpha bytes as a new blob.
 *   4. Update the layer:
 *      - `content_blob_id` ← new blob,
 *      - `mask_data_json` ← `{"subkind":"painted"}`.
 *
 * Reversible: undo restores the prior `mask_data_json` (with source/
 * channel/invert) and `content_blob_id`. The new blob is left in
 * place — the GC sweep will eventually evict it once unreferenced.
 */

import { bakeMask as bakeMaskTool } from '@diffusecraft/mcp-tools';
import { deriveFromLayer } from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import { ServerError } from '../../../types/errors.js';
import type { Command } from '../../undo-redo/manager.js';
import {
  decodeMaskBlob,
  parseMaskData,
  persistMaskBytes,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  serializeMaskData,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof bakeMaskTool.inputSchema>;
type Output = z.infer<typeof bakeMaskTool.outputSchema>;

interface SourceLayerRow {
  id: string;
  content_blob_id: string | null;
}

export interface BakeMaskHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
}

export function createBakeMaskHandler(
  deps: BakeMaskHandlerDeps,
): ToolHandler<typeof bakeMaskTool.inputSchema, typeof bakeMaskTool.outputSchema> {
  const { db, assets } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = requireMaskLayer(db, input.layer_id);
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
      layer.document_id,
    );
    const meta = parseMaskData(layer.mask_data_json);
    if (!meta || meta.subkind !== 'from_layer') {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `bake_mask requires a from_layer mask; layer ${layer.id} has subkind=${meta?.subkind ?? 'undefined'}`,
      });
    }
    const doc = requireDocument(db, document_id);

    // Resolve source bytes.
    const source = db
      .prepare<string, SourceLayerRow>(
        'SELECT id, content_blob_id FROM layers WHERE id = ?',
      )
      .get(meta.source_layer_id);
    if (!source) {
      throw new ServerError({
        code: 'NOT_FOUND',
        message: `bake_mask: source layer ${meta.source_layer_id} no longer exists`,
      });
    }
    const expectedRgba = doc.w * doc.h * 4;
    let baked: Uint8Array;
    if (!source.content_blob_id) {
      baked = new Uint8Array(doc.w * doc.h);
    } else {
      const blob = await assets.read(source.content_blob_id);
      if (!blob) {
        baked = new Uint8Array(doc.w * doc.h);
      } else if (blob.bytes.byteLength === expectedRgba) {
        const rgba = new Uint8Array(expectedRgba);
        rgba.set(blob.bytes.subarray(0, expectedRgba));
        baked = deriveFromLayer(rgba, doc.w, doc.h, {
          channel: meta.channel,
          invert: meta.invert,
        });
      } else {
        // Maybe already an alpha-only blob — reuse with optional invert.
        const decoded = decodeMaskBlob(blob.bytes, blob.meta.mime, doc.w * doc.h);
        if (decoded) {
          baked = meta.invert
            ? new Uint8Array(decoded.map((v) => 255 - v))
            : decoded;
        } else {
          baked = new Uint8Array(doc.w * doc.h);
        }
      }
    }

    const { new_blob_id } = await persistMaskBytes(db, assets, layer.id, baked);
    const priorMetaJson = layer.mask_data_json;
    const priorBlobId = layer.content_blob_id;

    db.prepare<[string, string]>(
      'UPDATE layers SET mask_data_json = ? WHERE id = ?',
    ).run(serializeMaskData({ subkind: 'painted' }), layer.id);

    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `bake_mask: layer ${layer.id} converted to painted`,
        affected_layer_ids: [layer.id],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: `bake_mask ${layer.id}`,
      revert: () => {
        db.prepare<[string | null, string | null, string]>(
          'UPDATE layers SET mask_data_json = ?, content_blob_id = ? WHERE id = ?',
        ).run(priorMetaJson, priorBlobId, layer.id);
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted bake_mask on layer ${layer.id}`,
            affected_layer_ids: [layer.id],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
      reapply: () => {
        db.prepare<[string, string, string]>(
          'UPDATE layers SET mask_data_json = ?, content_blob_id = ? WHERE id = ?',
        ).run(serializeMaskData({ subkind: 'painted' }), new_blob_id, layer.id);
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;

    return { layer_id: input.layer_id, applied: true } as Output;
  };
}
