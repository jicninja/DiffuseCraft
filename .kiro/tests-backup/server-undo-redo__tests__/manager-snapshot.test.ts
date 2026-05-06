#!/usr/bin/env tsx
/**
 * Unit tests for `UndoRedoManager` snapshot cadence
 * (undo-redo-system task A.4).
 *
 * Asserts requirements.md §3.3 (FR-10..FR-12: capture a full document
 * snapshot every `snapshot_every_n` Commands and anchor it on the
 * triggering push) per design.md §5 (`maybeSnapshot` consults the
 * provider only when the next push will land on a multiple of N).
 *
 * Behaviors covered:
 *   - With a `snapshotProvider` supplied: 20 executes at
 *     `snapshot_every_n: 5` trigger exactly 4 provider calls (after
 *     ops 5, 10, 15, 20).
 *   - Each captured snapshot anchors on the right zero-based undo index
 *     (4, 9, 14, 19).
 *   - With NO provider supplied: no snapshot anchors are stored on the
 *     stack — the manager remains a snapshot-free no-op (matches the
 *     legacy adapter / handler suites that don't pass a `db`).
 *
 * Runner: `tsx`. Run:
 *   `pnpm exec tsx \
 *     src/lib/undo-redo/__tests__/manager-snapshot.test.ts`.
 */
import { strict as assert } from 'node:assert';

import { buildCommand, type CommandSpec } from '../command.js';
import { UndoRedoManager } from '../manager.js';
import type {
  DocumentSnapshot,
  DocumentSnapshotProvider,
} from '../snapshot.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseSpec = <R>(over: Partial<CommandSpec<R>>): CommandSpec<R> => ({
  tool_name: 'add_layer',
  document_id: 'doc_TEST',
  args_summary: 'op',
  weight: 'small',
  apply: (async () => undefined as unknown as R) as () => Promise<R>,
  revert: async () => undefined,
  ...over,
});

const fakeSnapshot = (n: number): DocumentSnapshot => ({
  document: {
    id: 'doc_TEST',
    name: `snap-${n}`,
    w: 1,
    h: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    modified_at: '2026-01-01T00:00:00.000Z',
  },
  layers: [],
  regions: [],
  control_layers: [],
  selection: null,
});

interface CountingProvider {
  provider: DocumentSnapshotProvider;
  calls: number;
}

const makeCountingProvider = (): CountingProvider => {
  const state = { calls: 0 };
  const provider: DocumentSnapshotProvider = async () => {
    state.calls += 1;
    return fakeSnapshot(state.calls);
  };
  return {
    provider,
    get calls() {
      return state.calls;
    },
  } as CountingProvider;
};

// ---------------------------------------------------------------------------
// Stack-internal probe: the manager doesn't expose snapshot anchors on
// its public surface (intentionally — Phase B owns eviction). For this
// test we read the stack via the manager's internal map. We guard this
// access narrowly so a future refactor can swap to a public accessor.
// ---------------------------------------------------------------------------

interface StackProbe {
  getSnapshotCount(): number;
  getSnapshotAt(index: number): { anchor_undo_index: number } | undefined;
}

const probeStack = (
  mgr: UndoRedoManager,
  token_id: string,
  document_id: string,
): StackProbe | undefined => {
  // The manager keeps stacks under a private `stacks` Map keyed by
  // `${token_id}:${document_id}`. We narrow access through an unknown
  // cast to avoid leaking the field through the public API surface.
  const stacks = (mgr as unknown as { stacks: Map<string, StackProbe> }).stacks;
  return stacks.get(`${token_id}:${document_id}`);
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'snapshotProvider is invoked exactly 4 times across 20 executes (snapshot_every_n=5)',
    async () => {
      const counting = makeCountingProvider();
      const mgr = new UndoRedoManager({
        snapshot_every_n: 5,
        snapshotProvider: counting.provider,
      });
      for (let i = 0; i < 20; i += 1) {
        await mgr.execute(
          'alice',
          'tok_A',
          'doc_TEST',
          buildCommand(baseSpec({ args_summary: `op ${i + 1}` })),
        );
      }
      assert.equal(
        counting.calls,
        4,
        'provider called once per cadence boundary (5, 10, 15, 20)',
      );
    },
  ],
  [
    'each captured snapshot is anchored at the correct undo index (4, 9, 14, 19)',
    async () => {
      const counting = makeCountingProvider();
      const mgr = new UndoRedoManager({
        snapshot_every_n: 5,
        snapshotProvider: counting.provider,
      });
      for (let i = 0; i < 20; i += 1) {
        await mgr.execute(
          'alice',
          'tok_A',
          'doc_TEST',
          buildCommand(baseSpec({ args_summary: `op ${i + 1}` })),
        );
      }
      const stack = probeStack(mgr, 'tok_A', 'doc_TEST');
      assert.ok(stack, 'stack exists for (tok_A, doc_TEST)');
      assert.equal(stack.getSnapshotCount(), 4, 'four snapshot anchors stored');
      const anchors = [
        stack.getSnapshotAt(0)?.anchor_undo_index,
        stack.getSnapshotAt(1)?.anchor_undo_index,
        stack.getSnapshotAt(2)?.anchor_undo_index,
        stack.getSnapshotAt(3)?.anchor_undo_index,
      ];
      assert.deepEqual(anchors, [4, 9, 14, 19], 'zero-based anchors');
    },
  ],
  [
    'with NO snapshotProvider: no snapshot anchors are stored after 20 executes',
    async () => {
      const mgr = new UndoRedoManager({ snapshot_every_n: 5 });
      for (let i = 0; i < 20; i += 1) {
        await mgr.execute(
          'alice',
          'tok_A',
          'doc_TEST',
          buildCommand(baseSpec({ args_summary: `op ${i + 1}` })),
        );
      }
      const stack = probeStack(mgr, 'tok_A', 'doc_TEST');
      assert.ok(stack, 'stack exists');
      assert.equal(
        stack.getSnapshotCount(),
        0,
        'no anchors when no provider is supplied (legacy adapter path)',
      );
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
    console.error(
      `\n${failed}/${cases.length} manager-snapshot.test cases failed.`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n${cases.length}/${cases.length} manager-snapshot.test cases passed.`,
  );
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('unexpected error:', err);
  process.exit(1);
});
