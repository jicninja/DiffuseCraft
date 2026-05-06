# generation-workflow — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~3–5 weeks for one engineer (depends on `comfyui-management` graph builders being in place).**

---

## Phase A — Server: verb resolution & handler

- [x] **A.1** `resolveVerb` pure function with decision table from `requirements.md` §3.1. Unit tests covering all four verb cases + the missing-sub-mode error case. **(S)**
- [x] **A.2** `FILL_SUBMODE_CONFIG` constant in `libs/server/src/lib/comfy/graph/fill-config.ts`. **(S)**
- [x] **A.3** `generate_image` handler integrating: verb resolution → preset resolution → model presence check → graph build → tracker.submit → return job handle. **(M)**
- [x] **A.4** `MODEL_NOT_FOUND` error path with `hint`. **(XS)**
- [x] **A.5** `INVALID_INPUT` error path for missing `selection_mode` when needed. **(XS)**
- [x] **A.6** Empty-prompt + empty-canvas guard (`requirements.md` FR-23). **(XS)**
- [x] **A.7** Integration test: invoke `generate_image` end-to-end against fixture ComfyUI for each of the 4 verbs. **(M)** *(in-process FakeDb + MockTracker; live ComfyUI fixture deferred to comfyui-management I.5.)*

## Phase B — Server: presets

- [x] **B.1** Default presets `photographic`, `illustration`, `concept-art` in `comfy/presets/defaults.ts`. **(M)**
- [x] **B.2** `resolvePreset` function: by name → preset; if missing, server config default. **(S)**
- [x] **B.3** Preset hot-reload when `set_preset`/`delete_preset` mutate the registry. **(S)** *(registry exposes `upsert`/`remove`; the actual `set_preset`/`delete_preset` MCP handlers ship with comfyui-management.)*

## Phase C — Tablet: state & action button

- [ ] **C.1** Extend `canvas-slice.ts` with `strength`, `selection_mode`, setters. **(S)** *(deferred: `libs/ui` is out of scope for this server-side wave.)*
- [ ] **C.2** `<ActionButton />` component with live label updates per `requirements.md` §3.4 FR-12. **(M)** *(deferred: `libs/ui`.)*
- [ ] **C.3** `<SelectionSubModePicker />` component visible only when selection + strength=100. **(M)** *(deferred: `libs/ui`.)*
- [ ] **C.4** Live update latency: <50 ms from state change to label re-render. Asserted via React DevTools profile in test. **(S)** *(deferred: `libs/ui`.)*
- [ ] **C.5** Action button overflow menu: full sub-mode list + advanced options (negative prompt, batch size, seed). **(M)** *(deferred: `libs/ui`.)*

## Phase D — Tablet: progress indicator

- [ ] **D.1** `<GenerationProgress />` floating indicator with progress percentage. **(M)** *(deferred: `libs/ui`.)*
- [ ] **D.2** Tap-to-cancel calls `cancel_job`. **(S)** *(server side: `cancel_job` handler shipped; UI wiring deferred.)*
- [ ] **D.3** Disappears on `job.completed`. **(XS)** *(deferred: `libs/ui`.)*
- [ ] **D.4** Stage label localized (`queued`, `running`, etc.). **(S)** *(deferred: `libs/ui`.)*

## Phase E — Tablet: history strip integration

- [ ] **E.1** History strip listens to `historyStore` for new items. **(S)** *(deferred: `libs/ui`. Server emits `history.item-added` for the strip to consume.)*
- [ ] **E.2** Tap a preview → `apply_history_item({ history_item_id })`. **(S)** *(deferred: `libs/ui`.)*
- [ ] **E.3** Optional `auto_apply_latest` user pref (default false). **(S)** *(deferred: `libs/ui`.)*

## Phase F — Localization

- [ ] **F.1** All UI strings extracted to i18n: `Generate`, `Refine`, `Fill`, sub-mode labels, "Constrained variation". **(S)** *(deferred: `libs/ui`.)*
- [ ] **F.2** English + Spanish at minimum. **(S)** *(deferred: `libs/ui`.)*
- [x] **F.3** Verify diffusion prompts remain English regardless of UI language (per P23). **(XS)** *(server-side: handler passes `input.prompt` verbatim into the ComfyUI graph; no translation/normalization.)*

## Phase G — Tests

- [x] **G.1** Unit: `resolveVerb` covers all input combinations + error cases. **(S)** *(generation.ts cases 1–5.)*
- [x] **G.2** Unit: each fill sub-mode produces a graph with the expected denoising/blend mask config. **(M)** *(generation.ts cases 6–10.)*
- [ ] **G.3** Integration: tablet generates → previews land → user applies. End-to-end against in-memory server. **(L)** *(deferred: requires UI; server-side handler integration covered by generation.ts cases 18–26.)*
- [ ] **G.4** Visual regression: capture rendered canvas after a known-input generation; diff against baseline (manual review). **(M)** *(deferred: requires UI + live ComfyUI; tracked under visual-verification spec.)*

---

## Dependency order

```
A (server) → B (presets) → C/D/E (tablet) parallel → F (i18n) → G (tests)
```

A unblocks server-side fully. B is small. C/D/E can be done in parallel by 1 person across three days.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sub-mode configs (FILL_SUBMODE_CONFIG) drift from krita-ai-diffusion behavior | Visual regression tests (G.4); periodic comparison with krita-ai-diffusion outputs. |
| Action button label localization breaks live-update due to translation lookup latency | F.1 extracts strings at module load; runtime is just string interpolation. |
| Cancel during generate doesn't always succeed (ComfyUI between steps) | Document the latency (1-2 ComfyUI steps); UI shows "cancelling..." until confirmed. |
| Per-document strength persistence forgotten when document closes | C.1 explicitly persists per-document; tests cover document close/reopen. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order respects `comfyui-management` graph builders (A.3 depends on H.4 of comfyui-management).
3. Risks acceptable.

After approval, implementation begins with Phase A.
