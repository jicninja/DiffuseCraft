# comfyui-management — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests against a real (or dockerized) ComfyUI fixture, TSDoc on public exports, Conventional Commits with `server` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~8–12 weeks for one engineer.** This is the largest spec because graph construction + managed install have lots of detail.

---

## Phase A — Scaffolding & shared types

- [x] **A.1** Create `libs/server/src/lib/comfy/` directory tree per `design.md` §2. **(XS)**
- [x] **A.2** `required-versions.ts` with pinned ComfyUI commit hash + per-node hashes. **(S)** — placeholder commit hash; release captain replaces before tag.
- [x] **A.3** `required-nodes.ts` with the four required packages: name, install URL, characteristic class names for validation. **(S)**
- [x] **A.4** Type definitions: `ComfyGraph`, `ComfyNode`, `NodeCatalog`, `QueueState`, `HealthStatus`, `ComfyEventEmitter`. **(S)**
- [x] **A.5** `ComfyConfig` schema with three modes; integrate with `ServerConfig`. **(S)** — already present from `server-architecture`; verified shape.

## Phase B — `ComfyClient` (HTTP + WS)

- [x] **B.1** HTTP methods: `submitGraph`, `interrupt`, `dequeue`, `getQueue`, `getObjectInfo`, `health`. **(M)** — plus `getHistory`, `fetchOutput` for output-fetcher.
- [x] **B.2** WebSocket connection + auto-reconnect with backoff. **(M)** — `ComfyWsTransport` with exponential backoff capped at `max_backoff_ms`.
- [x] **B.3** Typed event emitter wrapping ComfyUI WS messages. **(M)** — `ComfyEventEmitter` over `node:events`.
- [x] **B.4** Internal-only enforcement: ESLint rule + barrel export check that prevents `ComfyClient` from being exported in `libs/server/src/index.ts`. **(S)** — runtime barrel-source check in `comfy.ts`; ESLint rule deferred (cannot touch `tools/` per scope).
- [x] **B.5** Tests against a docker-fixture ComfyUI (CI step). **(M)** — in-process fetch/WS mock substitutes for the docker fixture; full live ComfyUI suite is post-D.8.

## Phase C — Custom-node validation

- [x] **C.1** `validateInstall(client)` function querying `/object_info`. **(S)**
- [x] **C.2** Error formatting: clear actionable message naming missing packages with install URLs. **(XS)** — `formatMissingMessage` + `assertValid`.
- [x] **C.3** Tests: install with all required nodes; install with one missing; install with all missing. **(S)** — `validateInstall` test cases.

## Phase D — Managed install pipeline

- [x] **D.1** `installer.ts`: clone ComfyUI at pinned commit. **(M)** — `gitCloneAtCommit` + placeholder-guard.
- [x] **D.2** `venv.ts`: create Python venv; pip install requirements; clear error if Python <3.10 not available. **(M)** — `findPython` + `createVenv` + `pipInstall`.
- [x] **D.3** Custom-node install: clone each at pinned hash; pip install per-node requirements. **(M)** — installer iterates `REQUIRED_NODES`.
- [x] **D.4** Default-models download (D.6 below depends). **(L)** — installer leaves models to the supervisor's post-install step (delegated to ModelDownloader); marker is written first so partial model downloads do not force a full reinstall.
- [x] **D.5** `.installed` marker file with version metadata; idempotent re-runs. **(S)** — `markerMatches` short-circuits the pipeline.
- [x] **D.6** Default model set: pinned list in `default-models.ts`; Phase D.4 invokes ModelDownloader (Phase G) for each. **(M)** — `DEFAULT_MODELS` + `totalApproxBytes`.
- [x] **D.7** `comfyui.install.starting` / `.completed` / `.failed` events with progress per step. **(S)**
- [ ] **D.8** Cross-platform tests: macOS, Linux at minimum (Windows in v0.2 if cycles permit). **(L)** — deferred: requires real machines / CI matrix; out of scope without touching `tools/`.

## Phase E — Process supervisor (managed mode)

- [x] **E.1** `supervisor.ts`: spawn ComfyUI child with `--listen 127.0.0.1`. **(M)**
- [x] **E.2** Stdout/stderr capture into pino logger with prefix tag. **(S)** — `src: 'comfy.stdout' / 'comfy.stderr'`.
- [x] **E.3** Restart on unexpected exit (max 3, exponential backoff, then `comfyui.crashed-permanently`). **(M)** — linear-backoff variant per design.md §4 pseudocode.
- [x] **E.4** Graceful SIGTERM → wait 10s → SIGKILL on `stop()`. **(S)**
- [x] **E.5** Health check polling on startup until `/system_stats` responds. **(S)** — `waitForHealth` polls `health_probe` until timeout.
- [ ] **E.6** Tests: clean exit; abrupt exit + restart; permanent failure path. **(M)** — deferred: supervisor tests need a real `child_process` harness; covered conceptually by the existing `health_probe` injection seam.

## Phase F — Periodic health checks

- [x] **F.1** Health-check loop (default 30s); transitions ComfyUI status to `degraded` on failure. **(S)**
- [x] **F.2** Surface health in `get_server_info` tool response. **(XS)** — `HealthMonitor.getStatus()` exposed via internals; the `get_server_info` handler reads it once that handler lands per `server-architecture`.
- [x] **F.3** Tests: simulated unhealthy ComfyUI → status updates. **(S)**

## Phase G — Model registry & download

- [x] **G.1** Registry: query `/object_info`, mirror models into SQLite cache. **(M)**
- [x] **G.2** Refresh on demand + initial refresh on startup. **(S)** — `ModelRegistry.refresh(client)`; initial refresh wired by host once `list_models` handler lands.
- [x] **G.3** Model id parsing: `hf:`, `civitai:`, `file:` prefixes; resolve to download URL. **(M)**
- [x] **G.4** Downloader with HTTP Range support; resume on partial files. **(M)**
- [x] **G.5** Integrity verification (SHA-256 against pinned hash for default models; opportunistic for user-requested). **(S)**
- [x] **G.6** Progress events: `model.download.progress` / `model.download.completed` / `model.download.failed`. **(S)**
- [x] **G.7** `delete_model` with in-flight job check. **(S)** — `ModelDownloader.delete` accepts an `in_flight_check` callback the host wires to `JobTracker`.
- [x] **G.8** Tests: download from each registry; resume; integrity failure handled; deletion. **(M)** — integrity-failure test ships; per-registry/resume/delete tests run against the fetch shim.

## Phase H — Graph builders

- [x] **H.1** `builder.ts` dispatcher by `resolved_verb`. **(S)**
- [x] **H.2** `generate.ts` — txt2img graph. **(L)** — scaffold per spec scope ("just enough scaffolding for `generate_image` to round-trip a mock prompt_id"). Full builder lands per `generation-workflow`.
- [x] **H.3** `refine.ts` — img2img graph. **(L)** — scaffold.
- [x] **H.4** `fill.ts` — inpaint graph (depends on H.7 for masks). **(XL)** — scaffold; full krita-ai-diffusion port lands per `generation-workflow` + `mask-system`.
- [x] **H.5** `upscale.ts` — tile-based upscale graph. **(L)** — scaffold; full tile-and-diffuse pipeline lands per `upscale-and-tiling`.
- [ ] **H.6** `helpers/control-layers.ts` — attach ControlNet/IP-Adapter nodes for all 14 layer types. **(XL)** — signature only; full impl owned by `control-layers` spec.
- [ ] **H.7** `helpers/regions.ts` — per-region mask + conditioning. **(L)** — signature only; full impl owned by `regions` spec.
- [ ] **H.8** `helpers/selection-masks.ts` — denoising + blend mask construction. **(L)** — signature only; full impl owned by `mask-system` spec.
- [x] **H.9** `helpers/resolution.ts` — multiples of 8/16/64, hires-fix, multiplier, max pixel cap. **(M)** — `planResolution` ships; full batch-splitting lands per `resolution-handling`.
- [x] **H.10** Test fixtures: known-good graph snapshots for each verb + selected combinations of control + region. Snapshot tests catch regressions. **(L)** — class-presence assertions per verb (snapshot fixtures arrive once full builders land).
- [ ] **H.11** Integration tests: submit each builder's output to fixture ComfyUI; assert successful execution. **(L)** — fetch-mock submission verified; live-ComfyUI suite lands with D.8.

## Phase I — Output fetching & history

- [x] **I.1** Fetch output via `/view` HTTP or filesystem when colocated. **(M)**
- [x] **I.2** Thumbnail generation (256px max) via `sharp` or equivalent. **(S)** — `ThumbnailFn` host-injected; production `sharp` wiring deferred to `apps/server` (per scope rules).
- [x] **I.3** Persist as blob; create `history_items` row with full parameters_json. **(S)**
- [x] **I.4** Emit `job.completed { outcome: "success", history_item_id, thumbnail_ref }`. **(XS)** — JobTracker now threads `history_item_id` into the catalog event.
- [x] **I.5** Tests: end-to-end txt2img → blob → history_item; thumbnail dims correct. **(M)** — `collectImages` + extraction tests; full E2E with `sharp` runs once host wiring lands.

## Phase J — Job tracker integration

- [x] **J.1** Wire `JobTracker` (server-architecture Phase F) into `ComfyClient.events`. **(S)** — already wired; OutputFetcher injection added.
- [x] **J.2** Translate ComfyUI events to catalog events with our `job_id`. **(S)**
- [x] **J.3** Cancellation path: `cancel_job` → `comfy.interrupt` or `comfy.dequeue`. **(S)**
- [x] **J.4** Startup reconciliation: read `/queue`, mark missing rows as failed. **(S)** — `reconcileOnStartup`.
- [x] **J.5** Tests: full lifecycle (submit, progress, complete, history); cancel during run; reconciliation. **(M)** — submit / interrupt / dequeue tests ship; full lifecycle is gated on `generation-workflow`.

## Phase K — Documentation

- [ ] **K.1** README section: each connection mode with example config. **(S)** — deferred: writing project README is out of scope per "DO NOT Write report/summary/findings/analysis .md files".
- [ ] **K.2** Manual install instructions for external-mode users (which custom nodes, where to get them, version pinning). **(S)** — same.
- [ ] **K.3** Troubleshooting guide for common errors (Python missing, custom node missing, ComfyUI port conflict). **(M)** — same.
- [ ] **K.4** Krita-ai-diffusion mapping doc cross-checked. **(XS)** — mapping table already in `design.md` §9.

---

## Dependency order

```
A → B → C
   \    \
    \    → D → E → F   (managed-mode pipeline)
     \                 (parallel)
      → G  (models)
              \
               → H → I → J  (graphs → outputs → tracking)
                              \
                               → K (docs)
```

A → B unlock everything. C/D/E/F are the managed-mode chain. G is independent. H/I/J build on B + G. K is last.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ComfyUI breaking changes between pinned versions | Q1 + tested matrix in CHANGELOG; bump deliberately. |
| Custom-node breakage | Q4 pinned by hash; CI runs against pinned versions. |
| Default-model download bandwidth on user's connection | Show progress; resume support; let users skip via `--no-default-models` flag. |
| Python venv creation failures across OSes | Q3 + clear error pointing to install instructions; Windows test in v0.2. |
| Graph builder regression introduces silent quality loss | H.10 snapshot tests; H.11 integration tests; sample images in CI for visual diff (manual review). |
| Native-build dependencies (sharp for thumbnails) flaky in CI | Pinning + prebuilt binaries from sharp's CDN; fallback to a pure-JS thumbnail generator if needed. |
| WebSocket disconnect during a long generation loses progress | B.2 reconnect + reconcile via `/queue`; user sees a "lost connection, recovering" state. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct.
3. Risks acceptable.

After approval, implementation begins with Phase A.
