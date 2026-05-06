/**
 * `UndoRedoManager` (undo-redo-system task A.3).
 *
 * Implements requirements.md §3.1 (FR-1..FR-3 Command pattern), §3.2
 * (FR-4..FR-9 per-`(token, document)` stacks), §3.4 (FR-13..FR-15 emit
 * semantics — conflict detection itself is Phase E), §3.5 (FR-16..FR-18
 * reversibility scope — surface only), and §3.7 (FR-24..FR-26 stack
 * discard rules) per design.md §5.
 *
 * Two surfaces coexist on this class during the migration cascade:
 *
 *   1. **The new surface** (this task) targets the parametric
 *      {@link Command} from `./command.js`:
 *
 *        - {@link UndoRedoManager.execute} — apply + push + emit.
 *        - {@link UndoRedoManager.undo} / {@link UndoRedoManager.redo} —
 *          new `(token_name, token_id, document_id)` signature.
 *        - {@link UndoRedoManager.discardForToken},
 *          {@link UndoRedoManager.onTokenDisconnect},
 *          {@link UndoRedoManager.onTokenReconnect} — lifecycle hooks
 *          (Phase G owns the actual transport/connection wiring; this
 *          file just exposes the entry points and a deterministic timer
 *          shim for tests).
 *        - {@link UndoRedoManager.getUndoStack} /
 *          {@link UndoRedoManager.getRedoStack} — `CommandSummary[]`
 *          projections (FR-21).
 *
 *   2. **The legacy surface** (preserved verbatim for ABI compatibility
 *      until Phase F migrates the 12 existing handlers + the
 *      `reversibleCommandMw` middleware off it):
 *
 *        - {@link UndoRedoManager.enrol} — push a legacy
 *          `{revert, reapply, label?}` Command. The mutation has
 *          *already* happened in the handler; `enrol` does NOT call
 *          `apply()`.
 *        - {@link UndoRedoManager.undo} / {@link UndoRedoManager.redo} —
 *          legacy `(tokenName, documentId)` signature, distinguished by
 *          arity.
 *        - {@link UndoRedoManager.clear},
 *          {@link UndoRedoManager.getUndoLabels},
 *          {@link UndoRedoManager.getRedoLabels}.
 *
 *      Legacy stacks are keyed `${tokenName}:${documentId}`; new stacks
 *      are keyed `${tokenId}:${documentId}`. The two key spaces share
 *      the underlying `stacks` map but never collide unless a token's
 *      `name` equals another token's `id` — that case is intentionally
 *      undefined behavior and Phase F will eliminate it.
 *
 * Out of scope for A.3 (TODOs flagged inline):
 *   - Phase B — eviction policy: ✅ landed. The constructor now
 *     instantiates an {@link EvictionPolicy} and schedules a 30-s
 *     interval; {@link UndoRedoManager.discardAll} clears it.
 *   - Phase E — conflict detection: `execute` emits `conflict: false`
 *     unconditionally; the conflict-detection wrapper lives in the
 *     dispatcher middleware (Phase E).
 *   - Phase G — full lifecycle hookup: token revocation + `stop()` are
 *     Phase G. This task only exposes the entry points.
 */

import { buildCommand, type Command as ParametricCommand, type DocumentId } from './command.js';
import { ClientDocumentStack, type CommandSummary } from './stack.js';
import type {
  DocumentSnapshot,
  DocumentSnapshotProvider,
} from './snapshot.js';
import { EvictionPolicy } from './eviction.js';
import type { EventBus } from '../events/bus.js';

// Re-export types that downstream callers (server bootstrap, tests, the
// barrel `index.ts`) expect on this module. The legacy `Command` interface
// also lives here (below) so existing handler imports keep resolving via
// `import type { Command } from '../undo-redo/manager.js'`.
export type { DocumentId, ParametricCommand };

/**
 * Legacy {@link Command} shape — preserved verbatim for the 12 existing
 * handler files + `reversibleCommandMw` that import it via
 * `import type { Command } from '../undo-redo/manager.js'`. New code
 * should target the parametric {@link ParametricCommand} from
 * `./command.js` instead. Phase F migrates handlers off this surface.
 */
export interface Command {
  /** Reverts the operation. */
  revert(): Promise<void> | void;
  /** Re-applies after a previous revert. */
  reapply(): Promise<void> | void;
  /** Optional human-readable label for `get_undo_stack`. */
  readonly label?: string;
}

/**
 * Result of {@link UndoRedoManager.undo} via the new surface (FR-19).
 * `no_op: true` when the stack is empty; otherwise carries the reverted
 * Command's id + summary.
 */
export type UndoResult =
  | { no_op: true }
  | { reverted_command_id: string; args_summary: string };

/**
 * Result of {@link UndoRedoManager.redo} via the new surface (FR-20).
 */
export type RedoResult =
  | { no_op: true }
  | { redone_command_id: string; args_summary: string };

/**
 * Pluggable timer set so tests can drive disconnect-grace timing
 * deterministically without monkey-patching globals.
 */
export interface TimerProvider {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/**
 * Constructor options for {@link UndoRedoManager}.
 *
 * All fields are optional. The legacy stub accepted only `max_depth`;
 * that field is preserved for backwards compatibility but the new
 * fields take precedence when both are set.
 */
export interface UndoRedoOptions {
  /** Per-`(token, document)` undo/redo cap (FR-9). Default 100. */
  max_depth_per_client?: number;
  /** Snapshot anchor cadence (FR-10). Default 20. */
  snapshot_every_n?: number;
  /** Disconnect grace window (FR-25). Default 600 s. */
  retain_after_disconnect_seconds?: number;
  /** Total memory budget (FR-27). Default 512 MiB. Phase B reads this. */
  max_total_memory_bytes?: number;
  /**
   * Floor of commands kept per stack during eviction (FR-27 implicit:
   * "evict oldest commands … from the bottom of the deepest stacks"
   * with a recent-ops floor — design.md §6 line 250). Default 5.
   * The eviction policy never drops the most recent
   * `floor_ops_per_stack` ops from any stack, even if the global memory
   * budget is still exceeded.
   */
  floor_ops_per_stack?: number;
  /**
   * Multi-client conflict-detection window (ms) — design.md §7.
   * {@link UndoRedoManager.execute} treats two Commands as overlapping
   * when the prior `document.changed` event landed on the bus within
   * the last `conflict_window_ms`. Default 1000 ms.
   */
  conflict_window_ms?: number;
  /**
   * Optional event bus. When omitted, `document.changed` emissions
   * become no-ops — handy for the legacy handler suite which doesn't
   * pass a bus today.
   */
  bus?: EventBus;
  /**
   * Optional timer shim for deterministic disconnect-timer tests.
   * Defaults to `globalThis` (`setTimeout` / `clearTimeout`).
   */
  timers?: TimerProvider;
  /**
   * Optional snapshot capture function (FR-10..FR-12). When supplied,
   * the manager calls it after every push that lands the undo length
   * on a positive multiple of `snapshot_every_n` and forwards the
   * captured payload to the stack as the new anchor. When omitted,
   * `maybeSnapshot` is a no-op — the legacy adapter / handler suites
   * which do not pass a `db` continue to operate without snapshots.
   */
  snapshotProvider?: DocumentSnapshotProvider;
  /** @deprecated alias for `max_depth_per_client`; kept for the legacy stub. */
  max_depth?: number;
}

/**
 * Resolved internal config. Every field is required after the
 * constructor merges options + defaults.
 */
interface ResolvedConfig {
  readonly max_depth_per_client: number;
  readonly snapshot_every_n: number;
  readonly retain_after_disconnect_seconds: number;
  readonly max_total_memory_bytes: number;
  readonly floor_ops_per_stack: number;
  readonly conflict_window_ms: number;
}

/**
 * Cadence (ms) of {@link EvictionPolicy.run} calls. Hard-coded per
 * design.md §5 line 137 (`setInterval(... , 30_000)`). 30 s is large
 * enough that the policy's O(N) sweep over stacks is invisible to the
 * tool dispatch path (NFR-2: eviction MUST NOT block dispatch — the
 * synchronous run is fast at v1 stack counts) and small enough that a
 * runaway burst gets pruned before the bus's recent-events buffer
 * grows pathologically.
 */
const EVICTION_TICK_MS = 30_000;

/**
 * In-memory undo/redo manager. One instance lives on the server (see
 * `lib/server.ts`); `lifecycle.undo` exposes it on the
 * {@link import('../../types/lifecycle.js').ServerStatus} surface.
 */
export class UndoRedoManager {
  /**
   * Map of stack-key → stack. Holds both legacy keys
   * (`${tokenName}:${documentId}`) and new keys
   * (`${tokenId}:${documentId}`). The two coexist without collision so
   * long as token ids and token names live in disjoint string spaces
   * (Phase F migrates handlers off the legacy surface).
   */
  private readonly stacks = new Map<string, ClientDocumentStack>();
  /** Pending disconnect timers, keyed by `token_id`. */
  private readonly disconnectTimers = new Map<string, unknown>();
  private readonly config: ResolvedConfig;
  private readonly bus: EventBus | undefined;
  private readonly timers: TimerProvider;
  private readonly snapshotProvider: DocumentSnapshotProvider | undefined;
  /**
   * Memory-budget enforcer (FR-27, Phase B). Constructed unconditionally
   * — it inspects the same `stacks` map the manager owns, so even when
   * the periodic timer is disabled (e.g., budget = 0) callers can drive
   * a manual sweep via this reference for tests / diagnostics.
   */
  private readonly eviction: EvictionPolicy;
  /**
   * Periodic handle for {@link EvictionPolicy.run}. `null` when no
   * interval is scheduled (defensive escape hatch — set when
   * `max_total_memory_bytes <= 0`, which disables eviction entirely).
   * Cleared in {@link discardAll}.
   */
  private readonly evictionTimer: ReturnType<typeof setInterval> | null;

  constructor(options: UndoRedoOptions = {}) {
    this.config = {
      max_depth_per_client:
        options.max_depth_per_client ?? options.max_depth ?? 100,
      snapshot_every_n: options.snapshot_every_n ?? 20,
      retain_after_disconnect_seconds: options.retain_after_disconnect_seconds ?? 600,
      max_total_memory_bytes: options.max_total_memory_bytes ?? 512 * 1024 * 1024,
      floor_ops_per_stack: options.floor_ops_per_stack ?? 5,
      // FR-13 default per design.md §7. The bus's recent-events buffer
      // retains events for at least this long, so the lookup always
      // sees every event published within the window.
      conflict_window_ms: options.conflict_window_ms ?? 1000,
    };
    this.bus = options.bus;
    this.timers = options.timers ?? {
      setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
      clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
    };
    this.snapshotProvider = options.snapshotProvider;

    // Phase B.1 — eviction policy + periodic tick (design.md §5 line
    // 137 + §6). The policy reads a read-only view of `this.stacks`,
    // so create-on-first-use stacks are visible to it without further
    // wiring. The 30-s interval is started only when the budget is
    // strictly positive — `max_total_memory_bytes <= 0` is treated as
    // an explicit "disable eviction" knob (handy in pathological tests
    // or for embedders who manage memory externally). The policy is
    // still instantiated so the same `eviction.run()` entry point is
    // available for manual / external invocation.
    this.eviction = new EvictionPolicy({
      stacks: this.stacks,
      bus: this.bus,
      config: {
        max_total_memory_bytes: this.config.max_total_memory_bytes,
        floor_ops_per_stack: this.config.floor_ops_per_stack,
      },
    });
    if (this.config.max_total_memory_bytes > 0) {
      this.evictionTimer = setInterval(() => this.eviction.run(), EVICTION_TICK_MS);
      // Allow the Node event loop to exit even when this timer is the
      // last pending handle. The manager's lifecycle is bounded by
      // `server.stop()` (which calls `discardAll`), so an unref'd
      // interval is safe.
      const handle = this.evictionTimer as unknown as { unref?: () => void };
      handle.unref?.();
    } else {
      this.evictionTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // New parametric surface (target for Phase F migration)
  // -------------------------------------------------------------------------

  /**
   * Apply a {@link ParametricCommand}, push it onto the calling
   * `(token_id, document_id)` undo stack, emit a `document.changed`
   * event, and return the apply result (FR-1, FR-5, FR-23).
   *
   * **Conflict detection (Phase E.2, design.md §7).** Before applying,
   * the manager peeks at recent `document.changed` events on the bus
   * via {@link EventBus.recentEvents} (window =
   * `config.conflict_window_ms`, default 1000 ms). When a prior event
   * (a) targets the same `document_id`, (b) originates from a *different*
   * token, AND (c) lists at least one layer ID in common with this
   * Command's {@link ParametricCommand.affected_layer_ids}, the manager
   * emits `document.changed { conflict: true }` after applying and
   * augments the `change_summary` with the conflicting token's name
   * (design.md §7 line 285). Both Commands stay in their originating
   * clients' undo stacks (FR-14) — last-write-wins applies to the
   * canvas, not to the stacks (FR-15).
   *
   * **Why inlined.** Design.md §7 expresses the wrapper as a free
   * function in the dispatcher middleware (`executeWithConflictDetection`).
   * We collapse it into `execute` to make this method the single
   * trusted entry point: a separate public wrapper would invite
   * callers to skip conflict detection by going straight to a (now
   * private) raw `execute`. The behavior is always desired, so we make
   * it unbypassable.
   */
  async execute<R>(
    token_name: string,
    token_id: string,
    document_id: DocumentId,
    command: ParametricCommand<R>,
  ): Promise<R> {
    const stack = this.getOrCreateStack(token_id, document_id);
    const myAffected = deriveAffectedLayers(command);

    // Conflict lookup runs BEFORE apply so the prior client's event is
    // the one we compare against — applying first would record OUR
    // event into the buffer and we could then "find" it as a prior
    // overlap. The bus's recent-events buffer is independent of
    // subscriber order, so reads here always reflect the steady state.
    const overlapping = this.bus
      ? findOverlapping(
          this.bus.recentEvents('document.changed', this.config.conflict_window_ms),
          document_id,
          token_name,
          myAffected,
        )
      : undefined;

    const result = await command.apply();
    const snapshot = await this.maybeSnapshot(stack, document_id);
    stack.push(command, snapshot);

    const baseSummary = command.args_summary;
    const summary = overlapping
      ? `${baseSummary} (conflicts with prior edit by ${overlapping.originating_token_name})`
      : baseSummary;
    this.publish({
      name: 'document.changed',
      payload: {
        document_id,
        change_summary: summary,
        affected_layer_ids: myAffected,
        originating_token_name: token_name,
        conflict: !!overlapping,
      },
    });
    return result;
  }

  /**
   * Pop the newest Command off `(token_id, document_id)`'s undo stack,
   * call `revert()`, emit `document.changed`, and return the reverted
   * Command's id + summary (FR-6, FR-19, FR-23).
   *
   * Overload: also accepts the legacy `(tokenName, documentId)`
   * signature for the 12 existing handler suites — distinguished by
   * arity. The legacy path resolves via `${tokenName}:${documentId}`.
   */
  async undo(token_name: string, token_id: string, document_id: DocumentId): Promise<UndoResult>;
  async undo(tokenName: string, documentId: string): Promise<void>;
  async undo(
    tokenOrName: string,
    tokenIdOrDoc: string,
    documentId?: DocumentId,
  ): Promise<UndoResult | void> {
    if (documentId === undefined) {
      // Legacy 2-arg form.
      return this.legacyUndo(tokenOrName, tokenIdOrDoc);
    }
    const stack = this.stacks.get(this.newKey(tokenIdOrDoc, documentId));
    if (!stack) return { no_op: true };
    const cmd = stack.popUndo();
    if (!cmd) return { no_op: true };
    await cmd.revert();
    this.publish({
      name: 'document.changed',
      payload: {
        document_id: documentId,
        change_summary: `Undid: ${cmd.args_summary}`,
        affected_layer_ids: [],
        originating_token_name: tokenOrName,
        conflict: false,
      },
    });
    return { reverted_command_id: cmd.id, args_summary: cmd.args_summary };
  }

  /**
   * Pop the newest Command off `(token_id, document_id)`'s redo stack,
   * call `apply()`, emit `document.changed`, and return the redone
   * Command's id + summary (FR-7, FR-20, FR-23).
   */
  async redo(token_name: string, token_id: string, document_id: DocumentId): Promise<RedoResult>;
  async redo(tokenName: string, documentId: string): Promise<void>;
  async redo(
    tokenOrName: string,
    tokenIdOrDoc: string,
    documentId?: DocumentId,
  ): Promise<RedoResult | void> {
    if (documentId === undefined) {
      return this.legacyRedo(tokenOrName, tokenIdOrDoc);
    }
    const stack = this.stacks.get(this.newKey(tokenIdOrDoc, documentId));
    if (!stack) return { no_op: true };
    const cmd = stack.popRedo();
    if (!cmd) return { no_op: true };
    await cmd.apply();
    this.publish({
      name: 'document.changed',
      payload: {
        document_id: documentId,
        change_summary: `Redid: ${cmd.args_summary}`,
        affected_layer_ids: [],
        originating_token_name: tokenOrName,
        conflict: false,
      },
    });
    return { redone_command_id: cmd.id, args_summary: cmd.args_summary };
  }

  /**
   * Drop every stack belonging to `token_id`, across all documents
   * (FR-25 token revocation; called by Phase G's revoke handler).
   * Also cancels any pending disconnect timer.
   */
  discardForToken(token_id: string): void {
    const prefix = `${token_id}:`;
    for (const key of this.stacks.keys()) {
      if (key.startsWith(prefix)) this.stacks.delete(key);
    }
    const pending = this.disconnectTimers.get(token_id);
    if (pending !== undefined) {
      this.timers.clearTimeout(pending);
      this.disconnectTimers.delete(token_id);
    }
  }

  /**
   * Drop every stack, cancel every pending disconnect timer, and stop
   * the periodic eviction tick (FR-25 server stop). Idempotent. Called
   * from `server.stop()` so the manager exits cleanly with no
   * in-flight timers and no lingering memory.
   */
  discardAll(): void {
    this.stacks.clear();
    for (const handle of this.disconnectTimers.values()) {
      this.timers.clearTimeout(handle);
    }
    this.disconnectTimers.clear();
    if (this.evictionTimer !== null) {
      clearInterval(this.evictionTimer);
    }
  }

  /**
   * Schedule a discard of every stack for `token_id` after
   * `retain_after_disconnect_seconds` elapses. If a timer was already
   * pending it is replaced (the most-recent disconnect "wins").
   *
   * Called by Phase G when the token's last live transport closes.
   */
  onTokenDisconnect(token_id: string): void {
    // Cancel any pre-existing timer to avoid duplicate discards.
    const prior = this.disconnectTimers.get(token_id);
    if (prior !== undefined) this.timers.clearTimeout(prior);
    const ms = this.config.retain_after_disconnect_seconds * 1000;
    const handle = this.timers.setTimeout(() => {
      this.disconnectTimers.delete(token_id);
      this.discardForToken(token_id);
    }, ms);
    this.disconnectTimers.set(token_id, handle);
  }

  /**
   * Cancel the pending disconnect-discard for `token_id`. Idempotent;
   * a no-op when no timer is pending. Called when the token reconnects
   * within the grace window.
   */
  onTokenReconnect(token_id: string): void {
    const pending = this.disconnectTimers.get(token_id);
    if (pending === undefined) return;
    this.timers.clearTimeout(pending);
    this.disconnectTimers.delete(token_id);
  }

  /** Newest-first {@link CommandSummary} projection (FR-21). */
  getUndoStack(token_id: string, document_id: DocumentId): readonly CommandSummary[] {
    return (
      this.stacks.get(this.newKey(token_id, document_id))?.getUndoSummary() ?? []
    );
  }

  /** Newest-first {@link CommandSummary} projection of the redo stack. */
  getRedoStack(token_id: string, document_id: DocumentId): readonly CommandSummary[] {
    return (
      this.stacks.get(this.newKey(token_id, document_id))?.getRedoSummary() ?? []
    );
  }

  // -------------------------------------------------------------------------
  // Legacy surface (ABI compatibility for 12 existing handler files)
  // -------------------------------------------------------------------------

  /**
   * Push a {@link Command} (legacy shape) onto the calling
   * `(tokenName, documentId)` undo stack.
   *
   * **Crucial semantic:** the handler has *already* performed the
   * mutation (the existing handler files compute apply/revert closures
   * locally and stash the result in `ctx.scratch.command`). `enrol`
   * therefore does NOT call `apply()` — doing so would re-mutate the
   * canvas. Phase F migrates this surface onto {@link execute}, at
   * which point the manager owns the apply call.
   */
  enrol(tokenName: string, documentId: string, command: Command): void {
    const stack = this.legacyStack(tokenName, documentId);
    const wrapped = this.wrapLegacy(documentId, command);
    // FR-5 / FR-8: push appends to undo + clears redo. We bypass
    // `command.apply()` because the handler already applied (see
    // method-level docstring above).
    stack.push(wrapped);
  }

  /** Legacy `(tokenName, documentId)` undo. Awaits revert; void return. */
  private async legacyUndo(tokenName: string, documentId: string): Promise<void> {
    const stack = this.legacyStack(tokenName, documentId);
    const cmd = stack.popUndo();
    if (!cmd) return;
    await cmd.revert();
  }

  /** Legacy `(tokenName, documentId)` redo. Awaits apply; void return. */
  private async legacyRedo(tokenName: string, documentId: string): Promise<void> {
    const stack = this.legacyStack(tokenName, documentId);
    const cmd = stack.popRedo();
    if (!cmd) return;
    await cmd.apply();
  }

  /** Legacy: list of label strings, oldest at index 0 (insertion order). */
  getUndoLabels(tokenName: string, documentId: string): readonly string[] {
    const stack = this.stacks.get(this.legacyKey(tokenName, documentId));
    if (!stack) return [];
    // Oldest-first — match the legacy stub's behavior. The new
    // `getUndoStack` returns newest-first; legacy callers expect the
    // opposite ordering, so reverse the newest-first projection.
    return stack
      .getUndoSummary()
      .slice()
      .reverse()
      .map((s) => s.args_summary);
  }

  getRedoLabels(tokenName: string, documentId: string): readonly string[] {
    const stack = this.stacks.get(this.legacyKey(tokenName, documentId));
    if (!stack) return [];
    return stack
      .getRedoSummary()
      .slice()
      .reverse()
      .map((s) => s.args_summary);
  }

  /** Drop the legacy `(tokenName, documentId)` stack entirely. */
  clear(tokenName: string, documentId: string): void {
    this.stacks.delete(this.legacyKey(tokenName, documentId));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private newKey(token_id: string, document_id: DocumentId): string {
    return `${token_id}:${document_id}`;
  }

  private legacyKey(tokenName: string, documentId: string): string {
    return `${tokenName}:${documentId}`;
  }

  private getOrCreateStack(
    token_id: string,
    document_id: DocumentId,
  ): ClientDocumentStack {
    const key = this.newKey(token_id, document_id);
    let stack = this.stacks.get(key);
    if (!stack) {
      stack = new ClientDocumentStack(
        token_id,
        document_id,
        this.config.max_depth_per_client,
        this.config.snapshot_every_n,
      );
      this.stacks.set(key, stack);
    }
    return stack;
  }

  private legacyStack(tokenName: string, documentId: string): ClientDocumentStack {
    const key = this.legacyKey(tokenName, documentId);
    let stack = this.stacks.get(key);
    if (!stack) {
      stack = new ClientDocumentStack(
        tokenName,
        documentId,
        this.config.max_depth_per_client,
        this.config.snapshot_every_n,
      );
      this.stacks.set(key, stack);
    }
    return stack;
  }

  /**
   * Wrap a legacy `{revert, reapply, label?}` command in a parametric
   * {@link ParametricCommand} so the underlying {@link ClientDocumentStack}
   * sees a uniform shape. Uses a sentinel `tool_name = "legacy"` so
   * future resource handlers can filter or ignore these entries.
   */
  private wrapLegacy(documentId: string, legacy: Command): ParametricCommand<unknown> {
    return buildCommand<unknown>({
      tool_name: 'legacy',
      document_id: documentId,
      args_summary: legacy.label ?? '<command>',
      weight: 'small',
      apply: async () => {
        await legacy.reapply();
        return undefined;
      },
      revert: async () => {
        await legacy.revert();
      },
    });
  }

  private publish(event: { name: string; payload: unknown }): void {
    if (!this.bus) return;
    this.bus.publish(event);
  }

  /**
   * Capture a full document snapshot when the next push will land on a
   * `snapshot_every_n` boundary (FR-10..FR-12 per design.md §5).
   *
   * Cadence rule:
   *   - This method runs BEFORE the push, so the post-push length is
   *     `peekUndoLength() + 1`.
   *   - We want anchors at undo indices `snapshot_every_n - 1`,
   *     `2 * snapshot_every_n - 1`, … (zero-based — i.e., after the
   *     5th, 10th, … push for `N=5`). That is exactly when
   *     `(peekUndoLength() + 1) % snapshot_every_n === 0`.
   *
   * When no {@link DocumentSnapshotProvider} was supplied (legacy
   * adapter / pre-A.4 handler suites that don't pass a `db`), this
   * method returns `undefined` and the stack skips anchoring — that
   * preserves the legacy behavior verbatim.
   */
  private async maybeSnapshot(
    stack: ClientDocumentStack,
    document_id: DocumentId,
  ): Promise<DocumentSnapshot | undefined> {
    if (!this.snapshotProvider) return undefined;
    const lengthAfterPush = stack.peekUndoLength() + 1;
    if (lengthAfterPush <= 0) return undefined;
    if (lengthAfterPush % this.config.snapshot_every_n !== 0) return undefined;
    return this.snapshotProvider(document_id);
  }
}

// ---------------------------------------------------------------------------
// Module-private conflict-detection helpers (Phase E.2)
// ---------------------------------------------------------------------------

/**
 * Shape of `document.changed` event payloads as observed by the
 * conflict detector. Field-level optional because (a) historical
 * emitters and the legacy `enrol` adapter publish nothing, and (b)
 * non-undo `document.changed` events from sibling subsystems (e.g.,
 * `paint_strokes`'s direct emit) may not include every field. Missing
 * fields are treated as "scope unknown" and never trigger a conflict.
 */
interface DocumentChangedShape {
  readonly document_id?: unknown;
  readonly originating_token_name?: unknown;
  readonly affected_layer_ids?: unknown;
}

/**
 * Read `affected_layer_ids` off a Command, returning a plain array.
 * Returns `[]` when the field is absent — that's the "scope unknown"
 * signal: a Command with no declared scope never overlaps anything,
 * so legacy handlers + the wrapped legacy adapter that don't yet
 * populate the field flow through {@link UndoRedoManager.execute}
 * without spurious conflict flags. Phase F migrates handlers to
 * populate this field where applicable.
 */
function deriveAffectedLayers(
  cmd: ParametricCommand,
): ReadonlyArray<string> {
  return cmd.affected_layer_ids ?? [];
}

/**
 * Pure-function intersection check used by the conflict detector. Two
 * Commands are considered overlapping iff their `affected_layer_ids`
 * lists share at least one entry. Empty lists never overlap (see
 * {@link deriveAffectedLayers} for the rationale).
 *
 * Linear scan — `b` is wrapped in a `Set` only when the smaller of
 * the two has more than a handful of entries. v1 keeps both lists
 * tiny in practice (typical Command touches 1–3 layers), so the
 * naive `O(|a| × |b|)` form is fine.
 */
function haveOverlap(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length === 0 || b.length === 0) return false;
  for (const x of a) {
    if (b.includes(x)) return true;
  }
  return false;
}

/**
 * Search the supplied `recent` events (already filtered to
 * `document.changed` + within the conflict window by the caller) for
 * an event that (a) targets the same `document_id`, (b) originates
 * from a different token, and (c) overlaps `myAffected` on at least
 * one layer ID. Returns the matching payload (typed minimally for the
 * single field the caller needs) or `undefined`.
 *
 * Iterates newest-first so the conflict-summary string credits the
 * most recent prior edit when several recent events overlap.
 */
function findOverlapping(
  recent: ReadonlyArray<{ payload: unknown; published_at: number }>,
  document_id: DocumentId,
  token_name: string,
  myAffected: ReadonlyArray<string>,
): { originating_token_name: string } | undefined {
  if (recent.length === 0 || myAffected.length === 0) return undefined;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const entry = recent[i]!;
    const p = entry.payload as DocumentChangedShape | null | undefined;
    if (!p) continue;
    if (p.document_id !== document_id) continue;
    const otherToken =
      typeof p.originating_token_name === 'string'
        ? p.originating_token_name
        : undefined;
    if (!otherToken || otherToken === token_name) continue;
    const otherLayers = Array.isArray(p.affected_layer_ids)
      ? (p.affected_layer_ids.filter((x): x is string => typeof x === 'string'))
      : [];
    if (!haveOverlap(myAffected, otherLayers)) continue;
    return { originating_token_name: otherToken };
  }
  return undefined;
}
