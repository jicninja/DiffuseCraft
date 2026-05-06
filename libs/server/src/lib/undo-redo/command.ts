/**
 * Reversible {@link Command} contract + {@link buildCommand} helper.
 *
 * Implements `undo-redo-system` design.md §3 / requirements.md §3.1
 * (FR-1, FR-2, FR-3). Every reversible tool handler in v1 produces a
 * `Command<R>` whose `apply()` performs the mutation and `revert()`
 * restores the prior state. The pair is deterministic for a given
 * starting document state (FR-2): re-applying after revert reproduces
 * the same observable outcome (modulo non-deterministic seeds — for AI
 * generation, re-applying replays the captured bytes from the history
 * item rather than regenerating).
 *
 * Two `Command` shapes coexist in this directory during the migration
 * cascade:
 *   - This file's parametric `Command<R>` (richer metadata: `id`,
 *     `tool_name`, `document_id`, `args_summary`, `weight`,
 *     `created_at`, `_result`). New code targets this shape.
 *   - The legacy `Command` interface in `manager.ts` (just `revert` /
 *     `reapply` / optional `label`) used by ~10 existing handlers. Task
 *     A.3 rewires the manager onto the parametric shape; until then
 *     this file lives alongside without disturbing the existing
 *     surface.
 *
 * Task scope: A.1 — non-behavioral (interface + helper + tests). The
 * helper is the only code path; the interface itself is type-only.
 */

import { newId } from '../id.js';

/**
 * A document-scoped identifier. The undo-redo system treats document
 * IDs symbolically (per design.md §3); v1 aliases to `string` (ULID
 * shape produced by `lib/id.ts`). A future task may swap in a branded
 * type — that change is local to this alias.
 */
export type DocumentId = string;

/**
 * A reversible operation enrolled with the {@link UndoRedoManager}.
 *
 * `R` is the payload type returned by {@link Command.apply}. After the
 * first successful apply, the manager calls `apply()` again on `redo`;
 * the captured `_result` lets the redo path return the same payload to
 * the caller without re-running side effects on the consumer side.
 */
export interface Command<R = unknown> {
  /** ULID, set at construction time by {@link buildCommand}. */
  readonly id: string;
  /** Catalog tool name (`add_layer`, `set_selection`, ...) for audit/debug. */
  readonly tool_name: string;
  /** Document this command targets. */
  readonly document_id: DocumentId;
  /**
   * Human-readable hint surfaced to UI / audit log
   * (e.g., `"Add layer 'Generated: red barn'"`). ≤120 chars.
   */
  readonly args_summary: string;
  /**
   * Hint for snapshot policy / memory budgeting:
   *   - `"small"`  — visibility toggle, name change, single-pixel mask.
   *   - `"medium"` — layer add/remove, transform, paint stroke.
   *   - `"large"`  — flatten, group transform, history-item apply.
   */
  readonly weight: 'small' | 'medium' | 'large';
  /** ISO-8601 timestamp of construction. */
  readonly created_at: string;
  /**
   * Optional set of layer IDs this Command touches. Used by the
   * conflict-detection wrapper in {@link UndoRedoManager.execute} to
   * decide whether an incoming Command overlaps a recent edit by
   * another client (requirements.md §3.4 FR-13..FR-15, design.md §7).
   *
   * **Semantics:**
   *   - `undefined` or empty list → "scope unknown" → never flagged as
   *     conflicting (defaults to safe + non-noisy: legacy handlers
   *     don't yet populate this field, and every Command they produce
   *     would otherwise spuriously appear to overlap).
   *   - Non-empty list → the canonical set of layer IDs whose state
   *     this Command mutates. Conflict detection considers two
   *     Commands overlapping iff their lists intersect.
   *
   * Phase F migration target: every reversible handler eventually
   * populates this field. Until then, only handlers updated under the
   * Phase E + F cascade emit it.
   */
  readonly affected_layer_ids?: ReadonlyArray<string>;
  /** Performs (or re-performs) the operation. */
  apply(): Promise<R>;
  /** Restores the prior state. */
  revert(): Promise<void>;
  /**
   * Captured during the first {@link Command.apply} for `redo` to
   * return the same payload. Mutated once by {@link buildCommand}'s
   * apply wrapper; otherwise read-only.
   */
  readonly _result?: R;
}

/**
 * Spec for a Command, omitting fields that {@link buildCommand}
 * populates. Pass everything *except* `id`, `created_at`, and
 * `_result` — those are filled in for you.
 */
export type CommandSpec<R> = Omit<Command<R>, 'id' | 'created_at' | '_result'>;

/**
 * Constructs a {@link Command} from a partial spec, populating
 * `id` (ULID), `created_at` (ISO timestamp), and an `apply` wrapper
 * that captures the result into `_result` for redo.
 *
 * The `revert` function is forwarded verbatim — callers own the
 * "restore prior state" logic. Other metadata (`tool_name`,
 * `document_id`, `args_summary`, `weight`) is forwarded verbatim.
 */
export const buildCommand = <R>(spec: CommandSpec<R>): Command<R> => {
  const cmd: Command<R> = {
    tool_name: spec.tool_name,
    document_id: spec.document_id,
    args_summary: spec.args_summary,
    weight: spec.weight,
    // `affected_layer_ids` is optional per `Command<R>`; forward it
    // verbatim only when the caller supplied a value so downstream
    // consumers can distinguish "scope unknown" (undefined) from
    // "scope = no layers" (empty array). Phase E's conflict detector
    // treats both as non-overlapping; the distinction matters for
    // future audit / debug surfaces.
    ...(spec.affected_layer_ids !== undefined
      ? { affected_layer_ids: spec.affected_layer_ids }
      : {}),
    id: newId(),
    created_at: new Date().toISOString(),
    apply: async () => {
      const r = await spec.apply();
      // Capture result for redo's same-payload guarantee. Single
      // mutation; `_result` is otherwise treated as read-only.
      Object.assign(cmd, { _result: r });
      return r;
    },
    revert: spec.revert,
  };
  return cmd;
};
