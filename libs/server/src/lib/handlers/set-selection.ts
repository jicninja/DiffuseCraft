/**
 * `set_selection` handler (selection-tools FR-1/FR-3/FR-5/FR-6/FR-10).
 *
 * Polymorphic setter that accepts six shape kinds — `rect`, `polygon`,
 * `mask`, `magic_wand`, `clear`, `modify` — with an optional `op`
 * (`replace` / `add` / `subtract` / `intersect`) governing how the new
 * shape composes with the existing selection.
 *
 * For Tier 1 the handler delegates the geometry math to canvas-core and
 * persists the result via {@link SelectionStore}. Magic-wand server-side
 * (B.6) reads the active layer's RGBA blob via {@link MaskAssetStore},
 * runs canvas-core's `magicWandSelect` against it, optionally composes
 * with the prior selection per `op`, and persists the resulting mask as
 * a fresh blob — preserving precision instead of going through the
 * lossy rect/polygon `reduceShape` fallback used by Tier 1 primitives.
 * Composite-raster sampling and `layer_id`-omitted callers still fall
 * back to a structured error until a composite cache is plumbed.
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
  magicWandSelect,
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
import { encodeMaskBlob, type MaskAssetStore } from './mask/shared.js';

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

export interface SetSelectionHandlerDeps {
  readonly db: DB;
  readonly store: SelectionStore;
  /**
   * Asset store for layer-blob reads + mask-blob writes used by B.6
   * magic-wand server-side. When omitted the magic-wand path keeps
   * returning `MAGIC_WAND_NOT_WIRED` so callers can fall back to the
   * client-side `magicWandSelect` + `kind: "mask"` submit pattern.
   */
  readonly assets?: MaskAssetStore;
}

export function createSetSelectionHandler(
  deps: SetSelectionHandlerDeps,
): ToolHandler<typeof setSelectionTool.inputSchema, typeof setSelectionTool.outputSchema> {
  const { db, store, assets } = deps;
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

    // FR-6/FR-7/FR-8: B.6 magic-wand server-side. Resolve against the
    // layer's RGBA blob and compose with `prior` per `op`, persisting the
    // result as a fresh mask blob so precision is preserved (the lossy
    // `reduceShape` fallback would corner-approximate the wand mask).
    if (input.shape.kind === 'magic_wand') {
      const next = await resolveMagicWand({
        shape: input.shape,
        doc,
        prior,
        op,
        assets,
        db,
      });
      return runUndoable(ctx, store, document_id, prior, next, op);
    }

    const next = computeNextSelection({
      input,
      doc,
      prior,
      op,
    });

    return runUndoable(ctx, store, document_id, prior, next, op);
  };
}

/**
 * Build the parametric Command and route it through {@link HandlerContext.undoRedo}
 * (FR-34 / design.md §11). Shared between the synchronous primitive path
 * and the async magic-wand path so both honour the same undo contract.
 *
 * Selection ops do not touch layers, so `affected_layer_ids` is omitted
 * (scope-unknown ⇒ never flagged as conflicting — selection edits don't
 * conflict with concurrent layer mutations by definition).
 */
const runUndoable = async (
  ctx: HandlerContext,
  store: SelectionStore,
  document_id: string,
  before: PersistedSelection,
  next: PersistedSelection,
  op: SelectionOp,
): Promise<Output> => {
  const apply = async (): Promise<Output> => {
    store.set({ document_id, selection: next });
    const bbox = selectionBBox(next) ?? undefined;
    return { active: next.kind !== 'none', bbox };
  };
  const revert = async (): Promise<void> => {
    store.set({ document_id, selection: before });
  };
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
      // Unreachable in production: `createSetSelectionHandler` intercepts
      // `magic_wand` shapes before this synchronous reducer is called, so
      // the layer-blob fetch + composition can run async (see
      // `resolveMagicWand`). The branch survives so the discriminated
      // union remains exhaustive and so direct callers of `__internals`
      // (test harness) get a clear, actionable error.
      throw new ServerError({
        code: 'MAGIC_WAND_NOT_WIRED',
        message:
          'computeNextSelection cannot reduce magic_wand shapes synchronously — call the full handler so resolveMagicWand can fetch the layer blob.',
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

/**
 * Resolve a `magic_wand` shape against a real layer's RGBA bytes (B.6).
 *
 * The shape is evaluated server-side via {@link magicWandSelect} from
 * canvas-core, then composed with `prior` per `op` at the mask level so
 * the result keeps full pixel precision. The composed mask is written
 * to {@link MaskAssetStore} and persisted as a `kind: 'mask'` selection
 * pointing at the new blob — `reduceShape`'s 4-corner polygon fallback
 * is intentionally bypassed because it would lose all interior detail.
 *
 * Hard pre-conditions surface as structured errors rather than silent
 * fallbacks:
 *   - `MAGIC_WAND_NOT_WIRED` — handler started without a `MaskAssetStore`
 *     (the legacy stub mode for hosts that haven't bootstrapped assets).
 *   - `MAGIC_WAND_COMPOSITE_NOT_WIRED` — `sample_composite: true` requires
 *     the composite raster cache, which lands with the renderer pipeline.
 *   - `MAGIC_WAND_LAYER_REQUIRED` — `layer_id` was omitted; without the
 *     composite path the server has no implicit "active layer".
 *   - `NOT_FOUND` / `INVALID_INPUT` — layer missing, on a different
 *     document, or has no rasterized content yet.
 *   - `UNSUPPORTED_LAYER_RASTER` — the layer's blob is not raw-RGBA at
 *     the document's dimensions (PNG decode lives in host-specific
 *     codecs; this server-only path keeps the byte contract narrow).
 */
interface ResolveMagicWandArgs {
  shape: Extract<Input['shape'], { kind: 'magic_wand' }>;
  doc: DocumentRow;
  prior: PersistedSelection;
  op: SelectionOp;
  assets: MaskAssetStore | undefined;
  db: DB;
}

interface LayerRasterRow {
  id: string;
  document_id: string;
  content_blob_id: string | null;
}

const resolveMagicWand = async (
  args: ResolveMagicWandArgs,
): Promise<PersistedSelection> => {
  const { shape, doc, prior, op, assets, db } = args;
  if (!assets) {
    throw new ServerError({
      code: 'MAGIC_WAND_NOT_WIRED',
      message:
        'set_selection({ kind: "magic_wand" }) requires a server-side MaskAssetStore. Run magicWandSelect() client-side and submit the result via `kind: "mask"` until the host wires `assets` into createSetSelectionHandler.',
    });
  }
  if (shape.sample_composite) {
    throw new ServerError({
      code: 'MAGIC_WAND_COMPOSITE_NOT_WIRED',
      message:
        'set_selection({ kind: "magic_wand", sample_composite: true }) needs the composite raster cache, which lands with the renderer pipeline. Sample a specific layer (`layer_id`) for now.',
    });
  }
  if (!shape.layer_id) {
    throw new ServerError({
      code: 'MAGIC_WAND_LAYER_REQUIRED',
      message:
        'set_selection({ kind: "magic_wand" }) requires `layer_id` until composite sampling lands. Pass the active layer id explicitly.',
    });
  }
  const layer = db
    .prepare<string, LayerRasterRow>(
      'SELECT id, document_id, content_blob_id FROM layers WHERE id = ?',
    )
    .get(shape.layer_id);
  if (!layer) {
    throw new ServerError({
      code: 'NOT_FOUND',
      message: `magic_wand: layer not found: ${shape.layer_id}`,
    });
  }
  if (layer.document_id !== doc.id) {
    throw new ServerError({
      code: 'INVALID_INPUT',
      message: `magic_wand: layer ${shape.layer_id} belongs to document ${layer.document_id}, not ${doc.id}`,
    });
  }
  if (!layer.content_blob_id) {
    throw new ServerError({
      code: 'INVALID_INPUT',
      message: `magic_wand: layer ${shape.layer_id} has no rasterized content yet`,
    });
  }
  const blob = await assets.read(layer.content_blob_id);
  if (!blob) {
    throw new ServerError({
      code: 'NOT_FOUND',
      message: `magic_wand: layer blob ${layer.content_blob_id} not found in asset store`,
    });
  }
  const expectedRgba = doc.w * doc.h * 4;
  if (blob.bytes.byteLength !== expectedRgba) {
    throw new ServerError({
      code: 'UNSUPPORTED_LAYER_RASTER',
      message: `magic_wand: layer blob is ${blob.bytes.byteLength} bytes, expected raw RGBA ${expectedRgba} (${doc.w}×${doc.h}×4). PNG decode is host-specific and not wired into this handler.`,
    });
  }
  // Buffer is a Node subclass of Uint8Array; copy out a clean view at
  // exactly the expected length so canvas-core's bounds check passes.
  const rgba = new Uint8Array(expectedRgba);
  rgba.set(blob.bytes.subarray(0, expectedRgba));

  const wandMask = magicWandSelect({
    imageBytes: rgba,
    width: doc.w,
    height: doc.h,
    tapPoint: shape.tap_point,
    tolerance: shape.tolerance,
    contiguous: shape.contiguous,
  });

  const composed: RasterMask =
    op === 'replace'
      ? wandMask
      : composeMasks(
          selectionToMask(persistedToCore(prior), doc.w, doc.h),
          wandMask,
          op,
        );

  // Empty result short-circuits to `none` instead of writing a
  // zero-byte-meaningful blob — keeps the asset store clean and matches
  // `reduceShape`'s contract for empty masks.
  if (!maskBounds(composed)) return { kind: 'none' };

  const encoded = encodeMaskBlob(composed.data);
  const written = await assets.write({ bytes: encoded.bytes, mime: encoded.mime });
  return {
    kind: 'mask',
    blob_id: written.id,
    width: doc.w,
    height: doc.h,
  };
};

/** Internal: surfaced for test harness reuse. */
export const __internals = {
  reduceShape,
  composeSelections,
  computeNextSelection,
  resolveMagicWand,
  applyOp,
  rectToMask,
  polygonToMask,
};
