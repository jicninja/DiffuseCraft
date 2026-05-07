/**
 * Connection store types.
 *
 * The connection store is the ONLY persisted store (FR-7). Tokens are NEVER
 * placed in the in-memory state; only the handle (backend id) lives there.
 * Tokens are fetched on demand via the secure-token wrapper (FR-9, FR-18).
 */

/**
 * Connection status enum exposed to the rest of the app. The legacy stub
 * shape used a coarser vocabulary (`'no-paired' | 'paired-no-active' |
 * 'connected'`); the spec requires a richer set
 * (`'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'`).
 *
 * To preserve backwards-compat with the existing chrome (apps/mobile router
 * and Settings.About debug card), the connection store also exposes a
 * derived `routerStatus` selector and `__debug*` actions that the stub
 * re-export wires through.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * A backend that has been paired and is known to the app.
 *
 * Provenance tracks how the device first met the backend (mDNS scan, QR
 * scan, or manual entry) — this is metadata only and does NOT change
 * behavior.
 *
 * `url` is the dial-able base URL (e.g. `http://192.168.1.42:7821`) used
 * by the SDK's HTTP transport to reach this backend on subsequent app
 * launches. Without it, paired entries are unrecoverable handles —
 * `id` + `name` alone do not identify a network endpoint.
 */
export interface PairedBackend {
  id: string;
  name: string;
  /** ISO timestamp of the most recent successful connection. */
  lastConnectedAt: string | null;
  /** Discovery origin of the pairing event. */
  origin: 'mdns' | 'qr' | 'manual' | 'code';
  /** Base URL the SDK dials when re-connecting to this backend. */
  url: string;
}

/** Input to `pairBackend` — same as PairedBackend minus derived fields. */
export interface NewPairedBackend {
  id: string;
  name: string;
  origin: 'mdns' | 'qr' | 'manual' | 'code';
  /** Base URL the SDK will dial. Required so the backend is re-reachable. */
  url: string;
}

/**
 * A backend currently visible on the local network. Volatile — refreshed by
 * the SDK on demand (FR-17, mDNS scan results).
 */
export interface DiscoveredBackend {
  id: string;
  name: string;
  host: string;
  port: number;
  version: string | null;
}

/** Connection-level error surfaced to UI. */
export interface ConnectionError {
  code: string;
  message: string;
  /** ISO timestamp the error was observed. */
  observedAt: string;
}

/**
 * The persisted shape of the connection store. Tokens NEVER appear here.
 * `partialize` enforces this.
 */
export interface PersistedConnectionState {
  pairedBackends: PairedBackend[];
  currentBackendId: string | null;
}

/**
 * Coarse router-friendly status used by `apps/mobile`'s root router. Derived
 * from the rich connection status + paired-backends list. Backwards-compat
 * with the connection-store stub's vocabulary.
 */
export type RouterConnectionStatus =
  | 'unknown'
  | 'no-paired'
  | 'paired-no-active'
  | 'connected';

/** Lightweight summary the UI uses to display backend lists. */
export interface PairedServerSummary {
  id: string;
  name: string;
}

/**
 * The full in-memory state of the connection store (state + actions).
 */
export interface ConnectionState {
  // ---- persisted ----
  pairedBackends: PairedBackend[];
  currentBackendId: string | null;

  // ---- volatile ----
  connectionStatus: ConnectionStatus;
  lastError: ConnectionError | null;
  discoveredBackends: DiscoveredBackend[];

  // ---- mutators ----
  /**
   * Pair a backend. Persists `pairedBackends` and stores the raw token in the
   * platform secure store (NOT in in-memory state).
   */
  pairBackend(backend: NewPairedBackend, rawToken: string): Promise<void>;
  /** Remove a paired backend; also clears its token from the secure store. */
  removeBackend(id: string): Promise<void>;
  /** Switch the active backend. */
  setCurrentBackend(id: string | null): void;
  /** Replace the discovered-backends list with the given snapshot. */
  setDiscoveredBackends(list: ReadonlyArray<DiscoveredBackend>): void;
  /** Update the connection status (called by the SDK lifecycle). */
  setConnectionStatus(status: ConnectionStatus, error?: ConnectionError | null): void;
  /**
   * Asynchronously fetch the token for a paired backend from the secure
   * store. Tokens NEVER hydrate into in-memory state (FR-18).
   */
  getToken(backendId: string): Promise<string | null>;

  // ---- legacy bridge: used by the connection-store stub re-export so the
  // existing chrome (apps/mobile router + Settings.About debug card)
  // continues to work without changes. Will be removed when the SDK lands
  // and screens migrate to the new vocabulary.
  // ----------------------------------------------------------------------
  /**
   * Coarse router status, derived from paired list + current id +
   * connection status. Reflects the original stub semantics:
   *   no paired → 'no-paired'
   *   paired but none active → 'paired-no-active'
   *   active connection → 'connected'
   *   pre-hydration cold-start → 'unknown' (never set after hydration completes)
   */
  routerStatus: RouterConnectionStatus;
  /** Convenience selector: paired backends as a router-friendly summary. */
  pairedSummaries: ReadonlyArray<PairedServerSummary>;

  /** Debug-only setter; mirrors stub `__debugSetStatus`. */
  __debugSetStatus(status: RouterConnectionStatus): void;
  /** Debug-only setter; mirrors stub `__debugSetServers`. */
  __debugSetServers(servers: ReadonlyArray<PairedServerSummary>): void;
  /** Debug-only cycle — walks no-paired → paired-no-active → connected. */
  __debugCycle(): void;
}
