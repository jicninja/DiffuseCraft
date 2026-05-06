/**
 * History garbage collection (D.1–D.7).
 *
 * Daily timer that:
 *   1. Deletes items whose `discarded_at` is older than 7 days (D.2).
 *   2. Deletes unreferenced items older than `retention_days` (D.3).
 *   3. Enforces the `max_size_bytes` blob budget by evicting oldest
 *      unreferenced items first (D.4).
 *   4. Pauses on `stop()` so an in-flight shutdown isn't interrupted (D.5).
 *   5. Emits `history.gc-completed` for observability (D.7).
 *
 * Startup-time orphan-blob check (D.6) is exposed as `runStartupCheck()` —
 * the server calls it once during bootstrap; items whose blobs are missing
 * are flagged `discarded_at = startup_time`. This keeps the bus contract
 * (any `history.gc-completed` payload) intact while letting the first run
 * happen in process startup rather than on the daily timer.
 *
 * The deeper "applied items survive while their layer exists" rule
 * (FR-13 §3.5 final bullet) lives in the SQL filters: `applied_to_layer_id
 * IS NULL` is the precondition for both retention and budget eviction. Once
 * a layer is removed, the calling spec (`layers` future work) clears that
 * pointer and the item becomes GC-eligible again — kept as a TODO marker
 * because there is no `remove_layer` handler yet to clear the pointer.
 */

import type { EventBus } from '../events/bus.js';
import type { AssetStore } from '../assets/store.js';
import type { HistoryStore, HistoryItemRow } from './store.js';

export interface HistoryGcConfig {
  /** Retention for unreferenced (never-applied) items. Default 30 days. */
  retention_days: number;
  /** Storage budget across history blobs. Default 5 GiB. */
  max_size_bytes: number;
  /** Discarded items aged past this are GC'd immediately. Default 7 days. */
  discarded_grace_days: number;
}

export const DEFAULT_HISTORY_GC_CONFIG: HistoryGcConfig = {
  retention_days: 30,
  max_size_bytes: 5 * 1024 * 1024 * 1024,
  discarded_grace_days: 7,
};

export interface HistoryGcDeps {
  store: HistoryStore;
  assets: AssetStore;
  bus: EventBus;
  config?: Partial<HistoryGcConfig>;
  /** Override the daily interval (used by tests). Defaults to 24h. */
  interval_ms?: number;
  /** Override the wall clock (used by tests). */
  now?: () => Date;
}

export interface HistoryGcRunResult {
  items_deleted: number;
  bytes_freed: number;
  ts: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class HistoryGc {
  private timer?: NodeJS.Timeout;
  private readonly cfg: HistoryGcConfig;
  private readonly intervalMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: HistoryGcDeps) {
    this.cfg = { ...DEFAULT_HISTORY_GC_CONFIG, ...(deps.config ?? {}) };
    this.intervalMs = deps.interval_ms ?? DAY_MS;
    this.now = deps.now ?? (() => new Date());
  }

  /** Start the daily timer (FR-13). Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.run();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Pause GC (D.5). Idempotent. Pinned blobs stay safe across restart. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Run a full GC pass. Public so callers can trigger an immediate sweep
   * (the server runs one shortly after `start()` in tests).
   */
  async run(): Promise<HistoryGcRunResult> {
    const now = this.now();
    let items_deleted = 0;
    let bytes_freed = 0;

    // 1. Discarded items past the grace window.
    const discardedCutoff = isoBefore(now, this.cfg.discarded_grace_days);
    const discarded = this.deps.store.selectDiscardedOlderThan(discardedCutoff);
    bytes_freed += await this.deleteAll(discarded);
    items_deleted += discarded.length;

    // 2. Unreferenced items past the retention window.
    const retentionCutoff = isoBefore(now, this.cfg.retention_days);
    const unreferenced = this.deps.store.selectUnreferencedOlderThan(retentionCutoff);
    bytes_freed += await this.deleteAll(unreferenced);
    items_deleted += unreferenced.length;

    // 3. Enforce the storage budget. We delete one row at a time so the
    // sweep stops the moment the total drops below the cap; deleting a
    // whole 50-row batch wholesale would over-shoot in tight budgets.
    let budget = this.deps.store.totalReferencedBytes();
    while (budget.total_bytes > this.cfg.max_size_bytes) {
      const batch = this.deps.store.selectOldestUnreferenced(50);
      if (batch.length === 0) break;
      let evicted = 0;
      for (const row of batch) {
        bytes_freed += await this.deleteOne(row);
        items_deleted += 1;
        evicted += 1;
        budget = this.deps.store.totalReferencedBytes();
        if (budget.total_bytes <= this.cfg.max_size_bytes) break;
      }
      if (evicted === 0) break;
    }

    const result: HistoryGcRunResult = {
      items_deleted,
      bytes_freed,
      ts: now.toISOString(),
    };
    this.deps.bus.publish({ name: 'history.gc-completed', payload: result });
    return result;
  }

  /**
   * Startup orphan-blob check (D.6 / FR Q6). Items whose referenced blobs
   * are missing get `discarded_at = startup_time`; the next GC pass evicts
   * them after the grace window.
   */
  runStartupCheck(): { degraded: number } {
    const orphans = this.deps.store.selectItemsWithMissingBlobs();
    const ts = this.now().toISOString();
    for (const item of orphans) {
      this.deps.store.markDiscarded({ id: item.id, discarded_at: ts });
    }
    return { degraded: orphans.length };
  }

  // ---- internal -----------------------------------------------------------

  private async deleteAll(rows: ReadonlyArray<HistoryItemRow>): Promise<number> {
    let bytes_freed = 0;
    for (const row of rows) {
      bytes_freed += await this.deleteOne(row);
    }
    return bytes_freed;
  }

  private async deleteOne(row: HistoryItemRow): Promise<number> {
    let bytes_freed = 0;
    if (row.image_blob_id) {
      bytes_freed += await safeDeleteBlob(this.deps.assets, row.image_blob_id);
    }
    if (row.thumbnail_blob_id && row.thumbnail_blob_id !== row.image_blob_id) {
      bytes_freed += await safeDeleteBlob(this.deps.assets, row.thumbnail_blob_id);
    }
    this.deps.store.deleteById(row.id);
    return bytes_freed;
  }
}

function isoBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

async function safeDeleteBlob(assets: AssetStore, id: string): Promise<number> {
  // The AssetStore returns void; we can't directly read the byte count after
  // delete. Read first to estimate, then delete. The byte total is best-effort
  // because the row may be missing if a parallel sweep already removed it.
  const meta = await assets.read(id).catch(() => null);
  await assets.delete(id);
  return meta?.meta.bytes ?? 0;
}
