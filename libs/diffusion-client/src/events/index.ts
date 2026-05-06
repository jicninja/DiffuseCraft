/**
 * Events barrel — re-exports the buffered event bus (E.1 / E.2 / E.3) and
 * its public types. The eventual `DiffuseCraftClient` (B.6) constructs one
 * `EventBus` per session and exposes the typed `events` namespace
 * (design.md §3) on top of it.
 */

export { EventBus } from "./bus.js";
export type { EventBusOptions, HttpStatusSource } from "./bus.js";
export type {
  ConnectionStatus,
  ConnectionStatusListener,
  EventListener,
  Unsubscribe,
} from "./types.js";
