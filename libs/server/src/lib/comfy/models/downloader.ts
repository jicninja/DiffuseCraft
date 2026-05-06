/**
 * Streaming model downloader (G.4, G.5, G.6, FR-12, FR-13, FR-14).
 *
 * Behaviour:
 *   - Streams the body to disk, emitting `model.download.progress` every
 *     ~256 KB (rate-limited so we don't spam the bus on fast NVMe).
 *   - Resumable across server restarts: probes the partial file size on
 *     disk and issues an HTTP `Range` request when present (FR-13).
 *   - Verifies SHA-256 against an expected hash when one is provided
 *     (FR-12 step 4 / G.5). Default models without a pinned hash skip the
 *     check; user-requested downloads include `sha256` opportunistically.
 *
 * Test seam: the `fetch` impl + filesystem operations can be replaced for
 * unit tests so the integration suite (G.8) is the only thing that hits
 * the network.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { Logger } from 'pino';

import type { EventBus } from '../../events/bus.js';
import { ComfyError, ComfyIntegrityError } from '../errors.js';
import { parseModelId } from './parsers/index.js';

export interface DownloadRequest {
  /** Logical model id (`hf:`, `civitai:`, or `file:`). */
  model_id: string;
  /** Absolute target file path on disk. */
  target_path: string;
  /** Optional SHA-256 hex digest to verify after the stream completes. */
  sha256?: string | null;
  /**
   * Optional override for the resolved URL. Used when the model registry
   * already knows the redirected CDN URL (e.g. Civitai redirects).
   */
  url_override?: string;
  /** Cancellation. */
  signal?: AbortSignal;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelDownloaderOptions {
  /** Test seam. */
  fetch?: typeof fetch;
  /** Min ms between two `model.download.progress` events for the same id. */
  progress_throttle_ms?: number;
}

const DEFAULT_PROGRESS_THROTTLE_MS = 250;

export class ModelDownloader {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly options: ModelDownloaderOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const resolved = parseModelId(req.model_id);
    if (resolved.registry === 'file') {
      // Local files are tracked, not transferred.
      const stat = await fsp.stat(resolved.absolute_path);
      const sha256 = await sha256OfFile(resolved.absolute_path);
      if (req.sha256 && sha256 !== req.sha256) {
        throw new ComfyIntegrityError(req.sha256, sha256);
      }
      return { path: resolved.absolute_path, bytes: stat.size, sha256 };
    }

    const url = req.url_override ?? resolved.url;
    await fsp.mkdir(path.dirname(req.target_path), { recursive: true });

    // Resume support: if a partial file exists, request a Range continuation.
    let existing = 0;
    try {
      existing = (await fsp.stat(req.target_path)).size;
    } catch {
      existing = 0;
    }

    const headers: Record<string, string> = {};
    if (existing > 0) headers['Range'] = `bytes=${existing}-`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, ...(req.signal ? { signal: req.signal } : {}) });
    } catch (err) {
      this.bus.publish({
        name: 'model.download.failed',
        payload: { model_id: req.model_id, error: { message: (err as Error).message } },
      });
      throw new ComfyError(`download failed for ${req.model_id}: ${(err as Error).message}`, { cause: err });
    }

    if (!res.ok && res.status !== 206 /* Partial Content */) {
      this.bus.publish({
        name: 'model.download.failed',
        payload: { model_id: req.model_id, error: { status: res.status } },
      });
      throw new ComfyError(`download for ${req.model_id} returned ${res.status}`);
    }

    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? Number(totalHeader) + existing : 0;

    // Stream the response body to disk (append in resume mode).
    const fd = await fsp.open(req.target_path, existing > 0 ? 'a' : 'w');
    const hasher = crypto.createHash('sha256');

    // When resuming we must rehash the prefix on disk to get a final digest.
    if (existing > 0) {
      const prefix = await fsp.readFile(req.target_path);
      hasher.update(prefix);
    }

    let bytesWritten = existing;
    let lastEmit = 0;
    const throttle = this.options.progress_throttle_ms ?? DEFAULT_PROGRESS_THROTTLE_MS;
    try {
      const body = res.body;
      if (!body) throw new ComfyError(`download for ${req.model_id} returned empty body`);
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        await fd.write(chunk);
        hasher.update(chunk);
        bytesWritten += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= throttle) {
          lastEmit = now;
          this.bus.publish({
            name: 'model.download.progress',
            payload: {
              model_id: req.model_id,
              bytes_done: bytesWritten,
              bytes_total: total > 0 ? total : null,
              percent: total > 0 ? Math.floor((bytesWritten / total) * 100) : null,
            },
          });
        }
      }
    } finally {
      await fd.close();
    }

    const finalSha = hasher.digest('hex');
    if (req.sha256 && finalSha !== req.sha256) {
      // Remove the corrupt file so a retry restarts cleanly.
      try {
        await fsp.unlink(req.target_path);
      } catch {
        /* ignore */
      }
      this.bus.publish({
        name: 'model.download.failed',
        payload: { model_id: req.model_id, error: { reason: 'integrity-mismatch' } },
      });
      throw new ComfyIntegrityError(req.sha256, finalSha);
    }

    this.bus.publish({
      name: 'model.download.completed',
      payload: { model_id: req.model_id, bytes: bytesWritten, sha256: finalSha, path: req.target_path },
    });
    this.logger.info(
      { model_id: req.model_id, bytes: bytesWritten, sha256: finalSha },
      'model download complete',
    );
    return { path: req.target_path, bytes: bytesWritten, sha256: finalSha };
  }

  /** Delete a model file with an in-flight job check (FR-14 / G.7). */
  async delete(args: { file_path: string; in_flight_check: () => boolean }): Promise<void> {
    if (args.in_flight_check()) {
      throw new ComfyError(`model in use by an active job; cannot delete ${args.file_path}`);
    }
    try {
      await fsp.unlink(args.file_path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.bus.publish({ name: 'model.deleted', payload: { file_path: args.file_path } });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256OfFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
