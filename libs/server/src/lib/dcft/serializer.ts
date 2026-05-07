/**
 * `.dcft v1` serializer — turns a stored document plus its layers and blobs
 * into a portable ZIP archive matching the layout defined in
 * `libs/canvas-core/src/dcft/types.ts`.
 *
 * Boundary: this file owns the document → archive direction. The mirror
 * direction (archive → new document rows) lands in `materializer.ts`
 * (task 4.2). Both share `archive.ts` for the ZIP container.
 *
 * Algorithm overview:
 *   1. Read the `documents` row by id (`document_not_found` if missing).
 *   2. Read all `layers` rows for the document, ordered by `position ASC`.
 *   3. For each layer that has a `content_blob_id`, fetch the blob from
 *      the asset store (`blob_missing` if not found). Layers without a
 *      blob (e.g. derived `from_layer` masks) are skipped — only layers
 *      with raster bytes appear in the archive.
 *   4. Build `document.json` per `DcftDocumentJsonSchema`. Each entry
 *      includes `raster_path = layers/<layer-id>.png`. Validate via Zod
 *      to surface mapping bugs early; a Zod failure here is an internal
 *      bug and is rethrown as `Error` (the `SerializeError` discriminants
 *      defined in design.md are user-facing failure modes only).
 *   5. Compute `document_sha256` over the canonical (sorted-key) JSON
 *      serialization of `document.json`.
 *   6. Build `manifest.json` per `DcftManifestSchema`.
 *   7. Pack the archive: `manifest.json`, `document.json`, then one PNG
 *      per included layer at `layers/<layer-id>.png`.
 *   8. Reject if total archive size exceeds `DCFT_MAX_BYTES`.
 *
 * v1 fallback: the design specifies "re-encode to PNG if the stored MIME
 * is not already image/png". The server has no PNG re-encoder dependency
 * in the v1 tree (no `sharp`, no `canvas`). v1 therefore requires the
 * precondition that any blob referenced by a layer's `content_blob_id`
 * already has MIME `image/png`. Non-PNG blobs surface as a runtime error
 * (rethrown `Error`) — this is documented in CONCERNS for the reviewer
 * and revisited when an encoder lib lands.
 *
 * Requirements: 3.2, 3.10 (image-io spec).
 */

import * as crypto from 'node:crypto';
import type { Database as DB } from 'better-sqlite3';

import {
  DcftDocumentJsonSchema,
  DcftManifestSchema,
  DCFT_FORMAT_VERSION,
  DCFT_MAX_BYTES,
  type DcftDocumentJson,
  type DcftLayerEntry,
  type DcftManifest,
} from '@diffusecraft/canvas-core';

import type { AssetStore } from '../assets/store.js';
import { zipPack } from './archive.js';

// ---- Local Result type ------------------------------------------------------
//
// `libs/canvas-skia/src/io/adapter.ts` defines an identically-shaped Result for
// client-side adapters; the server cannot depend on canvas-skia (Nx tag rules)
// so we mirror the shape locally. If a shared `@diffusecraft/core` Result type
// lands later, this can be replaced with a single re-export.

/**
 * Discriminated success/failure tuple matching the `SerializeError` interface
 * in design.md § "server / format / DcftSerializer".
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ---- Public types -----------------------------------------------------------

/**
 * Failure modes surfaced to the HTTP route layer. The route maps each kind to
 * an HTTP status code per design.md § "Document import / export routes".
 */
export type SerializeError =
  | { readonly kind: 'document_not_found'; readonly documentId: string }
  | { readonly kind: 'blob_missing'; readonly blobId: string }
  | { readonly kind: 'archive_too_large'; readonly bytesSize: number };

/**
 * Serializer dependencies. The server's request-context wires these in once
 * during bootstrap; tests pass an in-memory SQLite handle plus an `AssetStore`
 * pointed at a tmp dir.
 */
export interface DcftSerializerDeps {
  readonly db: DB;
  readonly blobStore: Pick<AssetStore, 'read'>;
}

/**
 * Public surface — see `serialize` for the contract. Exposed as an interface
 * (rather than a free function) to match the design.md interface and to make
 * stubbing in higher-level smoke harnesses straightforward.
 */
export interface DcftSerializer {
  /**
   * Build a `.dcft v1` archive for the given `documentId`. Returns `ok` with
   * the raw archive bytes, or one of the `SerializeError` discriminants.
   */
  serialize(documentId: string): Promise<Result<Uint8Array, SerializeError>>;
}

// ---- Internal row types -----------------------------------------------------
//
// Mirrors the v1 schema in `libs/server/src/lib/db/migrations/001-initial-schema.ts`
// plus the additive columns from migrations 004 (`group_id`) and 005
// (`mask_data_json`). Migrations 002 and 003 do not touch `documents` /
// `layers`. We do NOT widen these to the project's existing `LayerRow` from
// `undo-redo/snapshot.ts` because that type intentionally drops `group_id`
// and `mask_data_json`, which the `.dcft` schema persists.

interface DocumentRow {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly created_at: string;
  readonly modified_at: string;
}

interface LayerRow {
  readonly id: string;
  readonly document_id: string;
  readonly kind: string;
  readonly name: string;
  readonly position: number;
  readonly opacity: number;
  readonly blend: string;
  /** SQLite stores booleans as INTEGER (0/1). */
  readonly visible: number;
  readonly content_blob_id: string | null;
  readonly group_id: string | null;
  readonly mask_data_json: string | null;
}

// ---- Helpers ----------------------------------------------------------------

/**
 * Recursively sort object keys so `JSON.stringify` produces a deterministic,
 * canonical byte sequence regardless of insertion order. The output of this
 * function is the input to SHA-256 and is also what is written to the archive
 * as `document.json`, so the in-archive hash and the recomputed hash on
 * materialize are guaranteed to match.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      sorted[k] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/** Stable JSON serialization via key-sorted recursion + standard stringify. */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Map a `mask_data_json` string from the DB to the discriminated union the
 * `.dcft` schema expects. Returns `undefined` for non-mask layers.
 */
function decodeMaskData(raw: string | null): DcftLayerEntry['mask_data'] {
  if (raw === null || raw === '') return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`dcft.serializer: malformed mask_data_json: ${raw}`);
  }
  // Trust the schema validator below to reject anything unexpected.
  return parsed as DcftLayerEntry['mask_data'];
}

/**
 * Map a SQLite layer row to the persisted `.dcft` layer entry shape. The
 * `created_at` field is not stored on `layers` in v1, so we synthesize it
 * from the parent document's `created_at` (matches the document timeline
 * closely enough for v1; the spec's revalidation triggers call out that
 * adding a real column should bump the format).
 */
function layerRowToEntry(row: LayerRow, documentCreatedAt: string): DcftLayerEntry {
  const entry: DcftLayerEntry = {
    id: row.id,
    document_id: row.document_id,
    kind: row.kind as DcftLayerEntry['kind'],
    name: row.name,
    position: row.position,
    opacity: row.opacity,
    visible: row.visible !== 0,
    locked: false,
    blend_mode: row.blend as DcftLayerEntry['blend_mode'],
    group_id: row.group_id ?? undefined,
    mask_data: decodeMaskData(row.mask_data_json),
    created_at: documentCreatedAt,
    raster_path: `layers/${row.id}.png`,
  };
  return entry;
}

// ---- Factory ---------------------------------------------------------------

/**
 * Build a {@link DcftSerializer} bound to a SQLite handle and an asset store.
 *
 * The factory prepares the hot SELECTs once per construction; subsequent
 * `serialize` calls reuse them. This mirrors the pattern in
 * `libs/server/src/lib/undo-redo/snapshot.ts` (`createSqliteSnapshotProvider`).
 */
export function createDcftSerializer(deps: DcftSerializerDeps): DcftSerializer {
  const { db, blobStore } = deps;

  const selectDocument = db.prepare<string, DocumentRow>(
    'SELECT id, name, w, h, created_at, modified_at FROM documents WHERE id = ?',
  );
  const selectLayers = db.prepare<string, LayerRow>(
    `SELECT id, document_id, kind, name, position, opacity, blend, visible,
            content_blob_id, group_id, mask_data_json
       FROM layers
      WHERE document_id = ?
      ORDER BY position ASC, id ASC`,
  );

  return {
    async serialize(documentId: string): Promise<Result<Uint8Array, SerializeError>> {
      // 1. Fetch the document row.
      const docRow = selectDocument.get(documentId);
      if (!docRow) return err({ kind: 'document_not_found', documentId });

      // 2. Fetch ordered layers.
      const layerRows = selectLayers.all(documentId);

      // 3. Pull bytes for layers that have content. Only layers with raster
      //    bytes participate in the archive entry list.
      const archiveEntries: Record<string, Uint8Array> = {};
      const layerEntries: DcftLayerEntry[] = [];

      for (const row of layerRows) {
        const blobId = row.content_blob_id;
        if (blobId === null) {
          // Skip layers without raster bytes (e.g. `from_layer` masks). The
          // schema requires `raster_path`, so they are omitted from the
          // document.json layer list entirely. Reviewer concern noted in
          // CONCERNS in the status report.
          continue;
        }
        const blob = await blobStore.read(blobId);
        if (blob === null) return err({ kind: 'blob_missing', blobId });

        // v1 fallback: require the stored blob to already be PNG. See file
        // header for rationale; CONCERNS reflects this for review.
        if (blob.meta.mime !== 'image/png') {
          throw new Error(
            `dcft.serializer: layer ${row.id} blob ${blobId} has MIME ${blob.meta.mime}; ` +
              `v1 requires image/png (re-encode path not yet wired — see TODO in serializer.ts header).`,
          );
        }

        archiveEntries[`layers/${row.id}.png`] = new Uint8Array(
          blob.bytes.buffer,
          blob.bytes.byteOffset,
          blob.bytes.byteLength,
        );
        layerEntries.push(layerRowToEntry(row, docRow.created_at));
      }

      // 4. Build document.json. Validate via Zod to surface schema-mapping
      //    bugs immediately rather than letting them slip into the archive.
      const documentJson: DcftDocumentJson = {
        id: docRow.id,
        name: docRow.name,
        width: docRow.w,
        height: docRow.h,
        color_mode: 'srgb',
        layers: layerEntries,
        created_at: docRow.created_at,
        modified_at: docRow.modified_at,
      };
      const docParse = DcftDocumentJsonSchema.safeParse(documentJson);
      if (!docParse.success) {
        // This is an internal bug in our row→entry mapping, NOT a user-facing
        // failure mode — surface as a thrown Error so the route handler maps
        // it to 500. The three SerializeError discriminants in design.md are
        // intentionally kept narrow.
        throw new Error(
          `dcft.serializer: document.json failed schema validation: ${docParse.error.message}`,
        );
      }

      // 5. Canonical serialization for hashing AND for the in-archive bytes,
      //    so `materialize` recomputes the same digest deterministically.
      const documentJsonText = canonicalStringify(docParse.data);
      const documentJsonBytes = new TextEncoder().encode(documentJsonText);
      const documentSha256 = crypto
        .createHash('sha256')
        .update(documentJsonBytes)
        .digest('hex');

      // 6. Manifest.
      const manifest: DcftManifest = {
        version: DCFT_FORMAT_VERSION,
        document_id: docRow.id,
        document_sha256: documentSha256,
        layer_count: layerEntries.length,
        width: docRow.w,
        height: docRow.h,
        created_at: new Date().toISOString(),
      };
      const manifestParse = DcftManifestSchema.safeParse(manifest);
      if (!manifestParse.success) {
        throw new Error(
          `dcft.serializer: manifest.json failed schema validation: ${manifestParse.error.message}`,
        );
      }
      const manifestJsonBytes = new TextEncoder().encode(
        canonicalStringify(manifestParse.data),
      );

      // 7. Pack. Insertion order: manifest → document → layers (sorted by
      //    path) so the archive byte layout is deterministic for byte-equal
      //    round-trip checks at the `unzip -l` level.
      const orderedEntries: Record<string, Uint8Array> = {};
      orderedEntries['manifest.json'] = manifestJsonBytes;
      orderedEntries['document.json'] = documentJsonBytes;
      const layerPaths = Object.keys(archiveEntries).sort();
      for (const p of layerPaths) {
        orderedEntries[p] = archiveEntries[p]!;
      }

      const archiveBytes = zipPack(orderedEntries);

      // 8. Size cap.
      if (archiveBytes.byteLength > DCFT_MAX_BYTES) {
        return err({ kind: 'archive_too_large', bytesSize: archiveBytes.byteLength });
      }

      return ok(archiveBytes);
    },
  };
}
