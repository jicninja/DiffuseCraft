/**
 * Shared server-error wrapping helper for the SDK's three transports
 * (HTTP, stdio, in-memory).
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.4 (FR-14: typed `ServerError` thrown
 *     on 4xx/5xx and MCP error responses).
 *   - `client-sdk` design.md §6 — references `errors.ts` (the
 *     {@link import("../errors.js").ServerError} taxonomy used at host
 *     boundaries).
 *
 * Why this lives here rather than per-transport: the original B.2 / B.3
 * implementations duplicated the `instanceof McpError` → `ServerError`
 * wrap as a private method on each transport. Centralising the logic
 * means:
 *
 *   - The HTTP-level error path ({@link StreamableHTTPError}, thrown by
 *     `@modelcontextprotocol/sdk/client/streamableHttp.js` on every
 *     non-2xx fetch — verified against
 *     `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js`
 *     lines 105 / 317 / 342 / 364 / 404 / 448) is wrapped consistently
 *     too — every `4xx` / `5xx` lands as a `ServerError` with
 *     `status_code`, not a leaked SDK type that hosts cannot pattern-match
 *     against.
 *
 *   - The MCP `isError: true` tool-result path is converted in one place.
 *     The MCP SDK's `Client.callTool` (verified at
 *     `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`
 *     lines 490-520) does NOT throw on tool-level errors; it returns the
 *     `CallToolResult` with `isError: true` for the consumer to inspect.
 *     FR-14 mandates that the SDK *throw* a typed `ServerError` for those —
 *     otherwise consumers would have to inspect every tool response by
 *     hand, defeating the point of FR-12's typed return shapes.
 *
 *   - Anything else (network errors, generic `Error`s, etc.) is rethrown
 *     verbatim. {@link import("../errors.js").ConnectionError} already
 *     covers transport-level failures emitted by the transport itself
 *     (connect / disconnect / reconnect orchestration); fall-through here
 *     preserves the original error for diagnostics rather than masking it
 *     with a generic wrap.
 *
 * The helper is intentionally importable from any transport — it is a
 * leaf module that depends only on the public MCP SDK types and the SDK's
 * own `errors.ts`. No import from `@diffusecraft/server` (forbidden by
 * project conventions).
 */

import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { ServerError, type ConnectionTransportKind } from "../errors.js";

// ---------------------------------------------------------------------------
// Tool-result `isError` detection
// ---------------------------------------------------------------------------

/**
 * Structural shape of an MCP `CallToolResult` payload that carries an
 * error. The MCP SDK validates the shape against `CallToolResultSchema`
 * before returning it from `Client.callTool`; we narrow the slot we need
 * (`isError`, `content`, optional `structuredContent`) without
 * re-validating.
 *
 * `content` is typed as `unknown[]` here because the catalog's tool
 * outputs use `structuredContent` and the `content` array typically
 * holds at most one text block summarising the error. Hosts pattern-match
 * on `code` / `details` rather than parsing the text — it is preserved
 * verbatim in `details` for diagnostics.
 */
interface IsErrorToolResult {
  readonly isError: true;
  readonly content?: unknown;
  readonly structuredContent?: unknown;
}

/**
 * Type guard for the MCP `CallToolResult` error shape (`isError: true`).
 * Returns `true` when the value is a non-null object with `isError === true`.
 *
 * Used by the transport's `send()` path immediately after `callTool`
 * resolves: when this returns `true` we synthesise a `ServerError` and
 * throw rather than handing the error-shaped result back to the caller
 * (FR-14 — "typed ServerError thrown on … MCP error responses").
 */
export function isErrorToolResult(value: unknown): value is IsErrorToolResult {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { isError?: unknown }).isError === true
  );
}

// ---------------------------------------------------------------------------
// Catalog `ErrorResponse` extraction
// ---------------------------------------------------------------------------

/**
 * Structural shape of the catalog's `ErrorResponse` envelope (see
 * `libs/mcp-tools/src/shared/errors.ts` — `code`, `message`, optional
 * `hint`, `retry_after_ms`, `field_path`). We mirror the field set
 * inline rather than importing the Zod schema so this leaf module stays
 * dependency-light; the helper is duck-type-permissive (any object with a
 * string `code` and `message` is accepted) so future additions to the
 * envelope flow through `details` verbatim.
 */
interface CatalogErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly retry_after_ms?: number;
  readonly field_path?: string;
}

/**
 * Test whether `value` looks like a catalog {@link CatalogErrorEnvelope}.
 * Used to pick the most informative message for the synthesised
 * `ServerError` when the server returns `{ isError: true,
 * structuredContent: { code, message, ... } }`.
 */
function isCatalogErrorEnvelope(value: unknown): value is CatalogErrorEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/**
 * Pull a human-readable message out of an MCP `CallToolResult` error
 * payload. Order of preference:
 *
 *   1. `structuredContent` shaped like a catalog `ErrorResponse` —
 *      its `message` field.
 *   2. The first `content` block's `text` (the MCP convention is one
 *      text block summarising the failure).
 *   3. A static fallback so the thrown `ServerError` always has a
 *      non-empty message.
 */
function extractErrorMessage(result: IsErrorToolResult): string {
  if (isCatalogErrorEnvelope(result.structuredContent)) {
    return result.structuredContent.message;
  }
  const content = result.content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as { type?: unknown; text?: unknown };
    if (first && typeof first === "object" && typeof first.text === "string") {
      return first.text;
    }
  }
  return "tool returned isError without structured payload";
}

// ---------------------------------------------------------------------------
// `wrapServerError` — the canonical wrapper
// ---------------------------------------------------------------------------

/**
 * Convert an SDK-thrown error into the SDK's typed
 * {@link ServerError}. Recognises three shapes:
 *
 *   - {@link McpError} (JSON-RPC error returned by the server, surfaced
 *     by the MCP SDK's protocol layer at
 *     `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`
 *     line 459 / 490) → wrapped with `mcp_error_code` and `details: err.data`.
 *
 *   - {@link StreamableHTTPError} (raw HTTP non-2xx, thrown by the
 *     Streamable HTTP client transport at `streamableHttp.js` lines
 *     105 / 317 / 342 / 364 / 404 / 448) → wrapped with `status_code`.
 *     The SDK uses the placeholder `code: -1` for "unexpected content
 *     type" — we only treat the error as HTTP-shaped when `code` is a
 *     non-negative integer (covering 1xx-5xx), otherwise we fall through
 *     and re-throw verbatim so consumers see the original `Error`.
 *
 *   - Anything else → re-thrown verbatim (in particular: network
 *     errors / generic `Error`s / `AbortError`s — those keep their
 *     original form so consumers can pattern-match by `instanceof` or
 *     by `name`).
 *
 * `transportKind` is recorded in the synthesised message so log
 * consumers can see at a glance which transport raised the error.
 * `toolName` is optional — when present, the message prefixes
 * `tool '<name>' failed:`. Resource reads pass `undefined`.
 */
export function wrapServerError(
  err: unknown,
  transportKind: ConnectionTransportKind,
  toolName: string | undefined,
): unknown {
  if (err instanceof McpError) {
    return new ServerError(
      toolName !== undefined
        ? `${transportKind} transport: tool '${toolName}' failed: ${err.message}`
        : `${transportKind} transport: ${err.message}`,
      {
        mcp_error_code: err.code,
        details: err.data,
        cause: err,
      },
    );
  }

  if (err instanceof StreamableHTTPError) {
    // The SDK's `code` slot holds the HTTP status. The placeholder `-1`
    // (used for "unexpected content type") is NOT a status — fall
    // through to the verbatim re-throw so consumers see the original
    // SDK error and don't get a misleading `status_code: -1` on the
    // wrapped form.
    if (typeof err.code === "number" && err.code >= 0) {
      return new ServerError(
        toolName !== undefined
          ? `${transportKind} transport: tool '${toolName}' failed: HTTP ${err.code} ${err.message}`
          : `${transportKind} transport: HTTP ${err.code} ${err.message}`,
        {
          status_code: err.code,
          cause: err,
        },
      );
    }
  }

  return err;
}

// ---------------------------------------------------------------------------
// `serverErrorFromIsErrorResult` — convert MCP tool-result error → throw
// ---------------------------------------------------------------------------

/**
 * Convert an MCP `CallToolResult` carrying `isError: true` into a typed
 * {@link ServerError}. Used by every transport's `send()` path
 * immediately after `client.callTool` resolves, before returning the
 * result to the SDK caller.
 *
 *   - `details` carries the full result payload (`content` +
 *     `structuredContent`) so hosts can introspect catalog-specific
 *     fields like `retry_after_ms` / `hint`.
 *
 *   - When `structuredContent` matches the catalog's
 *     {@link CatalogErrorEnvelope} shape, its `message` is used verbatim
 *     for the thrown error; otherwise the first text content block (or a
 *     static fallback) supplies it.
 *
 *   - `mcp_error_code` is intentionally NOT set: the `isError: true`
 *     path is the MCP "tool reported a recoverable failure" channel,
 *     distinct from the JSON-RPC error channel that produces
 *     {@link McpError} (and is wrapped via {@link wrapServerError} above).
 *     Hosts that need to distinguish the two can read `details` (only
 *     `isError: true` results carry `content` arrays) or check
 *     `mcp_error_code === undefined`.
 */
export function serverErrorFromIsErrorResult(
  result: IsErrorToolResult,
  transportKind: ConnectionTransportKind,
  toolName: string,
): ServerError {
  const message = extractErrorMessage(result);
  return new ServerError(
    `${transportKind} transport: tool '${toolName}' failed: ${message}`,
    {
      details: result,
    },
  );
}
