#!/usr/bin/env tsx
/**
 * Unit tests for {@link ClientDocumentStack}
 * (undo-redo-system task A.2).
 *
 * Asserts requirements.md §3.2 (FR-4..FR-9: per-client per-document
 * stacks) and §3.3 (FR-10..FR-12: snapshot anchoring) and design.md §4.
 *
 * Behaviors covered:
 *   - `push` appends to `undo`, clears `redo`, evicts oldest on
 *     `maxDepth` overflow, and anchors a snapshot every `snapshotEvery`.
 *   - `popUndo()` moves a Command from `undo` → `redo`; returns
 *     `undefined` on empty.
 *   - `popRedo()` moves a Command from `redo` → `undo`; returns
 *     `undefined` on empty.
 *   - `getUndoSummary()` / `getRedoSummary()` return projections
 *     newest-first.
 *   - `totalMemoryBytes()` returns a finite number > 0 once a command
 *     has been pushed.
 *   - Snapshot anchor index is correct when `undo.length` is a multiple
 *     of `snapshotEvery`.
 *
 * Runner: `tsx` (matches the rest of `libs/server/src/__tests__`).
 * Run: `pnpm exec tsx \
 *        src/lib/undo-redo/__tests__/stack.test.ts`.
 */
import { strict as assert } from 'node:assert';

import { buildCommand, type Command, type CommandSpec } from '../command.js';
import {
  ClientDocumentStack,
  type CommandSummary,
  type DocumentSnapshot,
} from '../stack.js';

const baseSpec = <R>(over: Partial<CommandSpec<R>>): CommandSpec<R> => ({
  tool_name: 'add_layer',
  document_id: 'doc_TEST',
  args_summary: 'Add layer X',
  weight: 'small',
  apply: (async () => undefined as unknown as R) as () => Promise<R>,
  revert: async () => undefined,
  ...over,
});

const mkCmd = (over: Partial<CommandSpec<unknown>> = {}): Command<unknown> =>
  buildCommand(baseSpec<unknown>(over));

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'push appends to undo and clears redo (FR-5, FR-8)',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 20);
      const c1 = mkCmd({ args_summary: 'op 1' });
      const c2 = mkCmd({ args_summary: 'op 2' });
      s.push(c1);
      s.push(c2);
      assert.deepEqual(
        s.getUndoSummary().map((x) => x.args_summary),
        ['op 2', 'op 1'],
        'undo summary newest-first after two pushes',
      );
      // Pop one undo to populate redo, then push a fresh op → redo cleared.
      const popped = s.popUndo();
      assert.equal(popped?.args_summary, 'op 2', 'popUndo returns newest');
      assert.equal(s.getRedoSummary().length, 1, 'redo has the popped op');
      const c3 = mkCmd({ args_summary: 'op 3' });
      s.push(c3);
      assert.equal(
        s.getRedoSummary().length,
        0,
        'pushing a fresh command clears redo (FR-8)',
      );
    },
  ],
  [
    'push respects maxDepth and evicts oldest first (FR-9)',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 3, 100);
      const c1 = mkCmd({ args_summary: 'op 1' });
      const c2 = mkCmd({ args_summary: 'op 2' });
      const c3 = mkCmd({ args_summary: 'op 3' });
      const c4 = mkCmd({ args_summary: 'op 4' });
      s.push(c1);
      s.push(c2);
      s.push(c3);
      s.push(c4);
      const summary = s.getUndoSummary().map((x) => x.args_summary);
      assert.deepEqual(
        summary,
        ['op 4', 'op 3', 'op 2'],
        'oldest (op 1) evicted; newest first',
      );
    },
  ],
  [
    'push anchors a snapshot every snapshotEvery ops (FR-10)',
    () => {
      // snapshotEvery = 2 → snapshots after the 2nd, 4th, ... push.
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 2);
      s.push(mkCmd(), { kind: 'snap-1' });
      // After 1 push, undo.length=1 → not a multiple of 2 → no snapshot.
      assert.equal(
        s.getSnapshotCount(),
        0,
        'no snapshot after 1st push (length 1, not a multiple of 2)',
      );
      s.push(mkCmd(), { kind: 'snap-2' });
      assert.equal(
        s.getSnapshotCount(),
        1,
        'snapshot anchored at the 2nd push (length 2 % 2 === 0)',
      );
      const anchor = s.getSnapshotAt(0);
      assert.equal(
        anchor?.anchor_undo_index,
        1,
        'anchor_undo_index points at undo[length-1] after the 2nd push',
      );
      assert.deepEqual(anchor?.snapshot, { kind: 'snap-2' });
    },
  ],
  [
    'push does NOT anchor a snapshot when no snapshot payload is provided',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 1);
      // snapshotEvery=1 means every push qualifies, but absent a payload
      // we must not add a phantom snapshot.
      s.push(mkCmd());
      assert.equal(
        s.getSnapshotCount(),
        0,
        'snapshot count must remain 0 when snapshot is omitted',
      );
    },
  ],
  [
    'popUndo moves Command from undo → redo; undefined on empty (FR-6)',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 100);
      assert.equal(s.popUndo(), undefined, 'empty stack → undefined');
      const c1 = mkCmd({ args_summary: 'op 1' });
      s.push(c1);
      const popped = s.popUndo();
      assert.equal(popped?.id, c1.id, 'popUndo returns the pushed command');
      assert.equal(s.getUndoSummary().length, 0, 'undo now empty');
      assert.equal(s.getRedoSummary().length, 1, 'redo received the command');
      assert.equal(
        s.getRedoSummary()[0]?.id,
        c1.id,
        'redo top is the popped command',
      );
    },
  ],
  [
    'popRedo moves Command from redo → undo; undefined on empty (FR-7)',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 100);
      assert.equal(s.popRedo(), undefined, 'empty redo → undefined');
      const c1 = mkCmd();
      s.push(c1);
      s.popUndo(); // populate redo
      const popped = s.popRedo();
      assert.equal(popped?.id, c1.id, 'popRedo returns the redo top');
      assert.equal(s.getRedoSummary().length, 0, 'redo now empty');
      assert.equal(s.getUndoSummary().length, 1, 'undo received the command');
    },
  ],
  [
    'getUndoSummary / getRedoSummary return projections newest-first (FR-21)',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 100);
      const c1 = mkCmd({ args_summary: 'op 1', tool_name: 'add_layer' });
      const c2 = mkCmd({ args_summary: 'op 2', tool_name: 'set_selection' });
      const c3 = mkCmd({ args_summary: 'op 3', tool_name: 'remove_layer' });
      s.push(c1);
      s.push(c2);
      s.push(c3);
      const undoSum = s.getUndoSummary();
      assert.equal(undoSum.length, 3);
      assert.deepEqual(
        undoSum.map((x: CommandSummary) => x.args_summary),
        ['op 3', 'op 2', 'op 1'],
        'undo summary is newest-first',
      );
      // CommandSummary projection shape (FR-21).
      const top = undoSum[0]!;
      assert.equal(top.id, c3.id);
      assert.equal(top.tool_name, 'remove_layer');
      assert.equal(top.args_summary, 'op 3');
      assert.equal(typeof top.created_at, 'string');
      // No apply / revert leakage in the projection.
      assert.equal(
        (top as unknown as { apply?: unknown }).apply,
        undefined,
        'apply must NOT be exposed in the summary projection',
      );
      assert.equal(
        (top as unknown as { revert?: unknown }).revert,
        undefined,
        'revert must NOT be exposed in the summary projection',
      );
      // Now exercise redo summary newest-first.
      s.popUndo(); // op 3 → redo
      s.popUndo(); // op 2 → redo
      const redoSum = s.getRedoSummary();
      assert.deepEqual(
        redoSum.map((x: CommandSummary) => x.args_summary),
        ['op 2', 'op 3'],
        'redo summary is newest-first (op 2 was pushed onto redo last)',
      );
    },
  ],
  [
    'totalMemoryBytes returns a finite number > 0 with at least one command pushed',
    () => {
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 100);
      const empty = s.totalMemoryBytes();
      assert.ok(Number.isFinite(empty), 'finite when empty');
      assert.ok(empty >= 0, 'non-negative when empty');
      s.push(mkCmd({ args_summary: 'a sizeable summary string' }));
      const after = s.totalMemoryBytes();
      assert.ok(Number.isFinite(after), 'finite after push');
      assert.ok(after > 0, 'positive after at least one command pushed');
      assert.ok(after > empty, 'memory increases after a push');
    },
  ],
  [
    'snapshot anchor index tracks undo.length−1 across multiple anchors',
    () => {
      // snapshotEvery=3 → anchors after pushes 3, 6, 9, ...
      const s = new ClientDocumentStack('tok', 'doc_TEST', 100, 3);
      const snap = (n: number): DocumentSnapshot => ({ n });
      for (let i = 1; i <= 9; i += 1) {
        s.push(mkCmd({ args_summary: `op ${i}` }), snap(i));
      }
      assert.equal(s.getSnapshotCount(), 3, 'three anchors after 9 pushes');
      // Anchor indices are length-1 at the time of the push:
      //   length=3 → idx 2; length=6 → idx 5; length=9 → idx 8.
      assert.equal(s.getSnapshotAt(0)?.anchor_undo_index, 2);
      assert.equal(s.getSnapshotAt(1)?.anchor_undo_index, 5);
      assert.equal(s.getSnapshotAt(2)?.anchor_undo_index, 8);
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
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed}/${cases.length} stack.test cases failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} stack.test cases passed.`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('unexpected error:', err);
  process.exit(1);
});
