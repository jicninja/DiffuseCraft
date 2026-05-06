/**
 * Pure layer operations (B.1, B.2, B.4).
 *
 * Each function takes a document + inputs and returns a new document
 * (and the affected layer where relevant). No in-place mutation, no
 * I/O, no rendering.
 */

import type { DocumentId, LayerId } from '../shared/ids';
import { ulid as makeUlid } from '../shared/ulid';
import type { BlendMode } from '../layers/blend-modes';
import type { ControlType, Layer, LayerKind, LayerPatch, RegionData, ClipMaskRef } from '../layers/types';
import type { Document } from './document';

/** Sort comparator: primary by `position`, secondary by `created_at` (FR-7). */
export const byPosition = (a: Layer, b: Layer): number => {
  if (a.position !== b.position) return a.position - b.position;
  // Tiebreaker per FR-7: stable sort by `created_at` ascending.
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
};

const touch = (doc: Document, now: string): Document => ({ ...doc, modified_at: now });

const nowIso = (now?: () => string): string => (now ? now() : new Date().toISOString());

/**
 * Default name strategy (Q7): `Layer N` for empty paint layers, `Mask N`,
 * `Control N`, `Region N` for the others. Imports / generations override.
 */
export const defaultLayerName = (kind: LayerKind, doc: Document): string => {
  const samesKind = doc.layers.filter((l) => l.kind === kind).length;
  const labels: Record<LayerKind, string> = {
    paint: 'Layer',
    mask: 'Mask',
    control: 'Control',
    region: 'Region',
  };
  return `${labels[kind]} ${samesKind + 1}`;
};

/** Inputs accepted by `addLayer`. */
export interface AddLayerInput {
  kind: LayerKind;
  name?: string;
  position?: number;
  opacity?: number;
  visible?: boolean;
  blend_mode?: BlendMode;
  clip_mask?: ClipMaskRef;
  group_id?: string;
  content_blob_id?: string;
  control_type?: ControlType;
  region_data?: RegionData;
  /** Optional explicit id (otherwise a ULID is minted). */
  id?: LayerId;
  /** `now` injection for deterministic tests. */
  now?: () => string;
}

/** Mint a new layer + insert it into the stack, shifting layers above upward. */
export const addLayer = (
  doc: Document,
  input: AddLayerInput,
): { doc: Document; layer: Layer } => {
  const created_at = nowIso(input.now);
  const layer: Layer = {
    id: (input.id ?? (makeUlid() as LayerId)) as LayerId,
    document_id: doc.id as DocumentId,
    kind: input.kind,
    name: input.name ?? defaultLayerName(input.kind, doc),
    position: input.position ?? doc.layers.length,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    locked: false,
    blend_mode: input.blend_mode ?? 'normal',
    clip_mask: input.clip_mask,
    group_id: input.group_id,
    content_blob_id: input.content_blob_id,
    control_type: input.control_type,
    region_data: input.region_data,
    created_at,
  };
  // Shift layers at-or-above the insertion index upward.
  const shifted = doc.layers.map((l) =>
    l.position >= layer.position ? { ...l, position: l.position + 1 } : l,
  );
  const next = [...shifted, layer].sort(byPosition);
  return {
    doc: touch({ ...doc, layers: next }, created_at),
    layer,
  };
};

/** Remove a layer; remaining layers' positions are compacted. */
export const removeLayer = (doc: Document, layer_id: LayerId): { doc: Document } => {
  if (!doc.layers.some((l) => l.id === layer_id)) {
    return { doc };
  }
  const filtered = doc.layers.filter((l) => l.id !== layer_id);
  // Compact positions to remove gaps while preserving order.
  const sorted = [...filtered].sort(byPosition);
  const compacted = sorted.map((l, idx) => (l.position === idx ? l : { ...l, position: idx }));
  // Also drop any group-child reference.
  const groups = doc.groups.map((g) =>
    g.child_layer_ids.includes(layer_id)
      ? { ...g, child_layer_ids: g.child_layer_ids.filter((id) => id !== layer_id) }
      : g,
  );
  return {
    doc: touch(
      {
        ...doc,
        layers: compacted,
        groups,
        active_layer_id: doc.active_layer_id === layer_id ? null : doc.active_layer_id,
      },
      nowIso(),
    ),
  };
};

/**
 * Apply a patch to a single layer. `position` updates trigger a reorder;
 * other fields update in place.
 */
export const updateLayer = (
  doc: Document,
  layer_id: LayerId,
  patch: LayerPatch,
): { doc: Document } => {
  const target = doc.layers.find((l) => l.id === layer_id);
  if (!target) return { doc };
  // Position changes need a re-shift; defer to `reorderLayer`.
  if (typeof patch.position === 'number' && patch.position !== target.position) {
    const { position, ...rest } = patch;
    const reordered = reorderLayer(doc, layer_id, position).doc;
    if (Object.keys(rest).length === 0) return { doc: reordered };
    const targetAfter = reordered.layers.find((l) => l.id === layer_id);
    if (!targetAfter) return { doc: reordered };
    const merged = { ...targetAfter, ...rest } as Layer;
    return {
      doc: touch(
        {
          ...reordered,
          layers: reordered.layers.map((l) => (l.id === layer_id ? merged : l)).sort(byPosition),
        },
        nowIso(),
      ),
    };
  }
  const updated: Layer = { ...target, ...patch } as Layer;
  return {
    doc: touch(
      { ...doc, layers: doc.layers.map((l) => (l.id === layer_id ? updated : l)).sort(byPosition) },
      nowIso(),
    ),
  };
};

/**
 * Insert `layer_id` at index `to_position`, shifting other layers to make
 * room (B.4). Idempotent when the layer is already at that position.
 */
export const reorderLayer = (
  doc: Document,
  layer_id: LayerId,
  to_position: number,
): { doc: Document } => {
  const target = doc.layers.find((l) => l.id === layer_id);
  if (!target) return { doc };
  const clamped = Math.max(0, Math.min(to_position, doc.layers.length - 1));
  if (clamped === target.position) return { doc };
  // Strategy: remove from list, then re-insert at clamped index with shifting.
  const without = doc.layers.filter((l) => l.id !== layer_id).sort(byPosition);
  const compacted = without.map((l, idx) => ({ ...l, position: idx }));
  // Make room at `clamped`.
  const shifted = compacted.map((l) =>
    l.position >= clamped ? { ...l, position: l.position + 1 } : l,
  );
  const next = [...shifted, { ...target, position: clamped }].sort(byPosition);
  return { doc: touch({ ...doc, layers: next }, nowIso()) };
};

/** Shallow-copy a layer with a fresh id and ` copy` suffix. */
export const duplicateLayer = (
  doc: Document,
  layer_id: LayerId,
  opts: { now?: () => string } = {},
): { doc: Document; layer: Layer } => {
  const target = doc.layers.find((l) => l.id === layer_id);
  if (!target) {
    throw new Error(`duplicateLayer: layer ${layer_id} not found.`);
  }
  return addLayer(doc, {
    kind: target.kind,
    name: `${target.name} copy`,
    position: target.position + 1,
    opacity: target.opacity,
    visible: target.visible,
    blend_mode: target.blend_mode,
    clip_mask: target.clip_mask,
    group_id: target.group_id,
    content_blob_id: target.content_blob_id,
    control_type: target.control_type,
    region_data: target.region_data,
    now: opts.now,
  });
};

/**
 * Pluggable pixel-blender used by `mergeDown` / `flattenVisible`.
 *
 * Server uses Sharp; tablet uses Skia (in-app preview before committing
 * the merge through the server). Pure-function shape preserved by passing
 * the blender as input.
 */
export interface BlobBlender {
  /**
   * Composite the supplied layers (top-of-stack first) and return a single
   * blob id referring to the resulting raster on the server.
   */
  blend(layers: ReadonlyArray<Layer>, dims: { w: number; h: number }): Promise<string>;
}

/**
 * Merge a layer with the one immediately below it into a single paint layer.
 * Mutations stay reversible because the operation is registered as a Command
 * by the caller (per FR-15 / undo-redo-system spec).
 */
export const mergeDown = async (
  doc: Document,
  layer_id: LayerId,
  blender: BlobBlender,
  opts: { now?: () => string } = {},
): Promise<{ doc: Document; merged_layer: Layer }> => {
  const sorted = [...doc.layers].sort(byPosition);
  const idx = sorted.findIndex((l) => l.id === layer_id);
  if (idx <= 0) {
    throw new Error('mergeDown: layer is not above another layer.');
  }
  const top = sorted[idx]!;
  const bottom = sorted[idx - 1]!;
  if (top.kind !== 'paint' || bottom.kind !== 'paint') {
    throw new Error('mergeDown: only paint layers can be merged.');
  }
  const blob_id = await blender.blend([top, bottom], { w: doc.width, h: doc.height });
  const created_at = nowIso(opts.now);
  const merged_layer: Layer = {
    id: (makeUlid() as LayerId) as LayerId,
    document_id: doc.id,
    kind: 'paint',
    name: bottom.name,
    position: bottom.position,
    opacity: 1,
    visible: bottom.visible,
    locked: false,
    blend_mode: 'normal',
    content_blob_id: blob_id,
    created_at,
  };
  // Remove top + bottom, insert merged at bottom's old position.
  const without = doc.layers.filter((l) => l.id !== top.id && l.id !== bottom.id);
  const next = [...without, merged_layer].sort(byPosition).map((l, i) => ({ ...l, position: i }));
  return { doc: touch({ ...doc, layers: next }, created_at), merged_layer };
};

/**
 * Flatten every visible paint layer into a single paint layer at the bottom
 * of the stack. Hidden layers are preserved untouched.
 */
export const flattenVisible = async (
  doc: Document,
  blender: BlobBlender,
  opts: { now?: () => string } = {},
): Promise<{ doc: Document; flattened_layer: Layer }> => {
  const sorted = [...doc.layers].sort(byPosition);
  // Top-of-stack first for the blender.
  const visiblePaint = sorted.filter((l) => l.visible && l.kind === 'paint').reverse();
  if (visiblePaint.length === 0) {
    throw new Error('flattenVisible: no visible paint layers to flatten.');
  }
  const blob_id = await blender.blend(visiblePaint, { w: doc.width, h: doc.height });
  const created_at = nowIso(opts.now);
  const flattened_layer: Layer = {
    id: (makeUlid() as LayerId) as LayerId,
    document_id: doc.id,
    kind: 'paint',
    name: 'Flattened',
    position: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blend_mode: 'normal',
    content_blob_id: blob_id,
    created_at,
  };
  const remaining = sorted.filter((l) => !(l.visible && l.kind === 'paint'));
  // Shift remaining up by 1 and prepend the flattened layer.
  const shifted = remaining.map((l, i) => ({ ...l, position: i + 1 }));
  return {
    doc: touch({ ...doc, layers: [flattened_layer, ...shifted] }, created_at),
    flattened_layer,
  };
};

/** Set / clear the active layer (FR-14 "Set as current target"). */
export const setActiveLayer = (
  doc: Document,
  layer_id: LayerId | null,
): { doc: Document } => {
  if (layer_id !== null && !doc.layers.some((l) => l.id === layer_id)) {
    return { doc };
  }
  return { doc: touch({ ...doc, active_layer_id: layer_id }, nowIso()) };
};
