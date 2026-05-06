/**
 * Public types for the SDK event bus (E.1 / E.3).
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.6 (FR-19 typed `events.on`,
 *     FR-20 buffered late-attach replay, FR-21 connection-status events).
 *   - `client-sdk` design.md §2 (`events/types.ts` module slot),
 *     §3 (Public API — `events: { on(...), onConnectionStatus(...) }`,
 *     `getStatus(): "disconnected" | "connecting" | "connected" |
 *     "reconnecting" | "error"`).
 *
 * The bus surfaces TWO consumer-facing channels:
 *
 *   1. Typed catalog events (`job.progress`, `job.completed`, ...) keyed by
 *      `EventName` from `@diffusecraft/mcp-tools`. Listener payloads are
 *      `EventPayload<E>` — typed at the call site (FR-19).
 *
 *   2. Connection-status transitions (`onConnectionStatus`) — broader than
 *      the HTTP transport's reconnect-only enum (`'reconnecting' |
 *      'connected' | 'failed'`); aligned with the public client's
 *      `getStatus()` projection (design.md §3).
 *
 * The bus does NOT redefine `EventName` / `EventPayload` — it re-exposes the
 * catalog's source of truth via `import type` so the public SDK surface is a
 * single typed contract.
 */

import type { EventName, EventPayload } from "@diffusecraft/mcp-tools";

/**
 * Typed event listener (FR-19). The `E extends EventName` parameter narrows
 * `payload` to that event's catalog-defined shape — consumers get
 * IntelliSense + compile-time safety without touching the underlying
 * `unknown` payload that the wire transport delivers.
 */
export type EventListener<E extends EventName> = (
  payload: EventPayload<E>,
) => void;

/**
 * Cancel a previously registered listener. Idempotent — calling more than
 * once is a no-op (consistent with `Transport.subscribe`'s `Unsubscribe`).
 */
export type Unsubscribe = () => void;

/**
 * Connection-status transitions emitted to consumers via
 * `events.onConnectionStatus(...)` (FR-21 / FR-31).
 *
 * Aligned verbatim with `DiffuseCraftClient.getStatus()` from design.md §3:
 *
 *   - `'disconnected'` — no transport-level connection (initial state, or
 *     after `client.disconnect()`).
 *   - `'connecting'` — `client.connect()` in flight; handshake not yet
 *     complete.
 *   - `'connected'` — handshake complete; transport ready to accept calls.
 *   - `'reconnecting'` — transient failure; the HTTP reconnect loop
 *     (`transports/reconnect.ts`) is retrying. Maps from the transport's
 *     `'reconnecting'` emission verbatim.
 *   - `'error'` — terminal failure. Maps from the transport's `'failed'`
 *     emission (the reconnect module emits `'failed'` so the public client
 *     can decide on the consumer-visible name; the bus does that mapping
 *     here).
 */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Listener for connection-status transitions (FR-21). Returns `void`; the
 * bus drops listener exceptions onto the configured logger so one
 * misbehaving consumer cannot starve the others.
 */
export type ConnectionStatusListener = (status: ConnectionStatus) => void;
