#!/usr/bin/env tsx
/**
 * Unit tests for {@link Command} + {@link buildCommand}
 * (undo-redo-system task A.1).
 *
 * Asserts requirements.md §3.1 (FR-1, FR-2, FR-3) and design.md §3:
 *   - `buildCommand` populates `id` (ULID-shaped, 26 chars Crockford
 *     base32) and `created_at` (ISO-8601 string).
 *   - `apply()` returns the result and stores it in `_result`.
 *   - `revert()` is callable and uses the user-supplied function.
 *   - Pass-through fields (`tool_name`, `document_id`, `args_summary`,
 *     `weight`) match the spec verbatim.
 *
 * Runner: `tsx` (matches the rest of `libs/server/src/__tests__`).
 * Run: `pnpm --filter @diffusecraft/server exec tsx \
 *        src/lib/undo-redo/__tests__/command.test.ts`.
 */
import { strict as assert } from 'node:assert';

import { buildCommand, type Command, type CommandSpec } from '../command.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const baseSpec = <R>(over: Partial<CommandSpec<R>>): CommandSpec<R> => ({
  tool_name: 'add_layer',
  document_id: 'doc_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  args_summary: "Add layer 'Generated: red barn'",
  weight: 'medium',
  apply: (async () => undefined as unknown as R) as () => Promise<R>,
  revert: async () => undefined,
  ...over,
});

const cases: Array<[string, () => Promise<void> | void]> = [
  [
    'buildCommand populates id with a ULID-shaped 26-char Crockford string',
    () => {
      const cmd = buildCommand(baseSpec<void>({}));
      assert.equal(typeof cmd.id, 'string');
      assert.equal(cmd.id.length, 26, `expected 26-char ULID, got ${cmd.id.length}`);
      assert.match(cmd.id, ULID_RE, `id "${cmd.id}" does not match ULID Crockford-base32 shape`);
    },
  ],
  [
    'buildCommand populates created_at with an ISO-8601 string',
    () => {
      const before = Date.now();
      const cmd = buildCommand(baseSpec<void>({}));
      const after = Date.now();
      assert.equal(typeof cmd.created_at, 'string');
      assert.match(cmd.created_at, ISO_RE, `created_at "${cmd.created_at}" not ISO-8601`);
      const t = Date.parse(cmd.created_at);
      assert.ok(Number.isFinite(t), 'created_at must parse as a date');
      assert.ok(t >= before && t <= after, 'created_at must be within the construction window');
    },
  ],
  [
    'two buildCommand calls produce distinct ids',
    () => {
      const a = buildCommand(baseSpec<void>({}));
      const b = buildCommand(baseSpec<void>({}));
      assert.notEqual(a.id, b.id, 'each Command must have a unique id');
    },
  ],
  [
    'apply() returns the result and stores it in _result',
    async () => {
      const payload = { layer_id: 'lyr_01HZZ' } as const;
      let applyCalls = 0;
      const cmd = buildCommand(
        baseSpec<typeof payload>({
          apply: async () => {
            applyCalls += 1;
            return payload;
          },
        }),
      );

      assert.equal(cmd._result, undefined, '_result is undefined before apply()');
      const returned = await cmd.apply();
      assert.equal(applyCalls, 1, 'user-supplied apply ran exactly once');
      assert.equal(returned, payload, 'apply() returns the user payload');
      assert.equal(cmd._result, payload, 'apply() captures payload into _result');
    },
  ],
  [
    'revert() is callable and uses the user-supplied function',
    async () => {
      let reverts = 0;
      const cmd = buildCommand(
        baseSpec<void>({
          revert: async () => {
            reverts += 1;
          },
        }),
      );
      await cmd.revert();
      assert.equal(reverts, 1, 'user-supplied revert was invoked');
    },
  ],
  [
    'pass-through fields (tool_name, document_id, args_summary, weight) are forwarded verbatim',
    () => {
      const spec = baseSpec<number>({
        tool_name: 'set_selection',
        document_id: 'doc_TEST',
        args_summary: 'Set selection: rect 10,10 → 200,200',
        weight: 'small',
      });
      const cmd = buildCommand(spec);
      assert.equal(cmd.tool_name, 'set_selection');
      assert.equal(cmd.document_id, 'doc_TEST');
      assert.equal(cmd.args_summary, 'Set selection: rect 10,10 → 200,200');
      assert.equal(cmd.weight, 'small');
    },
  ],
  [
    'Command<R> is generically typed (compile-time probe via runtime values)',
    async () => {
      const cmd: Command<string> = buildCommand<string>(
        baseSpec<string>({
          apply: async () => 'applied',
        }),
      );
      const out: string = await cmd.apply();
      assert.equal(out, 'applied');
      assert.equal(cmd._result, 'applied');
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
    console.error(`\n${failed}/${cases.length} command.test cases failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${cases.length}/${cases.length} command.test cases passed.`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('unexpected error:', err);
  process.exit(1);
});
