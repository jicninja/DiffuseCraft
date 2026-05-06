# visual-verification — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, structural tests where applicable, TSDoc on exported functions, Conventional Commits with `mobile` or `ci` scope. Each task ≤ 2 hours of focused work.
> **Sequencing:** Most tasks are independent and may be done in any order; T1 / T2 are infrastructural and should land first. T11 is the post-implementation baseline run and depends on `screens-implementation` Wave 1 completing.

---

## T1 — Install Maestro and add `pnpm verify:visual` script

- [ ] Install Maestro locally on the spec author's machine; document the install command in `apps/mobile/visual-verification/README.md`.
- [ ] Add `"verify:visual": "tsx apps/mobile/visual-verification/scripts/run.ts"` to the workspace-root `package.json` `scripts` block.
- [ ] Add `tsx`, `js-yaml`, `pngjs` (and `@types/pngjs`) to `devDependencies` at the workspace root if not already present.
- [ ] Confirm Maestro can launch the app via the deep link `diffusecraft://splash` against a running emulator (manual one-shot smoke).

**Acceptance:** `pnpm verify:visual --help` prints the usage message stub authored in T4. Running Maestro standalone (`maestro test apps/mobile/visual-verification/flows/01-splash.yaml`) succeeds and writes a screenshot.

---

## T2 — Set up odiff and pixelmatch as dev deps; benchmark both on a sample diff

- [ ] Add `odiff-bin` (npm-distributed odiff binary) and `pixelmatch` to root `devDependencies`.
- [ ] Author `apps/mobile/visual-verification/scripts/__tests__/_fixtures/{identical-a,identical-b,different-a,different-b}.png` as 1366×1024 fixtures (identical pair = same image; different pair = same image with a 200×200 red square stamped on `different-b`).
- [ ] Hand-run odiff and pixelmatch over the fixtures; record diff times in `README.md`'s "Tooling rationale" section.

**Acceptance:** Both tools produce expected diffs. odiff completes in ≤ 1 s on the 1366×1024 input; pixelmatch in ≤ 5 s. README documents the numbers.

---

## T3 — Author 13 Maestro flow YAMLs

- [ ] For each artboard label in `requirements.md` FR-1 / FR-2, write the corresponding YAML at `apps/mobile/visual-verification/flows/<filename>.yaml` per the template in `design.md` §2.
- [ ] Each Editor flow uses the deep links from FR-8.
- [ ] Each flow includes `extendedWaitUntil` keyed on a known visible string from `apps/mobile/src/screens/_strings/<screen>.ts` (where applicable) plus `waitForAnimationToEnd: timeout: 1500`.
- [ ] Each flow's `takeScreenshot` writes to `../captures/<artboard>/_latest` (the orchestrator post-processes the rename per design §2.1).

**Acceptance:** Running `maestro test` against each YAML individually on a developer emulator produces a screenshot at `apps/mobile/visual-verification/captures/<artboard>/_latest.png`. All 13 succeed.

---

## T4 — Build `scripts/run.ts` (orchestrator)

- [ ] Detect emulator (`adb devices` for Android; `xcrun simctl list devices booted` for iOS) and fail fast with a clear message if none is running.
- [ ] Prime determinism knobs: emulator clock (`adb shell date <fixed>`), animator scales (`adb shell settings put global animator_duration_scale 0`), locale (`adb shell setprop persist.sys.locale en-US`), `show_touches 0`, AsyncStorage clear (`adb shell pm clear dev.diffusecraft.mobile`).
- [ ] Iterate over the flow files in a fixed order; for each, invoke Maestro (`maestro test <flow>`) and rename `_latest.png` to `<run-timestamp>.png`.
- [ ] Read `apps/mobile/design-snapshot/manifest.json`; pass `snapshot_version` and `ref_changed` (per design §7) into the diff/report stages.
- [ ] Call `runDiff()` (T5) per artboard; collect JSON results.
- [ ] Call `generateReport()` (T6) over the result array.
- [ ] On `--ci` flag, skip the `open` browser launch; on local mode, open `report/index.html` in the default browser.
- [ ] Exit non-zero only on infra failures (emulator boot fail, Maestro crash, diff tool error). High-ratio diffs alone do NOT fail the run (FR-6).

**Acceptance:** `pnpm verify:visual` runs end-to-end against a developer emulator with a built app installed and produces the report. Manual one-shot smoke test passes.

---

## T5 — Build `scripts/diff.ts` (single-screen diff)

- [ ] Export `runDiff({ artboard, referencePath, capturePath, outDir, thresholds })` returning the structured JSON shape from `requirements.md` FR-4.
- [ ] Default to odiff via `odiff-bin`; honour `DIFFUSECRAFT_DIFF_TOOL=pixelmatch` env var to switch to pixelmatch.
- [ ] Resolution-mismatch handling per design §4.3 (resample with deterministic Lanczos kernel; record `resampled` field).
- [ ] Compute `pixels_diff` from the diff PNG via `pngjs` (counting non-transparent red pixels) for both backends.
- [ ] Compute `ratio = pixels_diff / total_pixels`; `passed = ratio < thresholds.warn`.
- [ ] Write `<artboard>.diff.png` and `<artboard>.diff.json` under `report/`.

**Acceptance:** `pipelineSmoke.test.ts` (T9) passes. Manual run on a real capture produces a sensible diff PNG and JSON.

---

## T6 — Build `scripts/report.ts` (HTML index generator)

- [ ] Export `generateReport(results, opts)` taking the result array from `run.ts` plus `{ snapshot_version, run_timestamp, git_sha, thresholds, no_reference_routes }`.
- [ ] Emit a self-contained HTML file at `apps/mobile/visual-verification/report/index.html` matching design §5.
- [ ] Inline the small CSS + JS for filter chips; no external CDN.
- [ ] Include the "No-reference" section listing the 5 skipped Settings detail routes from FR-7.
- [ ] Include the "Errors" section if any infra failures occurred (FR-NFR-6).
- [ ] Include the snapshot-version banner and `ref_changed` summary count (FR-10).

**Acceptance:** Opening the generated `index.html` directly in a browser shows every reference / capture / diff image, summary counts, filter chips, and the no-reference section. Vitest test (T9) asserts every artboard label appears in the output HTML.

---

## T7 — Create `.github/workflows/visual-verification.yml`

- [ ] Workflow file matching the sketch in design §6.1.
- [ ] Triggers: `pull_request` paths `apps/mobile/**`, `libs/ui/**`, `apps/mobile/design-snapshot/**`, `apps/mobile/visual-verification/**`, `tailwind.config.js`; `push` on `main`.
- [ ] Single job `visual-verification` running on `ubuntu-latest`, `timeout-minutes: 25`.
- [ ] Steps: pnpm + node setup, install Maestro, install odiff via `odiff-bin`, boot Pixel Tablet API 34 emulator via `reactivecircus/android-emulator-runner@v2`, prebuild + run the Expo app on the emulator, run `pnpm verify:visual --ci`.
- [ ] Artifact upload via `actions/upload-artifact@v4` named `visual-verification-${{ github.run_id }}`, `path: apps/mobile/visual-verification/report`, `if: always()`.

**Acceptance:** A test PR triggers the workflow; workflow completes ≤ 10 min total wall-clock (NFR-1) and produces an uploaded artifact. (If the project's CI provider differs from GitHub Actions, adapt per design §6.1 and §11 Q1.)

---

## T8 — Wire PR-comment step linking to the artifact

- [ ] Add the `peter-evans/create-or-update-comment@v4` step to the workflow with the body template from design §6.1.
- [ ] Use `if: github.event_name == 'pull_request' && always()` so the comment posts even when the build catches an infra failure (the operator wants a link to the partial report).
- [ ] Idempotent: subsequent runs on the same PR update the existing comment rather than spamming new ones (use the action's `comment-id` discovery via a unique marker in the body).

**Acceptance:** PR receives exactly one comment from the workflow (updated in place on re-runs) linking to the correct artifact URL.

---

## T9 — Author `pipelineSmoke.test.ts` (meta-test)

- [ ] Vitest test at `apps/mobile/visual-verification/scripts/__tests__/pipelineSmoke.test.ts`.
- [ ] Test 1: `runDiff` over the identical fixture pair returns `ratio < 0.001`, `passed: true`, writes `diff.png` + `diff.json`.
- [ ] Test 2: `runDiff` over the different fixture pair returns `ratio > 0.1`, `passed: false`.
- [ ] Test 3: routes-coverage — imports `apps/mobile/src/navigation/linking.ts`'s `linking.config.screens`, walks the entries, asserts each terminal path is either present in `apps/mobile/visual-verification/flows/` (matching FR-2) OR in the no-reference exclusion list (FR-7). Includes the splash debug route in the latter (it has its own flow).
- [ ] Test 4: `generateReport(stubResults)` returns HTML containing every artboard label.
- [ ] Test 5: `manifest.ts` ingestion handles the placeholder `snapshot_version: 0` without crashing.

**Acceptance:** Running `pnpm test --filter visual-verification` (or the equivalent root test command) passes locally and on CI.

---

## T10 — Write `apps/mobile/visual-verification/README.md`

- [ ] Section "Local usage" — how to run `pnpm verify:visual`, prerequisites (running emulator, app installed).
- [ ] Section "CI usage" — link to the workflow file, explanation that diffs are informative-only in v1.
- [ ] Section "Emulator setup" — Pixel Tablet API 34 image and AVD name; iPad Pro 12.9" simulator as opt-in local profile.
- [ ] Section "Tooling rationale" — odiff vs. pixelmatch benchmark numbers from T2; Maestro vs. Detox rationale.
- [ ] Section "Threshold values" — explain 5 % / 10 % are starting points, not gates; link to follow-up gating spec (TBD).
- [ ] Section "Adding a new screen" — template steps for creating a new flow YAML, regenerating snapshot, and running locally.
- [ ] Section "Troubleshooting" — common failures (emulator not detected, Maestro can't find `dev.diffusecraft.mobile`, odiff segfault on non-glibc) and resolutions.
- [ ] Section "No-reference routes" — list the 5 skipped Settings detail routes and link to the `screens-implementation` FR-18 that owns them.

**Acceptance:** A new contributor can run `pnpm verify:visual` end-to-end using only the README, without asking the spec author.

---

## T11 — First baseline run after `screens-implementation` Wave 1 lands

- [ ] After `screens-implementation` Wave 1 (Splash + 4 Pairing screens) is reviewed and merged, manually run `pnpm verify:visual` on a developer machine.
- [ ] Inspect the produced report; record per-screen ratios in a comment on this spec's status.
- [ ] If any screen exceeds the alert threshold (10 %), file a follow-up ticket against `screens-implementation` with the diff PNG attached. Do NOT silently amend chrome from this spec.
- [ ] Re-run after `screens-implementation` Waves 2 and 3 land; final status summary covers all 13 screens.

**Acceptance:** A status comment exists on this spec listing ratios for all 13 screens after Wave 3 has merged. No silent edits made to chrome from within this spec; any divergences raised as follow-up tickets.
