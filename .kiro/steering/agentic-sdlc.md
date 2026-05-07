# Agentic SDLC

How DiffuseCraft is built. This document is steering, not a tutorial — it documents the **rules and rationale** behind the workflow so any contributor (human, Claude, Codex, Gemini, future agents) operates the same way without reverse-engineering it from the skill files.

`CLAUDE.md` points at the skills. **This file explains why those skills exist and how they compose.**

## Core stance

DiffuseCraft uses a **Kiro-style spec-driven development workflow on an agentic SDLC**. Three things are true at once:

1. **Specs are the unit of work, not tickets.** A feature lives in `.kiro/specs/<feature>/{requirements,design,tasks}.md`. The repo's own steering (`.kiro/steering/`) sits above specs as durable project memory.
2. **Agents are first-class implementers.** The same `kiro-impl` flow that a human triggers is run autonomously by Claude Code as subagents-per-task with reviewer gating. The pipeline is designed to be safe when a non-human is at the keyboard.
3. **Evidence beats assertion.** "Done" is a claim that requires fresh, reproducible evidence — not a self-report. `kiro-verify-completion` is the gate; reviewer subagents are the auditor.

If a workflow shortcut would erode any of those three, we don't take it. Velocity in this repo comes from *less rework*, not from skipping phases.

## The four phases (and why each exists)

```
Discovery  →  Specification  →  Implementation  →  Validation
(optional)    (gated × 3)        (gated × N tasks)   (cross-task)
```

| Phase | Skill | What gets produced | Why this phase exists |
|---|---|---|---|
| **Discovery** | `kiro-discovery` | `brief.md` (single-spec) or `roadmap.md` (multi-spec) | Decide whether the idea is one feature or a wave; capture the "why" before requirements freeze it |
| **Specification — Requirements** | `kiro-spec-requirements` | `requirements.md` (EARS format) | Force the user-visible contract to be unambiguous before any code is touched |
| **Specification — Design** | `kiro-spec-design` | `design.md` (architecture, schemas, sequence diagrams) | Translate WHAT into HOW with enough detail that an implementer needs no further design decisions |
| **Specification — Tasks** | `kiro-spec-tasks` | `tasks.md` (checklist with DoD per item) | Break design into independently-completable units sized for one subagent run |
| **Implementation** | `kiro-impl` | Code + commits | Execute the tasks. Autonomous mode runs one subagent per task; manual mode runs them in main context. **Reviewer-gated either way.** |
| **Validation** | `kiro-validate-impl` | Pass/fail report | Prove the *feature* works as a whole, not just each task in isolation |

**Approval boundaries.** Each specification artifact is human-reviewed before the next is generated. The `-y` fast-track skips approval prompts but **does not skip the artifacts** — they still get written and committed, so the audit trail is intact.

## Why subagents-per-task (autonomous mode)

When `kiro-impl <feature>` is invoked without specific task numbers, the runtime dispatches **one subagent per task** rather than implementing everything in the main context. This is deliberate.

| Property | Effect |
|---|---|
| **Context isolation per task** | Each subagent starts fresh. It does not inherit the main session's clutter, half-formed assumptions, or prior errors. |
| **Bounded blast radius** | A subagent that goes off-script affects one task. The reviewer catches it before merge. The main session never absorbed the bad reasoning. |
| **Forced spec re-reading** | The subagent has not read `requirements.md` and `design.md` before — it must read them. This catches drift between what the spec says and what the main session "remembered." |
| **Independent reviewer** | The reviewer subagent (`kiro-review`) likewise starts fresh; it has no incentive to confirm the implementer's choices. |
| **Parallelizable when safe** | Independent tasks (no shared file, no sequential dependency) can be dispatched in parallel — see `superpowers:dispatching-parallel-agents`. Sequential dependencies stay sequential. |

The cost is real: each subagent is a fresh-context cache miss. We accept that cost because the alternative — a single 100-task main session — produces drift that costs more to repair than the cache misses cost to avoid.

**Manual mode** (`kiro-impl <feature> 1,3,5`) keeps the work in the main session. Use it when the user wants to watch the changes land in real time, or when the tasks are small enough that subagent overhead dominates. **Reviewer gating is unchanged** — even manual mode passes through `kiro-review` before a task is marked complete.

## Reviewer gating (`kiro-review`)

Every implemented task is reviewed by an independent agent before being marked done. The reviewer's job is **not** to rubber-stamp. The reviewer:

1. **Reads the approved spec** (`requirements.md`, `design.md`, the specific task in `tasks.md`).
2. **Reads the diff** the implementer produced.
3. **Reads the verification evidence** the implementer attached.
4. **Decides:** accept, request changes, or reject.

The reviewer is adversarial by design. "It looks fine" is not a review. A review must cite either (a) a specific spec clause the diff satisfies, or (b) a specific gap the diff leaves open. If the reviewer cannot do either, the diff is not yet reviewable — kick it back for evidence.

**The reviewer never silently fixes.** If the implementer missed something, the reviewer flags it and the implementer (or a remediation subagent) fixes it. This keeps the implementer/reviewer roles distinct so the next reviewer pass is still independent.

## Verification before completion (`kiro-verify-completion`)

A "done" claim must be backed by **fresh evidence**, not by reasoning. The required evidence depends on what was built:

| Kind of work | Required evidence |
|---|---|
| TypeScript library code | `tsc --noEmit` clean on the affected projects; lint clean |
| MCP tool handler | `mcp-tools` catalog conformance check passes; the new tool appears in `dist/catalog.json`; a small ad-hoc invocation script proves the handler shape |
| Server middleware/transport | Server starts; affected route returns expected status; logs show the path was exercised |
| RN screen / component | Metro bundles; the screen renders on iOS Simulator (or device); the specific interaction was driven manually; `/tmp/device.log` reviewed for runtime warnings |
| RN canvas/gesture code | As above + the gesture/draw path was exercised with stylus or simulator finger; no Skia/Reanimated runtime errors in `/tmp/device.log` |

**During the testing-deferred phase (`testing.md`)**, automated test runs are *not* acceptable evidence — because they may not exist or may be archived. The bar is "type-check + manual run + visual inspection," verbatim from `testing.md`. When testing resumes, the automated suite returns to the evidence list.

**Stale evidence is no evidence.** A claim made at 14:00 backed by a `tsc` run from 13:30, with three commits in between, is not verified — it is hopeful. Re-run before claiming.

## Debugging protocol (`kiro-debug`)

When implementation hits a bug, test failure, or unexpected behavior, the response is **root-cause-first**, not patch-first.

1. **Reproduce.** Confirm the bug exists with the exact steps. If it cannot be reproduced, that is the first finding.
2. **Localize.** Read the failing path top-down (logs → handler → store → SDK → wire). Skip nothing.
3. **Hypothesize.** State the suspected cause as a *falsifiable* claim.
4. **Disprove or confirm.** Add a probe (a log, a breakpoint, a printf if that's what the runtime affords) that distinguishes the hypothesis from the alternatives.
5. **Fix the cause, not the symptom.** A patch that suppresses the symptom without identifying the cause is rejected, even if the symptom goes away.

**Bypassing safety checks (`--no-verify`, `git push --force` against a shared branch, mocking the database in an integration test, deleting a failing assertion) is not a fix.** It is a tell that the bug is still present, dressed up. The skill `superpowers:systematic-debugging` codifies the same sequence; use it whenever a bug bites.

## How this connects to the principles

The SDLC enforces specific principles from `principles.md`:

| Workflow rule | Principle it enforces |
|---|---|
| Spec-first; no code before `tasks.md` is approved | P25 (no half-finished implementations) — partial work doesn't enter the repo |
| MCP tool catalog declared in `mcp-tools` before handlers exist in `server` | P1 (agent-first), P5 (state queryable), P6 (idempotency declared in metadata) |
| Reviewer subagent reads spec independently | P2 (no privileged GUI internals — both UI and agent paths land via the same handler) |
| Verification-before-completion forbids assertion-only "done" | P25 again, plus the "evidence beats assertion" stance above |
| Subagent-per-task forces fresh spec read | P20 (library independence) — each task lands in its layer without bleed-through |

## Skill priority (when multiple apply)

1. **Process skills first** — `kiro-discovery`, `superpowers:brainstorming`, `superpowers:systematic-debugging`. These set HOW.
2. **Implementation skills second** — `kiro-impl`, domain-specific skills. These execute.
3. **Verification skills last** — `kiro-verify-completion`, `kiro-review`, `kiro-validate-impl`. These gate.

When a skill applies even at 1% likelihood, invoke it (per `superpowers:using-superpowers`). Skipping a skill because "this is just a small change" is the failure mode the SDLC is designed to prevent — small changes accumulate drift fastest.

## What this document is NOT

- **Not a replacement for the skills.** The skills carry the procedural detail; this document carries the rationale.
- **Not a process manual for outside contributors.** External contributors follow `CONTRIBUTING.md` (when written). This file is for repo insiders and the agents working alongside them.
- **Not negotiable per-PR.** Workflow shortcuts are a steering change. If a phase repeatedly produces no value, the steering is updated, not bypassed.
- **Not a contract about cadence.** Specs may take days; tasks may be minutes. The SDLC is shape-first, not time-first.

## Reference matrix

| Concern | Where the procedural detail lives |
|---|---|
| Spec phase commands | `.claude/skills/kiro-spec-{init,requirements,design,tasks,quick,batch}/SKILL.md` |
| Implementation orchestration | `.claude/skills/kiro-impl/SKILL.md` |
| Reviewer protocol | `.claude/skills/kiro-review/SKILL.md` |
| Verification protocol | `.claude/skills/kiro-verify-completion/SKILL.md` |
| Debug protocol | `.claude/skills/kiro-debug/SKILL.md` |
| Subagent dispatch patterns | `superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development` |
| Plan/execute split | `superpowers:writing-plans`, `superpowers:executing-plans` |
| TDD posture (currently disabled) | `testing.md` overrides `superpowers:test-driven-development` |
| Roadmap of in-flight specs | `.kiro/roadmap.md` |
| Active specs | `.kiro/specs/<feature-slug>/` |

## TBD

- Whether reviewer subagents should also enforce a "no new public exports without TSDoc" check automatically. Currently a code-review item; could move to skill-level.
- Whether `kiro-validate-impl` should run on every spec merge or only on milestone closures. Today it is per-spec; cost may push it to milestones.
- Whether to add a `kiro-rollback` skill for clean reversion of a partially-implemented feature. Today this is git's job; if a feature is rolled back often enough, codify it.
