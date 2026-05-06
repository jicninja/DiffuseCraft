# Testing — DEFERRED TO END OF v1

**Status:** Testing is **paused and archived** until the very end of the v1 cycle. Do not write, request, or enforce tests in the meantime. Existing test code has been moved to `.kiro/tests-backup/` (see that folder's `README.md` for the layout and restore procedure).

## What this means

- Do **not** create `*.test.*` or `*.spec.*` files for new code.
- Do **not** add `it(...)`, `describe(...)`, snapshot, or RTL assertions when implementing tasks.
- Do **not** block task completion on "missing tests" or "no test coverage."
- Do **not** invoke `vitest`, `nx test`, RN Testing Library, Maestro, or any test runner as part of normal development.
- Verification of work happens via **type-check + manual run + visual inspection** instead of an automated test suite.

## Implications for the spec workflow

- `tasks.md` should not contain dedicated "write tests for X" tasks. If an existing spec has them, treat them as deferred (skip, don't fail).
- `kiro-verify-completion`, `kiro-review`, and reviewer subagents must **not** request test runs as evidence. Acceptable evidence during this phase: TypeScript compiles, lint passes, the screen/feature was exercised manually (or, for non-UI code, a small ad-hoc script proved the behavior).
- The `tech.md` "Testing approach" matrix and `structure.md` "Testing layout" sections describe the **eventual** target, not current obligations. They are frozen — do not delete — but they are not in force right now.

## When testing resumes

The user has confirmed testing will be revisited **at the end of v1**, after the UI / schema / MCP tool surface stabilizes. At that point: delete this file, move directories from `.kiro/tests-backup/` back to their original paths (per its README), and re-run the suite — expect drift, treat survivors as a starting point. Until that moment, **this rule overrides any earlier "Testing Standards" doc, prior steering text, skill defaults, or TDD guidance** — including superpowers' `test-driven-development`. Code-only delivery is the active mode.

**Single exception:** `libs/mcp-tools/src/conformance/catalog-conformance.ts` is a build-time invariant check (tool count, catalog byte budget, description caps) consumed by `scripts/emit-json-schema.ts`. It lives outside `__tests__` and stays active. Don't confuse it with paused tests.

## Why

Velocity. The product is in a fast pre-v1 design/iteration phase where the UI, schema, and MCP tool surface are all still moving. Tests written now would mostly assert against shapes that are about to change, producing churn instead of safety. We will reintroduce the testing pyramid (unit → integration → critical-path E2E per `tech.md`) once the surface stabilizes.
