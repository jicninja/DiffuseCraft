# Tests — backup

Storage for test code that is **paused** during the pre-v1 fast-iteration phase. See `.kiro/steering/testing.md` for the active rule (testing disabled).

These directories were moved out of the source tree on 2026-05-04 so they don't run, don't get type-checked as part of source builds, and don't trip up reviewers — but the code is preserved verbatim so it can be restored at the end of v1.

## Layout

| Backed-up path here | Original source path |
|---|---|
| `canvas-core__tests__/` | `libs/canvas-core/src/__tests__/` |
| `core__tests__/` | `libs/core/src/__tests__/` |
| `mcp-tools__tests__/` | `libs/mcp-tools/src/__tests__/` |
| `server__tests__/` | `libs/server/src/__tests__/` |
| `server-undo-redo__tests__/` | `libs/server/src/lib/undo-redo/__tests__/` |
| `visual-verification__tests__/` | `apps/mobile/visual-verification/scripts/__tests__/` |

## When testing is re-enabled

1. Delete `.kiro/steering/testing.md` (or invert the rule).
2. Move each directory back to its original path (see table above).
3. Re-run the test suite to see what still passes — APIs may have drifted while testing was paused; treat surviving tests as a starting point, not a guarantee.
4. Update or delete the `feedback_testing_disabled.md` memory entry.

## Exception — `catalog-conformance`

`mcp-tools__tests__/catalog-conformance.ts` is **not actually a test** — it's a build-time invariant check (tool count cap, catalog byte budget, description word caps) that the build script `libs/mcp-tools/scripts/emit-json-schema.ts` calls during `pnpm --filter @diffusecraft/mcp-tools build:catalog`. Because it lived under `__tests__`, it got swept into this backup, but a copy was restored to `libs/mcp-tools/src/conformance/catalog-conformance.ts` so the build still works. The two files are identical at backup time. When testing is re-enabled, decide whether to keep both copies or move the canonical one back into `__tests__/`.

## Do not

- Do not edit files inside this folder during the paused phase. If a test references API that you change, the right move is "leave it stale, fix at restore time" — the whole point of the backup is to freeze it.
- Do not import from this folder. Nothing in the active source tree should reference `.kiro/tests-backup/...`.
