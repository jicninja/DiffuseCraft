# visual-verification

Maestro-driven screenshot diff. **Informative-only in v1** — never gates CI.

## Run locally

Pre-reqs: a booted **Pixel Tablet API 34** Android emulator (or iPad Pro
12.9 simulator) with the DiffuseCraft Expo app installed, plus
[Maestro](https://maestro.mobile.dev) on `PATH`.

```sh
pnpm verify:visual          # opens report/index.html when done
pnpm verify:visual --ci     # CI mode: structured stderr, no auto-open
```

The orchestrator pins clock / locale / animation scales for byte-stability
(FR-13). On finish it writes `report/index.html`.

## CI

`.github/workflows/visual-verification.yml` runs the same pipeline on every
PR (Linux runner; iOS would force macOS, ~10x cost) and uploads the
`report/` directory. A soft PR comment links to the artifact — never blocks
the merge. Pinned: Pixel Tablet, Android API 34, `google_apis`, `x86_64`,
1366×1024 viewport.

## Thresholds

`warn = 5%`, `alert = 10%` per-screen pixel ratio. Starting points only —
NOT gates (FR-6). Tightening to a gate is a follow-up spec.

## Skip a flow temporarily

Rename `flows/<flow>.yaml` to `_disabled-<flow>.yaml`. The orchestrator
only looks up flows by `CAPTURE_LABELS` (manifest.ts). Re-enable by
restoring the filename.

## Adding a new screen

1. Add the artboard to `apps/mobile/design-snapshot/manifest.json`.
2. Create `flows/<artboard>.yaml`.
3. Add the `label → flowFileBase` row in `manifest.ts:FLOW_BASENAME_BY_LABEL`.
4. Re-run `pnpm verify:visual` locally.

## No-reference routes

Five settings detail routes (`Settings.Models|Agents|Speech|Appearance|AuditLog`)
have no `.pen` baseline yet. They're listed in the report's "No-reference"
section and never produce a diff.
