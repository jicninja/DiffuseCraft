/**
 * `ConnectionTracker` — per-token reference-counted session liveness
 * (undo-redo-system A.5 / Phase G design contract for FR-25 grace timer).
 *
 * Transports that expose long-lived sessions (HTTP / Streamable HTTP /
 * future SSE) call:
 *
 *   - `acquire(token_id)` when a session opens. The first transition
 *     `0 → 1` for a given token id is treated as a *reconnect* and
 *     forwarded to {@link UndoRedoManager.onTokenReconnect}, which
 *     cancels any pending disconnect-discard timer.
 *
 *   - `release(token_id)` when a session closes. The transition
 *     `1 → 0` is treated as a *disconnect* and forwarded to
 *     {@link UndoRedoManager.onTokenDisconnect}, which schedules the
 *     stack discard after `retain_after_disconnect_seconds` elapses
 *     (default 600 s per `ServerConfig.undo`).
 *
 * Stdio is single-eternal-session and does NOT use this tracker — the
 * process exit is the disconnect signal, handled by `server.stop()`.
 *
 * In-memory transport calls are entirely in-process and ephemeral; they
 * also skip the tracker.
 *
 * Anonymous calls (no `token_id`, e.g. `/health` or `/pair`) are no-ops:
 * the tracker is keyed by `token_id` and silently ignores `null`/empty
 * inputs so transports may invoke it unconditionally.
 *
 * The tracker is *agnostic* about how transports map sessions to
 * acquire/release pairs. The current HTTP transport does request/response
 * (no long-lived per-token connection); for that mode the tracker is
 * still safe to wire — each request is one acquire+release pair, and the
 * grace timer simply re-arms after every request. Once the SDK
 * Streamable HTTP / SSE transport lands, sessions will be longer-lived
 * and the tracker's behavior will more closely match the design intent.
 */

import type { UndoRedoManager } from '../undo-redo/manager.js';

export class ConnectionTracker {
  /** Active session count per token id. Tokens at 0 are absent. */
  private readonly counts = new Map<string, number>();

  constructor(private readonly manager: UndoRedoManager) {}

  /**
   * Mark a new session opened for `token_id`. The first acquire after
   * any number of releases (the `0 → 1` transition) cancels the pending
   * disconnect-discard timer via {@link UndoRedoManager.onTokenReconnect}.
   *
   * Idempotent for `null` / empty inputs (anonymous calls).
   */
  acquire(token_id: string | null | undefined): void {
    if (!token_id) return;
    const prev = this.counts.get(token_id) ?? 0;
    const next = prev + 1;
    this.counts.set(token_id, next);
    if (prev === 0) {
      this.manager.onTokenReconnect(token_id);
    }
  }

  /**
   * Mark a session closed for `token_id`. The last release (the
   * `1 → 0` transition) schedules a stack discard after
   * `retain_after_disconnect_seconds` via
   * {@link UndoRedoManager.onTokenDisconnect}.
   *
   * Idempotent for `null` / empty inputs and for unknown ids.
   */
  release(token_id: string | null | undefined): void {
    if (!token_id) return;
    const prev = this.counts.get(token_id) ?? 0;
    if (prev <= 0) return; // unbalanced release — defensive no-op
    const next = prev - 1;
    if (next === 0) {
      this.counts.delete(token_id);
      this.manager.onTokenDisconnect(token_id);
    } else {
      this.counts.set(token_id, next);
    }
  }

  /** Snapshot of current per-token reference counts (for diagnostics). */
  getCounts(): ReadonlyMap<string, number> {
    return this.counts;
  }
}
