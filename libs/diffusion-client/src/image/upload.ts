/**
 * `image.upload` helper (H.2, design.md §2 / §11, requirements §3.11 FR-35).
 *
 * Wraps the `upload_blob` catalog tool (`libs/mcp-tools/src/tools/image-edit/
 * upload-blob.ts`) so consumers can hand the SDK raw bytes + dimensions and
 * receive a `{ ref: { uri } }` envelope they can drop into any tool that
 * accepts an `ImageEnvelope` `ref` arm.
 *
 * ## Why dimensions are required
 *
 * The `upload_blob` input schema declares `width` and `height` as
 * `z.number().int().positive()` — the server uses them for blob metadata
 * and downstream pipeline routing. The SDK is render-agnostic (NFR-3 / no
 * pixel-decoder dependency in the client portion of the bundle), so it
 * cannot derive dimensions from the bytes itself; consumers that already
 * hold the image (the canvas, MeshCraft's renderer, the tablet's selection
 * tool) supply them at the call site.
 *
 * The FR-35 spec line `client.image.upload(bytes, format)` is honoured as
 * the narrative shape; the runtime signature accepts an additional
 * `{ width, height }` slot because the catalog tool requires it. Passing
 * `0` to satisfy the type checker would fail Zod validation client-side
 * (FR-13) before any network call.
 *
 * ## Output mapping
 *
 * `upload_blob` returns `{ blob_id, uri, expires_at }`. FR-35 surfaces
 * only `{ ref: { uri } }` to keep the `image.upload` API symmetric with
 * `image.fetch` (which consumes the `ref` arm of the envelope). Consumers
 * that need the expiry timestamp can call the underlying
 * `client.tools.uploadBlob(...)` directly — that surface is preserved by
 * the generated tool catalog.
 */

import type { ImageFormat, ToolInput, ToolOutput } from "@diffusecraft/mcp-tools";

import { ClientValidationError, ConnectionError } from "../errors";
import type { Transport } from "../transports/transport";

/**
 * Per-call options for {@link uploadImage}. `width` / `height` are
 * required by the underlying `upload_blob` schema (see module-level
 * doc); they are exposed at the helper layer rather than baked into the
 * positional signature so a future server-side dimension-inference path
 * can default them without a breaking API change.
 */
export interface UploadImageOptions {
  /** Pixel width of the image, must be a positive integer. */
  width: number;
  /** Pixel height of the image, must be a positive integer. */
  height: number;
}

/**
 * Upload raw image bytes via the `upload_blob` tool and return the
 * resulting `{ ref: { uri } }` envelope (FR-35).
 *
 * @example
 * const ref = await uploadImage(pngBytes, "png", transport, {
 *   width: 1024,
 *   height: 1024,
 * });
 * await client.tools.applyMask({ image: { format: "png", width: 1024,
 *   height: 1024, ref: ref.ref } });
 */
export async function uploadImage(
  bytes: Uint8Array,
  format: ImageFormat,
  transport: Transport,
  opts: UploadImageOptions,
): Promise<{ ref: { uri: string } }> {
  if (!(bytes instanceof Uint8Array)) {
    throw new ClientValidationError(
      "uploadImage: bytes must be a Uint8Array",
      { field_path: "bytes" },
    );
  }
  if (bytes.byteLength === 0) {
    throw new ClientValidationError("uploadImage: bytes is empty", {
      field_path: "bytes",
    });
  }
  if (!opts || !Number.isInteger(opts.width) || opts.width <= 0) {
    throw new ClientValidationError(
      "uploadImage: opts.width must be a positive integer",
      { field_path: "opts.width" },
    );
  }
  if (!Number.isInteger(opts.height) || opts.height <= 0) {
    throw new ClientValidationError(
      "uploadImage: opts.height must be a positive integer",
      { field_path: "opts.height" },
    );
  }

  const data_base64 = bytesToBase64(bytes);
  const args: ToolInput<"upload_blob"> = {
    format,
    width: opts.width,
    height: opts.height,
    bytes: data_base64,
  };

  const result = (await transport.send("upload_blob", args)) as ToolOutput<"upload_blob">;
  if (!result || typeof result !== "object" || typeof result.uri !== "string") {
    throw new ClientValidationError(
      "uploadImage: upload_blob response missing `uri`",
      { field_path: "uri" },
    );
  }
  return { ref: { uri: result.uri } };
}

/**
 * Encode a {@link Uint8Array} to a base64 string across Node, RN, and
 * browser runtimes (NFR-2). `Buffer` is preferred when present (Node);
 * the `btoa` fallback covers React Native + browsers. The fallback
 * walks the byte array in chunks so we don't blow the call-stack limit
 * on `String.fromCharCode(...arr)` for large images.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (
    globalThis as {
      Buffer?: {
        from(data: Uint8Array): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    return maybeBuffer.from(bytes).toString("base64");
  }
  const btoa = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (typeof btoa !== "function") {
    throw new ConnectionError(
      "uploadImage: no base64 encoder available (neither Buffer nor btoa)",
    );
  }
  // Build the binary string in chunks to avoid `RangeError: too many
  // arguments` from `String.fromCharCode(...arr)` on large images. 8 KiB
  // is well under any engine's argument cap.
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}
