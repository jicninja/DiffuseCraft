# visual-verification — Design

> **Status:** Draft v0.1.
> **Companion to:** `requirements.md`.
> **Depends on:** `screens-implementation` (the chrome under test); `app-shell-navigation` (deep-link map at `apps/mobile/src/navigation/linking.ts`); `design-system-foundation` (snapshot manifest schema in `design.md` §6, and the produced `apps/mobile/design-snapshot/<artboard>/preview.png` baselines); `ui-component-library` (only as the source of the rendered chrome — no direct dependency).
> **References:** `.kiro/steering/tech.md` §"Stack at a glance" and §"Client UI: NativeWind + react-native-reusables"; `.kiro/steering/structure.md` §"Repository layout"; `_ui-implementation-roadmap.md` row 5; `apps/mobile/src/navigation/linking.ts` (the deep-link source of truth — quoted verbatim by §2 / §3); `apps/mobile/design-snapshot/manifest.json` (reference baseline catalog).

> **Snapshot manifest version cited:** the `apps/mobile/design-snapshot/manifest.json` produced by `design-system-foundation/T1`. v1 of this spec assumes either a real `snapshot_version >= 1` or the placeholder `snapshot_version: 0` (per `design-system-foundation` design.md §6.4) — the pipeline runs against either, and the report explicitly surfaces the version in its header.

## 1. Module layout

Exact file paths created or touched by this spec, mapped to the monorepo structure declared in `structure.md`:

| Path | Role | Owned by |
|---|---|---|
| `apps/mobile/visual-verification/flows/01-splash.yaml` | Maestro flow for `01-Splash`. | This spec |
| `apps/mobile/visual-verification/flows/02-pairing-mdns.yaml` | `02-Pairing-mDNS`. | This spec |
| `apps/mobile/visual-verification/flows/02b-pairing-qr.yaml` | `02b-Pairing-QR`. | This spec |
| `apps/mobile/visual-verification/flows/02c-pairing-code.yaml` | `02c-Pairing-Code`. | This spec |
| `apps/mobile/visual-verification/flows/02d-pairing-manual.yaml` | `02d-Pairing-Manual`. | This spec |
| `apps/mobile/visual-verification/flows/03-serverpicker.yaml` | `03-ServerPicker`. | This spec |
| `apps/mobile/visual-verification/flows/04-documents.yaml` | `04-Documents`. | This spec |
| `apps/mobile/visual-verification/flows/05-editor-generate.yaml` | `05-Editor-Generate`. | This spec |
| `apps/mobile/visual-verification/flows/05b-editor-inpaint.yaml` | `05b-Editor-Inpaint`. | This spec |
| `apps/mobile/visual-verification/flows/05c-editor-live.yaml` | `05c-Editor-Live`. | This spec |
| `apps/mobile/visual-verification/flows/05d-editor-chat-open.yaml` | `05d-Editor-Chat-Open`. | This spec |
| `apps/mobile/visual-verification/flows/06-settings.yaml` | `06-Settings`. | This spec |
| `apps/mobile/visual-verification/flows/06a-settings-connection.yaml` | `06a-Settings-Connection`. | This spec |
| `apps/mobile/visual-verification/scripts/run.ts` | Orchestrator: detects emulator, primes determinism knobs (FR-13), invokes Maestro per flow, calls diff, calls report. | This spec |
| `apps/mobile/visual-verification/scripts/diff.ts` | Single-screen diff function: invokes odiff (or pixelmatch), writes `diff.png` + `diff.json`. | This spec |
| `apps/mobile/visual-verification/scripts/report.ts` | HTML report generator from JSON outputs. | This spec |
| `apps/mobile/visual-verification/scripts/manifest.ts` | Reads `apps/mobile/design-snapshot/manifest.json`, normalises artboard list, surfaces `snapshot_version`, decides `ref_changed`. | This spec |
| `apps/mobile/visual-verification/scripts/__tests__/pipelineSmoke.test.ts` | Meta-test of the diff function (FR-15). | This spec |
| `apps/mobile/visual-verification/scripts/__tests__/_fixtures/identical-{a,b}.png` | Identical pair fixture for the meta-test. | This spec |
| `apps/mobile/visual-verification/scripts/__tests__/_fixtures/different-{a,b}.png` | Deliberately-different pair fixture. | This spec |
| `apps/mobile/visual-verification/captures/.gitkeep` | Placeholder so the dir exists in git; everything else under `captures/` is gitignored. | This spec |
| `apps/mobile/visual-verification/report/.gitkeep` | Same — per-run report artifacts are gitignored. | This spec |
| `apps/mobile/visual-verification/README.md` | Operator manual: local usage, CI usage, emulator setup, troubleshooting, threshold rationale. | This spec |
| `apps/mobile/visual-verification/package.json` | Dev-only package declaring Maestro / odiff / pixelmatch / pngjs / @types/pngjs deps; scripts for the pipeline. (Optional — may live at the root instead; see §1.2.) | This spec |
| `apps/mobile/.gitignore` | UPDATED to ignore `visual-verification/captures/*` and `visual-verification/report/*` except `.gitkeep`. | This spec |
| `package.json` (workspace root) | UPDATED with `"verify:visual"` script delegating to `apps/mobile/visual-verification/scripts/run.ts`. | This spec |
| `.github/workflows/visual-verification.yml` | GitHub Actions workflow (or equivalent in the chosen CI). | This spec |

### 1.1 Directory shape after this spec lands

```
apps/mobile/
└── visual-verification/                # NEW
    ├── README.md
    ├── package.json                    # optional, see §1.2
    ├── flows/
    │   ├── 01-splash.yaml
    │   ├── 02-pairing-mdns.yaml
    │   ├── 02b-pairing-qr.yaml
    │   ├── 02c-pairing-code.yaml
    │   ├── 02d-pairing-manual.yaml
    │   ├── 03-serverpicker.yaml
    │   ├── 04-documents.yaml
    │   ├── 05-editor-generate.yaml
    │   ├── 05b-editor-inpaint.yaml
    │   ├── 05c-editor-live.yaml
    │   ├── 05d-editor-chat-open.yaml
    │   ├── 06-settings.yaml
    │   └── 06a-settings-connection.yaml
    ├── scripts/
    │   ├── run.ts
    │   ├── diff.ts
    │   ├── report.ts
    │   ├── manifest.ts
    │   └── __tests__/
    │       ├── _fixtures/
    │       │   ├── identical-a.png
    │       │   ├── identical-b.png
    │       │   ├── different-a.png
    │       │   └── different-b.png
    │       └── pipelineSmoke.test.ts
    ├── captures/                       # gitignored (except .gitkeep)
    │   └── .gitkeep
    └── report/                         # gitignored (except .gitkeep)
        └── .gitkeep

.github/workflows/
└── visual-verification.yml             # NEW

package.json                            # UPDATED (verify:visual script)
```

### 1.2 Why a sub-package vs. root scripts

Two options exist; v1 picks (a):

- **(a) Plain folder + root scripts.** The verification scripts live at `apps/mobile/visual-verification/scripts/`; `pnpm verify:visual` is a root-level script that `tsx` the orchestrator. Maestro / odiff / pixelmatch are dev-deps at the workspace root. This is the v1 choice — fewer moving parts.
- **(b) Dedicated workspace package.** A `package.json` at `apps/mobile/visual-verification/` declares the deps, and the orchestrator runs as `pnpm --filter @diffusecraft/visual-verification run start`. More isolated, but adds another workspace boundary; deferred unless dep-pollution becomes a problem.

If (b) is later preferred, the file moves are mechanical and the CI workflow is a one-line change.

## 2. Maestro flow shape

Maestro is the chosen driver because it (i) supports Expo / React Native out of the box, (ii) drives Android and iOS simulators with a single YAML format, (iii) requires no native testing harness compilation (unlike Detox), (iv) is one binary on the runner. Fallback: Detox if a screen turns out to be unreachable via Maestro's deep-link launch (none expected — every screen IS reachable per `app-shell-navigation/linking.ts`).

### 2.1 Common flow shape

Every flow file follows this template:

```yaml
# apps/mobile/visual-verification/flows/<artboard>.yaml
appId: dev.diffusecraft.mobile         # from app.config.ts
---
- launchApp:
    arguments:
      url: "<deep-link-from-FR-2>"
- extendedWaitUntil:
    notVisible: "Loading"              # generic; if the screen has no spinner this is a no-op
    timeout: 1500
- waitForAnimationToEnd:
    timeout: 1500
- takeScreenshot: ../captures/<artboard>/<run-timestamp>
```

The orchestrator (§4) substitutes `<run-timestamp>` at invocation time via `--env=RUN_TIMESTAMP=...` and `${output.RUN_TIMESTAMP}` in the YAML, OR (simpler) by post-processing: Maestro writes to a fixed path; `run.ts` renames each capture file to its timestamped destination. v1 picks the post-process approach to keep the YAML free of templating.

### 2.2 Example — `01-splash.yaml`

```yaml
appId: dev.diffusecraft.mobile
---
- launchApp:
    arguments:
      url: "diffusecraft://splash"
- waitForAnimationToEnd:
    timeout: 1500
- takeScreenshot: ../captures/01-Splash/_latest
```

### 2.3 Example — `05-editor-generate.yaml`

```yaml
appId: dev.diffusecraft.mobile
---
- launchApp:
    arguments:
      url: "diffusecraft://editor/mock-doc-1?workspace=generate"
- extendedWaitUntil:
    visible: "Generate"                # WorkspaceTabs label; from _strings/editor.ts
    timeout: 3000
- waitForAnimationToEnd:
    timeout: 1500
- takeScreenshot: ../captures/05-Editor-Generate/_latest
```

The `extendedWaitUntil: visible:` arm waits for the Editor's WorkspaceTabs to render — preventing a screenshot of mid-load chrome. The string is keyed off `_strings/editor.ts` so a future i18n swap (per `screens-implementation` §8) doesn't silently break the flow.

## 3. Editor variant capture

The 4 captures from one Editor route are achieved by hitting deep links with the right query / path-suffix as defined by `linking.ts` Editor config:

```typescript
// excerpt from apps/mobile/src/navigation/linking.ts
Editor: {
  path: 'editor/:documentId/:chatSuffix?',
  parse: {
    documentId: (s: string) => { if (!s) throw new Error('empty documentId'); return s; },
    chatSuffix: (s?: string) => (s === 'chat' ? true : false),
  },
  // workspace is parsed by react-navigation's default query-string parser
}
```

The four flows (per requirements FR-8) and what each yields:

| Flow file | Deep link | EditorLocalState seeded |
|---|---|---|
| `05-editor-generate.yaml` | `diffusecraft://editor/mock-doc-1?workspace=generate` | `{ workspace: 'Generate', chatOpen: false }` |
| `05b-editor-inpaint.yaml` | `diffusecraft://editor/mock-doc-1?workspace=inpaint` | `{ workspace: 'Inpaint', chatOpen: false, selectionMock: true }` (per `screens-implementation/design.md` §4.2 — Inpaint auto-on selection mock) |
| `05c-editor-live.yaml` | `diffusecraft://editor/mock-doc-1?workspace=live` | `{ workspace: 'Live', chatOpen: false }` |
| `05d-editor-chat-open.yaml` | `diffusecraft://editor/mock-doc-1/chat` | `{ workspace: 'Generate', chatOpen: true }` |

Each Editor flow waits ≥ 500 ms after the launch (`waitForAnimationToEnd: timeout: 1500`) before `takeScreenshot` to avoid mid-transition captures (right-panel sub-tab swap, BottomPromptBar primary-action morph between Generate / Fill / Stop Live, marching-ants overlay fade).

The `mock-doc-1` document id is a placeholder — the route accepts any non-empty string; the chrome reads `route.params.documentId` and renders it as a label (per `screens-implementation` Editor) but performs no real lookup.

## 4. Diff tool integration

### 4.1 odiff (preferred)

odiff (https://github.com/dmtrKovalenko/odiff) is preferred because:
- Rust binary, ~10× faster than pure-JS pixelmatch on ~1.4 Mpx images.
- Anti-aliasing-aware via `--antialiasing` (RN font hinting + emulator subpixel rendering produce near-identical-but-not-pixel-equal AA edges; tolerating these collapses ~80 % of false positives).
- Single CLI, easy to wire from Node.

CLI invocation example (called by `scripts/diff.ts` per screen):

```
odiff \
  apps/mobile/design-snapshot/05-Editor-Generate/preview.png \
  apps/mobile/visual-verification/captures/05-Editor-Generate/_latest.png \
  apps/mobile/visual-verification/report/05-Editor-Generate.diff.png \
  --antialiasing \
  --threshold=0.1 \
  --output-diff-mask
```

Exit codes:
- `0` → identical or within tolerance.
- `21` → diff found (pixels emitted to the diff PNG).
- non-zero else → tool error (re-thrown with stderr).

Stdout includes a one-line summary; the script also reads the diff PNG's pixel-count via `pngjs` to fill `pixels_diff` in the JSON output.

### 4.2 pixelmatch (fallback)

If odiff cannot install on the chosen CI runner (e.g., glibc mismatch on a slim image), `scripts/diff.ts` falls back to `pixelmatch` + `pngjs` for the diff computation. The fallback is selected via an env var (`DIFFUSECRAFT_DIFF_TOOL=pixelmatch`) read at top of `diff.ts`; the structured JSON output's `tool` field reflects the choice.

### 4.3 Resolution mismatch handling

Reference PNGs are exported by pencil at the artboard size (1366×1024). Maestro captures land at the emulator's effective viewport size — which on the canonical Pixel Tablet runs at 1366×1024 effective in landscape, BUT may differ (1600×2560 native scaled). `scripts/diff.ts` SHALL:
1. Compare resolutions; if they differ, downscale the larger image to the smaller using a deterministic resampler (`pngjs` + a lanczos kernel, OR `sharp` with a fixed `kernel: 'lanczos3'`).
2. Record the resampled-or-not status in `diff.json` as `resampled: { reference: true/false, capture: true/false, target_size: [W, H] }`.
3. Note in the HTML report when a resample occurred so reviewers know AA-introduced extra diff is partially the resampler's fault, not the chrome's.

A future refinement (post-v1) is to render the snapshot reference at the emulator's exact native resolution; for v1, downscaling is the simpler choice.

## 5. Report HTML

The aggregated report at `apps/mobile/visual-verification/report/index.html` is a single self-contained file produced by `scripts/report.ts`. No external CDN, no JS framework — vanilla HTML + a small inline `<style>` + minimal vanilla JS for filter chips.

### 5.1 Page structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Visual Verification Report                                                │
│ snapshot_version: 1 · run: 2026-05-03T14:22Z · git: 7c4f9a2 · 13 screens  │
│ thresholds: warn 5% · alert 10%                                           │
├──────────────────────────────────────────────────────────────────────────┤
│ Summary                                                                   │
│ ✓ 11 passed   ⚠ 1 over warn   ✗ 0 over alert   – 5 no-reference   ↻ 0 ref-changed │
├──────────────────────────────────────────────────────────────────────────┤
│ Filter: [All] [Splash] [Pairing] [Servers] [Documents] [Editor] [Settings]│
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│ │ reference    │  │ capture      │  │ diff         │  05-Editor-Generate  │
│ │ <img …>      │  │ <img …>      │  │ <img …>      │  ratio 0.92%   ✓     │
│ └──────────────┘  └──────────────┘  └──────────────┘                       │
│                                                                            │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│ │ reference    │  │ capture      │  │ diff         │  05b-Editor-Inpaint  │
│ │ <img …>      │  │ <img …>      │  │ <img …>      │  ratio 6.41%   ⚠     │
│ └──────────────┘  └──────────────┘  └──────────────┘                       │
│ … one row per screen …                                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ No-reference screens                                                       │
│ Settings.Models · Settings.Agents · Settings.Speech · Settings.Appearance  │
│ · Settings.AuditLog                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Implementation notes

- One row per artboard. `<img loading="lazy">` so opening the report is fast even with 13 × 3 images.
- Each row carries a `data-group="<group>"` attribute for filter-chip toggling.
- Vanilla JS filter: clicking a chip adds/removes a `display:none` class on rows whose `data-group` doesn't match. No framework.
- Ratio chip rendered with `accent.muted` background for `passed`, `warn` token for over-warn, `danger` for over-alert (the report uses tokens by name from `tailwind.config.js`'s color palette — but inlined as raw hex in this self-contained HTML; this is the ONLY exception to the no-raw-hex rule, gated to the report generator's output, never in source files).
- `ref_changed: true` flips the row's badge to a circular-arrow indicator with the tooltip "Snapshot baseline changed this run — diff expected".
- `no_reference` rows are NOT rendered in the main grid; they appear only in the bottom "No-reference" section.
- An "Errors" section (FR-NFR-6) appears at the very bottom listing infrastructural failures (missing capture, diff tool error) with the underlying stderr.

## 6. CI integration

### 6.1 GitHub Actions workflow

Default v1 assumption: GitHub Actions. If the project adopts a different CI (open question — see §11 Q1), the workflow is adapted while preserving job name, artifact name, and PR-comment behaviour.

```yaml
# .github/workflows/visual-verification.yml — sketch
name: visual-verification

on:
  pull_request:
    paths:
      - 'apps/mobile/**'
      - 'libs/ui/**'
      - 'apps/mobile/design-snapshot/**'
      - 'apps/mobile/visual-verification/**'
      - 'tailwind.config.js'
  push:
    branches: [main]

jobs:
  visual-verification:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      # Maestro
      - name: Install Maestro
        run: |
          curl -fsSL "https://get.maestro.mobile.dev" | bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"

      # odiff (npm-distributed binary)
      - name: Verify odiff
        run: pnpm exec odiff-bin --version

      # Android emulator (Pixel Tablet API 34) via reactivecircus
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: default
          arch: x86_64
          profile: pixel_tablet
          emulator-options: -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim
          script: |
            # Prebuild Expo app for Android
            pnpm --filter mobile expo prebuild --platform android --no-install
            pnpm --filter mobile expo run:android --device emulator
            # Run the verification pipeline
            pnpm verify:visual --ci

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-verification-${{ github.run_id }}
          path: apps/mobile/visual-verification/report

      - name: Comment on PR with artifact link
        if: github.event_name == 'pull_request' && always()
        uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: |
            **Visual Verification report:** [download artifact `visual-verification-${{ github.run_id }}`](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})
            (informative; non-gating in v1)
```

Notes:
- `--ci` flag in `pnpm verify:visual --ci` switches `run.ts` to non-interactive mode (no auto-open browser, no spinner animations, structured stderr).
- The PR-comment step runs even on diff-detected runs because v1 is non-gating; the comment is the user's entry point regardless.
- The `path: apps/mobile/visual-verification/report` upload includes every diff PNG and the HTML index.

### 6.2 iOS

iOS (iPad Pro 12.9" simulator) is documented as a local-only profile; CI runs only Android by default for cost. A future enhancement adds an opt-in iOS lane (`workflow_dispatch` triggered) once the threshold gating spec lands.

## 7. Reference baseline strategy

Two options for the reference image source:

- **Option A (chosen for v1).** Read directly from `apps/mobile/design-snapshot/<artboard>/preview.png`. The reference is always tied to the current `snapshot_version`. Re-running `tools/snapshot-pen.ts` immediately changes the baseline; the `ref_changed` flag (FR-10) signals reviewers.
- **Option B (rejected).** Copy the PNG into a versioned folder `apps/mobile/visual-verification/baselines/<artboard>.png` at a pinned snapshot version. Insulates verification from snapshot churn but introduces a second baseline catalog that must be kept in sync. Adds confusion ("which is the source of truth?"), so v1 rejects this.

Reasoning for Option A:
1. Single source of truth — `apps/mobile/design-snapshot/` is the only place the design ground-truth lives.
2. Snapshot churn IS what we want to detect — when the designer ships a new `.pen`, the next CI run's diffs surface what needs revisiting in chrome. The `ref_changed` flag is the human-readable answer to "is this diff a regression or a baseline shift?".
3. No baseline-catalog drift bug class.

If a future spec needs a frozen baseline (e.g., an "approved" baseline distinct from the latest snapshot), it adds a `baselines/` folder explicitly and overrides Option A — deferred until that need is concrete.

## 8. False-positive handling

Known sources of false positives, with the technique each is suppressed by:

| Source | Suppression |
|---|---|
| Emulator font hinting / subpixel AA differs from pencil's renderer | `odiff --antialiasing` flag tolerates AA-edge differences by ≤ 1 lightness step. |
| Time-of-day / "now" labels in chrome | `run.ts` sets emulator clock to `2026-01-15T12:00:00Z` before each capture run (FR-13). Mock fixtures in `_mock/*.ts` use static strings ("2 hours ago") not computed-from-`Date.now()` per `screens-implementation` NFR-4 — already ensured upstream. |
| In-flight transition animations | `waitForAnimationToEnd: timeout: 1500` in every flow + `extendedWaitUntil: visible: <key-label>` waits for screen-specific known text to appear. |
| Reanimated cross-fade durations | `adb shell settings put global animator_duration_scale 0` (Android) and equivalent reduce-motion on iOS, set by `run.ts` once at startup. |
| Locale-dependent number / time formatting | Locale fixed to `en-US` via `adb shell setprop persist.sys.locale en-US` (Android) and `xcrun simctl --set ...` for iOS (iOS code path documented in README; not on default CI lane). |
| Dynamic timestamps in chrome (e.g., a pulsing "online" dot in `ServerPicker`) | `screens-implementation` chrome uses `accessibilityRole` + static state per FR-5 (no animations beyond defaults); the `online: true` mock is rendered as a static green dot. |
| Cursor / focus ring on the active input | Flows do not focus inputs unless explicitly required (Pairing.Code is the exception — see below). For Pairing.Code, the flow waits 500 ms after launch without tapping any digit — no cursor, no entered text, just the empty pad. |
| Haptic ripple visualisation (Android dev option) | Disabled in `run.ts` startup (`adb shell settings put system show_touches 0`). |
| Snapshot resolution mismatch | Resampled with deterministic Lanczos kernel; status surfaced in JSON (§4.3). |

## 9. Local dev workflow

`pnpm verify:visual` is a workspace-root script (added to the root `package.json`):

```json
{
  "scripts": {
    "verify:visual": "tsx apps/mobile/visual-verification/scripts/run.ts"
  }
}
```

Local UX:
1. Operator boots the canonical emulator (Pixel Tablet API 34) and runs `pnpm --filter mobile run:android` once so the app is installed.
2. `pnpm verify:visual` detects a running emulator (`adb devices`), primes the determinism knobs (FR-13), runs the 13 Maestro flows sequentially (parallelism = 1 locally to avoid emulator contention), runs odiff per capture, generates the HTML report, and opens `apps/mobile/visual-verification/report/index.html` in the user's default browser via `open` (macOS) / `xdg-open` (Linux).
3. Re-runs are fast: the emulator stays up; only flows + diff are re-executed.

CI mode (`--ci`) skips the browser open step and emits a structured stderr summary suitable for the PR comment.

## 10. Validation strategy

| Check | Tool | Enforcement |
|---|---|---|
| Diff function correctness on identical inputs | `pipelineSmoke.test.ts` (vitest): runs `runDiff(identical-a.png, identical-b.png)` and asserts `ratio < 0.001`, `passed: true`. | CI |
| Diff function correctness on different inputs | Same test file: runs `runDiff(different-a.png, different-b.png)` and asserts `ratio > 0.1`, `passed: false`, diff PNG written. | CI |
| Routes coverage — every `linking.ts` deep-link maps to exactly one flow OR one no-reference exclusion | `pipelineSmoke.test.ts`: imports `linking.ts`'s screens config, walks the entries, asserts each path is either present in `flows/` or in the no-reference exclusion list (FR-7). | CI |
| Flow YAML syntactic validity | A simple `js-yaml` parse pass over each YAML at test time, asserting the file parses and contains a `takeScreenshot` step. | CI |
| HTML report renders | `pipelineSmoke.test.ts` calls `generateReport(stubResults)` and asserts the output HTML contains every artboard label. | CI |
| `tsc --noEmit` clean for `apps/mobile/visual-verification/scripts/` | TS strict mode | CI |
| `manifest.json` ingestion handles the placeholder version (0) gracefully | Test feeds `manifest.ts` a stub manifest with `snapshot_version: 0` and asserts the report header renders without crashing and notes "snapshot in placeholder mode". | CI |
| End-to-end smoke (manual) | One-shot manual run by the operator who landed this spec — capture the report, attach to the spec's status update. | Manual one-off (T11) |

## 11. Open questions

### Q1 — CI provider

The spec assumes GitHub Actions. The repo's existing CI (if any) is not visible in `tech.md` / `structure.md` at spec-authoring time. If the project uses a different CI (CircleCI, GitLab CI, Buildkite, self-hosted runners), the workflow file needs a one-time port. The structure (one job, run pipeline, upload artifact, comment on PR) is provider-portable.

**Recommendation.** Confirm GitHub Actions is the chosen CI before T7. If not, T7 ports the workflow to the chosen provider; everything else is unaffected.

### Q2 — Primary emulator (Android vs. iOS)

The pipeline pins ONE canonical emulator (FR-11). v1 recommends Android Pixel Tablet API 34 because:
- Linux CI runners can boot it (`reactivecircus/android-emulator-runner`); iOS simulators require macOS runners which are ~10× more expensive.
- Tablet form factor matches the design.
- Effective viewport is 1366×1024 in landscape, matching the `.pen` artboard size.

iOS iPad Pro 12.9" is a closer visual analogue to the target hardware (Apple Pencil-driven tablets) but cost-prohibitive on every PR. v1 recommends Android-only on CI; iOS is a locally-runnable opt-in profile.

**Recommendation.** Confirm Android-as-CI-primary before T1.

### Q3 — Baseline regeneration cadence

When the designer ships a `.pen` update, `tools/snapshot-pen.ts` is re-run, `apps/mobile/design-snapshot/` is updated, and the next CI run reports `ref_changed: true` for every screen. Two questions follow:

- (a) Should the CI report distinguish "ref-changed but chrome still matches new ref" (low diff post-resample) from "ref-changed AND chrome now diverges" (high diff)?
- (b) Should the report retain a memory of "this screen was over-warn last run, is now under" (regression-recovery signal) — basically a small history?

**Recommendation.** v1 surfaces only `ref_changed` plus the current ratio; (a) falls out automatically (diff is computed against the new ref). (b) is deferred — it requires a persistent run-history store; out of scope.

### Q4 — Report hosting (artifact-only vs. GitHub Pages)

GitHub Pages can host the latest `main`-branch report at a stable URL, useful for designers who don't have GH access to artifacts. Alternative: every PR's artifact is enough.

**Recommendation.** v1 uses artifacts only. Pages hosting is a nice-to-have post-v1 (`visual-verification-pages` follow-up); the report HTML is already self-contained, so the move is trivial when wanted.

### Q5 — Threshold values (5 % / 10 %)

The default warn / alert thresholds are guesses. The first few CI runs after `screens-implementation` Wave 1 lands will reveal what fraction of pixels typically differ on a "good" run (font AA + emulator subpixel rendering should collapse this near zero, but real numbers are unknown). Once we have data, the threshold values should be tuned in a follow-up — almost certainly down from 5 % / 10 %.

**Recommendation.** Defer tuning to a `visual-verification-tuning` follow-up after T11 (first baseline run). v1 ships the conservative defaults.

### Q6 — pixelmatch fallback retention

If odiff installs cleanly on the chosen CI runner, pixelmatch becomes dead code. Should the fallback be removed?

**Recommendation.** Keep the fallback. It is ~50 lines, gives the script a backup if a future runner image breaks odiff, and serves as a documented alternative for anyone running the pipeline in a non-glibc environment (Alpine, Nix). Cost of keeping is low; cost of needing to add it back later is higher.

### Q7 — Mocking the connection state for capture

Several captured screens depend on `connectionStore` state:
- `01-Splash` is reachable in any state (`status === 'unknown'`).
- `02-Pairing-*` requires `status === 'no-paired'` (or `'unknown'` and the splash falls through).
- `03-ServerPicker` requires `status === 'paired-no-active'`.
- `04-Documents`, `05-Editor-*`, `06-Settings*` require `status === 'connected'`.

The deep links bypass the conditional root only if the persisted nav state matches the link target. `app-shell-navigation/RootRouter` re-routes to the natural entry if the state mismatches.

**Recommendation.** The Maestro flows clear AsyncStorage at startup (a one-time `adb shell pm clear dev.diffusecraft.mobile` on Android, equivalent on iOS) and rely on the `connectionStore.stub` defaulting to `no-paired` after the 300 ms boot probe. Then for each non-Pairing flow, the orchestrator pre-seeds the stub via a debug deep link `diffusecraft://__debug?cycle_to=connected` (a NEW debug link added by `screens-implementation` for this purpose) — OR uses Maestro to tap "Cycle stub state" in `Settings.About` enough times to land in the desired state.

The cleanest approach is a **debug deep link** added by `app-shell-navigation` post-v1 (or by an amendment to `screens-implementation`'s About debug card) that takes a target state parameter and sets the stub directly. This is the smallest cross-spec coordination cost.

**Status.** Open. Coordinate with `screens-implementation` author to add a debug deep link or accept the multi-tap approach; flagged in cross-spec coordination notes (the orchestrator's reply to the human reviewer).

### Q8 — Emulator default deep-link launch

Maestro's `launchApp.arguments.url` works on Android via Activity intent. On iOS simulators, the deep link must be registered via `xcrun simctl openurl`. Maestro abstracts this on most versions but may require explicit handling. Verify during T1.

**Recommendation.** Accept Maestro's default behaviour; if it fails on iOS, fall through to `xcrun simctl openurl booted <url>` invoked from `run.ts` before the flow's `launchApp` step.
