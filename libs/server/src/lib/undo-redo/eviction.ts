/**
 * Memory-budget eviction policy for the undo/redo subsystem
 * (undo-redo-system tasks B.1–B.4).
 *
 * Implements requirements.md §3.8:
 *
 *   - **FR-27** — Total undo memory across all `(token, document)` pairs
 *     SHALL be bounded by `ServerConfig.undo.max_total_memory_bytes`
 *     (default 512 MiB). On overflow, evict oldest snapshots first; if
 *     still over budget, evict oldest Commands starting from the
 *     **bottom** of the deepest stacks. A floor of `floor_ops_per_stack`
 *     ops (default 5) is preserved per stack so users never lose recent
 *     undo.
 *
 *   - **FR-28** — When eviction occurs, emit `undo.eviction { token_id,
 *     document_id, ops_evicted }` for observability.
 *
 *   - **FR-29** — Per-Command revert payload ≤ 16 MiB (the manager's
 *     responsibility at execute-time; eviction reacts to the aggregate).
 *
 * Wiring: {@link UndoRedoManager}'s constructor instantiates one
 * `EvictionPolicy`, passing a read-only view of its `stacks` map plus
 * the event bus. A 30-second `setInterval` in the manager calls
 * {@link EvictionPolicy.run}; `discardAll` clears the interval.
 *
 * **Module-private surface.** Not exported from `./index.ts`. Only the
 * manager is intended to construct or invoke this policy; tests + tuning
 * dashboards reach in via the manager.
 */

import type { ClientDocumentStack } from './stack.js';
import type { EventBus } from '../events/bus.js';

/**
 * Subset of the manager's resolved config that the policy needs.
 * Keeping this narrow (rather than coupling to `ResolvedConfig`) makes
 * the policy independently testable and avoids a circular import.
 */
export interface EvictionConfig {
  /** Total memory budget across all stacks (bytes). */
  readonly max_total_memory_bytes: number;
  /**
   * Minimum number of commands preserved per stack during eviction.
   * Below this depth, {@link EvictionPolicy.run} stops dropping ops
   * from a stack — recent undo is never sacrificed. Default 5.
   */
  readonly floor_ops_per_stack: number;
}

/**
 * Constructor options for {@link EvictionPolicy}.
 */
export interface EvictionPolicyOptions {
  /**
   * Read-only view of the manager's `stacks` map. The policy iterates
   * for budget calculation + locates the deepest stack, and calls
   * mutation methods on individual stack values
   * ({@link ClientDocumentStack.evictOldestSnapshot} /
   * {@link ClientDocumentStack.shiftOldestUndo}). The map itself is
   * never mutated by the policy — only its values.
   */
  readonly stacks: ReadonlyMap<string, ClientDocumentStack>;
  /**
   * Optional event bus for `undo.eviction` emissions. When omitted, the
   * policy still evicts but emits nothing (handy for unit tests + the
   * legacy adapter that does not pass a bus).
   */
  readonly bus?: EventBus | undefined;
  readonly config: EvictionConfig;
}

/**
 * Stateless (modulo input refs) memory-budget enforcer. {@link run} is
 * synchronous + idempotent: calling it when memory is under budget is a
 * cheap no-op (one pass over the stacks to sum bytes).
 */
export class EvictionPolicy {
  private readonly stacks: ReadonlyMap<string, ClientDocumentStack>;
  private readonly bus: EventBus | undefined;
  private readonly config: EvictionConfig;

  constructor(options: EvictionPolicyOptions) {
    this.stacks = options.stacks;
    this.bus = options.bus;
    this.config = options.config;
  }

  /**
   * Run one eviction pass. Per design.md §6:
   *
   *   1. Sum total memory across every stack. If ≤ budget → return.
   *   2. **Snapshot pass.** While total > budget AND any stack has at
   *      least one anchored snapshot, drop the single oldest snapshot
   *      across all stacks. Snapshots are pure "fast-restore anchors";
   *      removing them is correct (revert chains lengthen) and cheap.
   *   3. **Command pass.** While total > budget:
   *        - Find the stack with the deepest combined `undo.length`.
   *        - If its depth ≤ `floor_ops_per_stack`, STOP — every stack
   *          is at the floor and we cannot evict further without losing
   *          recent ops.
   *        - Otherwise, drop its oldest command + emit
   *          `undo.eviction { token_id, document_id, ops_evicted: 1 }`.
   *   4. Return when total ≤ budget OR floor reached.
   *
   * The total is recomputed after every drop so the policy reacts to
   * memory the deletion actually freed (a `JSON.stringify`-based
   * snapshot heuristic can be wildly skewed for one snapshot vs.
   * another). Cost: O(N × S) worst-case where N = stacks and
   * S = single-stack ops; N is small (a few tokens × a few docs each)
   * and the loop converges quickly because each iteration strictly
   * decreases total bytes.
   */
  run(): void {
    let total = this.totalMemory();
    if (total <= this.config.max_total_memory_bytes) return;

    // Pass 1 — snapshots.
    while (total > this.config.max_total_memory_bytes) {
      const oldest = this.findOldestSnapshotStack();
      if (!oldest) break;
      const dropped = oldest.stack.evictOldestSnapshot();
      if (!dropped) break;
      total = this.totalMemory();
    }

    // Pass 2 — commands from the deepest stack with floor preservation.
    while (total > this.config.max_total_memory_bytes) {
      const deepest = this.findDeepestStack();
      if (!deepest) break;
      if (deepest.depth <= this.config.floor_ops_per_stack) break;

      const removed = deepest.stack.shiftOldestUndo();
      if (!removed) break;

      const { token_id, document_id } = splitStackKey(deepest.key);
      this.publishEviction(token_id, document_id, 1);

      total = this.totalMemory();
    }
  }

  /** Sum of {@link ClientDocumentStack.totalMemoryBytes} across all stacks. */
  private totalMemory(): number {
    let total = 0;
    for (const stack of this.stacks.values()) {
      total += stack.totalMemoryBytes();
    }
    return total;
  }

  /**
   * Locate the stack whose `snapshots[0]` is the oldest in the system.
   *
   * v1 simplification: we don't compare snapshot timestamps across
   * stacks (snapshots are not stamped). Instead, "oldest" reduces to
   * "any stack that has at least one snapshot" — the choice of which
   * stack-to-drop-from on each pass is unspecified by the design but
   * always converges (every drop strictly reduces total bytes; the
   * loop terminates when none remain).
   *
   * We pick the first stack iterated by the underlying Map, which
   * preserves insertion order (oldest stack first per the
   * `getOrCreateStack` create-on-first-use semantics in the manager).
   * That gives a roughly FIFO-by-stack eviction across passes — close
   * enough to "oldest" for v1.
   */
  private findOldestSnapshotStack():
    | { key: string; stack: ClientDocumentStack }
    | undefined {
    for (const [key, stack] of this.stacks) {
      if (stack.getSnapshotCount() > 0) {
        return { key, stack };
      }
    }
    return undefined;
  }

  /**
   * Locate the stack with the greatest `peekUndoLength()`. Ties broken
   * by Map iteration order (i.e., the older-inserted stack wins). The
   * eviction policy walks every stack on every call; with N stacks ≤ a
   * few hundred in practice this is well below the 30-s tick budget.
   */
  private findDeepestStack():
    | { key: string; depth: number; stack: ClientDocumentStack }
    | undefined {
    let best:
      | { key: string; depth: number; stack: ClientDocumentStack }
      | undefined;
    for (const [key, stack] of this.stacks) {
      const depth = stack.peekUndoLength();
      if (!best || depth > best.depth) {
        best = { key, depth, stack };
      }
    }
    return best;
  }

  /**
   * Emit `undo.eviction { token_id, document_id, ops_evicted }`
   * (FR-28). When no bus is wired, the call is a silent no-op — the
   * eviction itself still happens, just without observability.
   */
  private publishEviction(
    token_id: string,
    document_id: string,
    ops_evicted: number,
  ): void {
    if (!this.bus) return;
    this.bus.publish({
      name: 'undo.eviction',
      payload: { token_id, document_id, ops_evicted },
    });
  }
}

/**
 * Split a stack-map key into `{ token_id, document_id }`. The manager
 * keys stacks as `${tokenId}:${documentId}` (and legacy stacks as
 * `${tokenName}:${documentId}` — same shape from this module's POV).
 *
 * Both halves are ULID-shaped (or tokenName-shaped) strings without
 * colons in v1, so a `split(':')` on the FIRST colon is unambiguous.
 * If a future scheme introduces colons in either half, this helper +
 * the manager's keying convention move together.
 *
 * On a malformed key (no colon), returns the whole key as `token_id`
 * and an empty `document_id`. The eviction event still fires with the
 * available data — observability never blocks correctness.
 */
function splitStackKey(key: string): { token_id: string; document_id: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { token_id: key, document_id: '' };
  return {
    token_id: key.slice(0, idx),
    document_id: key.slice(idx + 1),
  };
}
