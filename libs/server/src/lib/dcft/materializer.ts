/**
 * `.dcft v1` materializer — turns a portable ZIP archive (produced by
 * `serializer.ts`) into a fresh `documents` row plus its `layers` rows
 * and ingested layer-raster blobs.
 *
 * Boundary: this file owns the archive → document direction. The mirror
 * direction (document → archive) lives in `serializer.ts` (task 4.1).
 * Both share `archive.ts` for the ZIP container.
 *
 * Algorithm overview:
 *   1. Reject archives larger than `DCFT_MAX_BYTES` before opening.
 *   2. Unzip via `archive.zipUnpack`; on throw, surface `not_an_archive`.
 *   3. Read & parse `manifest.json`; validate against `DcftManifestSchema`.
 *      An unrecognized `version` (anything other than `1`) is its own
 *      `manifest_version_unknown` discriminant for friendlier UX.
 *   4. Read `document.json`; recompute SHA-256 over the on-disk bytes and
 *      compare against `manifest.document_sha256`. Mismatch is fatal.
 *   5. Validate the parsed `document.json` against `DcftDocumentJsonSchema`.
 *   6. For every layer entry, confirm the entry exists in the archive map
 *      and starts with the PNG magic byte sequence.
 *   7. In a single SQLite transaction, mint a fresh document ULID
 *      (DO NOT reuse `manifest.document_id`), upsert each layer raster
 *      into the blob store (content-addressed by SHA-256, with
 *      `expires_at = NULL` since the document references it), and insert
 *      one `layers` row per archive entry preserving order, opacity,
 *      blend, and visibility. Layer ULIDs are also freshly minted —
 *      layer ids are document-scoped, so the materialized doc gets a
 *      brand-new id namespace.
 *
 * Note on canonical hashing: the serializer writes `document.json` as a
 * canonical (sorted-key) byte sequence. The materializer therefore hashes
 * the on-disk bytes verbatim — no re-canonicalization needed — so any
 * single-byte tamper between serialize and materialize is caught here.
 *
 * Note on `expires_at`: `AssetStore.write` sets `expires_at = NULL` when
 * `ttl_seconds` is omitted, which matches the design: blobs ingested by
 * materialize are permanent because the document references them. GC
 * (B.5) walks `expires_at` and the `content_blob_id` reference graph,
 * so the materialized blobs survive GC sweeps.
 *
 * Requirements: 2.3, 2.4, 2.6, 3.10, 8.5 (image-io spec).
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
} from '@diffusecraft/canvas-core';

import { newId } from '../id.js';
import type { AssetStore, BlobMetadata } from '../assets/store.js';
import { zipUnpack } from './archive.js';

// ---- Local Result type ------------------------------------------------------
//
// Mirrors `serializer.ts`. Inlined (4 lines) rather than re-imported so the
// materializer's failure surface stays self-contained — the `MaterializeError`
// discriminants below are independent of `SerializeError` and the two files
// should not implicitly couple via a shared module just for this alias.

/**
 * Discriminated success/failure tuple matching the `MaterializeError`
 * interface in design.md § "server / format / DcftMaterializer".
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
export type MaterializeError =
  | { readonly kind: 'too_large'; readonly bytesSize: number; readonly capBytes: number }
  | { readonly kind: 'not_an_archive' }
  | { readonly kind: 'manifest_invalid'; readonly details: string }
  | { readonly kind: 'manifest_version_unknown'; readonly version: number }
  | { readonly kind: 'document_invalid'; readonly details: string }
  | { readonly kind: 'document_sha_mismatch' }
  | { readonly kind: 'layer_missing'; readonly rasterPath: string }
  | { readonly kind: 'layer_invalid'; readonly rasterPath: string; readonly cause: string };

/**
 * Materializer dependencies. The server's request-context wires these in once
 * during bootstrap; tests pass an in-memory SQLite handle plus an `AssetStore`
 * pointed at a tmp dir.
 *
 * `blobStore` is typed as the full `AssetStore` (not a structural slice like
 * the serializer's `Pick<AssetStore, 'read'>`) because the materializer needs
 * `write` plus the underlying DB handle for SHA-256-based dedup lookups.
 */
export interface DcftMaterializerDeps {
  readonly db: DB;
  readonly blobStore: AssetStore;
}

/**
 * Public surface — see `materialize` for the contract. Exposed as an interface
 * (rather than a free function) to match the design.md interface and to make
 * stubbing in higher-level smoke harnesses straightforward.
 */
export interface DcftMaterializer {
  /**
   * Validate a `.dcft v1` archive and persist it as a fresh document.
   * Returns `ok` with `{ documentId }` on success, or one of the
   * `MaterializeError` discriminants.
   */
  materialize(archive: Uint8Array): Promise<Result<{ documentId: string }, MaterializeError>>;
}

// ---- Helpers ----------------------------------------------------------------

/**
 * PNG magic byte sequence (89 50 4E 47 0D 0A 1A 0A). Per RFC 2083 §3.1, every
 * valid PNG starts with these eight bytes. We do not parse the rest of the
 * file — actual decoding happens client-side via the canvas adapter; the
 * materializer only needs to reject obvious non-PNG content (e.g. a JPEG that
 * was renamed `.png` and stuffed into the archive by a misbehaving exporter).
 */
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function hasPngMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.byteLength) return false;
  for (let i = 0; i < PNG_MAGIC.byteLength; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

const RASTER_PATH_RE = /^layers\/[0-9A-HJKMNP-TV-Z]{26}\.png$/;

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Wrap a possibly-non-`Uint8Array` archive value in a guaranteed `Uint8Array`
 * view. `fflate.unzipSync` returns plain `Uint8Array` values per its type
 * declaration, but several intermediate paths (multipart parsers, Buffer-from-
 * Node-streams) hand us `Buffer` (which IS-A `Uint8Array` but extends it). We
 * normalize defensively so subsequent slicing/digesting is well-defined.
 */
function asUint8(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value as ArrayBuffer);
}

// ---- Factory ---------------------------------------------------------------

/**
 * Build a {@link DcftMaterializer} bound to a SQLite handle and an asset store.
 *
 * The factory prepares the hot statements once per construction; subsequent
 * `materialize` calls reuse them. This mirrors `serializer.ts`'s factory.
 */
export function createDcftMaterializer(deps: DcftMaterializerDeps): DcftMaterializer {
  const { db, blobStore } = deps;

  // Content-addressed dedup lookup. If a blob with this SHA-256 already
  // exists in the store, reuse it instead of duplicating bytes on disk.
  const findBlobBySha = db.prepare<string, BlobMetadata>(
    'SELECT * FROM blobs WHERE sha256 = ? LIMIT 1',
  );

  // Permanent the dedup-hit path: a previously-ingested blob may have been
  // written with a TTL (e.g. as a job preview output). Once a document
  // references it, GC must keep it. This UPDATE is idempotent (NULL → NULL
  // for already-permanent rows) and fires inside the materialize transaction.
  const makeBlobPermanent = db.prepare<string>(
    'UPDATE blobs SET expires_at = NULL WHERE id = ?',
  );

  const insertDocument = db.prepare<[string, string, number, number, string, string]>(
    'INSERT INTO documents (id, name, w, h, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const insertLayer = db.prepare<
    [string, string, string, string, number, number, string, number, string, string | null, string | null]
  >(
    `INSERT INTO layers
       (id, document_id, kind, name, position, opacity, blend, visible,
        content_blob_id, group_id, mask_data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    async materialize(
      archive: Uint8Array,
    ): Promise<Result<{ documentId: string }, MaterializeError>> {
      // 1. Size cap. Mirror the serializer's check; defense-in-depth — the
      //    Fastify multipart layer also enforces this, but the materializer
      //    is callable from non-HTTP contexts (tests, future MCP tool wraps).
      if (archive.byteLength > DCFT_MAX_BYTES) {
        return err({
          kind: 'too_large',
          bytesSize: archive.byteLength,
          capBytes: DCFT_MAX_BYTES,
        });
      }

      // 2. Unzip. `fflate` throws synchronously on malformed input; we map
      //    that to `not_an_archive` regardless of the exact `FlateError`
      //    subkind — the route layer doesn't need finer granularity.
      let entries: Record<string, Uint8Array>;
      try {
        entries = zipUnpack(asUint8(archive));
      } catch {
        return err({ kind: 'not_an_archive' });
      }

      // 3. Read manifest.json. A missing manifest means we cannot trust the
      //    archive is `.dcft` at all — surface as `not_an_archive` (matches
      //    HTTP 415 mapping in design.md).
      const manifestBytes = entries['manifest.json'];
      if (!manifestBytes) return err({ kind: 'not_an_archive' });

      // 4. Parse + validate manifest.
      let manifestParsed: unknown;
      try {
        manifestParsed = JSON.parse(new TextDecoder().decode(manifestBytes));
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e);
        return err({ kind: 'manifest_invalid', details });
      }

      // Detect "wrong version" BEFORE running the full schema, so the user
      // sees a friendly "this archive is from a future build" message
      // instead of a generic Zod failure on the `version` literal.
      if (
        manifestParsed !== null &&
        typeof manifestParsed === 'object' &&
        'version' in manifestParsed
      ) {
        const v = (manifestParsed as { version: unknown }).version;
        if (typeof v === 'number' && Number.isInteger(v) && v !== DCFT_FORMAT_VERSION) {
          return err({ kind: 'manifest_version_unknown', version: v });
        }
      }

      const manifestParse = DcftManifestSchema.safeParse(manifestParsed);
      if (!manifestParse.success) {
        return err({ kind: 'manifest_invalid', details: manifestParse.error.message });
      }
      const manifest = manifestParse.data;

      // 5. Read document.json + recompute hash.
      const documentBytes = entries['document.json'];
      if (!documentBytes) {
        return err({ kind: 'document_invalid', details: 'missing document.json' });
      }

      const documentSha = sha256Hex(documentBytes);
      if (documentSha !== manifest.document_sha256) {
        return err({ kind: 'document_sha_mismatch' });
      }

      // 6. Parse + validate document.json. Note we hash BEFORE parsing —
      //    even if the bytes are valid JSON whose fields fail Zod
      //    validation, the hash is still computed against the raw bytes
      //    so a tamper that happens to land on still-valid fields is
      //    caught at step 5 above.
      let documentParsed: unknown;
      try {
        documentParsed = JSON.parse(new TextDecoder().decode(documentBytes));
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e);
        return err({ kind: 'document_invalid', details });
      }

      const documentParse = DcftDocumentJsonSchema.safeParse(documentParsed);
      if (!documentParse.success) {
        return err({ kind: 'document_invalid', details: documentParse.error.message });
      }
      const documentJson: DcftDocumentJson = documentParse.data;

      // 7. Per-layer presence + magic-byte check. We do this BEFORE opening
      //    the SQLite transaction so any rejection short-circuits without
      //    touching DB state.
      const layerBytesByPath = new Map<string, Uint8Array>();
      for (const layer of documentJson.layers) {
        const rasterPath = layer.raster_path;
        // Defense-in-depth: the schema already enforces this regex, but
        // the path is also used as a key into the archive map, so any
        // raster_path that escapes `layers/<ULID>.png` (e.g. via a
        // schema bypass) must be rejected before we touch the entries
        // table by attacker-controlled key.
        if (!RASTER_PATH_RE.test(rasterPath)) {
          return err({
            kind: 'layer_invalid',
            rasterPath,
            cause: 'raster_path does not match layers/<ULID>.png',
          });
        }
        const rasterBytes = entries[rasterPath];
        if (!rasterBytes) {
          return err({ kind: 'layer_missing', rasterPath });
        }
        const normalized = asUint8(rasterBytes);
        if (!hasPngMagic(normalized)) {
          return err({
            kind: 'layer_invalid',
            rasterPath,
            cause: 'missing PNG magic bytes',
          });
        }
        layerBytesByPath.set(rasterPath, normalized);
      }

      // 8. Persist atomically. better-sqlite3's `db.transaction(fn)`
      //    wraps the body in BEGIN/COMMIT (or ROLLBACK on throw). Blob-
      //    store writes happen INSIDE the transaction: AssetStore.write
      //    awaits `fs.writeFile` to disk and then issues the INSERT row
      //    via the same `db` handle, so a thrown error past the file-
      //    write leaves an orphan file on disk — that's the same
      //    failure mode AssetStore already has elsewhere in the codebase
      //    and is GC'd by the orphaned-file sweep in `assets/gc.ts`.
      //    The DB-side row inserts ARE atomic.

      const newDocumentId = newId();
      const nowIso = new Date().toISOString();

      // Pre-resolve layer blobs OUTSIDE the synchronous transaction body,
      // because `AssetStore.write` is async (it `await`s `fs.writeFile`)
      // and `db.transaction(fn)` requires a synchronous function. We
      // collect a plan of resolved-blob-id-per-layer first, then apply
      // documents/layers row inserts inside a single sync transaction.

      interface PlannedLayer {
        readonly layerId: string;
        readonly entry: DcftLayerEntry;
        readonly contentBlobId: string;
      }
      const plan: PlannedLayer[] = [];
      // Track which blob ids we wrote NEW inside this materialize call so a
      // failure later can roll them back. (DB row deletion is sufficient —
      // the orphan file sweep handles disk cleanup the same way it does for
      // any other interrupted write.)
      const newlyWrittenBlobIds: string[] = [];

      try {
        for (const entry of documentJson.layers) {
          const layerBytes = layerBytesByPath.get(entry.raster_path);
          if (!layerBytes) {
            // Unreachable: step 7 populated the map for every entry. Throw
            // a runtime error so an internal bug surfaces as 500, not a
            // silent skip.
            throw new Error(
              `dcft.materializer: layer bytes missing for ${entry.raster_path} after presence check`,
            );
          }
          const layerSha = sha256Hex(layerBytes);
          let contentBlobId: string;
          const existing = findBlobBySha.get(layerSha);
          if (existing) {
            contentBlobId = existing.id;
          } else {
            // AssetStore.write does its OWN INSERT into `blobs` plus an
            // `fs.writeFile`. We hand it a Buffer view over the same bytes.
            const written = await blobStore.write({
              bytes: Buffer.from(
                layerBytes.buffer,
                layerBytes.byteOffset,
                layerBytes.byteLength,
              ),
              mime: 'image/png',
            });
            contentBlobId = written.id;
            newlyWrittenBlobIds.push(written.id);
          }
          plan.push({ layerId: newId(), entry, contentBlobId });
        }

        // Atomic row inserts: documents row + every layers row + permanent-
        // blob marker for each referenced blob. If any step throws, the
        // whole transaction rolls back.
        const txn = db.transaction(() => {
          insertDocument.run(
            newDocumentId,
            documentJson.name,
            documentJson.width,
            documentJson.height,
            nowIso,
            nowIso,
          );

          for (const planned of plan) {
            const { layerId, entry, contentBlobId } = planned;
            // Pin the blob's lifetime to the document. NULL is the
            // permanent sentinel per migration 001; the GC walker in
            // `assets/gc.ts` skips rows with `expires_at IS NULL` AND
            // those still referenced by `layers.content_blob_id`. We
            // set both invariants in one pass.
            makeBlobPermanent.run(contentBlobId);

            const maskJson = entry.mask_data ? JSON.stringify(entry.mask_data) : null;
            insertLayer.run(
              layerId,
              newDocumentId,
              entry.kind,
              entry.name,
              entry.position,
              entry.opacity,
              entry.blend_mode,
              entry.visible ? 1 : 0,
              contentBlobId,
              entry.group_id ?? null,
              maskJson,
            );
          }
        });

        txn();
      } catch (e) {
        // Roll back any blob rows we created before the throw. AssetStore
        // doesn't expose a "delete row only" path, so we go straight to
        // the table — file cleanup is left to the orphan sweep, same as
        // every other write-then-fail path in the codebase.
        if (newlyWrittenBlobIds.length > 0) {
          const del = db.prepare<string>('DELETE FROM blobs WHERE id = ?');
          for (const id of newlyWrittenBlobIds) {
            try {
              del.run(id);
            } catch {
              // best effort
            }
          }
        }
        throw e;
      }

      return ok({ documentId: newDocumentId });
    },
  };
}
