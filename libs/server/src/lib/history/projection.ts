/**
 * Projection helpers — map a `history_items` row onto the catalog's
 * `HistoryItemSummary` / `HistoryItemFull` shapes.
 *
 * The DB row carries everything we know about an item; the catalog wire
 * shapes are subsets that drop server-internal columns (e.g. blob ids) in
 * favour of resolvable refs (`thumbnail_ref`, `image_ref`).
 *
 * Resolved verb / seed / strength are pulled from `parameters_json` with
 * conservative defaults so a malformed payload never blocks a read.
 *
 * `batch_summary` (FR-21 / Q4) lives on the row but is currently absent
 * from `HistoryItemSummary` — see TODO below. Until the schema gains the
 * field, the columns are still populated so the data is ready when it does.
 */

import type { HistoryItemRow } from './store.js';

export type ResolvedVerbName = 'generate' | 'refine' | 'fill' | 'constrained_variation';

interface BlobRefInput {
  bytes: number;
  mime: string;
}

export interface ProjectionDeps {
  image_blob: BlobRefInput | null;
  thumbnail_blob: BlobRefInput | null;
}

/**
 * Stored metadata pulled from `parameters_json`. Intentionally permissive —
 * each field defaults if absent so a partial generate payload still yields
 * a valid summary (NFR-1: thumbnail-fast path can't break on a missing
 * `seed`).
 */
export interface StoredParameters {
  prompt?: string;
  resolved_verb?: ResolvedVerbName;
  seed?: number | string;
  negative_prompt?: string;
  strength?: number;
  preset?: string;
  model?: string;
  control_layer_ids?: string[];
  region_ids?: string[];
  selection?: unknown;
  /** The layer present at submit time (FR-7 / FR-8). */
  source_layer_id?: string;
}

export function parseStoredParameters(json: string): StoredParameters {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed as StoredParameters;
  } catch {
    return {};
  }
}

const DEFAULT_RESOLVED_VERB: ResolvedVerbName = 'generate';

/** Map a row → `HistoryItemSummary`-shaped object (open-typed for projection). */
export function projectHistoryItemSummary(row: HistoryItemRow, deps: ProjectionDeps): Record<string, unknown> {
  const params = parseStoredParameters(row.parameters_json);
  return {
    id: row.id,
    prompt: row.prompt,
    resolved_verb: normalizeResolvedVerb(params.resolved_verb),
    seed: normalizeSeed(params.seed),
    created_at: row.created_at,
    applied_to_layer_id: row.applied_to_layer_id ?? undefined,
    thumbnail_ref: refFromBlob(row.thumbnail_blob_id, deps.thumbnail_blob),
  };
}

/** Map a row → `HistoryItemFull`-shaped object. */
export function projectHistoryItemFull(row: HistoryItemRow, deps: ProjectionDeps): Record<string, unknown> {
  const params = parseStoredParameters(row.parameters_json);
  return {
    ...projectHistoryItemSummary(row, deps),
    negative_prompt: params.negative_prompt,
    strength: clampStrength(params.strength),
    preset: params.preset,
    model: params.model,
    control_layer_ids: params.control_layer_ids ?? [],
    region_ids: params.region_ids ?? [],
    selection_used: serializeSelection(params.selection),
    image_ref: refFromBlob(row.image_blob_id, deps.image_blob),
  };
}

/** Internal — surface batch grouping (Q4) for the historyStore mirror. */
export interface BatchSummary {
  batch_job_id: string;
  batch_size: number;
  batch_position: number;
}

export function batchSummary(row: HistoryItemRow): BatchSummary | undefined {
  if (row.batch_size <= 1 || row.job_id === null) return undefined;
  return {
    batch_job_id: row.job_id,
    batch_size: row.batch_size,
    batch_position: row.batch_position,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizeResolvedVerb(value: unknown): ResolvedVerbName {
  if (
    value === 'generate' ||
    value === 'refine' ||
    value === 'fill' ||
    value === 'constrained_variation'
  ) {
    return value;
  }
  return DEFAULT_RESOLVED_VERB;
}

function normalizeSeed(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return 0;
}

function clampStrength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function serializeSelection(value: unknown): unknown {
  // Selection is a discriminated union ({rect}, {mask}, {none}). The catalog
  // schema accepts the same shape; pass it through as-is.
  if (value && typeof value === 'object') return value;
  return undefined;
}

function refFromBlob(
  blob_id: string | null,
  meta: BlobRefInput | null,
): Record<string, unknown> | undefined {
  if (!blob_id || !meta) return undefined;
  // The catalog's ImageEnvelope union requires `format`, `width`, `height`
  // for both inline and ref shapes. We don't know the dimensions here without
  // decoding the PNG — the consumer should call `get_image` to fetch real
  // bytes when displaying. Until a future spec persists dimensions in the
  // `blobs` row we surface a minimal envelope using `mime` + the canonical
  // 1×1 placeholder so the shape parses; clients use `ref.uri` for actual
  // bytes regardless.
  // TODO(generation-history): persist (width, height) on blobs and surface
  // here so first-pass thumbnails can render without a round-trip.
  const format = meta.mime === 'image/jpeg' ? 'jpeg' : meta.mime === 'image/webp' ? 'webp' : 'png';
  return {
    format,
    width: 1,
    height: 1,
    ref: {
      uri: `diffusecraft://blob/${blob_id}`,
    },
  };
}
