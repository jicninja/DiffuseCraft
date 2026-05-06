/**
 * `diffusecraft://redo-stack/{document-id}` resource (D.2, FR-22).
 *
 * Symmetric counterpart to `./undo-stack.ts` — reads the calling token's
 * per-document redo stack from the {@link UndoRedoManager} and returns
 * it as a paginated, optionally field-projected list of
 * {@link CommandSummary} entries.
 *
 * Per the catalog manifest at
 * `libs/mcp-tools/src/resources/manifest.ts:167`:
 *   - `supports_since: false`.
 *   - `supports_fields: true`.
 *   - `contentSchema: paginated(CommandSummary)`.
 *
 * See `./undo-stack.ts` for the field-mapping rationale (stack-side
 * `args_summary` / `created_at` → wire `description` / `performed_at`)
 * and the `(token_id ?? token_name)` stack-key fallback that mirrors the
 * C.1 / C.2 handler convention in `libs/server/src/lib/handlers/undo.ts`.
 *
 * Empty stack → `{ items: [], next_cursor: undefined }`.
 */

import type { UndoRedoManager } from '../undo-redo/manager.js';
import type { CommandSummary as StackCommandSummary } from '../undo-redo/stack.js';
import type { ResourceContext } from '../transports/in-memory.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

export interface RedoStackResourceQuery {
  document_id: string;
  cursor?: string;
  limit?: number;
  fields?: ReadonlyArray<string>;
}

export interface RedoStackResourcePage {
  items: ReadonlyArray<Record<string, unknown>>;
  next_cursor?: string;
}

const toWireSummary = (s: StackCommandSummary): Record<string, unknown> => ({
  id: s.id,
  tool_name: s.tool_name,
  description: s.args_summary,
  performed_at: s.created_at,
  reversible: true,
});

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

const resolveTokenKey = (ctx: ResourceContext): string =>
  ctx.token_id ?? ctx.token_name;

const clampLimit = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  const n = Math.trunc(raw);
  if (n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

const decodeCursor = (cursor: string | undefined, total: number): number => {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > total) return total;
  return n;
};

/** Serve `diffusecraft://redo-stack/{document-id}`. */
export function readRedoStack(
  manager: UndoRedoManager,
  ctx: ResourceContext,
  query: RedoStackResourceQuery,
): RedoStackResourcePage {
  const tokenKey = resolveTokenKey(ctx);
  const all = manager.getRedoStack(tokenKey, query.document_id);
  const limit = clampLimit(query.limit);
  const start = decodeCursor(query.cursor, all.length);
  const end = Math.min(start + limit, all.length);
  const slice = all.slice(start, end);
  const items = slice.map((entry) => projectFields(toWireSummary(entry), query.fields));
  return end < all.length ? { items, next_cursor: String(end) } : { items };
}
