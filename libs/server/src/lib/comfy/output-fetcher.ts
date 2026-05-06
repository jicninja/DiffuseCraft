/**
 * Output fetcher (I.1–I.5, FR-26, FR-27).
 *
 * On `executed` the JobTracker triggers `OutputFetcher.onJobCompleted`,
 * which:
 *   1. GET `/history/<prompt_id>` to discover the saved filenames.
 *   2. Fetch image bytes — filesystem when colocated, `/view` otherwise.
 *   3. Persist the bytes as a blob (server-architecture `AssetStore`).
 *   4. Generate a thumbnail (max 256 px). Thumbnail generation is
 *      delegated to a host-injected hook so we don't pull `sharp` into the
 *      server library; see `ThumbnailFn` below.
 *   5. Insert a `history_items` row.
 *   6. Return the new `history_item_id`.
 *
 * The catalog event (`job.completed { outcome, history_item_id, ... }`) is
 * published by the JobTracker, not here — keeps the responsibility split
 * clean.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { Database as DB } from 'better-sqlite3';
import type { Logger } from 'pino';

import type { AssetStore } from '../assets/store.js';
import { newId } from '../id.js';
import type { HistoryStore } from '../history/store.js';
import type { EventBus } from '../events/bus.js';
import type { ComfyClient } from './client.js';
import { ComfyError } from './errors.js';

/**
 * Host-injected thumbnail helper. Production uses `sharp`; tests inject a
 * pass-through. Given input bytes (PNG/JPEG/WEBP), produce thumbnail bytes
 * with longest side ≤ `max_dim`.
 */
export type ThumbnailFn = (bytes: Uint8Array, max_dim: number) => Promise<Uint8Array>;

export interface OutputFetcherOptions {
  /** Filesystem path of ComfyUI's output directory (FR-27). */
  comfy_output_dir?: string;
  /**
   * When set, the fetcher prefers a direct filesystem read for files
   * inside `comfy_output_dir`. Falls back to `/view` for cross-machine
   * external modes.
   */
  prefer_filesystem?: boolean;
  /** Thumbnail generator (host-injected). */
  thumbnail?: ThumbnailFn;
  /** Max thumbnail dimension (px). Default 256. */
  thumbnail_max_dim?: number;
  /**
   * Optional event bus. When supplied, an `history.item-created` event is
   * published per row inserted on completion. Subscribers (the tablet's
   * historyStore mirror) use it to refresh without polling.
   */
  bus?: EventBus;
}

export interface JobCompletedContext {
  prompt_id: string;
  job_id: string;
  document_id: string;
  prompt: string;
  parameters_json: string;
}

export class OutputFetcher {
  constructor(
    private readonly db: DB,
    private readonly comfy: ComfyClient,
    private readonly assets: AssetStore,
    private readonly logger: Logger,
    private readonly options: OutputFetcherOptions = {},
    private readonly history?: HistoryStore,
  ) {}

  /**
   * Pull every output of a finished prompt and create one `history_items`
   * row per image (FR-21 §3.7 — batch grouping). Each row carries shared
   * `job_id` + `created_at`, plus its own `batch_position`. Returns the
   * id of the first row for backward compat with `JobTracker` callers
   * that consume a singular `history_item_id`.
   *
   * If the optional `HistoryStore` is not wired, falls back to the legacy
   * single-row insert path so existing tests still work.
   */
  async onJobCompleted(ctx: JobCompletedContext): Promise<{
    history_item_id: string;
    history_item_ids: ReadonlyArray<string>;
    image_blob_ids: ReadonlyArray<string>;
  }> {
    const history = await this.comfy.getHistory(ctx.prompt_id);
    if (!history) {
      throw new ComfyError(`comfy /history/${ctx.prompt_id} returned 404 — outputs unavailable`);
    }
    const images = collectImages(history);
    if (images.length === 0) {
      this.logger.warn({ prompt_id: ctx.prompt_id }, 'no images in completed prompt');
    }

    // Step 1: persist every output blob (and optionally a thumbnail per
    // image — per-image thumbs make the strip render coherent FR-16).
    const imageBlobIds: string[] = [];
    const thumbBlobIds: Array<string | null> = [];
    for (const img of images) {
      const bytes = await this.fetchOne(img);
      const buf = Buffer.from(bytes);
      const blob = await this.assets.write({ bytes: buf, mime: 'image/png' });
      imageBlobIds.push(blob.id);
      if (this.options.thumbnail) {
        try {
          const thumb = await this.options.thumbnail(bytes, this.options.thumbnail_max_dim ?? 256);
          const thumbBlob = await this.assets.write({ bytes: Buffer.from(thumb), mime: 'image/png' });
          thumbBlobIds.push(thumbBlob.id);
        } catch (err) {
          this.logger.warn({ err, prompt_id: ctx.prompt_id }, 'thumbnail generation failed; row will lack a thumbnail');
          thumbBlobIds.push(null);
        }
      } else {
        thumbBlobIds.push(null);
      }
    }

    // Step 2: insert one history_item per image. Shared `created_at` so
    // batch siblings sort coherently in the strip.
    const created_at = new Date().toISOString();
    const batch_size = Math.max(1, imageBlobIds.length);
    const history_item_ids: string[] = [];

    if (this.history) {
      for (let i = 0; i < batch_size; i += 1) {
        const id = newId();
        const image_blob_id = imageBlobIds[i] ?? null;
        const thumbnail_blob_id = thumbBlobIds[i] ?? null;
        this.history.insert({
          id,
          document_id: ctx.document_id,
          job_id: ctx.job_id,
          prompt: ctx.prompt,
          parameters_json: ctx.parameters_json,
          image_blob_id,
          thumbnail_blob_id,
          created_at,
          batch_size,
          batch_position: i,
        });
        history_item_ids.push(id);
        if (this.options.bus) {
          this.options.bus.publish({
            name: 'history.item-created',
            payload: {
              history_item_id: id,
              document_id: ctx.document_id,
              job_id: ctx.job_id,
              batch_size,
              batch_position: i,
              created_at,
            },
          });
        }
      }
    } else {
      // Legacy fallback: single row, image #0 + first available thumb.
      const fallback_id = newId();
      const fallback_thumb = thumbBlobIds.find((t): t is string => t !== null) ?? null;
      this.db
        .prepare<[string, string, string, string, string, string | null, string | null, string]>(
          'INSERT INTO history_items (id, document_id, job_id, prompt, parameters_json, image_blob_id, thumbnail_blob_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          fallback_id,
          ctx.document_id,
          ctx.job_id,
          ctx.prompt,
          ctx.parameters_json,
          imageBlobIds[0] ?? null,
          fallback_thumb,
          created_at,
        );
      history_item_ids.push(fallback_id);
    }

    return {
      history_item_id: history_item_ids[0] ?? newId(),
      history_item_ids,
      image_blob_ids: imageBlobIds,
    };
  }

  // ---- internal -----------------------------------------------------------

  private async fetchOne(img: { filename: string; subfolder: string; type: string }): Promise<Uint8Array> {
    if (this.options.prefer_filesystem && this.options.comfy_output_dir) {
      const onDisk = path.join(this.options.comfy_output_dir, img.subfolder ?? '', img.filename);
      try {
        const buf = await fsp.readFile(onDisk);
        return new Uint8Array(buf);
      } catch (err) {
        this.logger.warn({ err, onDisk }, 'output filesystem read failed; falling back to /view');
      }
    }
    return await this.comfy.fetchOutput(img);
  }
}

/**
 * Walk a `HistoryEntry` and return every image emitted by every node. Public
 * so tests can validate the extraction without the rest of the fetcher.
 */
export function collectImages(history: {
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}): Array<{ filename: string; subfolder: string; type: string }> {
  const out: Array<{ filename: string; subfolder: string; type: string }> = [];
  for (const node of Object.values(history.outputs)) {
    if (!node.images) continue;
    for (const img of node.images) out.push(img);
  }
  return out;
}
