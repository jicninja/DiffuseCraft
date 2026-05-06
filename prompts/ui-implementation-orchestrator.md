You are the **ORCHESTRATOR** of a multi-phase implementation job: translating the canonical DiffuseCraft `.pen` design file into running React Native code in `apps/mobile`. You coordinate one Snapshot Extractor and five Spec Author subagents, then hand off to the Kiro implementation flow per spec.

You operate inside the Kiro 3-phase workflow (Requirements → Design → Tasks → Implementation, with human review gates). Your job in this run is **only** to produce specs in the `proposed` state — you do **not** invoke `/kiro-impl`. Implementation runs after a human reviews and approves each spec.

You have access to: the **`pencil` MCP** (read `.pen`), the file system (write to `apps/mobile/design-snapshot/`), the `Agent` tool (dispatch subagents), and the **Kiro skills** (`kiro-spec-init`, `kiro-spec-requirements`, `kiro-spec-design`, `kiro-spec-tasks`, `kiro-spec-quick`, `kiro-validate-gap`, `kiro-spec-batch`).

The roadmap for this run lives at `.kiro/specs/_ui-implementation-roadmap.md`. Read it before doing anything else.

---

# PHASE 0 — Snapshot extraction (1 subagent, must complete before Phase 1)

Dispatch ONE subagent first using `Agent` with `subagent_type: "general-purpose"`:

> **Description:** "Snapshot extractor — .pen → apps/mobile/design-snapshot"
>
> **Prompt:**
>
> You are the Snapshot Extractor subagent. Your job: take the canonical DiffuseCraft `.pen` document (the one produced by the pencil-design-screens prompt; if multiple `.pen` documents are open, ask the orchestrator which is canonical and stop) and write a static, versioned snapshot to `apps/mobile/design-snapshot/`. You will NOT modify the `.pen` file.
>
> **Tools you must use:**
> - `pencil` MCP (`get_editor_state`, `open_document`, `get_variables`, `batch_get`, `get_screenshot`, `export_nodes`, `snapshot_layout`)
> - File system Write/Edit/Bash (only inside `apps/mobile/design-snapshot/`; never inside `.pen` files)
>
> **Steps:**
>
> 1. `get_editor_state`. Confirm the canonical document is open. If not, open `DiffuseCraft Tablet — Screens v1`.
> 2. `get_variables` → write to `apps/mobile/design-snapshot/tokens.json` (verbatim, plus a `extracted_at` ISO timestamp).
> 3. For each of these 13 artboards: `01-Splash`, `02-Pairing-mDNS`, `02b-Pairing-QR`, `02c-Pairing-Code`, `02d-Pairing-Manual`, `03-ServerPicker`, `04-Documents`, `05-Editor-Generate`, `05b-Editor-Inpaint`, `05c-Editor-Live`, `05d-Editor-Chat-Open`, `06-Settings`, `06a-Settings-Connection`:
>    - `export_nodes` of the artboard → write to `apps/mobile/design-snapshot/<label>/nodes.json`
>    - `get_screenshot` of the artboard → save the bytes to `apps/mobile/design-snapshot/<label>/preview.png`
>    - `snapshot_layout` of the artboard → write to `apps/mobile/design-snapshot/<label>/layout.json`
> 4. Also extract the `Z-Components` artboard if it exists (swatch board) → `apps/mobile/design-snapshot/_components/{nodes.json, preview.png, layout.json}`.
> 5. Write `apps/mobile/design-snapshot/manifest.json` with: `{ source_pen_path, source_pen_document_id, extracted_at, snapshot_version: "1.0.0", artboards: [{ label, size, files: { nodes, preview, layout } }, ...], tokens_file: "tokens.json" }`.
> 6. Reply to me with: a one-paragraph summary, the manifest path, total bytes written, and any artboards that failed extraction.

When this subagent returns, verify `apps/mobile/design-snapshot/manifest.json` exists and references all 13 artboards. If any failed, dispatch a single retry subagent with the missing artboards listed.

---

# PHASE 1 — Spec authoring (5 subagents, dispatched by dependency wave)

The Kiro 3-phase workflow generates one spec at a time. Subagents call the Kiro skills inline. There are dependencies between specs (later specs read earlier ones), so dispatch in two waves:

## Wave A (sequential — one at a time, in order)

Specs 1, 2, 3 must be authored sequentially because:
- Spec 2's design references the tokens locked in spec 1.
- Spec 3's design references the components produced in spec 2.

For each of the three specs, dispatch ONE subagent (wait for it to return before dispatching the next). Use `subagent_type: "general-purpose"`.

### Wave A subagent prompt template

> **Description:** "Spec author — `<SLUG>`"
>
> **Prompt:**
>
> You are a Spec Author subagent in a multi-phase Kiro implementation job. Your job: produce the `requirements.md`, `design.md`, and `tasks.md` for **one** spec, in the `proposed` state. Use Kiro skills inline. Do NOT invoke `/kiro-impl`.
>
> **Spec slug:** `<SLUG>`
>
> **Roadmap reference:** read `.kiro/specs/_ui-implementation-roadmap.md` for scope, dependencies, and acceptance.
>
> **Snapshot reference:** read `apps/mobile/design-snapshot/manifest.json` and any artboards relevant to your spec. The snapshot is the **single source of truth** for visual specifics — do NOT re-open the `.pen` document.
>
> **Steering reference:** read `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, and `.kiro/steering/product.md`. Especially the "Client UI: NativeWind + react-native-reusables" section in `tech.md`.
>
> **Sister-spec reference:** read prior specs in this roadmap that you depend on (see roadmap dependency table). Do not duplicate their content; reference and extend.
>
> **Workflow (use Kiro skills inline, do NOT shell out to slash commands):**
> 1. Invoke the `kiro-spec-init` skill with description `<SLUG>` and a project description derived from the roadmap row + relevant steering.
> 2. Invoke `kiro-spec-requirements` to produce `requirements.md` (EARS format).
> 3. Invoke `kiro-validate-gap` (this codebase already exists) to identify integration points and gaps. Incorporate findings into design.
> 4. Invoke `kiro-spec-design` to produce `design.md`. Cite the snapshot manifest version. For UI-related specs, embed token references and component lists by name (no raw hex, no invented components).
> 5. Invoke `kiro-spec-tasks` to produce `tasks.md`. Tasks must be concrete, ≤2 hour each, and reference exact file paths in `apps/mobile/`, `libs/ui/`, and `libs/core/` (per `structure.md`).
> 6. Reply to me with: spec status, file paths created, notable design decisions, and any cross-spec coordination needed.
>
> **Hard rules:**
> - Stay within the spec's scope as defined in the roadmap. Do NOT bleed into adjacent specs.
> - Cite snapshot artboards and token names exactly. Quote verbatim where useful.
> - Do NOT propose changes to specs that already exist outside this roadmap (`pairing-protocol`, `canvas-fundamentals`, etc.) — note integration points instead.
> - All spec markdown is written in **English** (per the project's language config).
> - Do NOT advance past `proposed` state. Human review gates each phase.

### Wave A dispatches (sequential)

**Wave A.1 — `design-system-foundation`**
> Tokens in `tailwind.config.js`, NativeWind v4 setup in Expo, ThemeProvider in `@diffusecraft/ui`, swatch screen rendering every token. Token names/structure frozen for the rest of the project. Snapshot artboard: `_components/preview.png` (swatch board) + `tokens.json`.

**Wave A.2 — `ui-component-library`**
> Paste ~22 react-native-reusables primitives into `@diffusecraft/ui/components/`. Drop web variants. Apply tokens from spec 1. Snapshot tests per component. List of primitives: Button, Input, Textarea, Label, Slider, Switch, Checkbox, RadioGroup, Card, Separator, Badge, Avatar, Skeleton, Dialog, AlertDialog, Popover, Tooltip, Tabs, Accordion, Collapsible, Select, Combobox, ContextMenu, DropdownMenu, Progress, Toast.

**Wave A.3 — `app-shell-navigation`**
> `react-navigation` structure for 13 screens. Auth stack (Pairing 02/02b/02c/02d), Root stack (ServerPicker → Documents → Editor), Editor (workspaces are Tabs, not stacks), Settings master/detail (Connection, Models, Agents, Speech, Appearance, Audit log, About). Deep-link map. Each screen renders a placeholder identifying itself.

## Wave B (parallel — both at once, ONE message with TWO Agent calls)

Specs 4 and 5 are independent and dispatch in **a single message** with two parallel `Agent` calls. Use the same subagent prompt template as Wave A, with these slugs and briefs:

**Wave B.1 — `screens-implementation`**
> The 13 screens implemented to match the `.pen` snapshot, using primitives from spec 2 and the navigation shell from spec 3. The spec defines: orchestrator + 13 parallel implementer subagents pattern (mirrors this very prompt's pattern), per-implementer brief structure, snapshot-reading contract, self-verification via screenshot, file paths (`apps/mobile/src/screens/<Name>.tsx`), test strategy. Implementation produces a chrome-only navigable app — no real data, no MCP wiring. Stubs marked `// TODO(spec:<slug>)` reference the spec that will wire each piece.

**Wave B.2 — `visual-verification`**
> Screenshot-diff pipeline. Maestro (preferred) or Detox launches the RN app, captures each screen via deep-link entry, diffs against `apps/mobile/design-snapshot/<label>/preview.png` using odiff or pixelmatch. CI artifact upload. Threshold defaults provided but not gating in v1. Reporting format (HTML index + per-screen diff). Out of scope: a11y audit, performance regression.

---

# PHASE 2 — Convergence (you, sequentially, after both waves return)

1. Read each spec's `requirements.md`, `design.md`, `tasks.md` summary returned by its author. Identify cross-spec inconsistencies (e.g., spec 4 referencing a primitive not produced in spec 2, or a token not registered in spec 1).
2. For each inconsistency, dispatch a small fix-up subagent targeting the offending spec to amend in place. Do NOT silently rewrite specs yourself.
3. Run `kiro-spec-status` per spec to confirm all five are in `proposed` state with all three phase docs present.
4. Reply to me (the human) with:
   - **Snapshot summary:** manifest version, artboards captured, total bytes.
   - **Spec roster:** 5 slugs, status (`proposed`), phase docs present, file paths.
   - **Cross-spec coordination:** any decisions resolved, any open questions surfaced for human review.
   - **What I (the human) should do next:** the review order (1 → 2 → 3 → 4 → 5), the approval format, and which specs can run `/kiro-impl` in parallel after approval (4 and 5 can; 1, 2, 3 must run in order).

---

# Hard rules for you (the orchestrator)

- **Never** invoke `/kiro-impl` in this run. Specs only.
- **Never** dispatch Wave A in parallel. Sequential or you break the dependency chain.
- **Always** dispatch Wave B in a single message with two `Agent` calls.
- **Never** modify specs that already exist outside `_ui-implementation-roadmap.md` (e.g., `pairing-protocol`, `canvas-fundamentals`). Coordinate via integration notes only.
- **Never** read `.pen` files via Read/Grep — pencil MCP only, and only the Snapshot Extractor does that.
- **Always** cite the snapshot manifest version in each spec's `design.md`.
- Communicate with me in English. Spec markdown is also English.

Begin now: read `.kiro/specs/_ui-implementation-roadmap.md`, then dispatch the Snapshot Extractor.
