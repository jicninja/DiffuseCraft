/**
 * Secure-token wrapper.
 *
 * Per FR-9 / FR-18, raw tokens MUST live in the platform secure store
 * (`expo-secure-store` on iOS/Android), NEVER in plain AsyncStorage. The
 * store factory accepts a `SecureTokenAdapter` so that:
 *
 *   - apps/mobile injects the real expo-secure-store implementation;
 *   - tests inject the in-memory adapter exported here.
 *
 * The shape mirrors the subset of `expo-secure-store` we use, so the mobile
 * app can adapt by re-exporting `setItemAsync` / `getItemAsync` /
 * `deleteItemAsync`.
 */

export interface SecureTokenAdapter {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * In-memory adapter for tests and for hosts without secure storage. Each
 * call to this factory returns an isolated instance so tests don't bleed.
 */
export function createMemorySecureTokenAdapter(): SecureTokenAdapter {
  const map = new Map<string, string>();
  return {
    setItemAsync: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    getItemAsync: (key) => Promise.resolve(map.get(key) ?? null),
    deleteItemAsync: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

/** Build the secure-store key for a given backend id. */
export function tokenKey(backendId: string): string {
  return `diffusecraft.token.${backendId}`;
}
