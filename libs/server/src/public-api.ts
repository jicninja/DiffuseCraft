/**
 * Public-facing types of `@diffusecraft/server`.
 *
 * The actual factory + implementation classes live in `lib/server.ts`. This
 * file declares the interface surface so consumers can import types
 * without pulling in the full implementation tree.
 */

import type {
  ServerStatus,
  ServerLifecycleEvent,
  ServerLifecycleEventKind,
  Unsubscribe,
} from './types/lifecycle.js';
import type { HookRegistry } from './lib/hooks/registry.js';
import type {
  OpenWindowOptions,
  OpenWindowResult,
} from './lib/pairing/manager.js';

/**
 * Public pairing API. Hosts (apps/server, MeshCraft) call `openWindow` to
 * accept new devices outside the auto-opened first-run window. Listing
 * paired devices is exposed for the "Devices" UI panel (FR-30).
 */
export interface PairingInterface {
  openWindow(opts?: OpenWindowOptions): OpenWindowResult;
  listPairedDevices(): Array<{
    id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    pairing_method: string | null;
  }>;
  revokeToken(token_id: string): boolean;
}

export interface McpInterface {
  /** Dynamic call-site: invoke any registered tool by name. */
  invokeTool(name: string, args: unknown): Promise<unknown>;
  /**
   * Typed accessor map. Keys are tool names from the active catalog; values
   * are typed call functions. The accessors are runtime-generated via a Proxy
   * keyed on the `@diffusecraft/mcp-tools` manifest; build-time per-tool
   * narrowing can be layered on once a tool-name codegen step is added.
   */
  tools: Record<string, (args: unknown) => Promise<unknown>>;
  /** Read a `diffusecraft://` resource URI without invoking a handler. */
  readResource(uri: string): Promise<unknown>;
}

/**
 * Public event-bus surface for in-process callers (MeshCraft, the SDK's
 * in-memory transport, integration tests). Wraps the internal `EventBus`
 * with a stable API: subscribers receive payloads as `unknown` and are
 * responsible for narrowing them against the catalog's event payload
 * schemas (`@diffusecraft/mcp-tools`).
 *
 * The signature is intentionally minimal — `subscribe(name, handler)` and
 * an `Unsubscribe` callback. There is no `unsubscribeAll` / `removeAll` to
 * keep the boundary small; callers retain the returned function and call
 * it when teardown is required (mirrors `client-sdk` design.md §3 / §4
 * `Transport.subscribe` and §10 sampling lifecycle).
 *
 * Required by `client-sdk` requirements §3.3 (FR-9) so the in-memory
 * transport can call `server.events.subscribe(...)` directly without
 * reaching into private internals.
 */
export interface EventsInterface {
  /**
   * Subscribe to a named event. The handler receives the published
   * payload as `unknown` (the bus does not validate against the catalog's
   * payload schema; consumers do that at the call site). Returns an
   * `Unsubscribe` callback whose first call removes the handler and whose
   * subsequent calls are no-ops.
   *
   * The bus is open-ended — any string name the server publishes is
   * subscribable. The catalog (`@diffusecraft/mcp-tools` `EventName`) is
   * the canonical enumeration; in-process callers typically pass one of
   * those literals but the signature accepts any string so server-internal
   * lifecycle events (`lifecycle.*`) remain reachable for embedding hosts.
   */
  subscribe<E extends string>(
    name: E,
    handler: (payload: unknown) => void,
  ): Unsubscribe;
}

export interface DiffuseCraftServer {
  start(): Promise<ServerStatus>;
  stop(opts?: { graceful_timeout_ms?: number }): Promise<void>;
  getStatus(): ServerStatus;

  /** Programmatic MCP interface for in-process callers (MeshCraft, tests). */
  readonly mcp: McpInterface;

  /**
   * Programmatic event-bus surface for in-process callers (MeshCraft, the
   * `client-sdk` in-memory transport, tests). Required by `client-sdk`
   * FR-9; see {@link EventsInterface}.
   */
  readonly events: EventsInterface;

  on<E extends ServerLifecycleEventKind>(
    event: E,
    handler: (event: Extract<ServerLifecycleEvent, { kind: E }>) => void,
  ): void;
  off<E extends ServerLifecycleEventKind>(event: E, handler: (...args: unknown[]) => void): void;

  /** Embedding hooks (see `HookRegistry`). */
  readonly hooks: HookRegistry;

  /** Pairing-protocol API surface (see `PairingInterface`). */
  readonly pairing: PairingInterface;
}

export type { Unsubscribe };
