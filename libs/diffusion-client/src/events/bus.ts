/**
 * Buffered, typed event bus (E.1 / E.2 / E.3).
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.6 (FR-19 typed listeners, FR-20 buffered
 *     late-attach replay capped at `event_buffer_size`, FR-21
 *     `onConnectionStatus`).
 *   - `client-sdk` design.md §2 (`events/bus.ts` module slot), §3 (Public API
 *     — `events: { on(...), onConnectionStatus(...) }`), §7 (reference
 *     implementation: per-event-name listener set + buffer; flush-on-attach;
 *     FIFO drop on overflow).
 *
 * Wire integration:
 *
 *   - The bus subscribes lazily — on the FIRST `on(eventName, ...)` call for
 *     a given `eventName` it registers ONE forwarder against the wire-level
 *     `Transport.subscribe(eventName, ...)`. Subsequent listeners for the
 *     same event reuse the same forwarder (no per-listener wire round-trip).
 *
 *   - The forwarder enters the bus's internal `publish(eventName, payload)`
 *     — the same path that buffers when no consumer listener is attached —
 *     so events arriving WHILE consumers detach/reattach are queued and
 *     replayed (FR-20).
 *
 *   - Transports that do not yet wire MCP notifications (HTTP / stdio per
 *     B.3 / B.2 — the upstream gap is tracked by `server-architecture`)
 *     throw `ConnectionError` from `subscribe()`. The bus DOES NOT propagate
 *     that throw — it logs a warning and proceeds without wire delivery. The
 *     consumer's `on(...)` call still succeeds and still receives any
 *     events that subsequently arrive through `markEvent(...)` (used by the
 *     in-memory transport path or by a future wire-bridge).
 *
 *   - The in-memory transport (B.1) routes events synchronously from
 *     `server.events.subscribe` through its own `subscribe()`; the bus's
 *     forwarder receives them verbatim and the consumer sees them in real
 *     time.
 *
 * Buffer policy (E.2):
 *
 *   - The buffer is per-event-name (`Map<EventName, unknown[]>`) so a
 *     burst of `job.progress` events does not evict an unrelated
 *     `document.changed` event waiting for a late-attaching listener.
 *   - When the per-event-name FIFO exceeds `bufferSize`, the OLDEST entry
 *     is discarded (`buf.shift()`) and a `logger.warn` emits with the
 *     event name and the bound — observable evidence that consumers are
 *     not draining the bus fast enough.
 *
 * Connection status (E.3):
 *
 *   - `onConnectionStatus(handler)` registers a consumer listener for the
 *     bus's `ConnectionStatus` enum (5 values, design.md §3).
 *   - `markStatus(status)` is the producer entry point. The future
 *     `client.ts` (Phase B.6) calls it from `connect()` / `disconnect()` /
 *     reconnect-loop wiring. For HTTP transports the bus also auto-bridges
 *     `transport.onConnectionStatus(...)` (the B.4 method) when the optional
 *     `bridgeHttpTransport` option is supplied; the bridge maps the
 *     reconnect module's `'reconnecting' | 'connected' | 'failed'` to the
 *     bus's broader 5-value enum (`'failed'` → `'error'`).
 *   - Status changes are de-duplicated: emitting the same status twice in a
 *     row is a no-op so consumers don't see a phantom transition. The
 *     INITIAL status is `'disconnected'`; the first `markStatus(...)` call
 *     transitions away from it.
 *   - Late-attaching listeners receive the CURRENT status immediately on
 *     subscribe (one synchronous call). This matches the reactive-store
 *     pattern the `client-state-architecture` consumer expects: the
 *     connection store binds to the bus and projects `getStatus()` without
 *     racing the first transition.
 *
 * Disposal:
 *
 *   - `dispose()` tears down all wire-level subscriptions, clears all
 *     consumer listener sets, drops the buffer, and removes the optional
 *     HTTP-status bridge. Subsequent `on(...)` / `onConnectionStatus(...)`
 *     / `publish(...)` / `markStatus(...)` calls are no-ops (fail-safe; the
 *     outer client may dispose during teardown while consumers still hold
 *     references). After `dispose()` the bus is single-use — re-attaching
 *     it to a fresh transport is the outer client's responsibility (it
 *     will simply construct a new bus).
 */

import type { EventName, EventPayload } from "@diffusecraft/mcp-tools";

import type { Logger } from "../config.js";
import type { Transport, Unsubscribe } from "../transports/transport.js";

import type {
  ConnectionStatus,
  ConnectionStatusListener,
  EventListener,
} from "./types.js";

// ---------------------------------------------------------------------------
// Wire-level helpers
// ---------------------------------------------------------------------------

/**
 * Subset of `HttpTransport` used by the optional connection-status bridge.
 * Declared structurally so the bus does not depend on the concrete class
 * (avoids a transport-direction cycle and lets test harnesses supply a
 * minimal stub).
 */
export interface HttpStatusSource {
  onConnectionStatus(
    handler: (status: "reconnecting" | "connected" | "failed") => void,
  ): Unsubscribe;
}

/**
 * Map the HTTP transport's reconnect-only enum to the bus's broader
 * `ConnectionStatus`. The `'failed'` → `'error'` rename matches design.md §3
 * (the public `getStatus()` enum spells the terminal state `'error'`); the
 * other two values pass through unchanged.
 */
function mapHttpStatus(
  status: "reconnecting" | "connected" | "failed",
): ConnectionStatus {
  return status === "failed" ? "error" : status;
}

/**
 * Type guard that recognises the optional `onConnectionStatus(...)` method
 * on a transport instance. Used by the bus to opportunistically bridge the
 * HTTP transport's status emitter without requiring the caller to know
 * which kind they have.
 */
function hasOnConnectionStatus(
  candidate: unknown,
): candidate is HttpStatusSource {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { onConnectionStatus?: unknown })
      .onConnectionStatus === "function"
  );
}

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/**
 * Construction parameters for {@link EventBus}.
 *
 * `transport` is the wire-level subscription source. The bus calls
 * `transport.subscribe(eventName, ...)` on the FIRST consumer `on(...)` for
 * a given event name, and forwards every received payload into the bus's
 * internal `publish(...)` path.
 *
 * `bufferSize` is `event_buffer_size` from `ClientConfig` (FR-4 default
 * 100). Per-event-name buffers cap at this length; FIFO discard on
 * overflow with a `logger.warn` (FR-20, E.2).
 *
 * `logger` is optional; falls back to a no-op so the bus is usable in
 * library-internal code paths that have not threaded a logger through yet.
 *
 * `bridgeHttpTransport`, when `true`, opportunistically calls
 * `transport.onConnectionStatus(...)` if the transport exposes it
 * (i.e. when it is the HTTP transport from B.4) and re-emits the mapped
 * status via the bus's connection-status channel. Defaults to `true` —
 * the outer client (Phase B.6) opts out only when it owns the
 * `markStatus(...)` cadence end-to-end.
 */
export interface EventBusOptions {
  transport: Transport;
  bufferSize: number;
  logger?: Logger;
  bridgeHttpTransport?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type AnyEventListener = (payload: unknown) => void;

const NOOP_LOGGER: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

/**
 * Buffered event bus with typed subscribers (FR-19 / FR-20 / FR-21).
 *
 * The class is intentionally unexported-state — all mutation flows through
 * the public methods so the future `DiffuseCraftClient` (B.6) can rely on
 * the visible contract and so test harnesses do not depend on private
 * fields.
 */
export class EventBus {
  /** Per-event-name consumer listener sets. */
  private readonly listeners = new Map<EventName, Set<AnyEventListener>>();

  /**
   * Per-event-name FIFO buffer of payloads received while no consumer
   * listener is attached. Drained on the first `on(eventName, ...)` and
   * discarded oldest-first on overflow (E.2).
   */
  private readonly buffer = new Map<EventName, unknown[]>();

  /** Wire-level subscription handles per event name. */
  private readonly wireSubscriptions = new Map<EventName, Unsubscribe>();

  /**
   * Event names for which `transport.subscribe(...)` has thrown — kept so
   * the bus does not retry every `on(...)` (one warning per event name is
   * enough; the gap is closed upstream, not on a per-call basis).
   */
  private readonly wireFailed = new Set<EventName>();

  /** Connection-status listener set. */
  private readonly statusListeners = new Set<ConnectionStatusListener>();

  /** Optional teardown for the HTTP transport status bridge. */
  private statusBridgeUnsubscribe: Unsubscribe | null = null;

  /**
   * Last emitted status. Initial value `'disconnected'` matches the
   * `getStatus()` projection's pre-connect state (design.md §3).
   */
  private currentStatus: ConnectionStatus = "disconnected";

  private readonly transport: Transport;
  private readonly bufferSize: number;
  private readonly logger: Logger;
  private disposed = false;

  constructor(opts: EventBusOptions) {
    if (!Number.isInteger(opts.bufferSize) || opts.bufferSize < 1) {
      throw new RangeError(
        `EventBus: bufferSize must be a positive integer, got ${String(
          opts.bufferSize,
        )}`,
      );
    }
    this.transport = opts.transport;
    this.bufferSize = opts.bufferSize;
    this.logger = opts.logger ?? NOOP_LOGGER;

    // Bridge the HTTP transport's reconnect-only status emitter when
    // available (E.3). Failures here are non-fatal — `markStatus` remains
    // the canonical producer path and the outer client drives it directly.
    const bridgeRequested = opts.bridgeHttpTransport ?? true;
    if (bridgeRequested && hasOnConnectionStatus(this.transport)) {
      try {
        this.statusBridgeUnsubscribe = this.transport.onConnectionStatus(
          (raw) => {
            this.markStatus(mapHttpStatus(raw));
          },
        );
      } catch (err) {
        this.logger.warn(
          { err },
          "EventBus: failed to bridge http transport status; falling back to markStatus()",
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // Typed event subscription (FR-19 / FR-20)
  // -------------------------------------------------------------------

  /**
   * Subscribe a typed listener to a catalog event. Returns an
   * {@link Unsubscribe} that idempotently removes the listener.
   *
   * On the FIRST listener for a given event name the bus lazily calls
   * `transport.subscribe(eventName, ...)`. If the transport does not yet
   * publish events on the wire (HTTP / stdio at this writing — the
   * upstream gap is in `server-architecture`), the bus catches the
   * throw, logs a warning, and proceeds — the listener still attaches
   * and any buffered events for that name still flush. Future events
   * delivered via `markEvent(...)` (or via the in-memory transport's
   * own subscribe path) will reach the listener.
   *
   * Buffered events are drained synchronously to the new listener
   * before `on(...)` returns. The buffer is cleared once a listener
   * attaches (the spec language: "Late-attaching listeners receive the
   * buffered events on subscribe" — a one-shot replay, not a permanent
   * tail).
   */
  on<E extends EventName>(eventName: E, listener: EventListener<E>): Unsubscribe {
    if (this.disposed) {
      // Fail-safe: hand back a no-op unsubscribe rather than throwing.
      return () => {};
    }

    const erased = listener as AnyEventListener;
    let set = this.listeners.get(eventName);
    const fresh = !set;
    if (!set) {
      set = new Set<AnyEventListener>();
      this.listeners.set(eventName, set);
    }
    set.add(erased);

    // First listener for this event name → wire it up (if not already
    // wired and not previously known to throw). Order matters: we wire
    // BEFORE flushing the buffer so the in-memory transport's
    // synchronous re-publish path does not double-deliver.
    if (fresh) {
      this.ensureWireSubscription(eventName);
    }

    // Flush buffered events for this name to the new listener.
    const buffered = this.buffer.get(eventName);
    if (buffered && buffered.length > 0) {
      this.buffer.delete(eventName);
      for (const payload of buffered) {
        try {
          erased(payload);
        } catch (err) {
          this.logger.warn(
            { err, eventName },
            "EventBus: listener threw during buffered flush",
          );
        }
      }
    }

    return () => {
      const current = this.listeners.get(eventName);
      if (!current) return;
      current.delete(erased);
      // We deliberately keep the wire subscription alive even when the
      // listener set drops to empty — re-attaching later should not pay
      // a wire round-trip and (more importantly) the in-flight in-memory
      // event channel should keep flowing into the bus's buffer so the
      // FR-20 contract holds for the next listener.
    };
  }

  // -------------------------------------------------------------------
  // Publish path (FR-19 / FR-20 / E.2)
  // -------------------------------------------------------------------

  /**
   * Internal dispatch entry point. Called from the wire-level forwarder
   * (`transport.subscribe`) and from any future test or in-process code
   * that wants to inject an event manually. Public on the class so the
   * outer client can drive it explicitly when needed; the typed
   * generic ensures compile-time safety at the call site.
   */
  markEvent<E extends EventName>(eventName: E, payload: EventPayload<E>): void {
    this.publish(eventName, payload);
  }

  private publish(eventName: EventName, payload: unknown): void {
    if (this.disposed) return;

    const set = this.listeners.get(eventName);
    if (set && set.size > 0) {
      // Snapshot so listener mutations during dispatch do not skip
      // siblings (Set iteration honours insertion order but a listener
      // removing itself MID-iteration leaves a hole).
      const snapshot = Array.from(set);
      for (const listener of snapshot) {
        try {
          listener(payload);
        } catch (err) {
          this.logger.warn(
            { err, eventName },
            "EventBus: listener threw during dispatch",
          );
        }
      }
      return;
    }

    // No listeners → buffer per-event-name with FIFO discard at
    // capacity (FR-20 / E.2).
    let buf = this.buffer.get(eventName);
    if (!buf) {
      buf = [];
      this.buffer.set(eventName, buf);
    }
    buf.push(payload);
    if (buf.length > this.bufferSize) {
      buf.shift();
      this.logger.warn(
        { eventName, bufferSize: this.bufferSize },
        "EventBus: event buffer overflow; dropped oldest payload",
      );
    }
  }

  // -------------------------------------------------------------------
  // Connection status (FR-21 / E.3)
  // -------------------------------------------------------------------

  /**
   * Subscribe to connection-status transitions. The current status is
   * delivered synchronously to the new listener so consumers (the
   * connection store in `client-state-architecture`) bind without racing
   * the first transition.
   */
  onConnectionStatus(handler: ConnectionStatusListener): Unsubscribe {
    if (this.disposed) {
      return () => {};
    }
    this.statusListeners.add(handler);
    try {
      handler(this.currentStatus);
    } catch (err) {
      this.logger.warn(
        { err },
        "EventBus: connection-status listener threw on initial sync",
      );
    }
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  /**
   * Producer-side entry point for connection-status transitions. The
   * outer `DiffuseCraftClient` (B.6) calls this from `connect()` (→
   * `connecting` → `connected`), `disconnect()` (→ `disconnected`), and
   * reconnect-loop wiring (the HTTP bridge automates the latter when
   * available; non-HTTP transports drive it from the client class).
   *
   * De-duplicates: emitting the same status twice in a row is a no-op
   * so consumers do not see phantom transitions.
   */
  markStatus(status: ConnectionStatus): void {
    if (this.disposed) return;
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    const snapshot = Array.from(this.statusListeners);
    for (const listener of snapshot) {
      try {
        listener(status);
      } catch (err) {
        this.logger.warn(
          { err, status },
          "EventBus: connection-status listener threw during dispatch",
        );
      }
    }
  }

  /** Read the last-emitted status. Useful for the public `getStatus()`. */
  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /**
   * Tear down all wire subscriptions, clear listener sets, drop the
   * buffer, and remove the optional HTTP-status bridge. Idempotent.
   * After disposal, all public methods are no-ops; consumers holding
   * stale references see graceful degradation rather than throws.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [eventName, unsubscribe] of this.wireSubscriptions) {
      try {
        unsubscribe();
      } catch (err) {
        this.logger.warn(
          { err, eventName },
          "EventBus: wire unsubscribe threw during dispose",
        );
      }
    }
    this.wireSubscriptions.clear();
    this.listeners.clear();
    this.buffer.clear();
    this.statusListeners.clear();
    this.wireFailed.clear();

    if (this.statusBridgeUnsubscribe) {
      try {
        this.statusBridgeUnsubscribe();
      } catch (err) {
        this.logger.warn(
          { err },
          "EventBus: http status bridge unsubscribe threw during dispose",
        );
      }
      this.statusBridgeUnsubscribe = null;
    }
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private ensureWireSubscription(eventName: EventName): void {
    if (this.wireSubscriptions.has(eventName)) return;
    if (this.wireFailed.has(eventName)) return;
    try {
      const unsubscribe = this.transport.subscribe(eventName, (payload) => {
        this.publish(eventName, payload);
      });
      this.wireSubscriptions.set(eventName, unsubscribe);
    } catch (err) {
      // Transport-level subscription not yet implemented (HTTP / stdio
      // upstream gap). Log once per event name and continue — consumers
      // can still receive events via `markEvent(...)` or the in-memory
      // path. The catalog-level type contract is preserved.
      this.wireFailed.add(eventName);
      this.logger.warn(
        { err, eventName },
        "EventBus: transport.subscribe failed; events for this name will not flow over the wire " +
          "(server-architecture upstream gap). Listeners stay registered; markEvent() and " +
          "in-memory transport paths still deliver.",
      );
    }
  }
}
