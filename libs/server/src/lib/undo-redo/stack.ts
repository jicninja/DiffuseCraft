/**
 * Per-`(token, document)` undo/redo stack with snapshot anchoring
 * (undo-redo-system task A.2).
 *
 * Implements requirements.md §3.2 (FR-4..FR-9: per-client per-document
 * stacks) and §3.3 (FR-10..FR-12: snapshot policy) per design.md §4.
 *
 * Scope of this file:
 *   - The {@link ClientDocumentStack} class itself.
 *   - The {@link CommandSummary} projection (FR-21) plus the local
 *     `toSummary` helper that flattens a `Command<unknown>` into it.
 *   - A v1-grade {@link estimateBytes} helper for {@link totalMemoryBytes}.
 *
 * Out of scope:
 *   - The {@link UndoRedoManager} (task A.3) — intentionally NOT
 *     imported from `manager.ts` here. The legacy `Command` interface in
 *     `manager.ts` predates A.1 and is not the shape this stack speaks.
 *   - Eviction policy (Phase B) — `totalMemoryBytes()` is a pure getter;
 *     no eviction logic lives here.
 *   - Snapshot capture / format — `DocumentSnapshot` is an opaque alias
 *     for v1; task A.4 narrows the type.
 */

import type { Command } from './command.js';

// Re-export the doc-id alias so consumers of `stack.ts` don't need to
// reach into `command.ts` for it (design.md §4 keeps types co-located
// with the structures that use them).
export type { DocumentId } from './command.js';

/**
 * Opaque payload representing a full document snapshot at a point in
 * time. The actual shape is owned by Phase A.4 / future doc service —
 * this file treats it as a black box (`unknown`) and only counts bytes
 * via {@link estimateBytes} / `JSON.stringify` heuristics.
 *
 * Task A.4 narrows the type.
 */
export type DocumentSnapshot = unknown;

/**
 * A snapshot anchored to a specific position in the undo stack. The
 * `anchor_undo_index` is the index of the {@link Command} in the undo
 * array at the moment of capture (i.e., `undo.length - 1` after the
 * triggering push). When the manager rewinds past this index it can
 * restore from the snapshot rather than invoking each `Command.revert`.
 */
export interface SnapshotEntry {
  /** Index in the undo stack the snapshot is anchored to. */
  readonly anchor_undo_index: number;
  /** The captured opaque payload. */
  readonly snapshot: DocumentSnapshot;
}

/**
 * UI / audit projection of a {@link Command}. Implements requirements.md
 * FR-21: only `id`, `tool_name`, `args_summary`, `created_at` are
 * exposed — never `apply` / `revert`.
 */
export interface CommandSummary {
  readonly id: string;
  readonly tool_name: string;
  readonly args_summary: string;
  readonly created_at: string;
}

/** Project a {@link Command} into a {@link CommandSummary}. */
const toSummary = (cmd: Command<unknown>): CommandSummary => ({
  id: cmd.id,
  tool_name: cmd.tool_name,
  args_summary: cmd.args_summary,
  created_at: cmd.created_at,
});

/**
 * Type guard for inputs we believe are entries the stack manages
 * (commands or snapshot entries). Used solely by {@link estimateBytes}
 * to dispatch between the two heuristics.
 */
const isCommand = (x: unknown): x is Command<unknown> =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { id?: unknown }).id === 'string' &&
  typeof (x as { tool_name?: unknown }).tool_name === 'string' &&
  typeof (x as { args_summary?: unknown }).args_summary === 'string';

const isSnapshotEntry = (x: unknown): x is SnapshotEntry =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { anchor_undo_index?: unknown }).anchor_undo_index === 'number';

/**
 * Heuristic byte-count for one entry the stack tracks.
 *
 *   - For a {@link Command}: roughly `args_summary.length * 2` (UTF-16
 *     code units in V8) plus a 256-byte fixed overhead covering id,
 *     tool_name, created_at, weight, and the apply/revert closure
 *     identities. The actual revert payload (if any) lives in the
 *     handler's closure and is intentionally not measured here — that's
 *     Phase B's job once the eviction policy needs precise numbers.
 *
 *   - For a {@link SnapshotEntry}: `JSON.stringify(snapshot).length * 2`
 *     when the payload is JSON-shaped (most v1 cases). Falls back to a
 *     flat `1024` bytes when the payload contains a non-serializable
 *     value (functions, BigInt, cycles, etc.). The fallback is a
 *     deliberate over-estimate of "small" so eviction will eventually
 *     drop these even without perfect sizing.
 *
 * Returns `0` for an entry of an unknown shape — the totals stay
 * monotonic, never negative.
 */
const estimateOne = (item: unknown): number => {
  if (isCommand(item)) {
    return item.args_summary.length * 2 + 256;
  }
  if (isSnapshotEntry(item)) {
    try {
      const json = JSON.stringify(item.snapshot);
      if (typeof json === 'string') return json.length * 2;
    } catch {
      // fall through — non-serializable
    }
    return 1024;
  }
  return 0;
};

/**
 * Sum of {@link estimateOne} over a list of entries. Exposed locally
 * (not exported) per design.md §4 — the helper is a stack-internal
 * detail, not a public surface.
 */
const estimateBytes = (items: readonly unknown[]): number => {
  let total = 0;
  for (const item of items) total += estimateOne(item);
  return total;
};

/**
 * Per-`(token, document)` stack of {@link Command}s with snapshot
 * anchoring. Owns three internal arrays:
 *
 *   - `undo`  — chronological (oldest at index 0, newest at end).
 *   - `redo`  — chronological (newest at end). Cleared on every fresh
 *               {@link push} (FR-8: no branching in v1).
 *   - `snapshots` — anchored to undo positions, append-only here. Phase
 *                   B's eviction policy reads/mutates this.
 *
 * Public methods are O(1) for push / popUndo / popRedo, and O(N) for
 * the summary projections (`N` ≤ `maxDepth`).
 */
export class ClientDocumentStack {
  private readonly undo: Command<unknown>[] = [];
  private readonly redo: Command<unknown>[] = [];
  private readonly snapshots: SnapshotEntry[] = [];

  constructor(
    private readonly token_name: string,
    private readonly document_id: string,
    private readonly maxDepth: number,
    private readonly snapshotEvery: number,
  ) {}

  /**
   * Push a {@link Command} onto the undo stack. Implements FR-5 (push
   * appends to undo), FR-8 (clear redo on fresh op), FR-9 (depth cap),
   * and FR-10 (snapshot anchoring every `snapshotEvery` ops).
   *
   * `currentSnapshot` is consulted only when both:
   *   1. the new undo length is a multiple of `snapshotEvery`, AND
   *   2. a payload was supplied.
   *
   * Omit `currentSnapshot` to skip anchoring (e.g., on synthetic pushes
   * during tests, or when snapshot capture is async and pending).
   */
  push(command: Command<unknown>, currentSnapshot?: DocumentSnapshot): void {
    this.undo.push(command);
    // FR-8: pushing a fresh op invalidates the redo branch.
    this.redo.length = 0;

    // FR-9: cap depth, evicting from the bottom (oldest first).
    if (this.undo.length > this.maxDepth) {
      this.undo.shift();
      // Snapshots whose anchor index has slid below 0 are now stale
      // (anchor_undo_index < 0 conceptually); shift each surviving
      // snapshot down by one to keep them aligned, dropping any that
      // would land before the start of the array.
      // Phase B handles richer snapshot pruning — here we just keep
      // the data structure consistent.
      for (let i = this.snapshots.length - 1; i >= 0; i -= 1) {
        const next = this.snapshots[i]!.anchor_undo_index - 1;
        if (next < 0) {
          this.snapshots.splice(i, 1);
        } else {
          this.snapshots[i] = {
            anchor_undo_index: next,
            snapshot: this.snapshots[i]!.snapshot,
          };
        }
      }
    }

    // FR-10: anchor a snapshot every N pushes.
    if (
      currentSnapshot !== undefined &&
      this.undo.length > 0 &&
      this.undo.length % this.snapshotEvery === 0
    ) {
      this.snapshots.push({
        anchor_undo_index: this.undo.length - 1,
        snapshot: currentSnapshot,
      });
    }
  }

  /**
   * Pop the newest {@link Command} from the undo stack onto the redo
   * stack. Returns `undefined` if undo is empty (FR-6: caller treats
   * undefined as `{ no_op: true }`).
   *
   * Note this method does NOT call `revert()` — the manager (A.3) is
   * responsible for invoking `revert()` and emitting events. The stack
   * is purely a data structure.
   */
  popUndo(): Command<unknown> | undefined {
    const cmd = this.undo.pop();
    if (cmd) this.redo.push(cmd);
    return cmd;
  }

  /**
   * Pop the newest {@link Command} from the redo stack onto the undo
   * stack. Returns `undefined` if redo is empty (FR-7).
   */
  popRedo(): Command<unknown> | undefined {
    const cmd = this.redo.pop();
    if (cmd) this.undo.push(cmd);
    return cmd;
  }

  /** Newest-first projection of the undo stack (FR-21). */
  getUndoSummary(): CommandSummary[] {
    const out: CommandSummary[] = [];
    for (let i = this.undo.length - 1; i >= 0; i -= 1) {
      out.push(toSummary(this.undo[i]!));
    }
    return out;
  }

  /** Newest-first projection of the redo stack. */
  getRedoSummary(): CommandSummary[] {
    const out: CommandSummary[] = [];
    for (let i = this.redo.length - 1; i >= 0; i -= 1) {
      out.push(toSummary(this.redo[i]!));
    }
    return out;
  }

  /**
   * Total estimated bytes across `undo`, `redo`, and `snapshots` per
   * the {@link estimateBytes} heuristics. Phase B reads this to decide
   * eviction; A.2 only exposes it as a getter.
   */
  totalMemoryBytes(): number {
    return (
      estimateBytes(this.undo) +
      estimateBytes(this.redo) +
      estimateBytes(this.snapshots)
    );
  }

  /**
   * Number of anchored snapshots. Test-facing; kept on the public
   * surface because Phase B's eviction policy needs it too (read-only).
   */
  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  /**
   * Current undo-stack length (number of {@link Command}s registered,
   * not counting redo). Used by {@link UndoRedoManager.maybeSnapshot}
   * to decide whether the next {@link push} will land on a snapshot
   * cadence boundary (FR-10): if `(peekUndoLength() + 1) %
   * snapshotEvery === 0`, the manager captures and forwards a snapshot
   * payload so the post-push length is a multiple of `snapshotEvery`.
   */
  peekUndoLength(): number {
    return this.undo.length;
  }

  /**
   * Read a snapshot entry by its position in the snapshot array (oldest
   * first). Returns `undefined` for out-of-range indices.
   */
  getSnapshotAt(index: number): SnapshotEntry | undefined {
    return this.snapshots[index];
  }

  /**
   * Symmetric to {@link peekUndoLength} — returns the current redo-stack
   * length. Phase B's eviction policy reads this to surface redo memory
   * in future tuning passes; v1 only acts on undo + snapshots, but the
   * accessor is exposed for parity / observability (e.g., redo telemetry
   * in `undo.eviction` events when v2 starts evicting redo too).
   */
  peekRedoLength(): number {
    return this.redo.length;
  }

  /**
   * Drop the oldest snapshot anchor (`snapshots[0]`) and return whether
   * one was present. Used exclusively by Phase B's
   * {@link import('./eviction.js').EvictionPolicy} during the
   * snapshot-first eviction pass (FR-27): the policy iteratively drops
   * the oldest snapshot across all stacks until total memory ≤ budget OR
   * no snapshots remain.
   *
   * Does NOT touch the undo / redo arrays — the snapshots are pure
   * "fast-restore anchors", and dropping one only forces a longer revert
   * chain on undo, never breaks correctness.
   */
  evictOldestSnapshot(): boolean {
    if (this.snapshots.length === 0) return false;
    this.snapshots.shift();
    return true;
  }

  /**
   * Drop the oldest command (`undo[0]`) — the second-pass eviction step
   * after all snapshots are gone (FR-27). Mirrors the eviction logic
   * inside {@link push} when `undo.length > maxDepth`: every surviving
   * snapshot's `anchor_undo_index` is decremented by 1, and any whose
   * anchor would land below 0 are dropped.
   *
   * Returns the dropped command (or `undefined` if undo was empty). The
   * caller may use the return for telemetry; the eviction policy itself
   * only cares about the depth decrement.
   *
   * Implementation note: we re-walk `snapshots` from the end so an
   * in-place `splice` while iterating doesn't desync indices.
   */
  shiftOldestUndo(): Command<unknown> | undefined {
    const cmd = this.undo.shift();
    if (!cmd) return undefined;
    for (let i = this.snapshots.length - 1; i >= 0; i -= 1) {
      const next = this.snapshots[i]!.anchor_undo_index - 1;
      if (next < 0) {
        this.snapshots.splice(i, 1);
      } else {
        this.snapshots[i] = {
          anchor_undo_index: next,
          snapshot: this.snapshots[i]!.snapshot,
        };
      }
    }
    return cmd;
  }

  /** The token this stack belongs to (key fragment). */
  getTokenName(): string {
    return this.token_name;
  }

  /** The document this stack belongs to (key fragment). */
  getDocumentId(): string {
    return this.document_id;
  }
}
