/**
 * Token-provider helpers (K.1 + K.2 + K.3, design.md §2 / §3 / §9 / §11,
 * requirements §3.2 FR-4 token slot, §3.7 FR-23 + §3.8 FR-26 / FR-27 /
 * FR-28 + §3.9 FR-29).
 *
 * Three concerns share this module because they're tightly coupled:
 *
 *   1. **{@link TokenCache} (K.1)** — a `~5 minute` cache around a
 *      {@link TokenProvider} so the SDK does not invoke the consumer's
 *      keychain hook on every request (FR-27). Cleared on
 *      reconnect / disconnect / explicit rotation.
 *
 *   2. **{@link TokenStore} (K.2)** — adapter-shaped persistence for
 *      pairing tokens. The pairing client (F.3) writes here after a
 *      successful claim; the connection store reads here on transport
 *      construction. Backed by a consumer-supplied
 *      {@link SecureStoreAdapter} (FR-26 / FR-28).
 *
 *   3. **{@link TokenRotationHook} (K.3)** — a lightweight observer
 *      surface for token rotations. The server's pairing manager
 *      already publishes `auth.token-rotated` (see
 *      `libs/server/src/lib/pairing/manager.ts → rotateToken`); the SDK
 *      side is a wired-in placeholder until the catalog adds a
 *      corresponding event / response header. When the wire-level
 *      mechanism lands, the connection layer calls
 *      {@link TokenRotationHook.notify} to fan out to listeners and to
 *      persist the new token via {@link TokenStore.save}.
 *
 * The three classes are intentionally small and side-effect-free except
 * where they cross the SecureStore boundary; tests for the higher-level
 * wiring (transport → cache → store → rotation) live with the eventual
 * `DiffuseCraftClient` (Phase B.6).
 */

import type { TokenProvider } from "../config.js";
import type { SecureStoreAdapter } from "../adapters/secure-store.js";

// ---------------------------------------------------------------------------
// K.1 — TokenCache
// ---------------------------------------------------------------------------

/**
 * Default TTL applied to {@link TokenCache} entries: five minutes
 * (FR-27 — "cached for ~5 minutes within a session"). Exposed so
 * downstream tests / harnesses can reference the canonical value
 * without redeclaring it.
 */
export const DEFAULT_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Process-local cache around a {@link TokenProvider} (K.1, FR-27). The
 * SDK's HTTP transport (B.3) instantiates one of these per session;
 * `resolve()` is idempotent and concurrency-safe (a parallel call while
 * the provider promise is in flight returns the same in-flight promise
 * instead of triggering a second invocation).
 *
 * The cache is intentionally simple — there is no LRU, no per-key
 * eviction, no concurrent-key support. A single `DiffuseCraftClient`
 * instance binds to a single backend (per Q2 / design §1) and therefore
 * holds at most one token at a time.
 *
 * ## Lifecycle
 *
 *   - Construct with the SDK's session-default TTL ({@link
 *     DEFAULT_TOKEN_CACHE_TTL_MS}).
 *   - {@link resolve}: returns the cached value when fresh; otherwise
 *     invokes the provider, caches the resolution, and returns it.
 *   - {@link invalidate}: drops the cached value. Called on
 *     `disconnect()`, on `connect()` (fresh connection lifecycle
 *     boundary), on reconnect failure, and on token rotation.
 *   - {@link prime}: pre-populates the cache with a known-good token.
 *     Used by the pairing flow (F.3) so the very first request after
 *     pairing does not re-prompt the secure store.
 */
export class TokenCache {
  private cached: { value: string; expires_at: number } | null = null;
  private inflight: Promise<string> | null = null;
  private readonly ttl_ms: number;
  private readonly now: () => number;

  constructor(opts: { ttl_ms?: number; now?: () => number } = {}) {
    this.ttl_ms = opts.ttl_ms ?? DEFAULT_TOKEN_CACHE_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Return the cached token if fresh; otherwise invoke `provider` and
   * cache the result for the configured TTL. Concurrent calls share a
   * single in-flight provider invocation.
   */
  async resolve(provider: TokenProvider): Promise<string> {
    const now = this.now();
    if (this.cached && now < this.cached.expires_at) {
      return this.cached.value;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const value = await provider();
        if (typeof value !== "string" || value.length === 0) {
          throw new Error("TokenProvider returned an empty token");
        }
        this.cached = { value, expires_at: this.now() + this.ttl_ms };
        return value;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /**
   * Pre-populate the cache with a known-good value (e.g. the token the
   * pairing flow just claimed). The TTL clock starts now so a freshly
   * primed token is treated as freshly resolved.
   */
  prime(value: string): void {
    if (typeof value !== "string" || value.length === 0) return;
    this.cached = { value, expires_at: this.now() + this.ttl_ms };
  }

  /**
   * Drop any cached value. Called on `disconnect()`, on reconnect
   * failure (so the next attempt re-resolves the token in case the
   * stored copy was stale), and on rotation.
   */
  invalidate(): void {
    this.cached = null;
  }

  /** Test/debug accessor — `true` when a fresh value is cached. */
  isFresh(): boolean {
    return this.cached !== null && this.now() < this.cached.expires_at;
  }
}

// ---------------------------------------------------------------------------
// K.2 — TokenStore
// ---------------------------------------------------------------------------

/**
 * Default storage key for the active session's bearer token. Namespaced
 * so other DiffuseCraft data sharing the same secure store does not
 * collide (Electron `safeStorage` and Keychain both expose a flat
 * key-value namespace).
 */
export const DEFAULT_TOKEN_STORAGE_KEY = "diffusecraft.client.token";

/**
 * Adapter-shaped persistence helper for pairing tokens (K.2, FR-26 /
 * FR-28). Wraps a consumer-supplied {@link SecureStoreAdapter} so the
 * connection layer has a stable surface that does not change shape when
 * the adapter implementation does.
 *
 * The class is intentionally narrow — `load`, `save`, `clear`. Higher-
 * level concerns (token rotation, multi-backend persistence) live with
 * {@link TokenRotationHook} and the future connection-store spec.
 */
export class TokenStore {
  private readonly adapter: SecureStoreAdapter;
  private readonly storageKey: string;

  constructor(
    adapter: SecureStoreAdapter,
    storageKey: string = DEFAULT_TOKEN_STORAGE_KEY,
  ) {
    this.adapter = adapter;
    this.storageKey = storageKey;
  }

  /** Read the persisted token, or `null` when no token is stored. */
  async load(): Promise<string | null> {
    return this.adapter.get(this.storageKey);
  }

  /** Persist `token` against the configured storage key, replacing any prior value. */
  async save(token: string): Promise<void> {
    return this.adapter.set(this.storageKey, token);
  }

  /** Remove the persisted token. Idempotent when absent. */
  async clear(): Promise<void> {
    return this.adapter.delete(this.storageKey);
  }

  /**
   * Build a {@link TokenProvider} that reads from this store on every
   * call. Combined with {@link TokenCache.resolve}, the keychain is
   * touched at most once per ~5 minutes (FR-27); the cache amortises
   * the secure-store hit. Throws when the store is empty so the HTTP
   * transport surfaces a clean failure rather than sending a request
   * with an empty `Authorization` header.
   */
  asProvider(): TokenProvider {
    return async (): Promise<string> => {
      const value = await this.adapter.get(this.storageKey);
      if (value === null || value.length === 0) {
        throw new Error(
          `TokenStore: no token persisted under key '${this.storageKey}'`,
        );
      }
      return value;
    };
  }
}

// ---------------------------------------------------------------------------
// K.3 — TokenRotationHook
// ---------------------------------------------------------------------------

/**
 * Observer payload for {@link TokenRotationHook}. Mirrors the
 * server-side `auth.token-rotated` event shape (see
 * `libs/server/src/lib/pairing/manager.ts → rotateToken`) plus the
 * cleartext `new_token` the server returns on the rotation request /
 * response. The cleartext is the only surface the SDK can act on — the
 * `*_token_id` fields are diagnostic.
 */
export interface TokenRotationEvent {
  /** Cleartext bearer token that replaces the previous one. */
  readonly new_token: string;
  /** Server-side token row id of the new token. Diagnostic. */
  readonly new_token_id?: string;
  /** Server-side token row id of the rotated-out token. Diagnostic. */
  readonly old_token_id?: string;
}

/** Listener registered with {@link TokenRotationHook.subscribe}. */
export type TokenRotationListener = (event: TokenRotationEvent) => void;

/**
 * Token-rotation observer + persistence fan-out (K.3, FR-23).
 *
 * ## Activation status
 *
 * The wire-level mechanism the SDK would react to — a server-pushed
 * notification or an `X-Diffusecraft-Token-Rotated` response header —
 * is NOT yet defined in `mcp-tool-catalog`'s event/header surface. The
 * server's `PairingManager.rotateToken` already publishes
 * `auth.token-rotated` to its in-process bus, but no transport-level
 * event delivery is wired today (the HTTP transport's `subscribe()`
 * throws `ConnectionError` for the same reason — see
 * `transports/http.ts → subscribe`).
 *
 * This class is therefore implemented as a fully-functional observer
 * on the SDK side. Once the catalog gains the rotation event /
 * header, the HTTP transport calls {@link notify} from its
 * notification handler; consumers register listeners via
 * {@link subscribe} (typically the connection store, which then drops
 * its in-memory copy and re-resolves on the next request) and the
 * configured {@link TokenStore} / {@link TokenCache} update through
 * {@link bindStore} / {@link bindCache}.
 *
 * ## Lifecycle
 *
 *   - Construct one per `DiffuseCraftClient` session.
 *   - Optionally bind a {@link TokenStore} via {@link bindStore} so
 *     rotations are persisted automatically.
 *   - Optionally bind a {@link TokenCache} via {@link bindCache} so
 *     rotations prime the in-memory cache without an extra trip
 *     through the secure store.
 *   - Consumers register listeners via {@link subscribe} for any
 *     side effects beyond persistence (audit log, UI toast).
 *   - The SDK calls {@link notify} when a rotation arrives on the
 *     wire; the hook persists, primes, and fans out in that order so
 *     listeners observe the new token already-stored.
 */
export class TokenRotationHook {
  private readonly listeners = new Set<TokenRotationListener>();
  private store: TokenStore | null = null;
  private cache: TokenCache | null = null;

  /**
   * Bind a {@link TokenStore}; rotations subsequently persist via
   * {@link TokenStore.save} before listeners are notified. Pass `null`
   * to unbind.
   */
  bindStore(store: TokenStore | null): void {
    this.store = store;
  }

  /**
   * Bind a {@link TokenCache}; rotations subsequently prime the cache
   * via {@link TokenCache.prime} before listeners are notified, so
   * the first request after rotation does not re-resolve through the
   * provider. Pass `null` to unbind.
   */
  bindCache(cache: TokenCache | null): void {
    this.cache = cache;
  }

  /**
   * Register a rotation listener. Returns an unregister callback.
   * Listener errors are caught and swallowed (a noisy listener must
   * not break the rotation pipeline); production hooks log via the
   * SDK-wide logger which Phase B.6 will thread through.
   */
  subscribe(listener: TokenRotationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply a rotation: persist via the bound {@link TokenStore},
   * prime the bound {@link TokenCache}, then fan out to listeners.
   * Persistence is awaited so listeners observe the updated store;
   * listener invocations are not awaited (fire-and-forget) so a slow
   * listener does not block the rotation pipeline.
   */
  async notify(event: TokenRotationEvent): Promise<void> {
    if (typeof event.new_token !== "string" || event.new_token.length === 0) {
      throw new Error("TokenRotationHook.notify: new_token must be a non-empty string");
    }

    if (this.store) {
      try {
        await this.store.save(event.new_token);
      } catch {
        // Swallow secure-store failures here; the bound cache and
        // listeners still observe the rotation so the in-flight
        // session can continue. The SDK-wide logger (B.6) surfaces
        // the failure when wired.
      }
    }
    if (this.cache) {
      this.cache.prime(event.new_token);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // See note above on listener errors.
      }
    }
  }

  /** Test/debug accessor — number of currently-registered listeners. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
