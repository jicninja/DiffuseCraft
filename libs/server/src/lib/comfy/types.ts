/**
 * ComfyUI shared types (design.md §3, §6).
 *
 * Lightweight TypeScript shapes for the ComfyUI HTTP / WebSocket surface
 * exposed by `ComfyClient` plus the workflow-graph JSON shape consumed by
 * the per-verb builders in `graph/`.
 *
 * These types are intentionally permissive at the value level — ComfyUI's
 * API is loosely typed JSON. We carve out only the fields the server
 * actually inspects; everything else is preserved as `unknown` and forwarded
 * to ComfyUI verbatim.
 *
 * Internal: NOT exported from `libs/server/src/index.ts`. Per FR-20 / B.4
 * the ComfyUI surface is reachable only through `ComfyClient`, which is
 * itself host-internal.
 */

// ---------------------------------------------------------------------------
// Workflow graph (the JSON we POST to /prompt)
// ---------------------------------------------------------------------------

/**
 * A single node in a ComfyUI workflow graph. ComfyUI represents graphs as
 * `{ "<id>": { class_type, inputs }, ... }` where ids are stringified
 * integers and inputs may reference other node outputs as `[node_id, slot]`.
 */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, ComfyNodeInput>;
  /** Optional UI metadata; preserved but not interpreted by the server. */
  _meta?: Record<string, unknown>;
}

/** Either a literal value or a `[node_id, output_slot]` reference tuple. */
export type ComfyNodeInput = string | number | boolean | null | readonly [string, number] | unknown[];

/**
 * A complete ComfyUI workflow graph. The keys are node ids (stringified
 * integers); the values are nodes. Order in the object is irrelevant — the
 * graph is fully connected via input references.
 */
export type ComfyGraph = Record<string, ComfyNode>;

// ---------------------------------------------------------------------------
// HTTP responses
// ---------------------------------------------------------------------------

export interface ComfySubmitResponse {
  /** Unique id ComfyUI assigns to the submitted graph. */
  prompt_id: string;
  /** 0 = immediately running; positive = position in the queue. */
  number: number;
  /** Optional structured node-level errors (validation only). */
  node_errors?: Record<string, unknown>;
}

export interface QueueState {
  /** Currently executing prompt(s). */
  queue_running: ReadonlyArray<readonly [number, string, ComfyGraph, Record<string, unknown>, string[]]>;
  /** Pending prompts, ordered by submission time. */
  queue_pending: ReadonlyArray<readonly [number, string, ComfyGraph, Record<string, unknown>, string[]]>;
}

export interface HealthStatus {
  /** Top-level system metadata (ComfyUI version, OS, etc.). */
  system: Record<string, unknown>;
  /** Per-device VRAM / utilisation if available. */
  devices?: Array<Record<string, unknown>>;
}

/**
 * ComfyUI's `/object_info` response. Each top-level key is a node class name
 * (e.g. `"CheckpointLoaderSimple"`) and the value enumerates input slots.
 *
 * The server reads two facets:
 *   - **presence of class names** (custom-node validation, FR-7).
 *   - **enum lists embedded in input slots** (model registry refresh, FR-10).
 */
export type NodeCatalog = Record<string, NodeClassInfo>;

export interface NodeClassInfo {
  input?: {
    required?: Record<string, NodeInputSpec>;
    optional?: Record<string, NodeInputSpec>;
  };
  output?: ReadonlyArray<string>;
  output_name?: ReadonlyArray<string>;
  category?: string;
  display_name?: string;
}

/**
 * A single input-slot specification. ComfyUI represents enumerated options
 * (e.g. checkpoint names) as `[ ["model_a.safetensors", "model_b.safetensors"], { ... } ]`.
 */
export type NodeInputSpec = readonly [string | ReadonlyArray<string>, Record<string, unknown>?];

// ---------------------------------------------------------------------------
// History (used by output-fetcher)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  prompt: unknown;
  outputs: Record<
    string,
    {
      images?: Array<{ filename: string; subfolder: string; type: string }>;
      [k: string]: unknown;
    }
  >;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: ReadonlyArray<unknown>;
  };
}

export type HistoryResponse = Record<string, HistoryEntry>;

// ---------------------------------------------------------------------------
// WebSocket events (the typed wrapper exposes these via ComfyEventEmitter)
// ---------------------------------------------------------------------------

export interface ComfyProgressEvent {
  prompt_id: string;
  node_id?: string;
  step: number;
  max_steps: number;
}

export interface ComfyExecutedEvent {
  prompt_id: string;
  outputs: Record<string, unknown>;
}

export interface ComfyExecutingEvent {
  prompt_id: string;
  /** `null` when the prompt has finished executing. */
  node_id: string | null;
}

export interface ComfyExecutionErrorEvent {
  prompt_id: string;
  message: string;
  cause?: unknown;
}

export interface ComfyExecutionCachedEvent {
  prompt_id: string;
  nodes: ReadonlyArray<string>;
}

export interface ComfyStatusEvent {
  /** Number of prompts currently queued. */
  exec_info: { queue_remaining: number };
}

/**
 * Discriminated union of every WS message kind the server interprets.
 * Anything else is logged at debug level and dropped.
 */
export type ComfyWsMessage =
  | { type: 'progress'; data: ComfyProgressEvent }
  | { type: 'executed'; data: ComfyExecutedEvent }
  | { type: 'executing'; data: ComfyExecutingEvent }
  | { type: 'execution_error'; data: ComfyExecutionErrorEvent }
  | { type: 'execution_cached'; data: ComfyExecutionCachedEvent }
  | { type: 'status'; data: ComfyStatusEvent };

// ---------------------------------------------------------------------------
// Required custom nodes (FR-7)
// ---------------------------------------------------------------------------

export interface RequiredNode {
  /** Display name used in error messages and logs. */
  readonly name: string;
  /** GitHub clone URL. */
  readonly repo: string;
  /**
   * Pinned commit hash (FR-7 + Q4). Updates are deliberate; CI runs against
   * pinned versions so a custom-node author publishing a breaking change
   * cannot break us silently.
   */
  readonly commit: string;
  /**
   * Characteristic node-class names used for presence detection on the
   * `/object_info` endpoint. Validation succeeds when **all** classes are
   * present.
   */
  readonly checks: ReadonlyArray<string>;
  /** Doc URL shown in actionable error messages. */
  readonly install_url: string;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  /** Populated when `ok: false`. */
  missing?: ReadonlyArray<RequiredNode>;
  /** Human-readable summary message (used for error events / logs). */
  message?: string;
}

// ---------------------------------------------------------------------------
// Health status surfaced through `get_server_info`
// ---------------------------------------------------------------------------

export type ComfyStatus = 'unknown' | 'healthy' | 'degraded' | 'unreachable';
