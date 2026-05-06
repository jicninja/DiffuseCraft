# visual-verification — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `screens-implementation` (the 13 running screens whose chrome is the subject of the diff); `app-shell-navigation` (the 16 typed routes + the deep-link map at `apps/mobile/src/navigation/linking.ts` that drive every Maestro flow); `ui-component-library` (the primitives used by every screen — relevant only because the diff is taken against rendered chrome built from them); `design-system-foundation` (the snapshot manifest schema frozen in `design.md` §6 — the reference baseline source).
> **References:** `.kiro/steering/tech.md` §"Stack at a glance" and §"Client UI: NativeWind + react-native-reusables"; `.kiro/steering/structure.md` §"Repository layout"; `_ui-implementation-roadmap.md` row 5 ("Visual verification: informative diff in v1, not blocking; pipeline produced, threshold tuning deferred"); `apps/mobile/design-snapshot/manifest.json` (the reference baseline catalog); `apps/mobile/src/navigation/linking.ts` (the deep-link map cited verbatim by FR-2); `prompts/pencil-design-screens.md` §"WAVE 2 — Screen Designers" (the 13 artboards under verification).

## 1. Purpose

This spec closes the design-fidelity loop on the `.pen` → React Native handoff. It produces an informative screenshot-diff artifact every CI run: each running screen captured by Maestro on a tablet emulator is compared pixel-by-pixel against the `apps/mobile/design-snapshot/<artboard>/preview.png` exported by `design-system-foundation` T1, and a per-screen diff PNG plus an aggregated HTML report are uploaded as build artifacts.

The pipeline is **informative in v1, NOT gating.** Thresholds (5 % warn / 10 % alert) are starting points; a high diff ratio raises a flag for human review, never blocks a merge. Threshold gating, accessibility/contrast audit, performance regression, animation diffs, phone fallback verification, and cross-device matrix runs are explicit non-goals for v1.

The spec produces: a Maestro YAML flow per route, a Node/TS orchestrator that captures + diffs + reports, an `apps/mobile/visual-verification/report/index.html` aggregated viewer, a GitHub Actions workflow that runs the pipeline on every PR, and a local `pnpm verify:visual` script for fast feedback. The 5 Settings detail routes without `.pen` artboards (`Settings.Models`, `Settings.Agents`, `Settings.Speech`, `Settings.Appearance`, `Settings.AuditLog`) are explicitly skipped and marked "no-reference" in the report — they do NOT generate a 100 % diff false positive.

## 2. Stakeholders & user stories

### S1 — Designer reviewing fidelity after a chrome PR

> **Story 1.** As the design reviewer cross-checking the running app against the canonical `.pen`, I open the latest CI build's `visual-verification` artifact, scroll the HTML index, and see all 13 screens side-by-side: reference (left) / runtime capture (middle) / pixel diff (right). A `ratio` chip on each screen tells me at a glance which screens drifted. I do NOT need to install anything, run an emulator, or read code.

### S2 — Engineer adding or updating a screen

> **Story 2.** As an `apps/mobile` developer who just rewrote `Editor/RightPanel/Layers.tsx`, I run `pnpm verify:visual` locally before pushing. The script boots my emulator, drives Maestro through every flow, runs odiff, and opens `apps/mobile/visual-verification/report/index.html` in my browser. The Editor screen's diff column shows what I changed; if the ratio jumped past warn, I decide whether the change is intentional and either iterate or proceed.

### S3 — Reviewer commenting on a PR

> **Story 3.** As a code reviewer on a PR that touches `apps/mobile/src/screens/`, I see a comment from the `visual-verification` workflow with a link to the build artifact. I click through, scan the report, and add review comments tied to specific screens whose diff exceeded the warn threshold. My review is informed by visual evidence, not just code.

### S4 — Future maintainer tightening the threshold

> **Story 4.** As a future maintainer planning to promote the diff from informative to gating, I look at six months of artifacts, decide that 3 % is the right warn threshold and 7 % the alert threshold, edit `apps/mobile/visual-verification/scripts/run.ts` to flip a `gating: true` flag, and ship a follow-up spec (`visual-verification-gating`). The current spec's outputs (per-screen JSON, aggregated HTML) are the historical record that informs that decision.

### S5 — Designer who just re-ran the snapshot extractor

> **Story 5.** As the operator who re-ran `tools/snapshot-pen.ts` after a `.pen` redesign, I push the snapshot update. The next CI run reads the bumped `apps/mobile/design-snapshot/manifest.json` `snapshot_version`, detects the version differs from the previous run's record, and flags every screen as `ref-changed` so reviewers know the baseline shifted (large diffs are expected this run, not regressions).

## 3. Functional requirements (EARS)

### 3.1 Capture every running screen

**FR-1 (Ubiquitous).** The pipeline SHALL capture every screen of the 13-artboard set listed in `design-system-foundation` design.md §6.3 by driving the running RN app through Maestro YAML flows. The 13 capture targets are:

| # | Capture label (= artboard) | Maestro flow file |
|---|---|---|
| 1  | `01-Splash` | `apps/mobile/visual-verification/flows/01-splash.yaml` |
| 2  | `02-Pairing-mDNS` | `02-pairing-mdns.yaml` |
| 3  | `02b-Pairing-QR` | `02b-pairing-qr.yaml` |
| 4  | `02c-Pairing-Code` | `02c-pairing-code.yaml` |
| 5  | `02d-Pairing-Manual` | `02d-pairing-manual.yaml` |
| 6  | `03-ServerPicker` | `03-serverpicker.yaml` |
| 7  | `04-Documents` | `04-documents.yaml` |
| 8  | `05-Editor-Generate` | `05-editor-generate.yaml` |
| 9  | `05b-Editor-Inpaint` | `05b-editor-inpaint.yaml` |
| 10 | `05c-Editor-Live` | `05c-editor-live.yaml` |
| 11 | `05d-Editor-Chat-Open` | `05d-editor-chat-open.yaml` |
| 12 | `06-Settings` | `06-settings.yaml` |
| 13 | `06a-Settings-Connection` | `06a-settings-connection.yaml` |

**FR-2 (Ubiquitous).** Each Maestro flow SHALL launch the app via the deep-link patterns declared in `apps/mobile/src/navigation/linking.ts`. The mapping below is taken verbatim from that file; the spec does NOT invent new patterns:

| Flow | Deep link (from `linking.ts`) |
|---|---|
| `01-splash.yaml` | `diffusecraft://splash` |
| `02-pairing-mdns.yaml` | `diffusecraft://pair` |
| `02b-pairing-qr.yaml` | `diffusecraft://pair/qr` |
| `02c-pairing-code.yaml` | `diffusecraft://pair/code` |
| `02d-pairing-manual.yaml` | `diffusecraft://pair/manual` |
| `03-serverpicker.yaml` | `diffusecraft://servers` |
| `04-documents.yaml` | `diffusecraft://documents` |
| `05-editor-generate.yaml` | `diffusecraft://editor/mock-doc-1?workspace=generate` |
| `05b-editor-inpaint.yaml` | `diffusecraft://editor/mock-doc-1?workspace=inpaint` |
| `05c-editor-live.yaml` | `diffusecraft://editor/mock-doc-1?workspace=live` |
| `05d-editor-chat-open.yaml` | `diffusecraft://editor/mock-doc-1/chat` |
| `06-settings.yaml` | `diffusecraft://settings` |
| `06a-settings-connection.yaml` | `diffusecraft://settings/connection` |

If `linking.ts` is amended (post-v1), the flow files SHALL be updated in lockstep; the `routesCoverage.test.ts` from `app-shell-navigation` and a meta-test in this spec (FR-15) jointly enforce the coupling.

### 3.2 Capture artifacts

**FR-3 (Ubiquitous).** Maestro `takeScreenshot` outputs SHALL land at `apps/mobile/visual-verification/captures/<artboard>/<run-timestamp>.png`. Per-screen sub-directories are created as needed; the captures directory is gitignored except for a `.gitkeep`. The `<run-timestamp>` is an ISO-8601 string sanitised for filesystem use (`2026-05-03T14-22-41Z.png`).

### 3.3 Diff against the snapshot reference

**FR-4 (Ubiquitous).** The diff tool SHALL be `odiff` (preferred — Rust-based, fast, anti-aliasing-aware via `--ignore-aa`). `pixelmatch` is documented as a fallback to be selected if odiff proves un-ergonomic in the target CI environment (the orchestrator script abstracts the choice via a single function in `apps/mobile/visual-verification/scripts/diff.ts`). For each captured screen the pipeline SHALL produce:

- `apps/mobile/visual-verification/report/<artboard>.diff.png` — the red/green pixel diff image.
- `apps/mobile/visual-verification/report/<artboard>.diff.json` — the structured result, with shape:
  ```json
  {
    "artboard": "05-Editor-Generate",
    "reference": "apps/mobile/design-snapshot/05-Editor-Generate/preview.png",
    "capture":   "apps/mobile/visual-verification/captures/05-Editor-Generate/2026-05-03T14-22-41Z.png",
    "diff":      "apps/mobile/visual-verification/report/05-Editor-Generate.diff.png",
    "pixels_diff": 12834,
    "total_pixels": 1399296,
    "ratio": 0.00917,
    "threshold": { "warn": 0.05, "alert": 0.10 },
    "passed": true,
    "no_reference": false,
    "ref_changed": false,
    "tool": "odiff",
    "tool_args": ["--antialiasing", "--threshold=0.1"]
  }
  ```

### 3.4 Aggregated report

**FR-5 (Ubiquitous).** An aggregated HTML index SHALL be generated at `apps/mobile/visual-verification/report/index.html` listing every screen with reference / capture / diff side by side, plus the structured stats from FR-4. The page SHALL include:
- A header with `manifest.json` `snapshot_version`, the run's git SHA, run timestamp, total screens covered, and the warn/alert threshold values.
- A summary band with counts: `passed`, `over_warn`, `over_alert`, `no_reference`, `ref_changed`.
- One row per screen with three image columns (reference, capture, diff), a label, ratio chip, and pass/warn/alert badge.
- Filter chips by artboard group (`Pairing`, `Editor`, `Settings`, etc.) so reviewers can narrow the view.

The report is self-contained (no external CDN dependencies); images referenced via relative paths so the artifact opens cleanly when downloaded.

### 3.5 Thresholds (informative, non-gating in v1)

**FR-6 (Ubiquitous).** The default thresholds SHALL be:
- `warn = 0.05` (5 % per-screen pixel ratio).
- `alert = 0.10` (10 % per-screen pixel ratio).

These are starting points based on no prior data; they exist to tag rows in the report, not to gate CI. The pipeline's exit code SHALL NOT be derived from the diff outcome in v1 — only from infrastructural failures (emulator boot failure, Maestro flow crash, diff tool error). Promoting the thresholds to a gate is a follow-up spec.

### 3.6 No-reference handling

**FR-7 (Ubiquitous).** The 5 Settings detail routes without `.pen` artboards SHALL be skipped explicitly. They SHALL NOT have a Maestro flow in `apps/mobile/visual-verification/flows/`. The aggregated HTML report SHALL include a "No-reference" section listing these routes so reviewers see they were intentionally omitted (not silently lost). The skipped routes are:

| Route | Reason |
|---|---|
| `Settings.Models` (`diffusecraft://settings/models`) | No `.pen` artboard yet (per `screens-implementation` FR-18). |
| `Settings.Agents` (`diffusecraft://settings/agents`) | Same. |
| `Settings.Speech` (`diffusecraft://settings/speech`) | Same. |
| `Settings.Appearance` (`diffusecraft://settings/appearance`) | Same. |
| `Settings.AuditLog` (`diffusecraft://settings/audit`) | Same. |

If a future spec adds `.pen` artboards for these routes, `design-system-foundation/T1` regenerates `apps/mobile/design-snapshot/`, the manifest grows entries for them, and this spec's `run.ts` picks them up automatically (the flow files would be added in that follow-up). v1 SHALL NOT preemptively emit a flow file or a 100 %-diff entry for them.

### 3.7 Editor variant capture

**FR-8 (Ubiquitous).** The 4 Editor variants are captured by hitting deep links with the right `?workspace=` query param and `/chat` path suffix as parsed by `linking.ts`'s `Editor` config (which uses `path: 'editor/:documentId/:chatSuffix?'` plus the `chatSuffix` parser that maps the literal segment `chat` → `chat: true`). The four flows are:

| Flow | Deep link | Resulting Editor state |
|---|---|---|
| `05-editor-generate.yaml` | `diffusecraft://editor/mock-doc-1?workspace=generate` | `workspace=Generate`, `chat=false` |
| `05b-editor-inpaint.yaml` | `diffusecraft://editor/mock-doc-1?workspace=inpaint` | `workspace=Inpaint`, `chat=false` |
| `05c-editor-live.yaml` | `diffusecraft://editor/mock-doc-1?workspace=live` | `workspace=Live`, `chat=false` |
| `05d-editor-chat-open.yaml` | `diffusecraft://editor/mock-doc-1/chat` | `workspace=Generate`, `chat=true` |

Each flow SHALL include a `waitForAnimationToEnd` (or equivalent fixed `extendedWaitUntil` of ~500 ms) before `takeScreenshot` to avoid mid-transition captures.

### 3.8 CI integration

**FR-9 (Ubiquitous).** A GitHub Actions workflow at `.github/workflows/visual-verification.yml` SHALL run the full pipeline on every PR (and on `main` after merge) and upload the `apps/mobile/visual-verification/report/` directory as a build artifact named `visual-verification-<run-id>`. The workflow SHALL post (or update) a PR comment linking to the artifact URL so reviewers can open it in one click.

If the project's CI provider differs from GitHub Actions (open question — see `design.md` §11), the workflow file SHALL be adapted while preserving the same job name, the same output artifact name, and the same PR-comment behaviour.

### 3.9 Snapshot version awareness

**FR-10 (Ubiquitous).** The pipeline SHALL read `apps/mobile/design-snapshot/manifest.json`'s `snapshot_version`. The previous run's `snapshot_version` is persisted in a small file at `apps/mobile/visual-verification/report/.last_snapshot_version` (gitignored, regenerated each run from CI artifacts cache or the previous `index.html`). When the current and previous versions differ, every screen's `diff.json` SHALL set `ref_changed: true` and the HTML report SHALL flag the entire run as "Snapshot baseline changed — diffs expected" so reviewers do not mistake legitimate baseline drift for regressions.

### 3.10 Tablet emulator configuration

**FR-11 (Ubiquitous).** The canonical tablet emulator SHALL be documented in `apps/mobile/visual-verification/README.md` and used both locally and on CI. Recommended (subject to confirmation by the human reviewer — see `design.md` §11):
- Android: Pixel Tablet (1600×2560 logical, 1366×1024 effective landscape) running Android API 34 (system image: `system-images;android-34;default;x86_64`).
- iOS: iPad Pro 12.9" simulator (xcrun simctl device).

The pipeline SHALL pin one canonical device + OS combination (defaulting to Android for cost on Linux CI runners). The other combination is documented as an opt-in local profile, NOT a second matrix axis (cross-device matrix is out of scope for v1).

### 3.12 Local dev workflow

**FR-12 (Ubiquitous).** A workspace-root script `pnpm verify:visual` SHALL run the same pipeline locally against an already-running emulator. On success, the script SHALL open `apps/mobile/visual-verification/report/index.html` in the user's default browser. On failure (infra error), it SHALL print a clear error and exit non-zero.

### 3.13 Determinism & reproducibility

**FR-13 (Ubiquitous).** The pipeline SHALL fix sources of false positives by:
- Setting the emulator's date/time to a fixed value (e.g., `2026-01-15T12:00:00Z`) before each capture run so any "now" labels in the chrome match the snapshot.
- Disabling animation scale on Android (`adb shell settings put global animator_duration_scale 0`) and equivalent reduce-motion on iOS simulators.
- Locking the emulator locale to `en-US` so any locale-dependent number/time formatting is stable.
- Waiting for navigation/transition animations to settle (≥ 500 ms) before each `takeScreenshot`.

These knobs SHALL be set inside `scripts/run.ts` (not assumed to be the operator's responsibility) so the local and CI behaviours match.

### 3.14 Captures and reports are not committed

**FR-14 (Ubiquitous).** `apps/mobile/visual-verification/captures/` and `apps/mobile/visual-verification/report/` SHALL be gitignored except for their `.gitkeep` files. They are per-run outputs uploaded as CI artifacts; they MUST NOT pollute git history.

### 3.15 Pipeline meta-test

**FR-15 (Ubiquitous).** A meta-test at `apps/mobile/visual-verification/scripts/__tests__/pipelineSmoke.test.ts` SHALL exercise the diff function with two fixture inputs (an "identical" pair → ratio ~ 0; a "deliberately different" pair → ratio > 0.1) to assert the pipeline reports the correct ratios and writes the expected files. Plus, a routes-coverage check SHALL assert that the 13 flow YAMLs exactly match the keys produced by `linking.ts` (modulo the 5 known no-reference exclusions from FR-7) so a future linking-table edit cannot silently desync the verification surface.

## 4. Non-functional requirements

**NFR-1 (Speed).** The full pipeline (boot emulator → 13 flows → 13 diffs → HTML render → artifact upload) SHALL complete in ≤ 10 minutes on a standard GitHub-hosted Linux runner. Maestro flows are independent and may be parallelised; the diff step is single-threaded but each diff is ≤ 1 s on ~1.4 Mpx images.

**NFR-2 (Reproducibility).** Two runs with the same source code, the same `design-snapshot`, the same emulator image, and the same locked time/locale SHALL produce identical `pixels_diff` counts (within ±1 pixel, owing to JPEG/PNG roundtrip noise). The diff tool's anti-aliasing tolerance is fixed in code, not user-tunable per run.

**NFR-3 (Portability).** The orchestrator scripts SHALL run on macOS dev machines AND Linux CI runners. Path handling uses `node:path`; emulator detection branches on platform. Windows is not a target.

**NFR-4 (Lightweight).** Adding the verification deps SHALL NOT increase `apps/mobile`'s app bundle size. Maestro, odiff, pixelmatch, and the orchestrator are all dev-only — added to `devDependencies` of the root or a dedicated `apps/mobile/visual-verification/package.json` (see `design.md` §1).

**NFR-5 (Determinism — see FR-13).** Captures MUST be byte-stable across reruns at the same source state. Sources of nondeterminism enumerated in FR-13 SHALL be neutralised inside `scripts/run.ts`, not delegated to the operator.

**NFR-6 (Observability).** Failures (emulator boot, Maestro crash, diff tool error) SHALL emit a summary line to stdout naming the failing artboard and the underlying tool's stderr. The HTML report still lists the screens that succeeded; a top-level "Errors" section catalogues the failures with stderr excerpts.

## 5. Acceptance criteria

This spec is APPROVED-FOR-IMPLEMENTATION when:

1. The 13 Maestro flow YAMLs in `apps/mobile/visual-verification/flows/` exist and exactly match the deep-link table (FR-1, FR-2).
2. `pnpm verify:visual` runs on a developer machine against a running tablet emulator and produces a complete `apps/mobile/visual-verification/report/index.html`.
3. CI runs the same pipeline on every PR and uploads the report as a build artifact; a PR comment links to it.
4. Every captured screen produces exactly one `diff.png` and one `diff.json` in the report folder.
5. The 5 no-reference Settings detail routes appear in the report's "No-reference" section (NOT as failed diffs).
6. The pipeline's exit code reflects only infrastructural success/failure (FR-6); a high diff ratio does NOT fail CI in v1.
7. The HTML report is self-contained: opening the downloaded artifact's `index.html` directly in a browser shows every reference / capture / diff image without errors.
8. The pipeline meta-test (FR-15) passes locally and on CI.
9. The `snapshot_version`-change detection (FR-10) flags the entire run when the manifest version differs from the previous run's persisted value.
10. `apps/mobile/visual-verification/README.md` documents local + CI usage and the canonical emulator configuration.

## 6. Out of scope

- **Threshold gating.** v1's pipeline is informative; CI exit code is not derived from diff outcomes. A follow-up spec (`visual-verification-gating`) will tighten thresholds and turn them into merge gates after enough historical data exists.
- **Accessibility / contrast / screen-reader audit.** Out of scope. A future `a11y-audit` spec covers contrast ratios, hit-area minima, and screen-reader labels.
- **Performance regression.** Frame-time, cold-start, and memory regressions are owned by a future `performance-regression` spec.
- **Animation diffs.** Only static screen captures after a settle delay. Comparing animated transitions frame-by-frame is out of scope.
- **Phone fallback layout.** Tablet only; phone layouts are not implemented yet (per `screens-implementation` NFR-7).
- **Cross-device diff matrix.** v1 pins one canonical tablet emulator. Multi-device matrices (Android tablets at different DPIs, iOS iPad mini, foldables) are deferred.
- **Real data wiring.** The verification target is the chrome only; mocks from `screens-implementation/_mock/` are the data layer the pipeline observes.
- **Non-tablet form factors.** Desktop / web ports are excluded by `tech.md`.
- **Mocking the canvas itself.** Editor's `CanvasPlaceholder` is what gets diffed — the real canvas is owned by `canvas-fundamentals` and verified separately when it lands.
