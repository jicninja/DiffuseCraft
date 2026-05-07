/**
 * `diffusecraft://presets/list` resource.
 *
 * Projects each registered preset (`PresetRegistry.list()`) onto the
 * catalog's {@link PresetSummary} shape. The internal `NamedPreset`
 * already carries every field the projection needs; the only mapping is
 * `cfg → cfg_scale` (catalog name) and `loras` (each entry's
 * `strength_model` becomes the published `weight`).
 *
 * Pagination uses an integer offset cursor, matching `models-list.ts`.
 */

import type { PresetRegistry } from '../comfy/presets/registry.js';

export interface PresetsListResourceQuery {
  cursor?: string;
  limit?: number;
  fields?: ReadonlyArray<string>;
}

export interface PresetsListResourcePage {
  items: ReadonlyArray<Record<string, unknown>>;
  next_cursor?: string;
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

export function readPresetsList(
  registry: PresetRegistry,
  query: PresetsListResourceQuery = {},
): PresetsListResourcePage {
  const all = registry.list();
  const projected = all.map((preset) => {
    const summary: Record<string, unknown> = {
      id: preset.id,
      name: preset.name,
      // The catalog `model` is a `<registry>:<id>` ModelId; in v1 the
      // registry stores plain ComfyUI filenames, so surface them under
      // the `file:` registry — same convention as `models-list.ts`.
      model: `file:${preset.model}`,
      loras: preset.loras.map((l) => ({
        model: `file:${l.name}`,
        weight: l.strength_model,
      })),
      sampler: preset.sampler,
      steps: preset.steps,
      cfg_scale: preset.cfg,
    };
    return projectFields(summary, query.fields);
  });

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
