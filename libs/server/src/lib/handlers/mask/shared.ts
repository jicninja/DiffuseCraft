/**
 * Shared internals for mask-system handlers (mask-system spec Phase B).
 *
 * - `MaskAssetStore` — narrow asset surface the handlers use (write/read).
 * - `decodeMaskBlob` / `encodeMaskBlob` — Uint8Array ↔ Buffer codec for
 *   raw single-channel alpha. Servers wishing to swap to PNG bytes can
 *   provide a richer codec; this default mirrors `paint-strokes`'
 *   raw-RGBA approach for symmetry.
 * - `parseMaskData` / `serializeMaskData` — JSON for the
 *   `layers.mask_data_json` column added by migration 005.
 * - `requireMaskLayer` / `requireDocument` — thin DB readers + the typed
 *   error path.
 */

import type { Database as DB } from 'better-sqlite3';
import type { MaskData } from '@diffusecraft/canvas-core';

import { ServerError } from '../../../types/errors.js';

/** Shared mime tag for raw alpha blobs (single-channel). */
export const RAW_ALPHA_MIME = 'application/x-diffusecraft-mask';

export interface MaskAssetStore {
  write(args: {
    bytes: Buffer;
    mime: string;
    ttl_seconds?: number;
  }): Promise<{ id: string }>;
  read(id: string): Promise<{
    meta: { mime: string; bytes: number };
    bytes: Buffer;
  } | null>;
}

/**
 * Encode a mask `Uint8Array` for blob storage. Default uses raw bytes; the
 * codec is a thin wrapper so servers can swap to PNG when they have one.
 */
export const encodeMaskBlob = (mask: Uint8Array): { bytes: Buffer; mime: string } => ({
  bytes: Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength),
  mime: RAW_ALPHA_MIME,
});

/**
 * Decode a mask blob (raw bytes) into a `Uint8Array`. Returns `null` when
 * the mime is unrecognised (the handler must then start blank). PNG support
 * can be layered on top in a follow-up.
 */
export const decodeMaskBlob = (
  bytes: Buffer,
  mime: string,
  expectedSize: number,
): Uint8Array | null => {
  if (mime !== RAW_ALPHA_MIME) return null;
  if (bytes.byteLength !== expectedSize) return null;
  // Copy into a dedicated Uint8Array (Buffer's .buffer can be larger than
  // .byteLength when it lives in a pool).
  const out = new Uint8Array(expectedSize);
  out.set(bytes.subarray(0, expectedSize));
  return out;
};

/** Parse the `layers.mask_data_json` column. Returns null on missing/malformed. */
export const parseMaskData = (raw: string | null): MaskData | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MaskData;
    if (parsed && parsed.subkind === 'painted') return { subkind: 'painted' };
    if (
      parsed &&
      parsed.subkind === 'from_layer' &&
      typeof parsed.source_layer_id === 'string' &&
      (parsed.channel === 'alpha' || parsed.channel === 'luminance') &&
      typeof parsed.invert === 'boolean'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

/** Serialize MaskData back to JSON. */
export const serializeMaskData = (data: MaskData): string => JSON.stringify(data);

export interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

export interface MaskLayerRow {
  id: string;
  document_id: string;
  kind: string;
  content_blob_id: string | null;
  mask_data_json: string | null;
}

export const requireDocument = (db: DB, document_id: string): DocumentRow => {
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

export const requireMaskLayer = (db: DB, layer_id: string): MaskLayerRow => {
  const row = db
    .prepare<string, MaskLayerRow>(
      'SELECT id, document_id, kind, content_blob_id, mask_data_json FROM layers WHERE id = ?',
    )
    .get(layer_id);
  if (!row) {
    throw new ServerError({
      code: 'NOT_FOUND',
      message: `layer not found: ${layer_id}`,
    });
  }
  if (row.kind !== 'mask') {
    throw new ServerError({
      code: 'INVALID_INPUT',
      message: `layer ${row.id} kind=${row.kind} is not a mask`,
    });
  }
  return row;
};

/**
 * Resolve the document id from input / context (per-handler convention
 * mirrored from selection-tools handlers).
 */
export const resolveDocumentId = (
  inputDocumentId: string | undefined,
  ctxDocumentId: string | undefined,
  fallback?: string,
): string => {
  const id = inputDocumentId ?? ctxDocumentId ?? fallback;
  if (!id) {
    throw new ServerError({
      code: 'DOCUMENT_REQUIRED',
      message: 'mask handler requires a document_id (or active document on the request).',
    });
  }
  return id;
};

/**
 * Load a painted mask's bytes. Returns a freshly-zeroed buffer when the
 * mask layer has no content_blob_id (a brand-new mask).
 */
export const loadPaintedMaskBytes = async (
  assets: MaskAssetStore,
  blob_id: string | null,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const expected = width * height;
  if (!blob_id) return new Uint8Array(expected);
  const blob = await assets.read(blob_id);
  if (!blob) return new Uint8Array(expected);
  const decoded = decodeMaskBlob(blob.bytes, blob.meta.mime, expected);
  return decoded ?? new Uint8Array(expected);
};

/**
 * Persist updated mask bytes and update `layers.content_blob_id`. The
 * old blob id is returned so callers can include it in their revert
 * Command.
 */
export const persistMaskBytes = async (
  db: DB,
  assets: MaskAssetStore,
  layer_id: string,
  bytes: Uint8Array,
): Promise<{ new_blob_id: string }> => {
  const encoded = encodeMaskBlob(bytes);
  const written = await assets.write({ bytes: encoded.bytes, mime: encoded.mime });
  db.prepare<[string, string]>(
    'UPDATE layers SET content_blob_id = ? WHERE id = ?',
  ).run(written.id, layer_id);
  return { new_blob_id: written.id };
};
