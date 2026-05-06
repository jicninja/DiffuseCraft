# UI Implementation Roadmap — `.pen` → tablet app

> Sub-roadmap focused on translating the canonical `.pen` design file into running React Native code in `apps/mobile`. Independent of the feature backlog in `_backlog.md` — this roadmap defines **only** the UI/design-handoff axis.

## Scope decisions (confirmed)

1. **Implementation depth:** chrome + navigation skeleton. No real integration with `diffusion-client`, MCP, canvas, pairing, or stores. Stubs only. Real wiring lives in dedicated specs (`pairing-protocol`, `client-state-architecture`, `canvas-fundamentals`, etc.).
2. **Design handoff:** static snapshot (JSON + PNG per artboard) checked into `apps/mobile/design-snapshot/`. No live `.pen` reads at code time.
3. **Multi-agent execution:** orchestrator + parallel screen implementers for the screens spec. Foundation specs are sequential.
4. **Visual verification:** informative diff in v1 (not blocking). Pipeline produced, threshold tuning deferred.

## Specs in dependency order

> All 5 specs are written (requirements.md + design.md + tasks.md). Status: **specced**.

| Wave | # | Slug | Depends on | Status | Brief |
|---|---|---|---|---|---|
| 0 (sequential) | 1 | `design-system-foundation` | — | specced | Tokens (color, spacing, radii, type) materialised in `tailwind.config.js`. NativeWind v4 wired. ThemeProvider in `@diffusecraft/ui`. Swatch screen mounting every token visually. Token names/structure are frozen here for the rest of the project. |
| 0 (sequential) | 2 | `ui-component-library` | 1 | specced | ~22 `react-native-reusables` primitives pasted into `@diffusecraft/ui/components/` (Button, Input, Textarea, Label, Slider, Switch, Checkbox, RadioGroup, Card, Separator, Badge, Avatar, Skeleton, Dialog, AlertDialog, Popover, Tooltip, Tabs, Accordion, Collapsible, Select, Combobox, ContextMenu, DropdownMenu, Progress, Toast). Web variants dropped, tokens applied, snapshot tests. |
| 0 (sequential) | 3 | `app-shell-navigation` | 2 | specced | `react-navigation` structure for the 13 screens. Stacks: Auth (Pairing flow), Root (Documents → Editor), Editor inner stack (workspaces are tabs, not stacks), Settings master/detail. Deep link map. Each screen renders a placeholder. |
| 1 (parallel) | 4 | `screens-implementation` | 3 | specced | The 13 screens implemented to match the `.pen` snapshot — orchestrator + 13 parallel implementer subagents, one per artboard. Each implementer reads its artboard's snapshot JSON + PNG, produces `apps/mobile/src/screens/<Name>.tsx`, and self-verifies visually. Outputs a chrome-only app: navigable, no real data. |
| 1 (parallel) | 5 | `visual-verification` | 4 | specced | Screenshot-diff pipeline. Maestro (or Detox) launches the RN app, captures each screen, diff against the `.pen` PNG snapshot via odiff/pixelmatch. CI step reports divergences as artifacts (not gating in v1). |

**Parallelism note:** specs 4 and 5 are listed in the same wave because they're independent: 5's tooling can be built while 4's screens are being written. However 5's diff results are only meaningful once 4 has produced screens, so review-gating couples them.

## Phase 0 — `.pen` snapshot extraction (one-shot, before any spec)

A single utility task, NOT a spec, executed by the orchestrator before kicking off Wave 0:

- Open the canonical `.pen` document via the pencil MCP.
- For each of the 13 artboards: `export_nodes` → JSON; `get_screenshot` → PNG.
- Write to `apps/mobile/design-snapshot/<artboard-label>/{nodes.json, preview.png}`.
- Also export a `tokens.json` from `get_variables` and a `swatch.png` from the swatch board.
- Write `apps/mobile/design-snapshot/manifest.json` listing all artboards, sizes, source `.pen` ref, snapshot timestamp.

The snapshot is **versioned** (re-runnable when the design changes). Each spec's design.md cites `manifest.json` version it was authored against.

## Acceptance for the whole pass

- 5 specs created ✅ (all specced — requirements + design + tasks written) in `.kiro/specs/`.
- Phase 0 snapshot present in `apps/mobile/design-snapshot/` (or scheduled as the first task of spec 1).
- Specs reviewed and approved per Kiro 3-phase workflow before any implementation runs.
- After implementation: `pnpm dev` (Expo) renders the 13 screens, every screen reachable via `react-navigation`, every chrome element matches the `.pen` artboard within visual-verification thresholds.

## Out of scope

- Real ComfyUI / MCP / pairing / canvas integration.
- Light theme.
- Phone fallback layout.
- Animation polish beyond what `react-native-reanimated` defaults already give.
- A11y audit (deferred to a later spec once chrome is stable).

## Open items deferred until after Wave 0

- Whether `@diffusecraft/ui` exports a Storybook-RN target (likely yes, post-v1).
- Whether visual diff threshold should be per-token or per-region.
- Whether snapshot extraction lives as a `tools/snapshot-pen.ts` script in the monorepo or as an ad-hoc orchestrator action each time.
