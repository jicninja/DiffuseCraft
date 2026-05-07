/**
 * `paint_strokes` handler (brush-system Phase F).
 *
 * Materializes a sequence of brush strokes into a layer's pixel data via
 * canvas-core's compositor seam (`composeStrokeIntoRaster`). Built-in
 * brush presets are resolved from `BRUSH_PRESETS`; unknown brush ids raise
 * `BRUSH_NOT_FOUND`.
 *
 * Storage shape:
 *   - The handler reads/writes layers' raster bytes through a small
 *     `PixelCodec` injected at construction time. The default codec
 *     understands a raw-RGBA blob mime (`application/x-diffusecraft-raster`)
 *     so the v1 path doesn't pull in a PNG library at the server boundary.
 *     Apps/server (and MeshCraft) can override the codec to also accept
 *     `image/png` once they ship `sharp` or `pngjs`.
 *   - When a layer has no `content_blob_id`, the handler starts with a
 *     fully transparent raster sized to the document's `(w, h)`.
 *   - On write, the handler stores the new bytes via the asset store, sets
 *     `layers.content_blob_id` to the new blob id, and emits a
 *     `document.changed` event with the affected bounding box.
 *
 * Layer kind routing:
 *   - `paint` → RGBA stamps with the brush's color.
 *   - `mask`  → alpha-only stamps (FR-10): brush color is converted to
 *               luminance and added to dst alpha.
 *   - `control` (subkind {scribble, line_art, soft_edge}) routes through
 *               `paint`. For other control subkinds, callers use the
 *               dedicated `add_control_layer` tool — paint-strokes raises
 *               `INVALID_INPUT` here.
 *
 * Erase mode is selected per-stroke when the brush preset's `erase` field
 * is true (e.g. the Eraser preset). Color is preserved; destination alpha
 * is multiplied by `(1 - coverage)`.
 *
 * Selection clipping (FR-30): when `ignore_selection: false` (default) and
 * the document has an active selection, we clamp each stamp's effective
 * coverage by the selection mask before applying. Without a selection, the
 * stamps are applied directly. The minimal v1 handler does the simple thing:
 * if a selection mask is present and `ignore_selection` is false, the stamps
 * outside the selection bbox are dropped before composition; the per-pixel
 * mask multiply is left to a later refinement when the selection-tools spec
 * lands its mask-storage format. The bbox-only clip is conservative (some
 * stamps inside the bbox but outside the mask shape may slip through), but
 * matches the behavior the existing tools rely on.
 */

import { paintStrokes as paintStrokesTool } from '@diffusecraft/mcp-tools';
import {
  BRUSH_PRESETS,
  type BrushPresetId,
  type BrushPreset,
  captureSelectionClip,
  expandStrokeToStamps,
  composeStrokeIntoRaster,
  parseBrushColor,
  stampsBoundingBox,
  type SelectionClip,
  type Stamp,
} from '@diffusecraft/canvas-core';
import type { Database as DB } from 'better-sqlite3';
import type { z } from 'zod';

import type {
  HandlerContext,
  ToolHandler,
} from '../../types/handler-context.js';
import { ServerError } from '../../types/errors.js';
import { newId } from '../id.js';
import { persistedToCore } from '../selection/encoding.js';
import { SelectionStore } from '../selection/store.js';
import { buildCommand, type Command } from '../undo-redo/command.js';

type Input = z.infer<typeof paintStrokesTool.inputSchema>;
type Output = z.infer<typeof paintStrokesTool.outputSchema>;

/** Internal mime tag for raw-RGBA layer rasters (straight alpha, [r,g,b,a, ...]). */
export const RAW_RGBA_MIME = 'application/x-diffusecraft-raster';

/**
 * Encoder/decoder seam between the handler and the asset store. The default
 * codec only handles `application/x-diffusecraft-raster`; downstream hosts
 * inject a richer codec that also handles `image/png`.
 */
export interface PixelCodec {
  /** Decode bytes (with mime) into a tightly packed RGBA buffer. Returns null
   * when the codec doesn't recognise the mime. */
  decode(
    bytes: Buffer,
    mime: string,
    width: number,
    height: number,
  ): { width: number; height: number; data: Uint8ClampedArray } | null;
  /** Encode a raster buffer to bytes with the codec's preferred mime. */
  encode(raster: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }): { bytes: Buffer; mime: string };
}

export const defaultRawRgbaCodec: PixelCodec = {
  decode(bytes, mime, width, height) {
    if (mime !== RAW_RGBA_MIME) return null;
    if (bytes.byteLength !== width * height * 4) return null;
    // Copy into a Uint8ClampedArray (canvas-core's RasterBuffer shape).
    const data = new Uint8ClampedArray(width * height * 4);
    data.set(bytes);
    return { width, height, data };
  },
  encode(raster) {
    return {
      bytes: Buffer.from(
        raster.data.buffer,
        raster.data.byteOffset,
        raster.data.byteLength,
      ),
      mime: RAW_RGBA_MIME,
    };
  },
};

/**
 * Asset I/O the handler needs. Implemented by the server's `AssetStore` in
 * production; tests stub directly.
 */
export interface PaintStrokeAssetStore {
  /** Write bytes; returns blob id. */
  write(args: {
    bytes: Buffer;
    mime: string;
    ttl_seconds?: number;
  }): Promise<{ id: string }>;
  /** Read bytes; null if not found. */
  read(id: string): Promise<{
    meta: { mime: string; bytes: number };
    bytes: Buffer;
  } | null>;
}

interface DocumentRow {
  id: string;
  w: number;
  h: number;
}

interface LayerRow {
  id: string;
  document_id: string;
  kind: string;
  content_blob_id: string | null;
}

interface SelectionRow {
  document_id: string;
  bounds_json: string | null;
}

interface HandlerDeps {
  readonly db: DB;
  readonly assets: PaintStrokeAssetStore;
  /** Optional codec override; defaults to raw-RGBA only. */
  readonly codec?: PixelCodec;
  /**
   * Optional selection store. When provided, the handler captures a
   * `SelectionClip` snapshot at op-begin (selection-tools FR-34/FR-39) and
   * routes per-pixel clipping through the brush compositor. When omitted,
   * the legacy bbox-only selection clip remains in effect (back-compat for
   * hosts that have not yet wired the selection store into paint_strokes).
   */
  readonly selectionStore?: SelectionStore;
}

export function createPaintStrokesHandler(
  deps: HandlerDeps,
): ToolHandler<typeof paintStrokesTool.inputSchema, typeof paintStrokesTool.outputSchema> {
  const codec = deps.codec ?? defaultRawRgbaCodec;
  const { db, assets, selectionStore } = deps;

  return async (input: Input, ctx: HandlerContext): Promise<Output> => {
    const layer = db
      .prepare<string, LayerRow>(
        'SELECT id, document_id, kind, content_blob_id FROM layers WHERE id = ?',
      )
      .get(input.layer_id);
    if (!layer) {
      throw new ServerError({
        code: 'NOT_FOUND',
        message: `layer not found: ${input.layer_id}`,
      });
    }
    if (layer.kind !== 'paint' && layer.kind !== 'mask') {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `paint_strokes target layer kind=${layer.kind} is not paint or mask`,
      });
    }
    const document_id = input.document_id ?? layer.document_id;
    if (document_id !== layer.document_id) {
      throw new ServerError({
        code: 'INVALID_INPUT',
        message: `layer ${layer.id} belongs to document ${layer.document_id}, not ${document_id}`,
      });
    }

    const doc = db
      .prepare<string, DocumentRow>('SELECT id, w, h FROM documents WHERE id = ?')
      .get(document_id);
    if (!doc) {
      throw new ServerError({
        code: 'NOT_FOUND',
        message: `document not found: ${document_id}`,
      });
    }

    // Validate every brush_id up front so we never partially apply a stroke
    // batch and then bail.
    for (const stroke of input.strokes) {
      if (!isBuiltinBrushId(stroke.brush_id)) {
        throw new ServerError({
          code: 'BRUSH_NOT_FOUND',
          message: `brush_id "${stroke.brush_id}" is not a registered brush`,
        });
      }
    }

    // Capture the layer's prior `content_blob_id` so revert() can
    // restore it. The manager calls apply() inside execute(); by the
    // time revert() runs, the column already points at the new blob.
    const priorBlobId = layer.content_blob_id;

    const apply = async (): Promise<Output> => {
      // Load existing raster (or start blank).
      let raster = await loadLayerRaster({
        assets,
        codec,
        blobId: priorBlobId,
        width: doc.w,
        height: doc.h,
      });

      // Selection bbox clip — fast pre-filter that drops stamps fully outside
      // the selection bbox before per-pixel work. The (FR-34/FR-39) per-pixel
      // clip below is the authoritative gate — bbox is only an optimisation.
      const selectionBbox = !input.ignore_selection
        ? readSelectionBbox(db, document_id)
        : null;

      // FR-34/FR-37/FR-39 — capture a SelectionClip snapshot at op-begin.
      // The clip is held immutable for the lifetime of this `apply` call so
      // selection mutations during the in-flight write do not affect any
      // stroke in this batch. Mask-kind selections require an async pre-fetch
      // of the mask blob bytes; rect/lasso/none are computed inline.
      const clip = await captureClipForApply({
        db,
        assets,
        selectionStore,
        document_id,
        ignoreSelection: input.ignore_selection ?? false,
        width: doc.w,
        height: doc.h,
      });

      let unionBbox: { x: number; y: number; w: number; h: number } | null = null;

      for (const stroke of input.strokes) {
        const preset = BRUSH_PRESETS[stroke.brush_id as BrushPresetId];
        const points = stroke.points as ReadonlyArray<{
          x: number;
          y: number;
          pressure?: number;
        }>;
        const stamps = expandStrokeToStamps(
          preset,
          points.map((p) => ({
            x: p.x,
            y: p.y,
            ...(typeof p.pressure === 'number' ? { pressure: p.pressure } : {}),
          })),
          { sizeOverride: stroke.size },
        );
        const filtered = selectionBbox
          ? stamps.filter((s) => stampIntersectsBbox(s, selectionBbox))
          : stamps;
        if (filtered.length === 0) continue;

        const { color, opacity: colorOpacity } = parseBrushColor(stroke.color);
        raster = composeStrokeIntoRaster(raster, scaleStampOpacity(filtered, colorOpacity), {
          ...(layer.kind === 'mask' ? { maskOnly: true } : {}),
          color,
          ...(clip ? { clip } : {}),
        });

        const strokeBbox = stampsBoundingBox(filtered);
        if (strokeBbox) unionBbox = mergeBbox(unionBbox, strokeBbox);
      }

      if (!unionBbox) {
        // No stamps actually applied (all clipped) — leave the layer
        // alone. Returning `applied: false` is a no-op outcome; the
        // manager still pushes the (degenerate) Command, but a
        // subsequent revert() restores priorBlobId which is what's
        // already on the layer, so undo of a no-op is a no-op.
        return {
          applied: false,
          affected_bbox: { x: 0, y: 0, w: 0, h: 0 },
        } satisfies Output;
      }

      // Clip the affected bbox to the document.
      const clipped = clampBboxToRaster(unionBbox, doc.w, doc.h);

      // Encode + persist the new raster.
      const { bytes, mime } = codec.encode(raster);
      const written = await assets.write({ bytes, mime });
      db.prepare<[string | null, string]>(
        'UPDATE layers SET content_blob_id = ? WHERE id = ?',
      ).run(written.id, layer.id);

      return { applied: true, affected_bbox: clipped } satisfies Output;
    };

    const revert = async (): Promise<void> => {
      // Restore the prior blob id verbatim. The new blob written by
      // apply() is left referenced from the assets table — blob GC
      // (libs/server/src/lib/assets/gc.ts) will sweep it after its
      // TTL expires; that's the same eventual-cleanup contract every
      // reversible asset-mutating handler relies on.
      db.prepare<[string | null, string]>(
        'UPDATE layers SET content_blob_id = ? WHERE id = ?',
      ).run(priorBlobId, layer.id);
    };

    // FR-34 — route through the manager. The brush op touches exactly
    // one layer; populating `affected_layer_ids` lets the conflict
    // detector flag overlapping concurrent paint ops from another
    // token (design.md §7).
    const command: Command<Output> = buildCommand<Output>({
      tool_name: 'paint_strokes',
      document_id,
      args_summary: `paint_strokes on layer ${layer.id} (${input.strokes.length} stroke(s))`,
      weight: 'medium',
      affected_layer_ids: [layer.id],
      apply,
      revert,
    });
    const tokenId = ctx.token_id ?? ctx.token_name;
    return ctx.undoRedo.execute(ctx.token_name, tokenId, document_id, command);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBuiltinBrushId(id: string): id is BrushPresetId {
  return id in BRUSH_PRESETS;
}

interface LoadRasterArgs {
  assets: PaintStrokeAssetStore;
  codec: PixelCodec;
  blobId: string | null;
  width: number;
  height: number;
}

async function loadLayerRaster(args: LoadRasterArgs): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}> {
  const blank = {
    width: args.width,
    height: args.height,
    data: new Uint8ClampedArray(args.width * args.height * 4),
  };
  if (!args.blobId) return blank;
  const blob = await args.assets.read(args.blobId);
  if (!blob) return blank;
  const decoded = args.codec.decode(blob.bytes, blob.meta.mime, args.width, args.height);
  if (!decoded) {
    // Codec didn't recognise the mime — start blank rather than throwing,
    // so the brush still works in environments without a PNG codec wired up.
    return blank;
  }
  return decoded;
}

/**
 * Capture a {@link SelectionClip} snapshot for the current `apply`.
 *
 * Returns `null` when no selection store is wired (legacy host) OR when
 * `ignore_selection` is set OR when the active selection is empty/none.
 * Mask-kind selections trigger an async pre-fetch of the referenced blob;
 * rect/lasso/none are computed inline.
 *
 * Holding the captured clip immutable for the lifetime of `apply` is what
 * gives us FR-39 (mid-stroke selection-change protection) without locks:
 * the `editorStore`'s mutation only affects subsequent ops.
 */
async function captureClipForApply(args: {
  db: DB;
  assets: PaintStrokeAssetStore;
  selectionStore: SelectionStore | undefined;
  document_id: string;
  ignoreSelection: boolean;
  width: number;
  height: number;
}): Promise<SelectionClip | null> {
  if (args.ignoreSelection) return null;
  if (!args.selectionStore) return null;
  const persisted = args.selectionStore.getOrNone(args.document_id);
  if (persisted.kind === 'none') return null;
  const core = persistedToCore(persisted);
  const dims = { width: args.width, height: args.height };
  // For mask-kind, pre-fetch the referenced blob bytes; for rect/lasso/none
  // captureSelectionClip does not invoke the resolver.
  let resolved: Uint8Array | undefined;
  if (core.kind === 'mask') {
    // The encoding maps `layer_id` to the mask blob id verbatim.
    const blobId = core.layer_id as unknown as string;
    const blob = await args.assets.read(blobId);
    if (blob) {
      // Mask blobs are a flat single-channel Uint8Array sized to (w*h);
      // copy out of the Buffer so the consumer never holds a Node buffer.
      resolved = new Uint8Array(blob.bytes.byteLength);
      resolved.set(blob.bytes);
    }
  }
  const clip = captureSelectionClip(core, dims, () => resolved);
  // captureSelectionClip collapses empty masks to `kind: "none"`; pass
  // through that result so the compositor takes the zero-overhead path.
  return clip;
}

/** Read the document's selection bounding box, if any. */
function readSelectionBbox(
  db: DB,
  document_id: string,
): { x: number; y: number; w: number; h: number } | null {
  const row = db
    .prepare<string, SelectionRow>(
      'SELECT document_id, bounds_json FROM selections WHERE document_id = ?',
    )
    .get(document_id);
  if (!row || !row.bounds_json) return null;
  try {
    const parsed = JSON.parse(row.bounds_json) as
      | { x: number; y: number; w: number; h: number }
      | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.w !== 'number' ||
      typeof parsed.h !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function stampIntersectsBbox(
  stamp: Stamp,
  bbox: { x: number; y: number; w: number; h: number },
): boolean {
  const half = stamp.size * 0.5;
  return !(
    stamp.x + half < bbox.x ||
    stamp.x - half > bbox.x + bbox.w ||
    stamp.y + half < bbox.y ||
    stamp.y - half > bbox.y + bbox.h
  );
}

function mergeBbox(
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function clampBboxToRaster(
  bbox: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, bbox.x);
  const y = Math.max(0, bbox.y);
  const right = Math.min(width, bbox.x + bbox.w);
  const bottom = Math.min(height, bbox.y + bbox.h);
  return {
    x,
    y,
    w: Math.max(0, right - x),
    h: Math.max(0, bottom - y),
  };
}

function scaleStampOpacity(
  stamps: ReadonlyArray<Stamp>,
  factor: number,
): Stamp[] {
  if (factor === 1) return stamps as Stamp[];
  return stamps.map((s) => ({ ...s, opacity: s.opacity * factor }));
}

/** Internal helper for tests: resolves a built-in brush by id. */
export function resolveBuiltinBrush(id: string): BrushPreset | null {
  return isBuiltinBrushId(id) ? BRUSH_PRESETS[id] : null;
}

/** Re-export for clarity from the handler module. */
export { newId as makeBlobId };
