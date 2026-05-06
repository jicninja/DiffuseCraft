/**
 * `selection_to_mask` handler (mask-system B.5, FR-12).
 *
 * Rasterizes the active selection into a painted mask layer:
 *
 *   - When `layer_id` is supplied → overwrite that mask layer's bytes.
 *   - When `layer_id` is omitted   → create a new mask layer (subkind
 *                                    `painted`, kind `mask`) at the top of
 *                                    the stack and write the bytes.
 *
 * For the "create new layer" path, the layer's id is freshly minted via
 * `newId()`. Mask layers don't render as visible content (FR-3), so they
 * are inserted with `visible=1, blend='normal'` and a name derived from
 * the active selection or the user-supplied `name`.
 */

import { selectionToMask as selectionToMaskTool } from '@diffusecraft/mcp-tools';
import {
  selectionToMaskBytes,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import { ServerError } from '../../../types/errors.js';
import { newId } from '../../id.js';
import type { Command } from '../../undo-redo/manager.js';
import { SelectionStore } from '../../selection/store.js';
import { persistedToCore } from '../../selection/encoding.js';
import {
  encodeMaskBlob,
  parseMaskData,
  persistMaskBytes,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  serializeMaskData,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof selectionToMaskTool.inputSchema>;
type Output = z.infer<typeof selectionToMaskTool.outputSchema>;

export interface SelectionToMaskHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
  readonly selectionStore: SelectionStore;
}

interface LayerCountRow {
  c: number;
}

export function createSelectionToMaskHandler(
  deps: SelectionToMaskHandlerDeps,
): ToolHandler<typeof selectionToMaskTool.inputSchema, typeof selectionToMaskTool.outputSchema> {
  const { db, assets, selectionStore } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
    );
    const doc = requireDocument(db, document_id);

    // Rasterize the active selection.
    const persistedSel = selectionStore.getOrNone(document_id);
    const coreSel = persistedToCore(persistedSel);
    const bytes = selectionToMaskBytes(
      coreSel,
      { width: doc.w, height: doc.h },
      // We don't currently resolve mask-of-mask references — selection
      // already lives in the persisted form so the rasterizer doesn't
      // need to dereference further.
      undefined,
    );

    if (input.layer_id) {
      // ---- Overwrite path ----
      const layer = requireMaskLayer(db, input.layer_id);
      if (layer.document_id !== document_id) {
        throw new ServerError({
          code: 'INVALID_INPUT',
          message: `layer ${layer.id} belongs to document ${layer.document_id}, not ${document_id}`,
        });
      }
      const meta = parseMaskData(layer.mask_data_json);
      if (meta && meta.subkind !== 'painted') {
        throw new ServerError({
          code: 'INVALID_INPUT',
          message: `selection_to_mask overwrite requires a painted mask; layer ${layer.id} is subkind=${meta.subkind}`,
        });
      }
      const { new_blob_id } = await persistMaskBytes(db, assets, layer.id, bytes);
      const priorBlobId = layer.content_blob_id;
      ctx.publish({
        name: 'document.changed',
        payload: {
          document_id,
          change_summary: `selection_to_mask overwrote layer ${layer.id}`,
          affected_layer_ids: [layer.id],
          originating_token_name: ctx.token_name,
          conflict: false,
        },
      });
      const command: Command = {
        label: `selection_to_mask ${layer.id}`,
        revert: () => {
          db.prepare<[string | null, string]>(
            'UPDATE layers SET content_blob_id = ? WHERE id = ?',
          ).run(priorBlobId, layer.id);
          ctx.publish({
            name: 'document.changed',
            payload: {
              document_id,
              change_summary: `Reverted selection_to_mask on layer ${layer.id}`,
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
      return { layer_id: input.layer_id, created: false } as Output;
    }

    // ---- Create new mask layer path ----
    const new_layer_id = newId();
    const new_position =
      db
        .prepare<string, LayerCountRow>(
          'SELECT COUNT(*) AS c FROM layers WHERE document_id = ?',
        )
        .get(document_id)?.c ?? 0;
    const layerName = input.name ?? 'Selection mask';
    const encoded = encodeMaskBlob(bytes);
    const written = await assets.write({ bytes: encoded.bytes, mime: encoded.mime });

    db.prepare<[string, string, string, number, string, string, string]>(
      `INSERT INTO layers
         (id, document_id, kind, name, position, opacity, blend, visible, content_blob_id, mask_data_json)
       VALUES (?, ?, 'mask', ?, ?, 1.0, 'normal', 1, ?, ?)`,
    ).run(
      new_layer_id,
      document_id,
      layerName,
      new_position,
      written.id,
      serializeMaskData({ subkind: 'painted' }),
    );

    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `selection_to_mask created mask layer ${new_layer_id}`,
        affected_layer_ids: [new_layer_id],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });
    const command: Command = {
      label: `selection_to_mask ${new_layer_id}`,
      revert: () => {
        db.prepare<string>('DELETE FROM layers WHERE id = ?').run(new_layer_id);
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted selection_to_mask (removed layer ${new_layer_id})`,
            affected_layer_ids: [],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
      reapply: () => {
        // Re-insert the same layer (idempotent — the row's id is fixed).
        db.prepare<[string, string, string, number, string, string, string]>(
          `INSERT OR IGNORE INTO layers
             (id, document_id, kind, name, position, opacity, blend, visible, content_blob_id, mask_data_json)
           VALUES (?, ?, 'mask', ?, ?, 1.0, 'normal', 1, ?, ?)`,
        ).run(
          new_layer_id,
          document_id,
          layerName,
          new_position,
          written.id,
          serializeMaskData({ subkind: 'painted' }),
        );
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;

    return { layer_id: new_layer_id as never, created: true } as Output;
  };
}
