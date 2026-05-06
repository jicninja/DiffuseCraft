/**
 * `image.fetch` helper (H.1, design.md §2 / §11, requirements §3.11 FR-34).
 *
 * Resolves an {@link ImageEnvelope} (the discriminated `{ inline | ref }`
 * carrier from `@diffusecraft/mcp-tools`) to raw bytes, regardless of
 * which arm the server picked. Consumers don't have to inspect the
 * envelope shape themselves — `client.image.fetch(envelope)` just gives
 * them a {@link Uint8Array} they can hand to a decoder, an upload, or
 * the canvas.
 *
 * ## Envelope shapes
 *
 * Source of truth: `libs/mcp-tools/src/shared/envelope.ts`.
 *
 *   - `inline`: `{ format, width, height, inline: { encoding: "base64",
 *     data } }` — the bytes ride in the response, base64-encoded. Used
 *     when the payload fits under the client's `max_inline_image_kb`
 *     capability (default 256 KB).
 *   - `ref`: `{ format, width, height, ref: { uri:
 *     "diffusecraft://blob/<ULID>", expires_at? } }` — the bytes live in
 *     a short-lived signed blob (≤5 min, token-scoped) and the SDK
 *     fetches them via `transport.readResource(uri)`.
 *
 * ## Blob resource response
 *
 * The blob resource (`diffusecraft://blob/{id}` — see
 * `libs/mcp-tools/src/resources/manifest.ts`) is declared with a content
 * schema of `{ uri, expires_at, envelope: ImageEnvelope }`. The shape the
 * SDK observes depends on the transport:
 *
 *   - **In-memory transport**: `transport.readResource(...)` returns the
 *     server's raw schema content directly — i.e. the
 *     `{ uri, expires_at, envelope }` object. The inner `envelope` is
 *     itself an `ImageEnvelope`; for a non-cyclic blob it's an `inline`
 *     envelope carrying the base64 bytes.
 *   - **HTTP / stdio transports**: `transport.readResource(...)` returns
 *     the MCP SDK's `ReadResourceResult` shape — i.e. `{ contents: [{
 *     uri, mimeType?, blob? | text? }] }`. For an image the MCP SDK
 *     packages the bytes as `{ blob: <base64> }` (binary content) per
 *     the MCP spec.
 *
 * The helper handles both shapes structurally so consumers see the same
 * `Uint8Array` regardless of how the transport packages the response.
 *
 * ## Cyclic refs
 *
 * The blob resource's content schema permits the inner `envelope` to be
 * another `ref`-shaped envelope (the schema is a recursive union). In
 * practice the server emits an `inline` envelope at the leaf — a `ref →
 * ref → …` chain would defeat the purpose of the blob — but the helper
 * defends against the degenerate case by capping the recursion depth.
 */

import type { ImageEnvelope, ResourceUri } from "@diffusecraft/mcp-tools";

import { ClientValidationError, ConnectionError } from "../errors";
import type { Transport } from "../transports/transport";

/**
 * Maximum number of `ref → readResource → envelope` hops the helper will
 * follow before bailing out. The server emits an `inline` envelope at
 * the leaf in practice, so a depth of 4 is a forgiving upper bound that
 * still blocks an accidental loop from hanging the consumer.
 */
const MAX_REF_HOPS = 4;

/**
 * Resolve an {@link ImageEnvelope} to raw bytes (FR-34). Inline envelopes
 * are decoded directly; `ref` envelopes are read via the supplied
 * {@link Transport} and the resulting blob-resource payload is unwrapped
 * to its inner {@link Uint8Array}.
 *
 * Throws {@link ClientValidationError} on malformed envelopes or
 * unrecognised blob-resource shapes; {@link ConnectionError} is allowed
 * to propagate from the underlying `transport.readResource(...)` call.
 *
 * @example
 * const bytes = await fetchImage(envelope, transport);
 * const blob = new Blob([bytes], { type: `image/${envelope.format}` });
 */
export async function fetchImage(
  envelope: ImageEnvelope,
  transport: Transport,
): Promise<Uint8Array> {
  return resolveEnvelope(envelope, transport, 0);
}

async function resolveEnvelope(
  envelope: ImageEnvelope,
  transport: Transport,
  depth: number,
): Promise<Uint8Array> {
  if (envelope === null || typeof envelope !== "object") {
    throw new ClientValidationError(
      "fetchImage: envelope must be an object",
      { field_path: "envelope" },
    );
  }

  // Discriminator: `inline` or `ref` key presence (the schema is a Zod
  // union of two structurally-disjoint shapes — see
  // `libs/mcp-tools/src/shared/envelope.ts`).
  if ("inline" in envelope) {
    const inline = (envelope as { inline?: { encoding?: unknown; data?: unknown } }).inline;
    if (!inline || typeof inline !== "object") {
      throw new ClientValidationError(
        "fetchImage: inline envelope missing `inline` payload",
        { field_path: "envelope.inline" },
      );
    }
    if (inline.encoding !== "base64" || typeof inline.data !== "string") {
      throw new ClientValidationError(
        "fetchImage: inline envelope must declare `encoding: 'base64'` with string `data`",
        { field_path: "envelope.inline.encoding" },
      );
    }
    return base64ToBytes(inline.data);
  }

  if ("ref" in envelope) {
    if (depth >= MAX_REF_HOPS) {
      throw new ClientValidationError(
        `fetchImage: blob ref recursion exceeded ${MAX_REF_HOPS} hops; refusing to follow further`,
        { field_path: "envelope.ref" },
      );
    }
    const ref = (envelope as { ref?: { uri?: unknown } }).ref;
    if (!ref || typeof ref !== "object" || typeof ref.uri !== "string") {
      throw new ClientValidationError(
        "fetchImage: ref envelope missing `ref.uri`",
        { field_path: "envelope.ref.uri" },
      );
    }
    // The catalog's `ResourceUri` is a union of literal strings (one
    // per templated resource in the manifest); a concrete blob URI
    // like `diffusecraft://blob/<ULID>` is a *fill* of the templated
    // `diffusecraft://blob/{id}` slot. Cast through `unknown` to widen
    // — the transport itself does not validate the URI shape, so the
    // cast is a typing convenience rather than a runtime claim.
    const result = await transport.readResource(ref.uri as unknown as ResourceUri);
    return unwrapBlobResourceResult(result, transport, depth + 1);
  }

  throw new ClientValidationError(
    "fetchImage: envelope is neither inline nor ref",
    { field_path: "envelope" },
  );
}

/**
 * Unwrap whatever shape `transport.readResource(...)` returned into a
 * concrete {@link Uint8Array}. Two recognised shapes:
 *
 *   1. The MCP SDK's `ReadResourceResult` ({@link
 *      https://modelcontextprotocol.io | MCP spec}): `{ contents:
 *      [{ uri, mimeType?, blob? | text? }] }`. `blob` is a base64-encoded
 *      string; `text` is plain text (rejected here — image bytes are
 *      never `text`).
 *   2. The in-memory transport's raw schema content for the blob
 *      resource: `{ uri, expires_at, envelope }`. The inner `envelope`
 *      is itself an {@link ImageEnvelope} we recurse into.
 *
 * Returns a {@link Uint8Array}; throws {@link ClientValidationError} when
 * neither shape matches.
 */
async function unwrapBlobResourceResult(
  result: unknown,
  transport: Transport,
  depth: number,
): Promise<Uint8Array> {
  if (result === null || typeof result !== "object") {
    throw new ClientValidationError(
      "fetchImage: blob resource read returned a non-object response",
      { field_path: "<blob-resource>" },
    );
  }

  // Shape 1 — MCP SDK ReadResourceResult.
  const contents = (result as { contents?: unknown }).contents;
  if (Array.isArray(contents)) {
    const first = contents[0];
    if (first && typeof first === "object") {
      const blobField = (first as { blob?: unknown }).blob;
      if (typeof blobField === "string") return base64ToBytes(blobField);
      const textField = (first as { text?: unknown }).text;
      if (typeof textField === "string") {
        throw new ClientValidationError(
          "fetchImage: blob resource returned `text` content; expected base64 `blob` for image bytes",
          { field_path: "contents[0].text" },
        );
      }
    }
    throw new ClientValidationError(
      "fetchImage: blob resource MCP response carried no `blob` payload",
      { field_path: "contents[0]" },
    );
  }

  // Shape 2 — in-memory transport's raw schema content `{ envelope: ... }`.
  const innerEnvelope = (result as { envelope?: unknown }).envelope;
  if (innerEnvelope && typeof innerEnvelope === "object") {
    return resolveEnvelope(innerEnvelope as ImageEnvelope, transport, depth);
  }

  throw new ClientValidationError(
    "fetchImage: blob resource response did not match any recognised shape (expected MCP `{ contents }` or schema `{ envelope }`)",
    { field_path: "<blob-resource>" },
  );
}

/**
 * Decode a base64 string to a {@link Uint8Array} across Node, RN, and
 * browser runtimes (NFR-2). `Buffer` is preferred when present (Node
 * path); the `atob` fallback covers React Native + browsers.
 */
function base64ToBytes(b64: string): Uint8Array {
  const maybeBuffer = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): Uint8Array };
    }
  ).Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    const buf = maybeBuffer.from(b64, "base64");
    // Buffer is a Uint8Array subclass on Node, so direct return is safe;
    // copy into a plain Uint8Array to avoid leaking the subclass to
    // consumers that pattern-match on the prototype chain.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const atob = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof atob !== "function") {
    throw new ConnectionError(
      "fetchImage: no base64 decoder available (neither Buffer nor atob)",
    );
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
