/**
 * Shared store-side types used by multiple store modules.
 *
 * These are local to the client-state architecture and are NOT the canonical
 * MCP catalog types — those live in @diffusecraft/mcp-tools and will be
 * re-imported once the client-sdk lands. Until then, store actions log
 * `// TODO(client-sdk)` markers where they would call the SDK.
 */

/**
 * A minimal client handle injected into stores by the StoresProvider.
 *
 * The real `DiffuseCraftClient` lives in `@diffusecraft/diffusion-client` and
 * will be specified by the `client-sdk` spec. Until then, stores accept a
 * structurally-typed minimal surface so they can be tested with a mock.
 *
 * TODO(client-sdk): replace with the real client surface when available.
 */
export interface DiffuseCraftClientLike {
  /**
   * Subscribe to typed server events. Returns an unsubscribe function.
   */
  events: {
    subscribe(
      handler: (event: ServerEvent) => void,
    ): () => void;
  };
  /**
   * Invoke an MCP tool by name. Returns the raw response. Stores treat
   * thrown errors as failures.
   */
  invokeTool<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
  ): Promise<TResult>;
  /**
   * Read a `diffusecraft://` resource URI. Stores use this to hydrate
   * paginated lists (models, presets, history) instead of round-tripping
   * a list_* tool. Thrown errors are treated as failures.
   */
  readResource<TResult = unknown>(uri: string): Promise<TResult>;
}

/**
 * Server-emitted event envelope mirroring the names registered on the
 * server-side event bus (`libs/server/src/lib/events/bus.ts`).
 */
export type ServerEvent =
  | { name: 'job.progress'; payload: JobProgressPayload }
  | { name: 'job.completed'; payload: JobCompletedPayload }
  | { name: 'document.changed'; payload: DocumentChangedPayload }
  | { name: 'model.download.progress'; payload: ModelDownloadProgressPayload }
  | { name: 'audit.entry'; payload: AuditEntryPayload };

export interface JobProgressPayload {
  job_id: string;
  progress: number; // 0..1
  eta_seconds?: number;
  step?: string;
}

export interface JobCompletedPayload {
  job_id: string;
  outcome: 'success' | 'failed' | 'cancelled';
  error?: { code: string; message: string };
}

export interface DocumentChangedPayload {
  document_id: string;
  /**
   * Coarse-grained change kind — the client mirror reconciles slices based on
   * which area changed. Specific shapes are defined where they're used.
   */
  change: DocumentChange;
}

export type DocumentChange =
  | { kind: 'layers'; layers: ReadonlyArray<LayerSnapshot> }
  | { kind: 'selection'; selection: SelectionSnapshot }
  | { kind: 'history'; itemsAdded: ReadonlyArray<HistoryItemSnapshot> };

export interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export type SelectionSnapshot =
  | { kind: 'none' }
  | { kind: 'rect'; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'lasso'; points: ReadonlyArray<{ x: number; y: number }> }
  | { kind: 'mask'; mask_uri: string };

export interface ModelDownloadProgressPayload {
  model_id: string;
  bytes_downloaded: number;
  bytes_total: number;
}

export interface AuditEntryPayload {
  timestamp: string;
  token_name: string;
  operation: string;
  outcome: 'ok' | 'error';
}

/**
 * History item mirror — clients display thumbnails and apply/discard items.
 */
export interface HistoryItemSnapshot {
  id: string;
  document_id: string;
  created_at: string;
  thumbnail_uri: string | null;
  applied: boolean;
  discarded: boolean;
}
