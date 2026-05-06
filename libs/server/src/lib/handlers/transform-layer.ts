/**
 * `transform_layer` handler (transform-tools Phase C — C.3 + C.4).
 *
 * Translates, scales, rotates, flips, skews, or distorts a single layer or
 * a group composite. The decomposed transform is persisted on the
 * `layers.transform_json` column added by migration 004; missing values
 * collapse to the identity transform.
 *
 * Reversibility (P27, FR-22, FR-25): every call captures the pre-state of
 * every affected layer in one Command. Revert restores all of them; reapply
 * re-merges the same partial input on top of the (now restored) pre-state,
 * yielding a fresh result that matches the original call's effect.
 *
 * Group transforms (FR-25, C.4): when `group_id` is set, the same partial
 * input applies to every layer member. Each member's per-layer pre-state
 * is captured so revert is one undo step. The handler does not introduce a
 * `groups` table here — that scope is `canvas-fundamentals`. Group lookup
 * uses the `layers.group_id` column already provisioned in migration 001
 * via the document model. (When the column is not present at the SQL
 * level, callers can still supply explicit `layer_id`s and skip group
 * composition.)
 */

import { transformLayer as transformLayerTool } from '@diffusecraft/mcp-tools';
import {
  IDENTITY_TRANSFORM,
  mergeTransform,
  type TransformDecomposed,
  type TransformPartialInput,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { buildCommand, type Command } from '../undo-redo/command.js';

type Input = z.infer<typeof transformLayerTool.inputSchema>;
type Output = z.infer<typeof transformLayerTool.outputSchema>;

interface LayerTransformRow {
  id: string;
  document_id: string;
  transform_json: string | null;
}

/**
 * Decode a layer's stored `transform_json` column to a fully-typed
 * `TransformDecomposed`. Missing or malformed values fall back to the
 * identity transform — the handler never trusts a half-decoded shape.
 */
export const decodeStoredTransform = (raw: string | null): TransformDecomposed => {
  if (!raw) return { ...IDENTITY_TRANSFORM };
  try {
    const parsed = JSON.parse(raw) as Partial<TransformDecomposed>;
    return {
      tx: typeof parsed.tx === 'number' ? parsed.tx : 0,
      ty: typeof parsed.ty === 'number' ? parsed.ty : 0,
      sx: typeof parsed.sx === 'number' ? parsed.sx : 1,
      sy: typeof parsed.sy === 'number' ? parsed.sy : 1,
      rotation_deg: typeof parsed.rotation_deg === 'number' ? parsed.rotation_deg : 0,
      skew_x_deg: typeof parsed.skew_x_deg === 'number' ? parsed.skew_x_deg : 0,
      skew_y_deg: typeof parsed.skew_y_deg === 'number' ? parsed.skew_y_deg : 0,
      flip_h: typeof parsed.flip_h === 'boolean' ? parsed.flip_h : false,
      flip_v: typeof parsed.flip_v === 'boolean' ? parsed.flip_v : false,
      anchor: parsed.anchor && typeof parsed.anchor.x === 'number' && typeof parsed.anchor.y === 'number'
        ? parsed.anchor
        : { x: 0.5, y: 0.5 },
      ...(parsed.distort_corners ? { distort_corners: parsed.distort_corners } : {}),
    };
  } catch {
    return { ...IDENTITY_TRANSFORM };
  }
};

/** Encode a transform value to the stored JSON column. */
export const encodeStoredTransform = (t: TransformDecomposed): string =>
  JSON.stringify(t);

const summarize = (t: TransformPartialInput): string => {
  const keys = Object.keys(t);
  return keys.length === 0 ? 'no-op' : `fields=${keys.join(',')}`;
};

export function createTransformLayerHandler(
  db: DB,
): ToolHandler<typeof transformLayerTool.inputSchema, typeof transformLayerTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'transform_layer requires a document_id (or active document on the request).',
      });
    }
    if (!input.layer_id && !input.group_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: 'transform_layer requires either `layer_id` or `group_id`.',
      });
    }

    // Resolve target layers and pre-state.
    const targets = resolveTargets(db, document_id, input);
    if (targets.length === 0) {
      throw new ServerError({
        code: 'TARGET_NOT_FOUND',
        message: input.layer_id
          ? `layer not found: ${input.layer_id}`
          : `group has no layer members: ${input.group_id}`,
      });
    }

    const previous = new Map<string, TransformDecomposed>();
    const next = new Map<string, TransformDecomposed>();
    for (const t of targets) {
      const pre = decodeStoredTransform(t.transform_json);
      previous.set(t.id, pre);
      next.set(t.id, mergeTransform(pre, input.transform as TransformPartialInput));
    }

    const affected_layer_ids = [...next.keys()];

    const apply = async (): Promise<Output> => {
      const stmt = db.prepare<[string, string]>(
        'UPDATE layers SET transform_json = ? WHERE id = ?',
      );
      for (const [layer_id, t] of next) {
        stmt.run(encodeStoredTransform(t), layer_id);
      }
      if (input.layer_id && next.size === 1) {
        const single = next.get(input.layer_id);
        return {
          layer_id: input.layer_id,
          transform: single ?? IDENTITY_TRANSFORM,
          affected_layer_ids,
        } as Output;
      }
      if (input.group_id) {
        return {
          group_id: input.group_id,
          affected_layer_ids,
        } as Output;
      }
      // Fallthrough — single-layer call but resolveTargets returned more than
      // one (defensive — shouldn't happen).
      return { affected_layer_ids } as Output;
    };
    const revert = async (): Promise<void> => {
      const stmt = db.prepare<[string | null, string]>(
        'UPDATE layers SET transform_json = ? WHERE id = ?',
      );
      for (const [layer_id, t] of previous) {
        const pristine = isIdentity(t) ? null : encodeStoredTransform(t);
        stmt.run(pristine, layer_id);
      }
    };

    // FR-34 — route through the manager. Group + single-layer transforms
    // both populate `affected_layer_ids` so the conflict detector
    // (design.md §7) can flag overlapping concurrent transforms from
    // another token.
    const command: Command<Output> = buildCommand<Output>({
      tool_name: 'transform_layer',
      document_id,
      args_summary: input.group_id
        ? `transform_layer group=${input.group_id} (${summarize(input.transform as TransformPartialInput)})`
        : `transform_layer layer=${input.layer_id} (${summarize(input.transform as TransformPartialInput)})`,
      weight: affected_layer_ids.length > 1 ? 'large' : 'medium',
      affected_layer_ids,
      apply,
      revert,
    });
    const tokenId = ctx.token_id ?? ctx.token_name;
    return ctx.undoRedo.execute(ctx.token_name, tokenId, document_id, command);
  };
}

/**
 * Resolve the target layers for a transform call. Single-layer mode returns
 * exactly one row; group mode returns every member of the group.
 */
function resolveTargets(
  db: DB,
  document_id: string,
  input: Input,
): readonly LayerTransformRow[] {
  if (input.layer_id) {
    const row = db
      .prepare<[string, string], LayerTransformRow>(
        'SELECT id, document_id, transform_json FROM layers WHERE id = ? AND document_id = ?',
      )
      .get(input.layer_id, document_id);
    return row ? [row] : [];
  }
  if (input.group_id) {
    return db
      .prepare<[string, string], LayerTransformRow>(
        'SELECT id, document_id, transform_json FROM layers WHERE document_id = ? AND group_id = ? ORDER BY position ASC',
      )
      .all(document_id, input.group_id);
  }
  return [];
}

/** True when the transform equals the identity (lets revert clear the col). */
const isIdentity = (t: TransformDecomposed): boolean =>
  t.tx === 0
  && t.ty === 0
  && t.sx === 1
  && t.sy === 1
  && t.rotation_deg === 0
  && t.skew_x_deg === 0
  && t.skew_y_deg === 0
  && !t.flip_h
  && !t.flip_v
  && t.anchor.x === 0.5
  && t.anchor.y === 0.5
  && !t.distort_corners;
