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

export interface DiffuseCraftServer {
  start(): Promise<ServerStatus>;
  stop(opts?: { graceful_timeout_ms?: number }): Promise<void>;
  getStatus(): ServerStatus;

  /** Programmatic MCP interface for in-process callers (MeshCraft, tests). */
  readonly mcp: McpInterface;

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
