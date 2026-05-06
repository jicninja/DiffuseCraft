/**
 * Optimistic update helper.
 *
 * Per FR-12 / FR-13 and design §6, fast/reversible client mutations apply
 * immediately and revert on server-side failure. Stores call this helper to
 * keep the apply / revert / surface-error pattern uniform.
 *
 * Usage shape:
 *
 * ```ts
 * await runOptimistic({
 *   apply: () => set({ ... }),
 *   commit: () => client.invokeTool('update_layer', { ... }),
 *   revert: () => set({ ... }),
 * });
 * ```
 *
 * If `commit` rejects, `revert` runs and the original error rethrows so the
 * calling component can surface it (e.g., via toast).
 */

export interface OptimisticOptions<T> {
  /** Apply the speculative state immediately. */
  apply: () => void;
  /** Server-side commit. Must throw on failure. */
  commit: () => Promise<T>;
  /** Revert the speculative state. Called only on commit failure. */
  revert: () => void;
}

export async function runOptimistic<T>(opts: OptimisticOptions<T>): Promise<T> {
  opts.apply();
  try {
    return await opts.commit();
  } catch (err) {
    opts.revert();
    throw err;
  }
}
