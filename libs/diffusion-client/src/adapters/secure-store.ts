/**
 * `SecureStoreAdapter` (G.1, design.md §2 / §12, requirements §3.7 FR-22 +
 * §3.8 FR-26 / FR-28).
 *
 * The pluggable seam through which the SDK persists pairing tokens between
 * sessions. Concrete implementations live in consumer packages so the SDK
 * stays platform-neutral:
 *
 *   - `apps/mobile` (RN/Expo) wraps `expo-secure-store` (Keychain on iOS,
 *     Keystore on Android — token bytes never leave secure hardware).
 *   - MeshCraft (Electron) wraps `safeStorage.encryptString(...)` /
 *     `decryptString(...)` (DPAPI on Windows, Keychain on macOS, libsecret
 *     on Linux).
 *   - Tests + Node-side use the {@link InMemorySecureStoreAdapter} default
 *     declared below (FR-28).
 *
 * ## Why a separate file from `config.ts`?
 *
 * `config.ts` declares a `SecureStoreAdapter` placeholder typed against
 * `Promise<string | null>` so the Zod schema can route consumer-supplied
 * adapters through the validated `ClientConfig.adapters.secureStore` slot
 * without taking a runtime dependency on a real implementation. This file
 * is the *runtime* contract used by the connection layer (K.2) and by the
 * `TokenStore` helper in `shared/token-provider.ts`. The two declarations
 * are structurally identical and aliased via a re-export in `config.ts`'s
 * upstream so either import path produces the same type.
 *
 * ## Lifecycle
 *
 *   - `get(key)`: returns the previously-stored cleartext value, or `null`
 *     when no entry exists. MUST NOT throw on missing keys — `null` is the
 *     canonical "absent" signal so callers can use `?? null` chains
 *     without try/catch noise.
 *   - `set(key, value)`: persist `value` against `key`, replacing any prior
 *     entry. Implementations are free to debounce / batch but MUST resolve
 *     only after the underlying secure store has acknowledged the write.
 *   - `delete(key)`: best-effort removal. MUST NOT throw when the key is
 *     already absent (idempotent).
 *
 * ## Thread / async safety
 *
 * The SDK calls these methods at well-defined moments (token persist after
 * pairing, token load on transport construction, token clear on
 * disconnect-and-forget). Implementations are NOT required to serialize
 * concurrent writes against the same key — the SDK only ever issues one
 * outstanding mutation at a time per token slot.
 */

/**
 * Pluggable secure-token storage. See module-level doc for the full
 * lifecycle contract.
 */
export interface SecureStoreAdapter {
  /** Read the value stored under `key`, or `null` when absent. */
  get(key: string): Promise<string | null>;
  /** Persist `value` under `key`, replacing any prior entry. */
  set(key: string, value: string): Promise<void>;
  /** Best-effort remove `key`; idempotent when the key is already absent. */
  delete(key: string): Promise<void>;
}

/**
 * In-memory default supplied for tests, Node-side use, and the
 * MeshCraft-as-MCP-client path before the host wires its real Electron
 * `safeStorage` adapter (requirements FR-28). Holds entries in a process-
 * scoped {@link Map}; nothing leaves memory.
 *
 * ## Suitability
 *
 * - Tests: yes — the SDK's `client-state-architecture` harness installs
 *   one of these and asserts against the recorded calls.
 * - Production tablet: NO — tokens MUST persist across app restarts; use
 *   `expo-secure-store` or equivalent.
 * - Production MeshCraft: NO — same reason; use Electron `safeStorage`.
 *
 * The class is exported (rather than constructed lazily inside the SDK)
 * so consumers can opt into it explicitly with a clear name in their
 * config rather than relying on an implicit fallback.
 */
export class InMemorySecureStoreAdapter implements SecureStoreAdapter {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
