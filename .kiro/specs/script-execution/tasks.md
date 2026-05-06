# script-execution — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration + adversarial sandbox tests, TSDoc on public exports, Conventional Commits with `server` or `mobile` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d.

> **Total estimate: ~6–9 weeks for one engineer.** Sandbox + cross-platform testing is the biggest slice.

---

## Phase A — Scaffolding & types

- [ ] **A.1** `libs/server/src/lib/scripting/` directory tree per `design.md` §2. **(XS)**
- [ ] **A.2** `Runtime` interface, `ScriptSpec`, `ScriptResult` types. **(S)**
- [ ] **A.3** `ScriptConfig` Zod schema, integrated with `ServerConfig`. Fields: `runtime_preference`, `allow_pyodide_fallback`, `allowed_python_imports`, `allowed_js_imports`, `concurrency_cap`, `default_timeout_ms`, `default_max_memory_bytes`, `rate_limit_per_minute`, `venv_path`, `pyodide_path`. **(S)**
- [ ] **A.4** `apply_script` schema in `@diffusecraft/mcp-tools`. Catalog count now ~52 (within cap of 55). **(S)**

## Phase B — I/O protocol & runner stubs

- [ ] **B.1** Binary stdin/stdout protocol encode/decode helpers. **(M)**
- [ ] **B.2** `runner.py` stub with PIL parsing + `main()` invocation pattern. **(M)**
- [ ] **B.3** `runner.mjs` stub for JS with Sharp. **(M)**
- [ ] **B.4** Tests: round-trip image + params through stub locally (without sandbox). **(S)**

## Phase C — AST validation

- [ ] **C.1** Python AST validator. Use a long-lived Python validator subprocess that parses with `ast` and checks against whitelist + forbidden-call list. **(L)**
- [ ] **C.2** JS AST validator using `@babel/parser`. **(M)**
- [ ] **C.3** `ScriptWhitelist` config with default minimal set + operator extension. **(S)**
- [ ] **C.4** Tests: 30+ representative scripts (good + bad); each rejected case includes line number + module name. **(M)**
- [ ] **C.5** Tests: Python sandbox-escape attempts via `__class__`, `__bases__`, `__subclasses__` chains — all rejected at AST. **(M)**

## Phase D — Native Python runtime (Linux + macOS)

- [ ] **D.1** `NativePythonRuntime.ensureAvailable`: verify venv path, packages importable. **(M)**
- [ ] **D.2** Linux sandbox: `unshare -U -n -m` + `systemd-run` cgroup limits. Tested on Ubuntu 22.04+. **(L)**
- [ ] **D.3** macOS sandbox: `sandbox-exec` with generated `.sb` profile blocking network + restricting FS. **(L)**
- [ ] **D.4** Subprocess spawn + stdin write + stdout read with timeout + memory enforcement. **(M)**
- [ ] **D.5** stderr capture with 64 KB cap + truncation marker. **(S)**
- [ ] **D.6** Adversarial tests:
  - Script tries to open socket → blocked.
  - Script writes to `/tmp/leak` → blocked (only scratch writable).
  - Script reads `/etc/shadow` → blocked.
  - Script spawns subprocess → blocked (AST + runtime).
  - Script forks → memory limit hit before damage.
  - Script CPU loops → SIGKILL on timeout. **(L)**

## Phase E — Deno JS runtime

- [ ] **E.1** `DenoJsRuntime.ensureAvailable`: verify Deno binary present + version. **(S)**
- [ ] **E.2** Deno spawn with `--allow-read=<scratch>` `--allow-write=<scratch>` `--no-net` `--no-prompt` + memory flag. **(M)**
- [ ] **E.3** Adversarial tests for JS: socket attempts, FS escape attempts, eval/Function dynamic. **(M)**

## Phase F — Pyodide WASM fallback

- [ ] **F.1** `loadPyodide` integration; lazy-load on first use. **(M)**
- [ ] **F.2** Reduced whitelist (numpy + Pillow only — no native libs). **(S)**
- [ ] **F.3** Adversarial tests: confirm Pyodide can't access Node FS or net (it can't by default — JS-WASM bridge is FS-less). **(S)**
- [ ] **F.4** Document Pyodide caveats (slower; no cv2; bigger startup). **(S)**

## Phase G — Runtime selection

- [ ] **G.1** `selectRuntime(language, config)` with `auto` mode. **(M)**
- [ ] **G.2** Cache resolved runtime per process + language. **(S)**
- [ ] **G.3** Tests: each runtime selected on simulated host capabilities. **(M)**

## Phase H — Handler & job tracker integration

- [ ] **H.1** `applyScriptHandler` with AST validation + tracker submission. **(M)**
- [ ] **H.2** Job tracker extension: `submitScriptJob` routes to `ScriptRunner` instead of ComfyUI. **(M)**
- [ ] **H.3** Concurrency cap: 2 simultaneous server-wide; FIFO queue; `job.progress { stage: "queued" }` for queued. **(S)**
- [ ] **H.4** Per-token rate limit: 10/minute. **(S)**
- [ ] **H.5** `cancel_job` integration: SIGTERM + grace + SIGKILL. **(S)**
- [ ] **H.6** Tests: job lifecycle; cancellation; queue overflow. **(M)**

## Phase I — Reversibility

- [ ] **I.1** `output_target: "new_layer"`: persist as blob → history_item → `job.completed` (matches generation-history flow). User/agent applies via `apply_history_item`. **(S)**
- [ ] **I.2** `output_target: "replace_target"`: direct replace via reversible Command (`undo-redo-system` integration). **(M)**
- [ ] **I.3** Tests: undo/redo of replace path; new-layer path doesn't auto-apply. **(M)**

## Phase J — Audit log

- [ ] **J.1** Audit entries store first 200 chars of code + sha256 of full script + language + outcome + duration. **(S)**
- [ ] **J.2** `get_script_history({ since? })` admin tool returning full code (gated to current single-tier; documented caveat). **(S)**
- [ ] **J.3** Tests: long script truncation; hash matches full bytes. **(S)**

## Phase K — Built-in examples

- [ ] **K.1** `examples/grayscale.py`. **(XS)**
- [ ] **K.2** `examples/sepia.py`. **(XS)**
- [ ] **K.3** `examples/blur.py` (Gaussian + box blur). **(XS)**
- [ ] **K.4** `examples/levels.py` (point-curve adjustment). **(XS)**
- [ ] **K.5** `examples/threshold.py`. **(XS)**
- [ ] **K.6** `examples/edge_detect.py` (Canny via cv2). **(XS)**
- [ ] **K.7** `examples/palette_quantize.py`. **(XS)**
- [ ] **K.8** Equivalent JS examples for first three. **(S)**
- [ ] **K.9** Examples bundled with the server library and exposed via the tablet UI's `<ExamplesPicker />`. **(S)**

## Phase L — Tablet UX

- [ ] **L.1** `<ScriptPanel />` with all sections per `design.md` §12. **(L)**
- [ ] **L.2** `<CodeEditor />` simple syntax-highlighted editor. v1 = basic regex highlighter; Monaco-equivalent post-v1. **(M)**
- [ ] **L.3** `<ParamsEditor />` JSON editor with validation. **(S)**
- [ ] **L.4** `<ExamplesPicker />` with built-in examples. **(S)**
- [ ] **L.5** `<LogsViewer />` for stderr display. **(S)**
- [ ] **L.6** Layer-context-menu entry "Custom script…" + Tools menu entry. **(S)**
- [ ] **L.7** Tests: panel renders; example loads; run dispatches; result lands in history; cancellation works. **(M)**

## Phase M — Catalog & docs

- [ ] **M.1** `apply_script` added to v1 catalog (already in A.4). **(XS)**
- [ ] **M.2** Update `mcp-tool-catalog/requirements.md` §3.3.19 final tally to ~52 tools. **(XS)**
- [ ] **M.3** README on script execution: examples, sandbox guarantees, language whitelists, host requirements. **(M)**
- [ ] **M.4** Operator guide: how to extend whitelists, how to switch runtimes, troubleshooting (sandbox failures by OS). **(M)**
- [ ] **M.5** Security note: power-user feature; exposed only on paired LAN clients; never on tunnel without operator opt-in (post-v1). **(S)**

## Phase N — Performance & validation

- [ ] **N.1** Spawn overhead ≤200 ms benchmark. **(S)**
- [ ] **N.2** AST validation ≤50 ms for 64 KB script. **(S)**
- [ ] **N.3** End-to-end latency for grayscale 1024×1024: ≤1 s native, ≤3 s Pyodide. **(S)**
- [ ] **N.4** Adversarial test suite passes 100% (Phase D.6 + E.3). CI gates on this. **(M)**

---

## Dependency order

```
A → B → C
        \
         → D (Linux+macOS Python) → G (selection) → H (handler) → I (reversibility)
         → E (Deno JS) ↗                                            \
         → F (Pyodide fallback) ↗                                    → J (audit) → K (examples) → L (UI) → M (docs) → N (perf)
```

A is foundational. B/C parallel after A. D/E/F three runtime branches in parallel. G integrates them. H/I/J/K/L/M/N sequential at the end.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Linux sandbox primitives differ across distros (cgroup v1 vs v2, systemd vs init) | D.2 detects at startup; falls back to soft limits if cgroup v2 unavailable + warns. |
| macOS `sandbox-exec` is officially deprecated | We use it because it's still functional and the alternative (App Sandbox via codesign + entitlements) requires distribution as a signed bundle. v2 reevaluates if Apple removes it. |
| AST validator misses a Python escape vector (esoteric) | C.5 covers known escapes; add new tests when CVEs emerge; pin Python interpreter to a tested version. |
| Pyodide load time (first invocation) is slow | F.1 lazy-loads on first request; subsequent calls hit the cached pyodide. Document expected first-call latency. |
| Deno not installed on host | E.1 detects at startup; logs install instruction + disables `apply_script` for JS. |
| Native Python missing required packages | D.1 verifies on first call; clear error pointing to pip install command in the venv. |
| Memory limit not enforced reliably on macOS (no cgroups) | D.3 uses ulimit + monitors RSS via `ps`; if exceeded, send SIGKILL. Slightly less precise than Linux. Documented. |
| Per-invocation scratch dir not cleaned up after crash | D.4 uses `try/finally` + cleanup on server startup of any leftover `dcft-script-*` dirs older than 1 hour. |
| Catalog footprint exceeds 100 KB after this addition | M.2 verifies; description ≤200 words; likely fine since this is one tool with one schema. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Adversarial test suite (Phase D.6 + E.3) passes 100% in CI.
3. Cross-platform support: Linux + macOS confirmed; Windows graceful unsupported.
4. Risks acceptable.

After approval, implementation begins with Phase A.
