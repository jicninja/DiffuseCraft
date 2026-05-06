# script-execution — Requirements

> **Status:** Draft v0.1.
> **Backend class 3** per `tech.md` "Backends model".
> **Depends on:** `mcp-tool-catalog`, `server-architecture` (handler dispatcher + middleware), `undo-redo-system`.
> **References:** P1 (agent-first), P4 (zero AI provider keys), P19 (ComfyUI never raw — analogous principle: scripts never raw on host), P20 (library independence — engines never see scripts), P26 (server-side execution).

## 1. Purpose

Define the **scripting sandbox** — a server-side capability to run **user-supplied Python or JavaScript code** against image bytes with strict isolation, returning a modified image. This is the third backend class alongside ComfyUI (image inference) and Agent (LLM/VLM via MCP).

Use cases:
- A power user runs a custom OpenCV filter not covered by built-in tools.
- An agent generates a one-off NumPy manipulation (e.g., "convert to log-luminance + invert").
- Batch processing scripts that compose existing tools with custom code.
- Plugins that don't justify a full ComfyUI custom node.

This spec defines:
- The MCP tool surface (`apply_script` and helpers).
- Sandbox guarantees and runtime choice.
- I/O contract.
- AST-based import validation.
- Resource limits.
- Reversibility integration.
- Failure modes.

## 2. Stakeholders & user stories

### S1 — Power user with custom OpenCV transform
> **Story 1.** As an illustrator with a specific look in mind (radial gradient + multiply blend with a noise texture), I open the "Custom script" panel, paste 15 lines of Python using `cv2` and `numpy`, choose the active layer as target, run. ~3 s later, the result lands as a new layer above the original. I undo to revert.

### S2 — Agent generating ad-hoc transformations
> **Story 2.** As Claude Code, given a brief like "make this layer look like a fax photocopy", I generate a Python snippet (binary threshold + sprinkle noise + slight color tint), invoke `apply_script({ language: "python", code, target_layer_id })`. Server returns the new layer; I `apply_history_item` if needed.

### S3 — Plugin author / batch processor
> **Story 3.** As a third-party developer, I write a JavaScript script that does palette quantization. I batch-call `apply_script` over 100 layers via an external script; each call returns within budget; failures are isolated per call.

### S4 — User without sandbox-capable host
> **Story 4.** As a user on a Windows machine where the server's preferred sandbox isn't available, I attempt to run a script. The server returns `SCRIPT_EXECUTION_NOT_AVAILABLE` with a hint. The rest of DiffuseCraft works fine.

### S5 — Bad-actor agent attempting to escape sandbox
> **Story 5.** A misbehaving agent submits a script with `import socket; socket.connect(...)`. The AST validator rejects the import before execution; tool returns `SCRIPT_DISALLOWED_IMPORT { module: "socket" }`. No subprocess spawned. No FS or network impact.

## 3. Functional requirements (EARS)

### 3.1 The MCP tool

**FR-1 (Ubiquitous).** `apply_script({ language, code, target_layer_id?, params?, timeout_ms?, max_memory_bytes? })` SHALL be added to v1 catalog. Categories: `job`, `reversible: true`.

**FR-2 (Ubiquitous).** Input fields:
- `language`: `"python"` | `"javascript"`.
- `code`: string, ≤ 64 KB.
- `target_layer_id`: optional. If provided, script receives that layer's content as input. If absent, script runs without input image (e.g., to generate from scratch — output dimensions provided in `params`).
- `params`: optional JSON object passed to the script as a parsed dict / object.
- `timeout_ms`: optional, default 30000, max 120000.
- `max_memory_bytes`: optional, default 1 GB, max 4 GB.
- `output_target`: `"new_layer"` (default) | `"replace_target"` — what to do with the result.

**FR-3 (Ubiquitous).** Output:
- `job_id` (the call is async; a job is created).
- Eventually via `job.completed`: `{ outcome: "success", history_item_id?, layer_id?, stderr_log: string }` or `{ outcome: "failure", error: { code, message } }`.

**FR-4 (Ubiquitous).** When `output_target === "new_layer"`, the result lands in `generation-history` as a regular history item; user/agent applies via `apply_history_item`. When `output_target === "replace_target"`, the result replaces `target_layer_id`'s content in a single reversible Command.

### 3.2 Sandbox guarantees

**FR-5 (Ubiquitous).** **No network access.** Sandbox SHALL block all network syscalls. Verified by submitting a script that opens a socket; result must be `EACCES` or equivalent.

**FR-6 (Ubiquitous).** **No filesystem write outside scratch.** Sandbox creates a per-invocation scratch directory; script can read/write only inside. Outside reads limited to language stdlib paths + the whitelisted package install dirs.

**FR-7 (Ubiquitous).** **Memory limit.** Default 1 GB; configurable up to 4 GB. Exceeded → SIGKILL → tool returns `SCRIPT_OOM`.

**FR-8 (Ubiquitous).** **CPU time limit.** Default 30 s wall-clock; configurable up to 120 s. Exceeded → SIGKILL → tool returns `SCRIPT_TIMEOUT`.

**FR-9 (Ubiquitous).** **UID drop / non-privileged user.** On Linux, the subprocess runs as a dedicated unprivileged uid (created at server install or per invocation via `unshare -U`). On macOS, the subprocess runs under the server's user with `sandbox-exec` profile. On Windows: see FR-32 (graceful unsupported).

**FR-10 (Ubiquitous).** **No subprocess spawning from inside the script.** AST validator rejects `subprocess`, `os.system`, `os.popen`, `os.exec*`, `pty`, `multiprocessing` (Python); `child_process` (JS).

**FR-11 (Ubiquitous).** **No `eval` / `exec` / dynamic imports.** AST validator rejects `eval`, `exec`, `__import__`, `compile` (Python); `eval`, `Function`, `import()` (JS). Whitelisted-import-only is enforceable only without dynamic loading.

### 3.3 Whitelisted libraries

**FR-12 (Ubiquitous).** Python whitelist (v1):
- `numpy`
- `PIL` / `Pillow`
- `cv2` / `opencv-python` (cv2 only, no `opencv-contrib` to keep image scope tight)
- `scipy` (subset: `scipy.ndimage`, `scipy.signal` allowed; full `scipy.io` not — file-handling)
- `skimage` / `scikit-image`
- `math`, `json`, `re`, `itertools`, `functools`, `collections`, `dataclasses`, `typing`, `enum`, `datetime` (stdlib safe set)

**FR-13 (Ubiquitous).** JavaScript whitelist (v1):
- `sharp` (Node native bindings, fast)
- `jimp` (pure JS image processing)
- builtin: `Buffer`, `Math`, `JSON`, `Array`, `Map`, `Set`, etc. (standard ES)

**FR-14 (Ubiquitous).** AST validator SHALL run **before** spawning the subprocess. Disallowed import → tool returns `SCRIPT_DISALLOWED_IMPORT { module: "<name>", line: N }`. No subprocess started.

**FR-15 (Ubiquitous).** Whitelist is server-config'd: `script_execution.allowed_python_imports` and `.allowed_js_imports`. Operator may extend (e.g., add `requests` for offline-batch use case) at their own risk; default is minimal.

### 3.4 I/O contract (script ↔ subprocess)

**FR-16 (Ubiquitous).** **stdin protocol** (binary):
1. 4 bytes big-endian: header length (N).
2. N bytes UTF-8 JSON header: `{ "image": { "format": "png", "width": W, "height": H, "size": S }?, "params": {...}, "output_target": "..." }` (image fields absent if no input image).
3. S bytes PNG image data (if image present).

**FR-17 (Ubiquitous).** **stdout protocol** (binary):
1. 4 bytes big-endian: header length (M).
2. M bytes UTF-8 JSON header: `{ "image": { "format": "png", "width": W, "height": H, "size": S } }`.
3. S bytes PNG image data.

**FR-18 (Ubiquitous).** **stderr** is captured as UTF-8 logs and returned in the job result `stderr_log` field. Limited to 64 KB; oversized → truncated with marker.

**FR-19 (Ubiquitous).** Server SHALL provide language-specific **runner stubs**:
- Python: `runner.py` reads stdin per FR-16, decodes image to PIL, calls user's entrypoint function, encodes result back to stdout per FR-17.
- JavaScript: `runner.mjs` analogous.
- User's `code` is executed inside the runner's `main(image, params)` function context; user doesn't write boilerplate.

**FR-20 (Ubiquitous).** User code SHALL define a function signature:
- Python: `def main(image: PIL.Image.Image, params: dict) -> PIL.Image.Image`
- JavaScript: `export async function main(image, params) { return modifiedImage; }`

The runner enforces this contract; missing function → `SCRIPT_MISSING_ENTRYPOINT`.

### 3.5 Reversibility

**FR-21 (Ubiquitous).** When `output_target === "new_layer"`: the new layer's creation is a reversible Command (`apply_history_item`-style; revert removes the layer). Original target untouched.

**FR-22 (Ubiquitous).** When `output_target === "replace_target"`: the target layer's pre-state is captured; revert restores prior `content_blob_id`. Reversible Command per `undo-redo-system`.

**FR-23 (Ubiquitous).** Failed scripts SHALL NOT register Commands.

### 3.6 Runtime selection

**FR-24 (Ubiquitous).** v1 default runtime: **native Python subprocess** with sandbox via:
- **Linux**: `unshare -U -n -m` + cgroup memory/CPU limits + bind-mount jail for FS read.
- **macOS**: `sandbox-exec` with a custom `.sb` profile blocking network + restricting FS.
- **Windows**: not supported in v1 (FR-32).

**FR-25 (Ubiquitous).** v1 fallback: **Pyodide WASM** runtime (Python in WebAssembly) for hosts without OS-level sandbox primitives. Performance lower; no native libs (no `cv2`, no `sharp`); whitelist further reduced (`numpy`, `PIL` only via Pyodide-supported wheels). Activated automatically when OS sandbox unavailable AND operator opts in via `script_execution.allow_pyodide_fallback: true`.

**FR-26 (Ubiquitous).** v1 JavaScript runtime: **Deno subprocess** with `--allow-read=<scratch>` `--no-net` `--no-write` flags. Deno's permission model gives sandbox without OS-level primitives. Available on all OSes Deno supports.

**FR-27 (Ubiquitous).** Operator may opt into a different runtime via `script_execution.runtime_preference`: `"native"` | `"pyodide"` | `"deno"` | `"auto"` (default `"auto"` — pick the most-capable available).

### 3.7 Resource accounting

**FR-28 (Ubiquitous).** Per-token rate limit: default 10 script invocations / minute / token. Configurable. Exceeded → `RATE_LIMITED`.

**FR-29 (Ubiquitous).** Concurrent script execution cap: default 2 simultaneous server-wide. Beyond → queue (FIFO) with `job.progress { stage: "queued" }`.

**FR-30 (Ubiquitous).** Audit log entries SHALL include first 200 chars of the script + language + outcome + duration. Full script available via dedicated audit query for compliance reviews.

### 3.8 Failure modes

**FR-31 (Unwanted).** IF the script throws an unhandled exception, THE server SHALL return `outcome: "failure"` with `error.code: "SCRIPT_EXCEPTION"`, `error.message`, and `stderr_log` populated. The traceback (Python) or stack (JS) is in `stderr_log`.

**FR-32 (Unwanted).** IF the host OS doesn't support any available sandbox runtime AND fallbacks are disabled, THE tool SHALL return `SCRIPT_EXECUTION_NOT_AVAILABLE { reason }`. Tablet UI hides the script panel via `mcpCatalogStore.hasTool("apply_script")` reflecting catalog filtering at handshake.

**FR-33 (Unwanted).** IF the script produces output that doesn't match the I/O protocol (truncated header, invalid PNG, etc.), THE server SHALL return `SCRIPT_INVALID_OUTPUT` with diagnostic details from stderr.

### 3.9 Tablet UX

**FR-34 (Ubiquitous).** A "Custom script" panel SHALL be available behind a long-press on the layer's context menu OR via a "Tools → Script" menu (intentionally not on the main toolbar — it's a power feature).

**FR-35 (Ubiquitous).** The panel SHALL include:
- Language tab (Python / JavaScript).
- Code editor (Monaco-equivalent or simple text editor with syntax highlighting; v1 may use simple editor with basic highlighting).
- Params editor (JSON).
- Target picker (Active layer / specific layer).
- Output target (New layer / Replace).
- Timeout slider.
- Run button.

**FR-36 (Ubiquitous).** Run state UX: progress indicator with stage label ("queued" / "running" / "applying"). On completion, history item appears in the strip; user applies as usual. On failure, a clear error toast with summary; full stderr accessible from a "Logs" link in the toast.

**FR-37 (Ubiquitous).** Saved scripts (post-v1): a registry of named scripts the user has authored, recallable by name. **Out of scope for v1** — for now, user pastes code each time.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Script invocation overhead (server receives → subprocess spawned → ready for stdin) SHALL be ≤ 200 ms for the `auto`-selected runtime on a typical laptop.

**NFR-2 (Ubiquitous).** AST validation SHALL complete in ≤ 50 ms for scripts ≤ 64 KB.

**NFR-3 (Ubiquitous).** Sandbox escape attempts SHALL fail closed: any attempt to access network, FS outside scratch, or spawn subprocess SHALL produce a permission error inside the script and SHALL NOT compromise the host.

**NFR-4 (Ubiquitous).** Catalog impact: 1 tool added (`apply_script`). Combined with prior specs (transform-tools +1, mask-system +7, selection-tools +5), v1 catalog is now ~52 tools. Cap raised previously to 55 — within budget.

## 5. Out of scope

- **Saved-named-script registry** (post-v1).
- **Script versioning / git-backed scripts** (post-v1).
- **Plugin marketplace** (post-v1; might never).
- **GPU access from scripts** (would require the script subprocess to hit ComfyUI; defeats the simple sandbox; post-v1 if at all).
- **Inter-script communication / pipelines** (post-v1).
- **Scripts that consume MCP tools recursively** (a script calling other tools — no, scripts are leaf operations).
- **Scripts modifying multiple layers in one call** (v1 = one input one output; orchestration is the agent's job).

## 6. Open questions

### Q1 — Should scripts have read access to the entire document state?
A user might want a script that reads layer count, blends multiple layers, etc.

**Recommendation:** **no in v1.** Scripts get one image + params; orchestration of multiple layers is the agent's job (call `get_image` for each, pass into `apply_script`). Keeps sandbox simpler and avoids leaking too much state.

### Q2 — Should there be a "preview" mode that runs the script on a downsized version first?
For latency feedback during script authoring.

**Recommendation:** **post-v1.** v1 user runs once on full image; if slow, they choose a smaller `target_layer_id`. Preview mode is UX polish.

### Q3 — Pre-installed example scripts?
Bundle 5–10 example scripts to seed the user's mental model.

**Recommendation:** **yes** — ship a `script_examples.md` doc plus an "Examples" picker in the UI panel that lets user load common ones (grayscale, sepia, blur, levels, threshold, edge detect, palette quantize). User can edit and run.

### Q4 — Should the server allow Python virtualenv per-invocation?
Some users might want different package versions.

**Recommendation:** **no in v1.** One server-wide venv with the whitelisted packages pinned. Simpler, more predictable.

### Q5 — Logging full script vs hash for audit
Privacy concern: scripts might contain secrets in `params`.

**Recommendation:** audit log stores **first 200 chars** + sha256 of full script. Full script available via dedicated `get_script_history({ since })` admin tool, gated to admin-equivalent access (currently single-tier post-Q7 simplification — so any paired client; document this caveat). Params are NOT logged in detail (just keys).

### Q6 — Should scripts be revocable / cancellable mid-execution?
Long-running scripts could hang.

**Recommendation:** **yes**. `cancel_job({ job_id })` (already in catalog) works for script jobs — sends SIGTERM, then SIGKILL after grace.

### Q7 — Cross-platform sandbox: what's the Windows story long-term?
v1 doesn't support Windows. v2?

**Recommendation:** v2 evaluates Windows AppContainer + Job Objects for Windows native sandbox; or relies on Pyodide WASM. Decided when v2 starts.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The five user stories (§2) are realized.
2. Sandbox guarantees (FR-5..11) are testable: red-team scripts attempt each escape and fail closed.
3. AST whitelist rejects disallowed imports without spawning subprocess.
4. I/O contract is implementable with one runner stub per language.
5. Runtime selection (`auto`) picks the best available; gracefully degrades.
6. Catalog impact ≤55 tools (within current cap).
7. Tablet UX panel is reachable but not on the main toolbar.
8. Open questions have acceptable recommendations.
