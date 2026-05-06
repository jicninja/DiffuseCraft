/**
 * `diffusecraft://undo-stack/{document-id}` resource (D.1, FR-21).
 *
 * Reads the calling token's per-document undo stack from the
 * {@link UndoRedoManager} and returns it as a paginated, optionally
 * field-projected list of {@link CommandSummary} entries.
 *
 * Per the catalog manifest at
 * `libs/mcp-tools/src/resources/manifest.ts:158`:
 *   - `supports_since: false` — no `since` filtering on this resource.
 *   - `supports_fields: true` — clients may pass `?fields=a,b` to trim.
 *   - `contentSchema: paginated(CommandSummary)` — wire shape `{ id,
 *     tool_name, description, performed_at, reversible }` per
 *     `libs/mcp-tools/src/shared/common.ts:273`.
 *
 * The local stack-side {@link import('../undo-redo/stack.js').CommandSummary}
 * uses `args_summary` / `created_at`; the catalog wire shape uses
 * `description` / `performed_at` / `reversible`. This module bridges the
 * two on the way out — entries in the undo/redo stacks are by definition
 * reversible (FR-3), so `reversible` is always `true`.
 *
 * Pagination is index-based: the cursor is the post-page index in the
 * newest-first projection, encoded as a decimal string. Default limit is
 * 50, hard-capped at 50 to satisfy `paginated()`'s `.max(50)` bound from
 * `libs/mcp-tools/src/shared/pagination.ts:20`.
 *
 * Empty stack → `{ items: [], next_cursor: undefined }` (FR-21).
 */

import type { UndoRedoManager } from '../undo-redo/manager.js';
import type { CommandSummary as StackCommandSummary } from '../undo-redo/stack.js';
import type { ResourceContext } from '../transports/in-memory.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

export interface UndoStackResourceQuery {
  document_id: string;
  cursor?: string;
  limit?: number;
  fields?: ReadonlyArray<string>;
}

export interface UndoStackResourcePage {
  items: ReadonlyArray<Record<string, unknown>>;
  next_cursor?: string;
}

/** Project a stack-side {@link StackCommandSummary} onto the catalog wire shape. */
const toWireSummary = (s: StackCommandSummary): Record<string, unknown> => ({
  id: s.id,
  tool_name: s.tool_name,
  description: s.args_summary,
  performed_at: s.created_at,
  reversible: true,
});

/** Restrict an entry to the requested keys; pass-through when no `fields`. */
const projectFields = (
  obj: Record<string, unknown>,
  fields?: ReadonlyArray<string>,
): Record<string, unknown> => {
  if (!fields || fields.length === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) out[f] = obj[f];
  }
  return out;
};

/**
 * Resolve the stack key from the calling context. The manager keys stacks
 * by `(token_id, document_id)`; the stdio transport carries
 * `ctx.token_id = null` (auth-trusted-by-process), so we fall back to
 * `ctx.token_name` — mirrors the C.1 / C.2 handler convention in
 * `libs/server/src/lib/handlers/undo.ts:61`.
 */
const resolveTokenKey = (ctx: ResourceContext): string =>
  ctx.token_id ?? ctx.token_name;

/** Coerce a free-form `limit` query param into the supported range. */
const clampLimit = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  const n = Math.trunc(raw);
  if (n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

/** Decode the opaque cursor string into a non-negative start index. */
const decodeCursor = (cursor: string | undefined, total: number): number => {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > total) return total;
  return n;
};

/** Serve `diffusecraft://undo-stack/{document-id}`. */
export function readUndoStack(
  manager: UndoRedoManager,
  ctx: ResourceContext,
  query: UndoStackResourceQuery,
): UndoStackResourcePage {
  const tokenKey = resolveTokenKey(ctx);
  // Manager returns newest-first per FR-21 (see stack.ts:242).
  const all = manager.getUndoStack(tokenKey, query.document_id);
  const limit = clampLimit(query.limit);
  const start = decodeCursor(query.cursor, all.length);
  const end = Math.min(start + limit, all.length);
  const slice = all.slice(start, end);
  const items = slice.map((entry) => projectFields(toWireSummary(entry), query.fields));
  return end < all.length ? { items, next_cursor: String(end) } : { items };
}
