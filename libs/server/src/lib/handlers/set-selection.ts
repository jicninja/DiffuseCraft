/**
 * `set_selection` handler (selection-tools FR-1/FR-3/FR-5/FR-6/FR-10).
 *
 * Polymorphic setter that accepts six shape kinds — `rect`, `polygon`,
 * `mask`, `magic_wand`, `clear`, `modify` — with an optional `op`
 * (`replace` / `add` / `subtract` / `intersect`) governing how the new
 * shape composes with the existing selection.
 *
 * For Tier 1 the handler delegates the geometry math to canvas-core and
 * persists the result via {@link SelectionStore}. Magic-wand deferred
 * variant ("server samples the layer pixels") is a stub: we accept the
 * shape, persist a mask reference if the caller already pre-rasterized
 * the layer (via `mask` kind), and mark the magic-wand kind as needing
 * Tier 2 server-side raster sampling — a follow-up impl wires it.
 *
 * Reversibility: the handler captures the prior selection on the fly,
 * builds a parametric {@link Command}, and routes it through
 * {@link HandlerContext.undoRedo} per FR-34 / design.md §11. The
 * manager owns the apply call AND the `document.changed` emission for
 * the resulting mutation.
 */

import { setSelection as setSelectionTool } from '@diffusecraft/mcp-tools';
import {
  applyOp,
  composeMasks,
  invertMask,
  maskBounds,
  rectToMask,
  polygonToMask,
  refineMask,
  selectionToMask,
} from '@diffusecraft/canvas-core';
import type {
  RasterMask,
  SelectionOp,
  Selection as CoreSelection,
} from '@diffusecraft/canvas-core';
import type { z } from 'zod';
import type { Database as DB } from 'better-sqlite3';

import type { ToolHandler, HandlerContext } from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { buildCommand, type Command } from '../undo-redo/command.js';
import { SelectionStore, type PersistedSelection } from '../selection/store.js';
import { selectionBBox } from '../selection/bounds.js';
import { persistedToCore } from '../selection/encoding.js';

type Input = z.infer<typeof setSelectionTool.inputSchema>;
type Output = z.infer<typeof setSelectionTool.outputSchema>;

interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

const requireDocument = (db: DB, document_id: string): DocumentRow => {
  const row = db
    .prepare<string, DocumentRow>('SELECT id, w, h FROM documents WHERE id = ?')
    .get(document_id);
  if (!row) {
    throw new ServerError({
      code: 'DOCUMENT_NOT_FOUND',
      message: `document not found: ${document_id}`,
    });
  }
  return row;
};

/** Cheap quantize helper: rasterize a mask back into a polygon when its
 *  bbox is small. For the Tier 1 handler we always persist as a mask
 *  reference is overkill — for now we degrade to a `rect` envelope when
 *  the result is rectangular, otherwise we serialise the bytes via
 *  bounds_json as a base64 mini-mask. To keep the surface tight, the
 *  handler returns the persisted shape selected by {@link reduceShape}. */
const reduceShape = (mask: RasterMask): PersistedSelection => {
  const bb = maskBounds(mask);
  if (!bb) return { kind: 'none' };
  // Detect whether every pixel inside `bb` is fully selected — that's a
  // rect.
  let isRect = true;
  for (let y = bb.y; y < bb.y + bb.h && isRect; y++) {
    const row = y * mask.width;
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      if (mask.data[row + x] !== 255) {
        isRect = false;
        break;
      }
    }
  }
  if (isRect) {
    return { kind: 'rect', rect: bb };
  }
  // Fall back to a polygon approximation: use the bbox corners. This is
  // a placeholder for the AI tiers that will register the real mask
  // blob via the AssetStore. Future work: vectorize via marching squares.
  return {
    kind: 'polygon',
    points: [
      { x: bb.x, y: bb.y },
      { x: bb.x + bb.w, y: bb.y },
      { x: bb.x + bb.w, y: bb.y + bb.h },
      { x: bb.x, y: bb.y + bb.h },
    ],
  };
};

/**
 * Compose the prior selection with the incoming primitive shape using
 * the chosen op. Returns the persisted shape to write back.
 */
const composeSelections = (args: {
  width: number;
  height: number;
  prior: PersistedSelection;
  incomingCore: CoreSelection;
  incomingFallback: PersistedSelection;
  op: SelectionOp;
}): PersistedSelection => {
  const { width, height, prior, incomingCore, incomingFallback, op } = args;
  if (op === 'replace') return incomingFallback;
  // Compose via raster ops — the result is always a mask, which we
  // reduce to a rect/polygon when possible.
  const priorMask = selectionToMask(persistedToCore(prior), width, height);
  const incomingMask = selectionToMask(incomingCore, width, height);
  const composed = composeMasks(priorMask, incomingMask, op);
  return reduceShape(composed);
};

export function createSetSelectionHandler(
  db: DB,
  store: SelectionStore,
): ToolHandler<typeof setSelectionTool.inputSchema, typeof setSelectionTool.outputSchema> {
  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const document_id =
      input.document_id ?? (ctx as unknown as { document_id?: string }).document_id;
    if (!document_id) {
      throw new ServerError({
        code: 'DOCUMENT_REQUIRED',
        message: 'set_selection requires a document_id (or active document on the request).',
      });
    }
    const doc = requireDocument(db, document_id);
    const op: SelectionOp = (input.op as SelectionOp) ?? 'replace';
    const prior = store.getOrNone(document_id);

    const next = computeNextSelection({
      input,
      doc,
      prior,
      op,
    });

    // Capture the pre-state under a stable name so both apply() and
    // revert() can close over it. The manager calls apply() inside
    // execute(); revert() runs only on undo.
    const before = prior;

    const apply = async (): Promise<Output> => {
      store.set({ document_id, selection: next });
      const bbox = selectionBBox(next) ?? undefined;
      return { active: next.kind !== 'none', bbox };
    };
    const revert = async (): Promise<void> => {
      store.set({ document_id, selection: before });
    };

    // FR-34: route through the manager. Selection ops do not touch
    // layers, so `affected_layer_ids` is omitted (scope-unknown ⇒
    // never flagged as conflicting — selection edits don't conflict
    // with concurrent layer mutations by definition).
    const command: Command<Output> = buildCommand<Output>({
      tool_name: 'set_selection',
      document_id,
      args_summary: `set_selection (${next.kind}, op=${op})`,
      weight: 'small',
      apply,
      revert,
    });
    const tokenId = ctx.token_id ?? ctx.token_name;
    return ctx.undoRedo.execute(ctx.token_name, tokenId, document_id, command);
  };
}

interface ComputeArgs {
  input: Input;
  doc: DocumentRow;
  prior: PersistedSelection;
  op: SelectionOp;
}

const computeNextSelection = (args: ComputeArgs): PersistedSelection => {
  const { input, doc, prior, op } = args;
  const shape = input.shape;
  switch (shape.kind) {
    case 'clear':
      return { kind: 'none' };
    case 'rect': {
      const incoming: PersistedSelection = { kind: 'rect', rect: shape.rect };
      return composeSelections({
        width: doc.w,
        height: doc.h,
        prior,
        incomingCore: { kind: 'rect', rect: shape.rect },
        incomingFallback: incoming,
        op,
      });
    }
    case 'polygon': {
      const incoming: PersistedSelection = { kind: 'polygon', points: shape.points };
      return composeSelections({
        width: doc.w,
        height: doc.h,
        prior,
        incomingCore: { kind: 'lasso', points: shape.points },
        incomingFallback: incoming,
        op,
      });
    }
    case 'mask': {
      // FR-Q1 / Tier 2 storage path. The catalog's `mask` envelope is
      // produced by the AI tiers; without the AssetStore wired through
      // we accept it but fall back to `none` when the envelope lacks
      // an inline blob reference. The mask handlers (auto_select_subject /
      // select_by_prompt) own this path — once they land they register
      // a blob via the AssetStore and feed the id here.
      const env = shape.mask as { ref?: { uri: string }; width: number; height: number };
      if (!env.ref) {
        throw new ServerError({
          code: 'UNSUPPORTED_MASK_ENCODING',
          message: 'set_selection currently requires `kind: "mask"` envelopes to use the `ref` form. Tier 2 handlers will lift this restriction once their AssetStore wiring lands.',
        });
      }
      const blob_id = env.ref.uri.split('/').at(-1) ?? '';
      return {
        kind: 'mask',
        blob_id,
        width: env.width,
        height: env.height,
      };
    }
    case 'magic_wand': {
      // FR-6/FR-7/FR-8 server path. The Tier 1 implementation requires
      // the caller to either submit pre-rasterized magic-wand results via
      // `kind: 'mask'` (preferred) or to inline a polygon fallback. To
      // keep the catalog promise truthful we accept the shape but emit a
      // structured error explaining the missing layer-pixel-fetch wiring.
      // This will be lifted once the active layer's blob fetch is plumbed
      // through to the magic-wand pipeline.
      throw new ServerError({
        code: 'MAGIC_WAND_NOT_WIRED',
        message:
          'set_selection({ kind: "magic_wand" }) needs the active-layer blob fetch wired to the server-side magic-wand pipeline. Until then, run magicWandSelect() client-side and submit the result via `kind: "mask"`.',
      });
    }
    case 'modify': {
      // FR-9 — operate on the existing selection.
      const priorMask = selectionToMask(persistedToCore(prior), doc.w, doc.h);
      let next: RasterMask;
      switch (shape.op) {
        case 'invert':
          next = invertMask(priorMask);
          break;
        case 'grow':
          next = refineMask(priorMask, { grow_px: shape.amount ?? 0 });
          break;
        case 'shrink':
          next = refineMask(priorMask, { shrink_px: shape.amount ?? 0 });
          break;
        case 'feather':
          next = refineMask(priorMask, { feather_px: shape.amount ?? 0 });
          break;
        case 'blur':
          next = refineMask(priorMask, { blur_px: shape.amount ?? 0 });
          break;
        default: {
          const _exhaustive: never = shape.op;
          void _exhaustive;
          next = priorMask;
        }
      }
      // Op composition does not apply to `modify` — it always replaces.
      return reduceShape(next);
    }
    default: {
      const _exhaustive: never = shape;
      void _exhaustive;
      return prior;
    }
  }
};

/** Internal: surfaced for test harness reuse. */
export const __internals = {
  reduceShape,
  composeSelections,
  computeNextSelection,
  applyOp,
  rectToMask,
  polygonToMask,
};
