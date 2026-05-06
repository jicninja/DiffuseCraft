/**
 * Reversible-command middleware (D.9, P27) — legacy bridge.
 *
 * For tools flagged `reversible`, after the handler completes, register
 * the resulting legacy `{ revert, reapply, label? }` Command on the
 * per-client per-document undo stack via {@link UndoRedoManager.enrol}
 * (the legacy 2-arg surface — keyed by `token_name:document_id`). The
 * handler may pass the command via `ctx.scratch.command`; this
 * middleware no-ops when the slot is unset.
 *
 * **Phase F partial-migration status (undo-redo-system §11).** The
 * canonical write path is now `ctx.undoRedo.execute(...)`; four
 * handlers have been migrated:
 *
 *   - `apply_history_item`
 *   - `set_selection`
 *   - `paint_strokes`
 *   - `transform_layer`
 *
 * They no longer set `ctx.scratch.command`, so this middleware no-ops
 * for them. The remaining ten reversible handlers continue to ride the
 * legacy bridge; they are gated by an explicit allowlist in
 * `lib/conformance/undo-redo-conformance.ts` and tracked under their
 * owning specs:
 *
 *   - `mask/*` (mask-system)
 *   - `select_all` / `invert_selection` / `refine_selection`
 *     (selection-tools follow-up)
 *
 * **Why we don't retire this middleware yet.** Option A (preferred for
 * Phase F per the implementer prompt): leave the bridge in place and
 * untouched. Migrating the mask + selection-helper handlers is a
 * larger blast radius best owned by their respective specs; this
 * middleware is the single point keeping their existing wire shape
 * coherent until they migrate. When the legacy allowlist in
 * `undo-redo-conformance.ts` empties, this file can be deleted.
 *
 * TODO(mask-system, selection-tools): migrate the ten remaining
 * reversible handlers onto `ctx.undoRedo.execute(...)` and delete this
 * middleware + the corresponding allowlist entry in
 * `undo-redo-conformance.ts`.
 */

import type { Middleware } from './chain.js';
import type { UndoRedoManager } from '../undo-redo/manager.js';

export function createReversibleCommandMw(manager: UndoRedoManager): Middleware {
  return async (_args, ctx, next) => {
    const out = await next();
    const command = ctx.scratch['command'];
    if (!command) return out;
    if (!ctx.document_id) return out; // non-document-scoped reversible tools (rare) skip
    manager.enrol(ctx.token_name, ctx.document_id, command as never);
    return out;
  };
}
