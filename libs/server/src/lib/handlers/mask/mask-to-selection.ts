/**
 * `mask_to_selection` handler (mask-system B.6, FR-13 / FR-14).
 *
 * Reads a mask layer's bytes (painted directly; `from_layer` resolved by
 * loading the source layer's content blob and applying `deriveFromLayer`),
 * binarizes at the supplied threshold, persists the result as a fresh
 * blob, and sets the active selection to `{kind: 'mask', blob_id, w, h}`
 * via `SelectionStore`. Reversible: undo restores the prior persisted
 * selection.
 */

import { maskToSelection as maskToSelectionTool } from '@diffusecraft/mcp-tools';
import {
  deriveFromLayer,
  thresholdMaskBytes,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../../types/handler-context.js';
import { ServerError } from '../../../types/errors.js';
import type { Command } from '../../undo-redo/manager.js';
import { SelectionStore, type PersistedSelection } from '../../selection/store.js';
import {
  decodeMaskBlob,
  encodeMaskBlob,
  loadPaintedMaskBytes,
  parseMaskData,
  requireDocument,
  requireMaskLayer,
  resolveDocumentId,
  type MaskAssetStore,
} from './shared.js';

type Input = z.infer<typeof maskToSelectionTool.inputSchema>;
type Output = z.infer<typeof maskToSelectionTool.outputSchema>;

interface SourceLayerRow {
  id: string;
  document_id: string;
  kind: string;
  content_blob_id: string | null;
}

export interface MaskToSelectionHandlerDeps {
  readonly db: DB;
  readonly assets: MaskAssetStore;
  readonly selectionStore: SelectionStore;
}

export function createMaskToSelectionHandler(
  deps: MaskToSelectionHandlerDeps,
): ToolHandler<typeof maskToSelectionTool.inputSchema, typeof maskToSelectionTool.outputSchema> {
  const { db, assets, selectionStore } = deps;
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = requireMaskLayer(db, input.mask_layer_id);
    const document_id = resolveDocumentId(
      input.document_id,
      (ctx as unknown as { document_id?: string }).document_id,
      layer.document_id,
    );
    const doc = requireDocument(db, document_id);

    // Resolve mask bytes (painted vs from_layer).
    const meta = parseMaskData(layer.mask_data_json);
    let bytes: Uint8Array;
    if (!meta || meta.subkind === 'painted') {
      bytes = await loadPaintedMaskBytes(
        assets,
        layer.content_blob_id,
        doc.w,
        doc.h,
      );
    } else {
      // from_layer: load source layer's RGBA and derive.
      const source = db
        .prepare<string, SourceLayerRow>(
          'SELECT id, document_id, kind, content_blob_id FROM layers WHERE id = ?',
        )
        .get(meta.source_layer_id);
      if (!source) {
        throw new ServerError({
          code: 'NOT_FOUND',
          message: `from_layer mask references missing source layer: ${meta.source_layer_id}`,
        });
      }
      bytes = await deriveFromLayerBytes(
        assets,
        source.content_blob_id,
        doc.w,
        doc.h,
        meta.channel,
        meta.invert,
      );
    }

    // Binarize at threshold.
    const binary = thresholdMaskBytes(bytes, input.threshold ?? 128);

    // Persist a new mask blob and update the selection.
    const encoded = encodeMaskBlob(binary);
    const written = await assets.write({ bytes: encoded.bytes, mime: encoded.mime });

    const priorSelection = selectionStore.getOrNone(document_id);
    const next: PersistedSelection = {
      kind: 'mask',
      blob_id: written.id,
      width: doc.w,
      height: doc.h,
    };
    selectionStore.set({ document_id, selection: next });

    ctx.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: `mask_to_selection from layer ${layer.id} (threshold=${input.threshold ?? 128})`,
        affected_layer_ids: [],
        originating_token_name: ctx.token_name,
        conflict: false,
      },
    });

    const command: Command = {
      label: `mask_to_selection ${layer.id}`,
      revert: () => {
        selectionStore.set({ document_id, selection: priorSelection });
        ctx.publish({
          name: 'document.changed',
          payload: {
            document_id,
            change_summary: `Reverted mask_to_selection on ${document_id}`,
            affected_layer_ids: [],
            originating_token_name: ctx.token_name,
            conflict: false,
          },
        });
      },
      reapply: () => {
        selectionStore.set({ document_id, selection: next });
      },
    };
    (ctx as unknown as { document_id: string }).document_id = document_id;
    (ctx as unknown as { scratch: Record<string, unknown> }).scratch['command'] = command;

    return { active: true } as Output;
  };
}

/**
 * Read the source layer's RGBA blob and derive a mask via canvas-core.
 *
 * The default codec (paint-strokes' `defaultRawRgbaCodec`) writes
 * `application/x-diffusecraft-raster` bytes. We read those directly here;
 * in environments with PNG support, downstream hosts can swap the
 * `MaskAssetStore` for a richer codec and this helper still returns the
 * derived bytes so the handler doesn't need to know the format.
 */
async function deriveFromLayerBytes(
  assets: MaskAssetStore,
  blob_id: string | null,
  width: number,
  height: number,
  channel: 'alpha' | 'luminance',
  invert: boolean,
): Promise<Uint8Array> {
  if (!blob_id) return new Uint8Array(width * height);
  const blob = await assets.read(blob_id);
  if (!blob) return new Uint8Array(width * height);
  const expectedRgba = width * height * 4;
  // Treat the blob as raw RGBA when the size matches; otherwise return blank.
  if (blob.bytes.byteLength !== expectedRgba) {
    // Maybe single-channel mask reused as a paint layer alpha — fall back.
    const expectedAlpha = width * height;
    const decodedAlpha = decodeMaskBlob(blob.bytes, blob.meta.mime, expectedAlpha);
    if (decodedAlpha) {
      // alpha channel only — invert if asked.
      return invert ? new Uint8Array(decodedAlpha.map((v) => 255 - v)) : decodedAlpha;
    }
    return new Uint8Array(width * height);
  }
  const rgba = new Uint8Array(expectedRgba);
  rgba.set(blob.bytes.subarray(0, expectedRgba));
  return deriveFromLayer(rgba, width, height, { channel, invert });
}
