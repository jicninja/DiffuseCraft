/**
 * Typed event emitter for ComfyUI WS messages (B.3, FR-22).
 *
 * Wraps Node's `EventEmitter` with concrete payload types so callers don't
 * have to cast. Used by `JobTracker` (translating ComfyUI → catalog events)
 * and the integration test harness.
 *
 * The runtime emitter underneath is plain `events.EventEmitter` to avoid
 * pulling a new dependency; the public surface is just typed on top.
 */

import { EventEmitter } from 'node:events';

import type {
  ComfyExecutedEvent,
  ComfyExecutingEvent,
  ComfyExecutionCachedEvent,
  ComfyExecutionErrorEvent,
  ComfyProgressEvent,
  ComfyStatusEvent,
} from './types.js';

/** Event-name → payload mapping consumed by `JobTracker` and tests. */
export interface ComfyEventMap {
  progress: ComfyProgressEvent;
  executed: ComfyExecutedEvent;
  executing: ComfyExecutingEvent;
  execution_error: ComfyExecutionErrorEvent;
  execution_cached: ComfyExecutionCachedEvent;
  status: ComfyStatusEvent;
  /** WebSocket attached / re-attached. */
  open: void;
  /** WebSocket closed; `code` follows ws-protocol. */
  close: { code: number; reason?: string };
  /** Reconnection attempt; `attempt` is 1-indexed. */
  reconnecting: { attempt: number; delay_ms: number };
}

export type ComfyEventName = keyof ComfyEventMap;

/**
 * Strongly-typed wrapper around `EventEmitter`. The shape mirrors the
 * subset of `EventEmitter` we actually use in the codebase to keep the
 * surface small and predictable.
 */
export class ComfyEventEmitter {
  private readonly inner = new EventEmitter();

  on<E extends ComfyEventName>(event: E, handler: (payload: ComfyEventMap[E]) => void): this {
    this.inner.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  off<E extends ComfyEventName>(event: E, handler: (payload: ComfyEventMap[E]) => void): this {
    this.inner.off(event, handler as (...args: unknown[]) => void);
    return this;
  }

  once<E extends ComfyEventName>(event: E, handler: (payload: ComfyEventMap[E]) => void): this {
    this.inner.once(event, handler as (...args: unknown[]) => void);
    return this;
  }

  emit<E extends ComfyEventName>(event: E, payload: ComfyEventMap[E]): boolean {
    return this.inner.emit(event, payload);
  }

  removeAllListeners(): this {
    this.inner.removeAllListeners();
    return this;
  }

  listenerCount<E extends ComfyEventName>(event: E): number {
    return this.inner.listenerCount(event);
  }
}
