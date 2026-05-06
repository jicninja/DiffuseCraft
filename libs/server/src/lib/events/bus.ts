/**
 * Typed in-process event bus.
 *
 * Single emission point for catalog events (`job.progress`, `job.completed`,
 * `document.changed`, `model.download.progress`, `audit.entry`) plus
 * server-internal lifecycle events. Subscribers (transports, hooks) tap the
 * same bus (FR-26 / FR-27).
 *
 * Errors thrown by individual subscribers do not block other subscribers
 * (C.4). Errors are routed to the configured logger.
 *
 * The bus also maintains a small **ring buffer** of recently-published
 * events, queryable via {@link EventBus.recentEvents}. This buffer is the
 * substrate for `undo-redo-system` Phase E.1's conflict-detection lookup
 * (design.md §7): `executeWithConflictDetection` peeks at the last
 * `conflict_window_ms` of `document.changed` events to decide whether the
 * incoming Command overlaps a prior client's edit. The buffer is bounded
 * in two dimensions to keep memory predictable in long-running sessions:
 * a time-based retention window and a hard entry cap. Events older than
 * the window OR beyond the cap are pruned synchronously on every
 * {@link EventBus.publish} (no background timer).
 */

export type EventEnvelope = { name: string; payload: unknown };

export type EventHandler = (payload: unknown) => void | Promise<void>;

/**
 * One entry in the bus's recent-events ring buffer. Surfaced by
 * {@link EventBus.recentEvents} so callers can inspect prior payloads
 * + their publication time without subscribing.
 */
export interface RecentEvent {
  readonly payload: unknown;
  /** `Date.now()` at publish time — millisecond resolution. */
  readonly published_at: number;
}

export interface EventBusOptions {
  onSubscriberError?: (event: EventEnvelope, error: unknown) => void;
  /**
   * Retention window for the recent-events ring buffer (ms). Events
   * older than this are evicted on the next {@link EventBus.publish}.
   *
   * Default: 5_000 ms (5 s). The default is intentionally wider than
   * the design-doc default conflict window (1 s, design.md §7) so that
   * slow tests, GC pauses, or single-threaded event-loop hiccups do not
   * cause a legitimate `recentEvents("document.changed", 1000)` lookup
   * to miss events that landed within the requested window. Callers
   * always pass their own `withinMs` to {@link EventBus.recentEvents};
   * the retention window is just the upper bound on what the buffer
   * keeps available.
   */
  recentEventsRetentionMs?: number;
  /**
   * Hard cap on the number of entries in the recent-events ring buffer.
   * Defensive against runaway publishers — without a cap, a flood of
   * events within `recentEventsRetentionMs` could grow the buffer
   * unboundedly. On overflow, oldest entries are evicted first.
   *
   * Default: 1024 entries.
   */
  recentEventsMaxEntries?: number;
}

export class EventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();
  private readonly options: EventBusOptions;
  /**
   * Ring buffer of recent events keyed by name. Append-only on
   * {@link EventBus.publish}; pruned in place by
   * {@link EventBus.pruneRecent} on every publish (time + size bound).
   * The per-name `Array` is kept ordered by `published_at` ascending
   * (oldest first) so eviction is an `O(k)` `shift` in the common case
   * where `k` (entries to evict) is small.
   */
  private readonly recent = new Map<string, RecentEvent[]>();
  private readonly recentRetentionMs: number;
  private readonly recentMaxEntries: number;

  constructor(options: EventBusOptions = {}) {
    this.options = options;
    this.recentRetentionMs = options.recentEventsRetentionMs ?? 5_000;
    this.recentMaxEntries = options.recentEventsMaxEntries ?? 1024;
  }

  publish(event: EventEnvelope): void {
    // Record into the recent-events buffer BEFORE fan-out so a
    // synchronous subscriber that re-queries `recentEvents` sees the
    // current event. Pruning happens here too — bounded work per
    // publish keeps the buffer self-maintaining.
    this.recordRecent(event);

    const subs = this.subscribers.get(event.name);
    if (!subs) return;
    for (const handler of subs) {
      try {
        const ret = handler(event.payload);
        if (ret && typeof (ret as Promise<unknown>).then === 'function') {
          (ret as Promise<unknown>).catch((err) => this.handleSubError(event, err));
        }
      } catch (err) {
        this.handleSubError(event, err);
      }
    }
  }

  /**
   * Return events of `name` published within the last `withinMs`
   * milliseconds, oldest first. Returns an empty array when no events
   * of that name are buffered or all are older than the window.
   *
   * The result is a fresh array so callers can iterate without
   * worrying about concurrent `publish()` mutations. Entry payloads
   * are returned by reference — callers MUST treat them as read-only.
   *
   * `withinMs` is **clamped** internally by the bus's retention
   * window; querying for events older than the buffer can hold simply
   * yields what the buffer has.
   */
  recentEvents(name: string, withinMs: number): ReadonlyArray<RecentEvent> {
    const bucket = this.recent.get(name);
    if (!bucket || bucket.length === 0) return [];
    const cutoff = Date.now() - Math.max(0, withinMs);
    // Find the first entry within the window. Bucket is ordered
    // oldest-first; a linear scan is fine at our buffer sizes.
    let i = 0;
    while (i < bucket.length && bucket[i]!.published_at < cutoff) i += 1;
    return bucket.slice(i);
  }

  subscribe(name: string, handler: EventHandler): () => void {
    let set = this.subscribers.get(name);
    if (!set) {
      set = new Set();
      this.subscribers.set(name, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.subscribers.delete(name);
    };
  }

  /** Subscribe to all events; matches any name. Used by transport relays. */
  subscribeAll(handler: (event: EventEnvelope) => void): () => void {
    const wrapped: EventHandler = () => {
      // No-op; the actual relay happens in publishAll's caller pattern.
    };
    // For "all events", we expose a separate channel.
    this.allSubs.add(handler);
    void wrapped; // keep type explicit
    return () => this.allSubs.delete(handler);
  }

  private readonly allSubs = new Set<(event: EventEnvelope) => void>();

  /** Internal: emit to wildcard subscribers in addition to per-name ones. */
  publishWithBroadcast(event: EventEnvelope): void {
    this.publish(event);
    for (const handler of this.allSubs) {
      try {
        handler(event);
      } catch (err) {
        this.handleSubError(event, err);
      }
    }
  }

  private handleSubError(event: EventEnvelope, err: unknown): void {
    this.options.onSubscriberError?.(event, err);
  }

  /**
   * Append `event` to the per-name ring buffer with the current
   * timestamp, then prune the bucket along both bounds:
   *
   *   1. **Time bound** — drop entries older than `recentRetentionMs`.
   *   2. **Size bound** — drop oldest entries until length ≤
   *      `recentMaxEntries`.
   *
   * Pruning runs on every publish so the work amortizes to O(1) per
   * call in steady state (one push, occasional shift).
   */
  private recordRecent(event: EventEnvelope): void {
    const now = Date.now();
    let bucket = this.recent.get(event.name);
    if (!bucket) {
      bucket = [];
      this.recent.set(event.name, bucket);
    }
    bucket.push({ payload: event.payload, published_at: now });

    // Time-based eviction. Linear scan from the front (oldest); the
    // common case evicts zero or one entry.
    const cutoff = now - this.recentRetentionMs;
    let dropFront = 0;
    while (dropFront < bucket.length && bucket[dropFront]!.published_at < cutoff) {
      dropFront += 1;
    }
    if (dropFront > 0) bucket.splice(0, dropFront);

    // Size-based eviction. Defensive cap; usually a no-op.
    if (bucket.length > this.recentMaxEntries) {
      bucket.splice(0, bucket.length - this.recentMaxEntries);
    }
  }
}
