/**
 * Shared size and pixel-count limits for the `.dcft v1` portable file format
 * and image import.
 *
 * Both the client (decode preflight, archive size preflight) and the server
 * (`@fastify/multipart` configuration, archive validation) import these
 * constants so the cap is enforced identically on both sides — the client
 * never accepts a file the server would reject, and vice versa.
 *
 * Requirements: 8.1, 8.2, 8.5 (image-io spec).
 */

/**
 * Maximum decoded pixel count (width * height) for a picker-imported image.
 *
 * Files whose decoded resolution exceeds this value are rejected by the
 * client preflight before any layer is materialized (R8.1, R8.4).
 *
 * Value: 100 megapixels (100,000,000 pixels).
 */
export const IMAGE_MAX_PIXEL_COUNT = 100_000_000;

/**
 * Maximum size in bytes for a `.dcft` archive.
 *
 * Enforced by the client preflight on save / open and by the server's
 * `@fastify/multipart` `limits.fileSize` setting on upload (R8.2, R8.5).
 *
 * Value: 2 GiB (2 * 1024 * 1024 * 1024 bytes).
 */
export const DCFT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * `.dcft` format version this build emits and accepts on read.
 *
 * Re-exported alongside the Zod schemas in `./types`. The manifest's
 * `version` literal must match this constant; readers reject archives
 * whose manifest declares a different version.
 */
export const DCFT_FORMAT_VERSION = 1;
