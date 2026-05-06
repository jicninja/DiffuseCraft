#!/usr/bin/env tsx
/**
 * Unit tests for {@link UndoRedoManager} (undo-redo-system task A.3).
 *
 * Asserts requirements.md §3.1 (FR-1..FR-2: Command apply/revert), §3.2
 * (FR-4..FR-9: per-`(token, document)` stacks + branching invariant),
 * §3.4 (FR-13..FR-15 emit semantics), §3.5 (FR-16..FR-18 reversibility
 * scope — surface only here), and §3.7 (FR-24..FR-26 stack discard
 * rules) per design.md §5.
 *
 * Behaviors covered:
 *   - `execute` calls `apply()`, pushes onto the per-`(token_id,
 *     document_id)` stack, returns the apply result, and emits
 *     `document.changed { change_summary, originating_token_name,
 *     conflict: false }`.
 *   - `undo` reverts the newest Command, emits `document.changed
 *     { change_summary: "Undid: ..." }`, and returns the reverted id.
 *     Empty stack → `{ no_op: true }`.
 *   - `redo` re-applies the popped redo top, emits `"Redid: ..."`,
 *     returns the redone id. Empty redo → `{ no_op: true }`.
 *   - `discardForToken` removes ALL stacks for a token across docs.
 *   - `onTokenDisconnect` schedules a discard after the configured
 *     grace; `onTokenReconnect` cancels it. Driven by an injected
 *     {@link TimerProvider} so timing is deterministic.
 *   - `getUndoStack` / `getRedoStack` return projected
 *     `CommandSummary[]` newest-first.
 *   - Per-client isolation: two distinct `token_id`s on the same doc;
 *     A's undo only reverts A's command (Story 2).
 *   - Branching invariant (FR-8): a fresh `execute` after some `undo`s
 *     clears the redo stack.
 *   - Legacy adapter compatibility: `enrol` + 2-arg `undo`/`redo` +
 *     `getUndoLabels`/`getRedoLabels` + `clear` keep working.
 *
 * Runner: `tsx` (matches the rest of `libs/server/src/__tests__`).
 * Run: `pnpm exec tsx \
 *        src/lib/undo-redo/__tests__/manager.test.ts`.
 */
import { strict as assert } from 'node:assert';

import { buildCommand, type CommandSpec } from '../command.js';
import { type Command as LegacyCommand, type TimerProvider, UndoRedoManager } from '../manager.js';
import type { EventBus } from '../../events/bus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Captured {
  name: string;
  payload: Record<string, unknown>;
}

const makeBus = (
  log: Captured[],
): EventBus => {
  return {
    publish: (event: { name: string; payload: unknown }) =>
      log.push({ name: event.name, payload: event.payload as Record<string, unknown> }),
  } as unknown as EventBus;
};

const baseSpec = <R>(over: Partial<CommandSpec<R>>): CommandSpec<R> => ({
  tool_name: 'add_layer',
  document_id: 'doc_TEST',
  args_summary: 'Add layer X',
  weight: 'small',
  apply: (async () => undefined as unknown as R) as () => Promise<R>,
  revert: async () => undefined,
  ...over,
});

/**
 * Manual fake timer set. Tests advance time via `tick(ms)` to fire any
 * scheduled callbacks whose deadline has passed. No real wall-clock
 * delay is involved, so the suite stays deterministic.
 */
class FakeTimers implements TimerProvider {
  private now = 0;
  private nextId = 1;
  private readonly scheduled = new Map<
    number,
    { fireAt: number; handler: () => void }
  >();

  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.scheduled.set(id, { fireAt: this.now + ms, handler });
    return id;
  }

  clearTimeout(id: unknown): void {
    if (typeof id === 'number') this.scheduled.delete(id);
  }

  /** Advance virtual time and fire every callback whose deadline elapsed. */
  tick(ms: number): void {
    this.now += ms;
    // Fire entries in insertion order (good enough for the cases below).
    for (const [id, entry] of [...this.scheduled.entries()]) {
      if (entry.fireAt <= this.now) {
        this.scheduled.delete(id);
        entry.handler();
      }
    }
  }

  pendingCount(): number {
    return this.scheduled.size;
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'execute calls apply(), pushes, returns result, emits document.changed',
    async () => {
      const log: Captured[] = [];
      const mgr = new UndoRedoManager({ bus: makeBus(log) });
      let applied = 0;
      const cmd = buildCommand<string>(
        baseSpec({
          tool_name: 'add_layer',
          args_summary: "Add layer 'red barn'",
          apply: async () => {
            applied += 1;
            return 'layer_001';
          },
        }),
      );
      const result = await mgr.execute('alice', 'tok_A', 'doc_TEST', cmd);
      assert.equal(result, 'layer_001', 'execute returns apply result');
      assert.equal(applied, 1, 'apply() called exactly once');
      assert.equal(log.length, 1, 'one document.changed emitted');
      assert.equal(log[0]!.name, 'document.changed');
      assert.equal(log[0]!.payload['change_summary'], "Add layer 'red barn'");
      assert.equal(log[0]!.payload['originating_token_name'], 'alice');
      assert.equal(log[0]!.payload['conflict'], false);
      // Stack reflects the push.
      const undoStack = mgr.getUndoStack('tok_A', 'doc_TEST');
      assert.equal(undoStack.length, 1, 'undo stack now has 1 entry');
      assert.equal(undoStack[0]!.id, cmd.id, 'newest-first projection has the cmd');
    },
  ],
  [
    'undo reverts the newest Command, emits "Undid: ...", returns reverted id',
    async () => {
      const log: Captured[] = [];
      const mgr = new UndoRedoManager({ bus: makeBus(log) });
      let reverted = 0;
      const cmd = buildCommand(
        baseSpec({
          args_summary: 'op 1',
          revert: async () => {
            reverted += 1;
          },
        }),
      );
      await mgr.execute('alice', 'tok_A', 'doc_TEST', cmd);
      log.length = 0; // ignore execute's emission
      const result = await mgr.undo('alice', 'tok_A', 'doc_TEST');
      assert.equal(reverted, 1, 'revert() called exactly once');
      assert.deepEqual(result, {
        reverted_command_id: cmd.id,
        args_summary: 'op 1',
      });
      assert.equal(log.length, 1, 'one document.changed emitted on undo');
      assert.equal(log[0]!.payload['change_summary'], 'Undid: op 1');
      assert.equal(log[0]!.payload['originating_token_name'], 'alice');
      // Stack now empty.
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST').length, 0);
      assert.equal(mgr.getRedoStack('tok_A', 'doc_TEST').length, 1);
    },
  ],
  [
    'undo on empty stack returns { no_op: true }',
    async () => {
      const mgr = new UndoRedoManager();
      const result = await mgr.undo('alice', 'tok_A', 'doc_TEST');
      assert.deepEqual(result, { no_op: true });
    },
  ],
  [
    'redo re-applies, emits "Redid: ...", returns redone id',
    async () => {
      const log: Captured[] = [];
      const mgr = new UndoRedoManager({ bus: makeBus(log) });
      let applies = 0;
      const cmd = buildCommand(
        baseSpec({
          args_summary: 'op 1',
          apply: async () => {
            applies += 1;
            return undefined;
          },
        }),
      );
      await mgr.execute('alice', 'tok_A', 'doc_TEST', cmd);
      await mgr.undo('alice', 'tok_A', 'doc_TEST');
      log.length = 0;
      const result = await mgr.redo('alice', 'tok_A', 'doc_TEST');
      assert.equal(applies, 2, 'apply() called once on execute + once on redo');
      assert.deepEqual(result, {
        redone_command_id: cmd.id,
        args_summary: 'op 1',
      });
      assert.equal(log.length, 1);
      assert.equal(log[0]!.payload['change_summary'], 'Redid: op 1');
    },
  ],
  [
    'redo on empty stack returns { no_op: true }',
    async () => {
      const mgr = new UndoRedoManager();
      const result = await mgr.redo('alice', 'tok_A', 'doc_TEST');
      assert.deepEqual(result, { no_op: true });
    },
  ],
  [
    'discardForToken removes all stacks for that token across documents',
    async () => {
      const mgr = new UndoRedoManager();
      await mgr.execute('alice', 'tok_A', 'doc_1', buildCommand(baseSpec({})));
      await mgr.execute('alice', 'tok_A', 'doc_2', buildCommand(baseSpec({})));
      await mgr.execute('bob', 'tok_B', 'doc_1', buildCommand(baseSpec({})));
      assert.equal(mgr.getUndoStack('tok_A', 'doc_1').length, 1);
      assert.equal(mgr.getUndoStack('tok_A', 'doc_2').length, 1);
      assert.equal(mgr.getUndoStack('tok_B', 'doc_1').length, 1);
      mgr.discardForToken('tok_A');
      assert.equal(mgr.getUndoStack('tok_A', 'doc_1').length, 0, 'doc_1 cleared');
      assert.equal(mgr.getUndoStack('tok_A', 'doc_2').length, 0, 'doc_2 cleared');
      assert.equal(mgr.getUndoStack('tok_B', 'doc_1').length, 1, 'tok_B untouched');
    },
  ],
  [
    'onTokenDisconnect schedules a discard; onTokenReconnect cancels it',
    async () => {
      const timers = new FakeTimers();
      const mgr = new UndoRedoManager({
        retain_after_disconnect_seconds: 600,
        timers,
      });
      await mgr.execute('alice', 'tok_A', 'doc_TEST', buildCommand(baseSpec({})));
      mgr.onTokenDisconnect('tok_A');
      assert.equal(timers.pendingCount(), 1, 'one timer pending');
      // Fire just before deadline → still present.
      timers.tick(599_999);
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST').length, 1, 'pre-deadline: stack intact');
      // Fire past deadline → discarded.
      timers.tick(2);
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST').length, 0, 'post-deadline: discarded');
      assert.equal(timers.pendingCount(), 0, 'timer cleared after firing');
      // Reconnect path: schedule, then cancel before deadline.
      await mgr.execute('alice', 'tok_A', 'doc_TEST', buildCommand(baseSpec({})));
      mgr.onTokenDisconnect('tok_A');
      assert.equal(timers.pendingCount(), 1);
      mgr.onTokenReconnect('tok_A');
      assert.equal(timers.pendingCount(), 0, 'reconnect cancels timer');
      timers.tick(10_000_000);
      assert.equal(
        mgr.getUndoStack('tok_A', 'doc_TEST').length,
        1,
        'reconnect prevented discard',
      );
    },
  ],
  [
    'getUndoStack and getRedoStack project newest-first CommandSummary[]',
    async () => {
      const mgr = new UndoRedoManager();
      const c1 = buildCommand(baseSpec({ args_summary: 'op 1', tool_name: 'add_layer' }));
      const c2 = buildCommand(baseSpec({ args_summary: 'op 2', tool_name: 'set_selection' }));
      const c3 = buildCommand(baseSpec({ args_summary: 'op 3', tool_name: 'remove_layer' }));
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c1);
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c2);
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c3);
      const undo = mgr.getUndoStack('tok_A', 'doc_TEST');
      assert.deepEqual(
        undo.map((s) => s.args_summary),
        ['op 3', 'op 2', 'op 1'],
        'newest-first',
      );
      assert.equal(undo[0]!.tool_name, 'remove_layer');
      // No apply/revert leakage in projection.
      assert.equal(
        (undo[0] as unknown as { apply?: unknown }).apply,
        undefined,
        'apply must NOT appear on summary',
      );
      // Drive some undos to populate redo, then verify newest-first.
      await mgr.undo('alice', 'tok_A', 'doc_TEST');
      await mgr.undo('alice', 'tok_A', 'doc_TEST');
      const redo = mgr.getRedoStack('tok_A', 'doc_TEST');
      assert.deepEqual(
        redo.map((s) => s.args_summary),
        ['op 2', 'op 3'],
        'redo newest-first (op 2 pushed last)',
      );
    },
  ],
  [
    'per-client isolation: two tokens on the same doc do not share stacks (Story 2)',
    async () => {
      const mgr = new UndoRedoManager();
      let aReverted = 0;
      let bReverted = 0;
      const a = buildCommand(
        baseSpec({
          args_summary: "alice's paint layer",
          revert: async () => {
            aReverted += 1;
          },
        }),
      );
      const b = buildCommand(
        baseSpec({
          args_summary: "bob's control layer",
          revert: async () => {
            bReverted += 1;
          },
        }),
      );
      await mgr.execute('alice', 'tok_A', 'doc_TEST', a);
      await mgr.execute('bob', 'tok_B', 'doc_TEST', b);
      // A's undo should ONLY revert A's command.
      const aResult = await mgr.undo('alice', 'tok_A', 'doc_TEST');
      assert.equal(aReverted, 1, "alice's revert ran once");
      assert.equal(bReverted, 0, "bob's revert did NOT run");
      assert.deepEqual(aResult, {
        reverted_command_id: a.id,
        args_summary: "alice's paint layer",
      });
      // B's stack still has 1 entry.
      assert.equal(mgr.getUndoStack('tok_B', 'doc_TEST').length, 1);
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST').length, 0);
      // B's undo runs B's command; A's revert count stays at 1.
      const bResult = await mgr.undo('bob', 'tok_B', 'doc_TEST');
      assert.equal(bReverted, 1);
      assert.equal(aReverted, 1);
      assert.deepEqual(bResult, {
        reverted_command_id: b.id,
        args_summary: "bob's control layer",
      });
    },
  ],
  [
    'branching invariant (FR-8): a fresh execute after undos clears the redo stack',
    async () => {
      const mgr = new UndoRedoManager();
      const c1 = buildCommand(baseSpec({ args_summary: 'op 1' }));
      const c2 = buildCommand(baseSpec({ args_summary: 'op 2' }));
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c1);
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c2);
      await mgr.undo('alice', 'tok_A', 'doc_TEST');
      assert.equal(
        mgr.getRedoStack('tok_A', 'doc_TEST').length,
        1,
        'redo populated by the undo',
      );
      const c3 = buildCommand(baseSpec({ args_summary: 'op 3' }));
      await mgr.execute('alice', 'tok_A', 'doc_TEST', c3);
      assert.equal(
        mgr.getRedoStack('tok_A', 'doc_TEST').length,
        0,
        'fresh execute clears the redo stack (FR-8)',
      );
    },
  ],
  [
    'legacy enrol/undo/redo/clear/getUndoLabels/getRedoLabels keep working',
    async () => {
      const mgr = new UndoRedoManager();
      let applies = 0;
      let reverts = 0;
      const legacy = (label: string): LegacyCommand => ({
        label,
        revert: async () => {
          reverts += 1;
        },
        reapply: async () => {
          applies += 1;
        },
      });
      // enrol does NOT call apply (mutation already happened in handler).
      mgr.enrol('alice', 'doc_TEST', legacy('legacy op 1'));
      mgr.enrol('alice', 'doc_TEST', legacy('legacy op 2'));
      assert.equal(applies, 0, 'enrol must NOT call reapply');
      assert.deepEqual(
        mgr.getUndoLabels('alice', 'doc_TEST'),
        ['legacy op 1', 'legacy op 2'],
        'legacy labels preserved oldest-first',
      );
      // Legacy 2-arg undo path.
      await mgr.undo('alice', 'doc_TEST');
      assert.equal(reverts, 1, 'legacy undo called revert once');
      assert.deepEqual(mgr.getUndoLabels('alice', 'doc_TEST'), ['legacy op 1']);
      assert.deepEqual(mgr.getRedoLabels('alice', 'doc_TEST'), ['legacy op 2']);
      // Legacy 2-arg redo re-applies.
      await mgr.redo('alice', 'doc_TEST');
      assert.equal(applies, 1, 'legacy redo called reapply once');
      assert.deepEqual(mgr.getUndoLabels('alice', 'doc_TEST'), ['legacy op 1', 'legacy op 2']);
      assert.deepEqual(mgr.getRedoLabels('alice', 'doc_TEST'), []);
      // clear drops the stack.
      mgr.clear('alice', 'doc_TEST');
      assert.deepEqual(mgr.getUndoLabels('alice', 'doc_TEST'), []);
      assert.deepEqual(mgr.getRedoLabels('alice', 'doc_TEST'), []);
    },
  ],
  [
    'legacy and new key spaces are isolated (different `${A}:{B}` strings)',
    async () => {
      const mgr = new UndoRedoManager();
      // New surface uses (token_name, token_id, document_id).
      await mgr.execute(
        'alice',
        'tok_A',
        'doc_TEST',
        buildCommand(baseSpec({ args_summary: 'new op' })),
      );
      // Legacy surface uses (tokenName, documentId). Even with
      // tokenName='alice', the key is `alice:doc_TEST`, not `tok_A:doc_TEST`.
      mgr.enrol('alice', 'doc_TEST', {
        label: 'legacy op',
        revert: async () => {},
        reapply: async () => {},
      });
      // The new-surface stack saw only the new op.
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST').length, 1);
      assert.equal(mgr.getUndoStack('tok_A', 'doc_TEST')[0]!.args_summary, 'new op');
      // The legacy-surface stack saw only the legacy op.
      assert.deepEqual(mgr.getUndoLabels('alice', 'doc_TEST'), ['legacy op']);
    },
  ],
];

async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  FAIL ${name}\n        ${(err as Error).message}`);
      if ((err as Error).stack) {
        // eslint-disable-next-line no-console
        console.error((err as Error).stack);
      }
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} manager.test cases failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} manager.test cases passed.`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('unexpected error:', err);
  process.exit(1);
});
