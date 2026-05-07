/**
 * `diffusecraft://models/list` resource.
 *
 * Reads the cached model rows from `ModelRegistry` (mirrors ComfyUI's
 * discovered checkpoints, LoRAs, ControlNets, IP-Adapters, VAEs, and
 * upscalers — see `lib/comfy/models/registry.ts`) and projects them onto
 * the catalog's {@link ModelSummary} shape so the tablet's
 * `models` store can hydrate from a single resource read instead of
 * round-tripping the upstream ComfyUI catalog.
 *
 * Internal model "kinds" the registry tracks (`embedding`, `clip_vision`)
 * are not part of the catalog's `ModelKind` enum; those rows are skipped
 * silently so the projection always validates against `ModelSummary`.
 */

import type { ModelEntry, ModelRegistry, ModelType } from '../comfy/models/registry.js';

export interface ModelsListResourceQuery {
  /** Filter to a single kind (e.g. `'checkpoint'`). */
  kind?: string;
  cursor?: string;
  limit?: number;
  fields?: ReadonlyArray<string>;
}

export interface ModelsListResourcePage {
  items: ReadonlyArray<Record<string, unknown>>;
  next_cursor?: string;
}

const CATALOG_KINDS = new Set<ModelType>([
  'checkpoint',
  'lora',
  'controlnet',
  'ip_adapter',
  'vae',
  'upscale',
]);

/**
 * Map the registry's internal type to the catalog's `ModelKind` value.
 * The registry's `'upscale'` becomes the catalog's `'upscaler'`; every
 * other supported value passes through unchanged.
 */
function toCatalogKind(type: ModelType): string | null {
  if (!CATALOG_KINDS.has(type)) return null;
  if (type === 'upscale') return 'upscaler';
  return type;
}

/**
 * Project a registry row onto a `ModelSummary`-shaped record. Returns
 * `null` when the row's kind is not represented in the catalog enum so
 * the caller can drop it from the page.
 */
function projectModelEntry(entry: ModelEntry): Record<string, unknown> | null {
  const kind = toCatalogKind(entry.type);
  if (!kind) return null;
  // Discovered rows do not have a `<registry>:<id>` form yet; surface
  // them under the `file:` registry, which mirrors how local-only
  // checkpoints flow through the model pipeline today.
  const id = `file:${entry.name}`;
  const installed = Boolean(entry.file_path);
  const bytes = Math.max(0, entry.size);
  return { id, kind, name: entry.name, bytes, installed };
}

function projectFields(
  obj: Record<string, unknown>,
  fields?: ReadonlyArray<string>,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return obj;
  const projected: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) projected[f] = obj[f];
  }
  return projected;
}

export function readModelsList(
  registry: ModelRegistry,
  query: ModelsListResourceQuery = {},
): ModelsListResourcePage {
  const all = registry.list(
    query.kind && (CATALOG_KINDS.has(query.kind as ModelType) || query.kind === 'upscaler')
      ? (query.kind === 'upscaler' ? 'upscale' : (query.kind as ModelType))
      : undefined,
  );

  const projected: Record<string, unknown>[] = [];
  for (const row of all) {
    const p = projectModelEntry(row);
    if (p) projected.push(projectFields(p, query.fields));
  }

  // Cursor is a 1-based offset encoded as a decimal string. Catalogue
  // says `supports_since: true` but model lists don't have a stable
  // `updated_at` — `since` is silently ignored at this layer; pagination
  // is the only knob that affects the page boundary.
  const limit = clampLimit(query.limit);
  const start = parseCursor(query.cursor);
  const slice = projected.slice(start, start + limit);
  const nextOffset = start + slice.length;
  const hasMore = nextOffset < projected.length;
  return hasMore ? { items: slice, next_cursor: String(nextOffset) } : { items: slice };
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return 100;
  return Math.min(limit, 500);
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
