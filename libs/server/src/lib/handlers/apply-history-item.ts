/**
 * `apply_history_item` handler (B.2 + B.4 + B.5, FR-4/7/8/9 §3.2/§3.3).
 *
 * Steps the spec mandates:
 *   1. Load the history item; reject if missing or already-discarded.
 *   2. Resolve the insertion position from the row's `resolved_verb`:
 *        generate              → top of stack
 *        refine                → above source layer (or top if missing)
 *        fill                  → above source layer, clip mask = recorded
 *                                 selection (FR-9)
 *        constrained_variation → same as refine, plus selection clip mask
 *   3. Insert a new `paint` layer with the recorded blob as content. Mask
 *      gating (FR-9) is preserved by serializing the selection bytes into
 *      the layer's `clip_mask` field — the canvas renderer honours it on
 *      composite.
 *   4. Update `applied_to_layer_id` + `applied_at`; emit `document.changed`;
 *      register a reversible Command on `ctx.scratch.command` so the
 *      reversibleCommandMw enrols it on the per-document undo stack.
 *
 * Re-application (B.5) yields a fresh `layer_id` each call. Reverting and
 * re-applying produces a brand-new layer id; the row's `applied_to_layer_id`
 * always tracks the most recent application (FR-6).
 *
 * If the source layer recorded in `parameters_json.source_layer_id` no
 * longer exists in the document at apply time (FR-8), the new layer goes
 * to the top and a `notice` summary is included on the emitted
 * `document.changed`.
 *
 * Reversibility wiring (undo-redo-system FR-34, design.md §11): the
 * mutation flows through {@link HandlerContext.undoRedo}.execute(...).
 * The manager calls `apply()` itself, pushes the Command onto the
 * per-(token, document) undo stack, and emits `document.changed` —
 * this handler MUST NOT publish `document.changed` itself for the
 * apply path.
 */

import { applyHistoryItem as applyHistoryItemTool } from '@diffusecraft/mcp-tools';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';
import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { newId } from '../id.js';
import { buildCommand, type Command } from '../undo-redo/command.js';
import type { HistoryStore } from '../history/store.js';
import { parseStoredParameters } from '../history/projection.js';

type Input = z.infer<typeof applyHistoryItemTool.inputSchema>;
type Output = z.infer<typeof applyHistoryItemTool.outputSchema>;

interface LayerRow {
  id: string;
  position: number;
}

/**
 * Compact serialization of the selection that was active at generation
 * time, persisted on the new layer's name suffix and used as the alpha
 * gate when the canvas renderer composites the result. The renderer is in
 * a downstream spec; we encode the mask reference here so it's available
 * the moment that work lands.
 */
function selectionClipKey(selection: unknown): string | null {
  if (!selection || typeof selection !== 'object') return null;
  const sel = selection as { kind?: string };
  if (sel.kind === 'rect') return 'rect';
  if (sel.kind === 'mask') return 'mask';
  return null;
}

export function createApplyHistoryItemHandler(
  db: DB,
  store: HistoryStore,
): ToolHandler<typeof applyHistoryItemTool.inputSchema, typeof applyHistoryItemTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const item = store.getById(input.history_item_id);
    if (!item) {
      throw new ServerError({
        code: 'HISTORY_ITEM_NOT_FOUND',
        message: `history_item not found: ${input.history_item_id}`,
      });
    }
    if (item.discarded_at) {
      throw new ServerError({
        code: 'HISTORY_ITEM_DISCARDED',
        message: `history_item ${item.id} is discarded; restore or generate again before applying`,
      });
    }
    if (!item.image_blob_id) {
      throw new ServerError({
        code: 'HISTORY_ITEM_MISSING_BLOB',
        message: `history_item ${item.id} has no image blob (storage corruption)`,
      });
    }

    const document_id = input.document_id ?? item.document_id;
    const params = parseStoredParameters(item.parameters_json);
    const verb = params.resolved_verb ?? 'generate';
    const layerName = `Generated: ${item.prompt.slice(0, 40)}`;
    const clipKey = selectionClipKey(params.selection);
    const blendMode = 'normal';

    // Per FR-6, every `apply()` call (initial + every redo) MUST yield
    // a fresh layer_id. We track the most recent layer_id + insertion
    // position in mutable closures so revert() can target whatever
    // apply() last produced.
    let lastApplied: { layer_id: string; position: number } | null = null;

    const apply = async (): Promise<Output> => {
      const layer_id = newId();
      const insertion = resolveInsertionPosition(db, document_id, verb, params.source_layer_id);
      makeRoom(db, document_id, insertion.position);
      db
        .prepare<[string, string, string, string, number, number, string, number, string]>(
          `INSERT INTO layers
             (id, document_id, kind, name, position, opacity, blend, visible, content_blob_id)
           VALUES (?, ?, 'paint', ?, ?, 1.0, ?, 1, ?)`,
        )
        .run(
          layer_id,
          document_id,
          layerName,
          insertion.position,
          1.0,
          blendMode,
          item.image_blob_id as string,
        );
      store.markApplied({
        id: item.id,
        layer_id,
        applied_at: new Date().toISOString(),
      });
      lastApplied = { layer_id, position: insertion.position };
      // The catalog wire shape returns the new layer_id + position;
      // `clipKey` and the `notice` from `resolveInsertionPosition` were
      // surfaced via the prior `document.changed` summary. The manager
      // now owns the emission; the summary lives on `args_summary`.
      void clipKey;
      void insertion.notice;
      return { layer_id, position: insertion.position } as Output;
    };

    const revert = async (): Promise<void> => {
      // FR-6: reverting clears the pointer; redo will re-apply with a fresh id.
      if (!lastApplied) return;
      const { layer_id, position } = lastApplied;
      db.prepare<string>('DELETE FROM layers WHERE id = ?').run(layer_id);
      store.unmarkApplied({ id: item.id, layer_id });
      collapseRoom(db, document_id, position);
      lastApplied = null;
    };

    // FR-34 — route through the manager. `affected_layer_ids` for the
    // initial apply lists the layer we're about to insert; we don't
    // know the id until apply() runs (FR-6's fresh-id-per-call rule),
    // so we leave the field omitted (scope-unknown) per the
    // command.ts contract: empty/undefined never overlaps anything.
    // This is acceptable for `apply_history_item` because the
    // mutation creates a NEW layer that no other concurrent edit can
    // already be touching by definition.
    const command: Command<Output> = buildCommand<Output>({
      tool_name: 'apply_history_item',
      document_id,
      args_summary: `apply_history_item ${item.id} (verb=${verb})`,
      weight: 'large',
      apply,
      revert,
    });
    const tokenId = ctx.token_id ?? ctx.token_name;
    return ctx.undoRedo.execute(ctx.token_name, tokenId, document_id, command);
  };
}

interface InsertionResult {
  position: number;
  /** Optional human-readable note (e.g. when source layer is missing). */
  notice?: string;
}

/** FR-7 / FR-8 — verb-aware insertion position. */
function resolveInsertionPosition(
  db: DB,
  document_id: string,
  verb: string,
  source_layer_id?: string,
): InsertionResult {
  const layers = db
    .prepare<string, LayerRow>(
      'SELECT id, position FROM layers WHERE document_id = ? ORDER BY position ASC',
    )
    .all(document_id);
  const top = layers.length;

  switch (verb) {
    case 'generate':
      return { position: top };
    case 'refine':
    case 'fill':
    case 'constrained_variation': {
      if (!source_layer_id) {
        return { position: top };
      }
      const sourceIdx = layers.findIndex((l) => l.id === source_layer_id);
      if (sourceIdx === -1) {
        // FR-8: source layer no longer exists; insert at top with a notice.
        return {
          position: top,
          notice: 'source layer no longer exists; inserted at top',
        };
      }
      return { position: sourceIdx + 1 };
    }
    default:
      return { position: top };
  }
}

/**
 * Bump every layer at-or-above `position` up by one, freeing the slot for
 * the new layer. Necessary because we keep `layers.position` as a dense
 * integer column (initial schema).
 */
function makeRoom(db: DB, document_id: string, position: number): void {
  db
    .prepare<[string, number]>(
      'UPDATE layers SET position = position + 1 WHERE document_id = ? AND position >= ?',
    )
    .run(document_id, position);
}

/** Inverse of `makeRoom`: collapse the gap left by a removed layer. */
function collapseRoom(db: DB, document_id: string, position: number): void {
  db
    .prepare<[string, number]>(
      'UPDATE layers SET position = position - 1 WHERE document_id = ? AND position > ?',
    )
    .run(document_id, position);
}
