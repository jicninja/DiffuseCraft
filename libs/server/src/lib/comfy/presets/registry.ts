/**
 * Preset registry (generation-workflow B.2, B.3).
 *
 * In-memory store of named presets, seeded with `DEFAULT_PRESETS` and mutated
 * by `set_preset` / `delete_preset` MCP tools (owned by `comfyui-management`'s
 * model registry). Lookups by name or id are O(1); the store is hot-reload
 * friendly because there is no caching layer beyond the map itself (B.3).
 *
 * The registry is intentionally process-local: `comfyui-management` lands
 * persistence to the `presets` SQL table later. This module exposes the
 * stable lookup API the `generate_image` handler and the action-button
 * component depend on; the persistence path is a strict superset.
 */

import {
  DEFAULT_PRESETS,
  DEFAULT_PRESET_NAME,
  type NamedPreset,
} from './defaults.js';

/** Error code surfaced by `resolvePreset` when a name has no entry. */
export class PresetNotFoundError extends Error {
  public readonly code = 'PRESET_NOT_FOUND' as const;
  public readonly name_attempted: string;
  public readonly available: readonly string[];

  constructor(name: string, available: readonly string[]) {
    super(`preset not found: ${name}`);
    this.name_attempted = name;
    this.available = available;
    this.name = 'PresetNotFoundError';
  }
}

export class PresetRegistry {
  private readonly byName = new Map<string, NamedPreset>();

  constructor(seed: ReadonlyArray<NamedPreset> = DEFAULT_PRESETS) {
    for (const p of seed) this.byName.set(p.name, p);
  }

  list(): ReadonlyArray<NamedPreset> {
    return [...this.byName.values()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): NamedPreset | undefined {
    return this.byName.get(name);
  }

  /** Insert or overwrite a preset. Used by `set_preset` (comfyui-management). */
  upsert(preset: NamedPreset): void {
    this.byName.set(preset.name, preset);
  }

  /** Remove a preset; returns true if removed. Used by `delete_preset`. */
  remove(name: string): boolean {
    return this.byName.delete(name);
  }
}

/**
 * Resolve a preset by name with sensible fallbacks.
 *
 *   - When `requested` is provided AND present in the registry → that preset.
 *   - When `requested` is provided but missing → throw `PresetNotFoundError`.
 *   - When `requested` is absent → fall back to `serverDefault` if present,
 *     else `DEFAULT_PRESET_NAME` (`"photographic"`).
 *
 * The fallback chain is what FR-41 implements: the minimum invocation
 * `generate_image({ prompt })` must always succeed.
 */
export function resolvePreset(
  registry: PresetRegistry,
  requested: string | undefined,
  serverDefault?: string,
): NamedPreset {
  if (requested !== undefined) {
    const explicit = registry.get(requested);
    if (!explicit) {
      throw new PresetNotFoundError(
        requested,
        registry.list().map((p) => p.name),
      );
    }
    return explicit;
  }
  const fallbackName = serverDefault ?? DEFAULT_PRESET_NAME;
  const fallback = registry.get(fallbackName) ?? registry.get(DEFAULT_PRESET_NAME);
  if (!fallback) {
    // Catastrophic: registry is empty. Should never happen because we always
    // seed with `DEFAULT_PRESETS` at construction.
    throw new PresetNotFoundError(fallbackName, registry.list().map((p) => p.name));
  }
  return fallback;
}
