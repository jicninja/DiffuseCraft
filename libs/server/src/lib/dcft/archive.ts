/**
 * `.dcft v1` archive helpers — thin synchronous wrappers around `fflate`'s
 * `zipSync` / `unzipSync` so the serializer (this task) and the materializer
 * (task 4.2) share a single packing/unpacking surface.
 *
 * The wrappers exist for two reasons:
 *   1. Re-typing: `fflate.zipSync` accepts a recursive `Zippable` shape we do
 *      not need — every entry in `.dcft` is a flat byte buffer keyed by the
 *      archive-relative path. Narrowing the input to `Record<string, Uint8Array>`
 *      keeps callers honest.
 *   2. Single point of policy: any future change (compression level, mtime
 *      stamping, deterministic ordering) lands here, not in every caller.
 *
 * Requirements: 3.2, 3.10 (image-io spec).
 */

import { zipSync, unzipSync } from 'fflate';

/**
 * Pack a flat map of archive-relative paths to byte buffers into a `.dcft v1`
 * ZIP archive. Returns the raw archive bytes; the caller owns the buffer.
 *
 * Entries are packed in iteration order of the input map. Callers that need
 * deterministic byte output should pass a map with a fixed key insertion
 * order (e.g. `manifest.json`, `document.json`, then layer rasters sorted by
 * path).
 */
export function zipPack(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries);
}

/**
 * Unpack a `.dcft v1` archive into a flat map of archive-relative paths to
 * byte buffers. Mirrors {@link zipPack}.
 *
 * Throws `fflate.FlateError` on malformed input; the materializer is
 * responsible for translating that into a `not_an_archive` discriminant.
 */
export function zipUnpack(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
