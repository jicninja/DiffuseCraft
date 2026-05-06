/**
 * Shared query-string helpers for resource URIs.
 *
 * The MCP `readResource` request only carries the URI itself; FR-17 (`?since` /
 * `?fields` support, `client-sdk` requirements §3.5) therefore lives on the
 * URI string. Both the stdio and HTTP transports pass identical URIs through
 * to the MCP SDK's `client.readResource({ uri })` call, so the URI assembly
 * logic is identical and is extracted here to keep the two transports in
 * lockstep.
 *
 * This module is internal (underscore-prefixed) — it is consumed by the
 * sibling transport files but is NOT part of the SDK's public surface.
 */

import type { ResourceReadQuery } from "./transport";

/**
 * Append `?since` / `?fields` / `?cursor` query parameters to a resource URI.
 * Empty / undefined queries leave the URI untouched. Multi-value `fields` are
 * joined with `,` (matching `mcp-tool-catalog` FR-46's sparse-fieldset shape).
 *
 * `cursor` is forwarded for pagination (FR-18 / D.3); the server-side resource
 * handlers (`libs/server/src/lib/resources/*`) parse it via the same
 * `query['cursor']` slot they use today. The `iterate(...)` helpers in
 * `resources/generated.ts` thread `next_cursor` through this helper without
 * the consumer touching the URL.
 *
 * The function is URI-format-agnostic — it works with both the
 * `diffusecraft://...` resource URI form and ordinary HTTP URLs, picking the
 * correct separator (`?` for the first param, `&` for subsequent ones) based
 * on whether the input already contains a `?`.
 */
export function appendResourceQuery(
  uri: string,
  query: ResourceReadQuery | undefined,
): string {
  if (!query) return uri;
  const params: string[] = [];
  if (query.since !== undefined) {
    params.push(`since=${encodeURIComponent(query.since)}`);
  }
  if (query.fields !== undefined && query.fields.length > 0) {
    params.push(`fields=${encodeURIComponent(query.fields.join(","))}`);
  }
  if (query.cursor !== undefined) {
    params.push(`cursor=${encodeURIComponent(query.cursor)}`);
  }
  if (params.length === 0) return uri;
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}${params.join("&")}`;
}
