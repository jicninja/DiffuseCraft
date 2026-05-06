/**
 * HTTP reconnect orchestration (`client-sdk` FR-7 / FR-29 / FR-30 / FR-31,
 * design.md §2 + §8).
 *
 * The MCP SDK's `StreamableHTTPClientTransport` already handles SSE-level
 * recovery for the long-lived event channel — `Last-Event-ID` replay,
 * server-supplied retry intervals, capped exponential backoff. This module
 * sits ABOVE the SDK and orchestrates the higher-level recovery the spec
 * mandates: when the SDK's transport fires `onclose` while the wrapper's
 * `connected` flag is still `true` (i.e. the close was unsolicited), the
 * SDK consumer (`HttpTransport`) needs to:
 *
 *   1. Re-construct `StreamableHTTPClientTransport` + `Client`, re-resolve
 *      the bearer token (the `TokenProvider` may have rotated it), and
 *      re-issue the MCP `initialize` handshake.
 *   2. Re-install the sampling request handler (the new `Client` does NOT
 *      inherit the previous request handlers).
 *   3. Replay any `send()` calls that were in-flight when the disconnect
 *      fired — bounded to one retry per request to avoid duplicate
 *      side-effects on `job` tools.
 *   4. Emit a `connection-status` transition (`reconnecting` →
 *      `connected` | `failed`) so the outer client (`DiffuseCraftClient`)
 *      surfaces it via `events.onConnectionStatus(...)`.
 *
 * `Reconnector` owns the backoff loop and the cancellation token. The
 * actual reconnect work (constructing the transport, re-handshaking,
 * re-attaching handlers) is supplied by the caller via the `reconnect`
 * callback — the transport owns the SDK-coupled code; this file owns the
 * sequencing, timing, and bookkeeping. Keeping the two split is what makes
 * the orchestration testable in isolation (Phase B.5 deferred per spec
 * "testing disabled until v1") and what keeps `http.ts` readable.
 */

import { ConnectionError } from "../errors";

// Cancellation contract:
//
//   - `start()` is the loop entry point. It runs until reconnection succeeds,
//     the configured `max_attempts` is exhausted, or `stop()` is called from
//     the outside. The returned promise resolves with the terminal status —
//     `connected`, `failed`, or `cancelled`.
//   - `stop()` is invoked from `HttpTransport.disconnect()` when the user
//     tears down the transport while a reconnect attempt is in flight. It
//     short-circuits the next `await sleep(...)` and bails the loop without
//     invoking the `reconnect` callback again.
//
// Why a class with internal state (instead of a free function): the `stop()`
// handle has to be reachable from outside the loop without threading a
// cancellation argument through every layer. A small class is the simplest
// expression of that.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Reconnect policy — same shape as `config.ts`'s `ReconnectConfig` (FR-4).
 * Re-stated here as a structural type so this module remains independent of
 * the wider `ClientConfig` schema and can be unit-tested against fixtures.
 *
 * `enabled === false` means the reconnect loop is skipped entirely; the
 * transport propagates a `ConnectionError` immediately on disconnect.
 *
 * `max_attempts` is the upper bound on reconnect tries before giving up.
 * The default is 5 (per `config.ts`'s `ReconnectConfigSchema.default`).
 *
 * `backoff_ms` is the per-attempt delay schedule. Attempt N reads index
 * `min(N - 1, backoff_ms.length - 1)`, so a schedule shorter than
 * `max_attempts` "saturates" at its last entry (e.g. with the default
 * `[500, 1000, 2000, 4000, 8000]` and `max_attempts = 7`, attempts 6 and 7
 * also wait 8000 ms).
 */
export interface ReconnectConfig {
  enabled: boolean;
  max_attempts: number;
  backoff_ms: number[];
}

/**
 * Connection-status transitions emitted to the consumer. Aligned with the
 * outer `DiffuseCraftClient.getStatus()` projection (design.md §3 —
 * `"reconnecting" | "connected" | "error"`). The reconnector emits
 * `failed` rather than `error` so the outer layer can decide on the public
 * status name (and so this module stays free of the `error` overload that
 * the wider client uses for connect-time failures).
 */
export type ReconnectStatus = "reconnecting" | "connected" | "failed";

/**
 * Construction parameters for {@link Reconnector}.
 *
 * `reconnect` is the caller-supplied closure that does the actual
 * SDK-coupled work — re-constructing `StreamableHTTPClientTransport`,
 * re-issuing the `initialize` handshake, re-installing the sampling
 * handler. It MUST throw on failure (the loop catches and retries) and
 * MUST resolve on success (the loop reads the resolution as "we're back").
 *
 * `onStatusChange` is invoked whenever the reconnect status changes:
 * `reconnecting` once at loop start, then either `connected` (successful
 * reconnect) or `failed` (max attempts exhausted). It is NOT called for
 * `cancelled` — the transport drives `disconnect()` itself in that case
 * and emits its own status from there.
 *
 * `onFatal` is invoked exactly once when the loop gives up. The supplied
 * error already carries `transport_kind: "http"` and `cause:
 * "reconnect-failed"`; the transport propagates it to any pending
 * `send()` callers and stores it for future calls.
 */
export interface ReconnectorParams {
  config: ReconnectConfig;
  reconnect: () => Promise<void>;
  onStatusChange: (status: ReconnectStatus) => void;
  onFatal: (err: Error) => void;
}

/**
 * Terminal outcome of a {@link Reconnector.start} run.
 *
 * - `connected`: the `reconnect` callback resolved on some attempt; the
 *   transport is back online.
 * - `failed`: every attempt threw and `max_attempts` is exhausted; the
 *   transport is dead and pending requests must be rejected.
 * - `cancelled`: `stop()` was called before either of the above; the
 *   transport was torn down by the user mid-reconnect and no further
 *   action is required.
 */
export type ReconnectOutcome = "connected" | "failed" | "cancelled";

// ---------------------------------------------------------------------------
// Reconnector
// ---------------------------------------------------------------------------

/**
 * Reconnect loop driver. Single-shot — instantiate, `start()`, observe
 * outcome. After a terminal outcome the instance is consumed; create a new
 * one for the next disconnect.
 *
 * Multi-shot reuse would require resetting the `cancelled` flag and the
 * `attempts` counter; deliberately not supported because the transport
 * always knows whether it wants a fresh loop (yes, on every unexpected
 * close it has not user-initiated) and constructing a new instance is
 * trivially cheap.
 */
export class Reconnector {
  /** Backoff loop iteration counter; only used internally for index lookup. */
  private attempts = 0;

  /**
   * Cancellation token. Flipped by `stop()`; checked between every step
   * of the loop and woven into the `sleep()` helper so an in-flight
   * backoff wait wakes immediately.
   */
  private cancelled = false;

  /**
   * Resolver for the in-flight backoff sleep, if any. Captured so
   * `stop()` can wake it without waiting for the timer to fire.
   */
  private wakeSleep: (() => void) | null = null;

  constructor(private readonly params: ReconnectorParams) {}

  /**
   * Run the reconnect loop. Resolves with the terminal outcome — never
   * throws (errors from the supplied `reconnect` closure are absorbed
   * into the retry counter; the final `failed` case calls `onFatal`
   * before resolving).
   *
   * Behaviour when `params.config.enabled === false`: skip the loop
   * entirely, immediately call `onStatusChange("failed")` + `onFatal(err)`,
   * and resolve with `"failed"`. The transport reads this as "reconnect
   * is disabled — propagate the original disconnect error to callers".
   *
   * Behaviour when `params.config.max_attempts <= 0`: same as `enabled
   * === false`. Zero attempts is functionally identical to disabled.
   */
  async start(): Promise<ReconnectOutcome> {
    const { config, reconnect, onStatusChange, onFatal } = this.params;

    if (!config.enabled || config.max_attempts <= 0) {
      // Reconnect is policy-disabled — emit `failed` synchronously and
      // bail. The transport propagates a `ConnectionError` from here.
      onStatusChange("failed");
      onFatal(reconnectFailedError("reconnect disabled"));
      return "failed";
    }

    onStatusChange("reconnecting");

    while (this.attempts < config.max_attempts) {
      if (this.cancelled) return "cancelled";

      // 1) Wait the backoff for THIS attempt (attempt 1 reads index 0).
      const delay = pickBackoff(config.backoff_ms, this.attempts);
      if (delay > 0) {
        await this.cancellableSleep(delay);
        if (this.cancelled) return "cancelled";
      }

      // 2) Try the reconnect.
      this.attempts++;
      try {
        await reconnect();
        if (this.cancelled) {
          // Edge case: stop() raced with a successful reconnect. The
          // transport's disconnect path will tear down the freshly
          // re-built client, but we still report `cancelled` so we
          // don't double-emit `connected`.
          return "cancelled";
        }
        onStatusChange("connected");
        return "connected";
      } catch {
        // Swallow and retry. The SDK-side error is already logged by
        // the caller (or will be by Phase B.6's logger wiring); we
        // only care about success vs. exhaustion at this layer.
        // Loop continues.
      }
    }

    // Exhausted — transport is dead.
    onStatusChange("failed");
    onFatal(reconnectFailedError(`exhausted ${config.max_attempts} attempt(s)`));
    return "failed";
  }

  /**
   * Cancel an in-flight loop. Safe to call before `start()` (the next
   * `start()` will short-circuit immediately) and after a terminal
   * outcome (no-op). Idempotent.
   */
  stop(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    const wake = this.wakeSleep;
    this.wakeSleep = null;
    if (wake) wake();
  }

  /**
   * `sleep(ms)` that wakes early on `stop()`. Implemented as a promise
   * race between a `setTimeout` and the cancellation resolver; whichever
   * fires first resolves the await.
   */
  private cancellableSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.wakeSleep = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      // Allow Node to exit if the timer is the only thing keeping the
      // event loop alive (matches `http.ts`'s disconnect grace timer).
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
      }
      this.wakeSleep = finish;
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick the backoff delay for a 0-indexed attempt number, saturating at
 * the last entry of the schedule. Returns 0 when the schedule is empty
 * (shouldn't happen — `ReconnectConfigSchema` requires `min(1)` — but we
 * defend anyway so a malformed structural config doesn't divide-by-zero).
 *
 * Exported for the same testability reason `Reconnector` is a class — the
 * Phase B.5 tests (deferred) want to assert against a known schedule.
 */
export function pickBackoff(schedule: number[], attemptIndex: number): number {
  if (schedule.length === 0) return 0;
  const idx = Math.min(attemptIndex, schedule.length - 1);
  const ms = schedule[idx] ?? 0;
  return ms > 0 ? ms : 0;
}

/**
 * Sentinel string the spec mandates as the `cause` field on the
 * `ConnectionError` raised when reconnect ultimately fails. Exported so
 * `HttpTransport` (and any consumer doing structural error inspection)
 * can match against it without redefining the literal.
 */
export const RECONNECT_FAILED_CAUSE = "reconnect-failed" as const;

/**
 * Build the `ConnectionError` shape mandated by the spec for the
 * reconnect-failed terminal state: `transport_kind: "http"` and the
 * documented `cause: "reconnect-failed"` sentinel. Returns a plain
 * `ConnectionError` (not a subclass) so `instanceof ConnectionError`
 * checks at consumer boundaries work without surprise.
 */
export function reconnectFailedError(detail: string): ConnectionError {
  return new ConnectionError(
    `http transport: reconnect failed (${detail})`,
    { transport_kind: "http", cause: RECONNECT_FAILED_CAUSE },
  );
}
