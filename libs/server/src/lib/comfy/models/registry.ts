/**
 * Model registry (G.1, G.2, FR-10, FR-11).
 *
 * Mirrors ComfyUI's discovered models into our SQLite cache so the server
 * can answer `list_models` / preset resolution / `delete_model` without
 * round-tripping ComfyUI on every request.
 *
 * Discovery walks `/object_info` and reads the enum lists embedded in each
 * loader node's input slots:
 *   - `CheckpointLoaderSimple.ckpt_name`
 *   - `LoraLoader.lora_name`
 *   - `ControlNetLoader.control_net_name`
 *   - `VAELoader.vae_name`
 *   - `UpscaleModelLoader.model_name`
 *   - `IPAdapterUnifiedLoader.preset` / IPAdapter loaders
 *
 * The registry is intentionally lightweight. Heavy metadata (file size,
 * sha256) is filled in lazily by the downloader; an entry without a
 * concrete `file_path` represents a model the server **knows about** but
 * has not yet hashed (e.g. it predates our cache).
 */

import type { Database as DB } from 'better-sqlite3';

import type { ComfyClient } from '../client.js';
import { newId } from '../../id.js';
import type { NodeCatalog, NodeClassInfo, NodeInputSpec } from '../types.js';

export type ModelType = 'checkpoint' | 'lora' | 'controlnet' | 'ip_adapter' | 'vae' | 'upscale' | 'embedding' | 'clip_vision';

export interface ModelEntry {
  id: string;
  name: string;
  type: ModelType;
  file_path: string;
  size: number;
  integrity_hash: string | null;
}

export interface ModelRegistryOptions {
  /** When provided, replaces `Date.now` for deterministic tests. */
  now?: () => number;
}

export class ModelRegistry {
  constructor(private readonly db: DB, private readonly options: ModelRegistryOptions = {}) {}

  /** Replace the cache with a fresh snapshot from ComfyUI. */
  async refresh(comfy: ComfyClient): Promise<void> {
    const info = await comfy.getObjectInfo();
    const buckets = extractAllNames(info);
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM models');
      const stmt = this.db.prepare<[string, string, ModelType, string, number, string | null]>(
        'INSERT INTO models (id, name, type, file_path, size, integrity_hash) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const [type, names] of buckets) {
        for (const name of names) {
          stmt.run(newId(), name, type, name, 0, null);
        }
      }
    });
    tx();
    void this.options.now;
  }

  /** Look up an entry by `name`. */
  findByName(name: string): ModelEntry | null {
    return (
      (this.db
        .prepare<string, ModelEntry>('SELECT id, name, type, file_path, size, integrity_hash FROM models WHERE name = ?')
        .get(name) as ModelEntry | undefined) ?? null
    );
  }

  /** Enumerate all entries of a given type. */
  list(type?: ModelType): ReadonlyArray<ModelEntry> {
    if (type) {
      return this.db
        .prepare<string, ModelEntry>(
          'SELECT id, name, type, file_path, size, integrity_hash FROM models WHERE type = ?',
        )
        .all(type);
    }
    return this.db
      .prepare<[], ModelEntry>('SELECT id, name, type, file_path, size, integrity_hash FROM models')
      .all();
  }

  /** Delete an entry by id (G.7 — file removal is the downloader's job). */
  deleteById(id: string): boolean {
    const result = this.db.prepare<string>('DELETE FROM models WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Update size / integrity hash after a successful download. */
  updateMeta(id: string, meta: { size: number; integrity_hash?: string | null; file_path?: string }): void {
    if (meta.file_path !== undefined) {
      this.db
        .prepare<[number, string | null, string, string]>(
          'UPDATE models SET size = ?, integrity_hash = ?, file_path = ? WHERE id = ?',
        )
        .run(meta.size, meta.integrity_hash ?? null, meta.file_path, id);
      return;
    }
    this.db
      .prepare<[number, string | null, string]>('UPDATE models SET size = ?, integrity_hash = ? WHERE id = ?')
      .run(meta.size, meta.integrity_hash ?? null, id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOADER_MAP: ReadonlyArray<readonly [string, string, ModelType]> = [
  ['CheckpointLoaderSimple', 'ckpt_name', 'checkpoint'],
  ['CheckpointLoader', 'ckpt_name', 'checkpoint'],
  ['LoraLoader', 'lora_name', 'lora'],
  ['ControlNetLoader', 'control_net_name', 'controlnet'],
  ['VAELoader', 'vae_name', 'vae'],
  ['UpscaleModelLoader', 'model_name', 'upscale'],
  ['CLIPVisionLoader', 'clip_name', 'clip_vision'],
];

/**
 * Walk a `NodeCatalog` and produce per-bucket name lists. Public so tests
 * can drive the parser with hand-crafted catalogs without standing up an
 * actual ComfyUI instance.
 */
export function extractAllNames(info: NodeCatalog): ReadonlyArray<readonly [ModelType, ReadonlyArray<string>]> {
  const out: Array<readonly [ModelType, ReadonlyArray<string>]> = [];
  for (const [className, slot, type] of LOADER_MAP) {
    const names = readEnumOptions(info[className], slot);
    if (names.length > 0) out.push([type, names]);
  }
  return out;
}

function readEnumOptions(node: NodeClassInfo | undefined, slot: string): ReadonlyArray<string> {
  if (!node) return [];
  const inputs = node.input?.required ?? node.input?.optional ?? {};
  const spec = inputs[slot] as NodeInputSpec | undefined;
  if (!spec) return [];
  const [enumOrName] = spec;
  if (Array.isArray(enumOrName)) return enumOrName as ReadonlyArray<string>;
  return [];
}
