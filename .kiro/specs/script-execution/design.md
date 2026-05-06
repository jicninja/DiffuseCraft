# script-execution — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `undo-redo-system`, `tech.md` "Backends model" §3.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **One image in, one image out.** Multi-layer orchestration is the agent's job. |
| Q2 | **No preview mode in v1.** |
| Q3 | **Ship example scripts** (grayscale, sepia, blur, levels, threshold, edge detect, palette quantize). |
| Q4 | **One server-wide venv.** No per-invocation virtualenvs. |
| Q5 | **Log first 200 chars + sha256 of full script.** Full retrieval via admin tool. Params not logged in detail. |
| Q6 | **`cancel_job` works for script jobs** via SIGTERM + grace + SIGKILL. |
| Q7 | **Windows v2.** v1 = Linux + macOS + Pyodide fallback. |

## 2. Module layout

```
libs/server/src/lib/scripting/
├── index.ts
├── runner.ts                    # ScriptRunner class
├── runtime/
│   ├── runtime.ts               # Runtime interface
│   ├── native-python.ts         # Linux/macOS Python subprocess
│   ├── deno-js.ts               # Deno subprocess for JS
│   ├── pyodide-wasm.ts          # Fallback Pyodide
│   └── select.ts                # auto-select best runtime per host
├── sandbox/
│   ├── linux.ts                 # unshare + cgroups + bind-mount jail
│   ├── macos.ts                 # sandbox-exec profile generator
│   └── deno-perms.ts            # Deno permission flags
├── ast/
│   ├── python-validator.ts      # parse with libCST or ast (subprocess)
│   ├── js-validator.ts          # parse with @babel/parser
│   └── whitelist.ts             # allowed_imports config + checker
├── runner-stubs/                # the wrapper code injected around user scripts
│   ├── runner.py                # reads stdin, calls main(image, params), writes stdout
│   └── runner.mjs
├── io-protocol.ts               # encode/decode the binary stdin/stdout protocol
├── handler.ts                   # apply_script handler + reversibility integration
├── examples/                    # ships built-in example scripts
│   ├── grayscale.py
│   ├── sepia.py
│   ├── ... etc
└── audit.ts                     # script audit logging (200 chars + sha256)

libs/ui/src/script/
├── ScriptPanel.tsx              # tablet UI
├── CodeEditor.tsx               # simple syntax-highlighted editor
├── ParamsEditor.tsx             # JSON editor
├── ExamplesPicker.tsx
└── LogsViewer.tsx
```

## 3. Public API (handler signature)

```typescript
// libs/server/src/lib/scripting/handler.ts
export const applyScriptHandler: Handler<typeof applyScript> = async (input, ctx) => {
  // 1. AST validation (synchronous, before subprocess)
  const validation = validateAst(input.code, input.language);
  if (!validation.ok) {
    throw new ServerError({
      code: validation.error.code,    // SCRIPT_DISALLOWED_IMPORT | SCRIPT_FORBIDDEN_CALL | ...
      message: validation.error.message,
      hint: validation.error.hint,
      field_path: `code:${validation.error.line}`,
    });
  }

  // 2. Resolve target layer image (if provided)
  const inputImage = input.target_layer_id
    ? await ctx.layers.getRasterizedContent(input.document_id, input.target_layer_id)
    : null;

  // 3. Submit to job tracker as a script job
  const job_id = await ctx.tracker.submitScriptJob({
    document_id: input.document_id,
    token_name: ctx.tokenName,
    spec: {
      kind: "script",
      language: input.language,
      code: input.code,
      params: input.params ?? {},
      input_image: inputImage,
      output_target: input.output_target ?? "new_layer",
      target_layer_id: input.target_layer_id,
      timeout_ms: input.timeout_ms ?? 30_000,
      max_memory_bytes: input.max_memory_bytes ?? 1024 * 1024 * 1024,
    },
  });

  return { job_id };
};
```

The job tracker (per `server-architecture` §4.4 and `comfyui-management` analogue) routes script jobs to `ScriptRunner` instead of ComfyUI. Concurrency cap: 2 server-wide (FR-29). On completion, the runner publishes `job.completed { history_item_id, layer_id?, stderr_log }` and (depending on `output_target`) registers a reversible Command.

## 4. Runtime interface

```typescript
// libs/server/src/lib/scripting/runtime/runtime.ts
export interface Runtime {
  readonly name: "native-python" | "deno-js" | "pyodide-wasm";
  readonly languages: ReadonlyArray<"python" | "javascript">;

  /** Verify host capabilities; throws if unavailable. */
  ensureAvailable(): Promise<void>;

  /** Execute a script with given input; returns the output image bytes + stderr. */
  execute(spec: ScriptSpec, signal: AbortSignal): Promise<ScriptResult>;
}

export interface ScriptSpec {
  language: "python" | "javascript";
  code: string;
  params: object;
  input_image: Uint8Array | null;
  timeout_ms: number;
  max_memory_bytes: number;
}

export interface ScriptResult {
  outcome: "success" | "failure" | "timeout" | "oom" | "killed";
  output_image: Uint8Array | null;
  stderr_log: string;
  exit_code: number;
  duration_ms: number;
}
```

## 5. Native Python runtime (Linux + macOS)

```typescript
// libs/server/src/lib/scripting/runtime/native-python.ts
export class NativePythonRuntime implements Runtime {
  name = "native-python" as const;
  languages = ["python"] as const;

  async ensureAvailable(): Promise<void> {
    // Verify python in venv; required packages importable.
    // On Linux: verify cgroup v2; if not, downgrade memory limit to soft.
  }

  async execute(spec: ScriptSpec, signal: AbortSignal): Promise<ScriptResult> {
    const scratch = await mkdtemp(`/tmp/dcft-script-`);
    const stub = await readFile(path.join(__dirname, "../runner-stubs/runner.py"), "utf-8");
    const fullCode = `${stub}\n\n# --- USER CODE BELOW ---\n${spec.code}`;

    const cmd = process.platform === "linux"
      ? this.buildLinuxCmd(scratch, spec)   // unshare + cgroups
      : this.buildMacosCmd(scratch, spec);  // sandbox-exec

    const child = spawn(cmd.argv[0], cmd.argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: cmd.path, ...cmd.env },
      cwd: scratch,
    });

    // Write protocol header + image
    const header = encodeStdinHeader(spec);
    child.stdin.write(header);
    if (spec.input_image) child.stdin.write(spec.input_image);
    child.stdin.end();

    const start = Date.now();
    let output: Uint8Array | null = null;
    let stderrBuf = Buffer.alloc(0);

    const stdoutChunks: Buffer[] = [];
    child.stdout.on("data", (c) => stdoutChunks.push(c));
    child.stderr.on("data", (c) => {
      stderrBuf = Buffer.concat([stderrBuf, c]);
      if (stderrBuf.length > 64 * 1024) stderrBuf = stderrBuf.slice(0, 64 * 1024);
    });

    const timeoutTimer = setTimeout(() => child.kill("SIGKILL"), spec.timeout_ms);
    signal.addEventListener("abort", () => child.kill("SIGTERM"));

    const exit_code: number = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? -1)));
    clearTimeout(timeoutTimer);
    await rm(scratch, { recursive: true, force: true });

    const duration_ms = Date.now() - start;
    if (exit_code === 0) {
      output = decodeStdoutImage(Buffer.concat(stdoutChunks));
      return { outcome: "success", output_image: output, stderr_log: stderrBuf.toString("utf-8"), exit_code, duration_ms };
    }
    if (duration_ms >= spec.timeout_ms) return { outcome: "timeout", output_image: null, stderr_log: stderrBuf.toString("utf-8"), exit_code, duration_ms };
    if (exit_code === -9 /* SIGKILL on OOM */) return { outcome: "oom", output_image: null, stderr_log: stderrBuf.toString("utf-8"), exit_code, duration_ms };
    return { outcome: "failure", output_image: null, stderr_log: stderrBuf.toString("utf-8"), exit_code, duration_ms };
  }

  private buildLinuxCmd(scratch: string, spec: ScriptSpec): SpawnCmd {
    return {
      argv: [
        "unshare", "-U", "-n", "-m",                     // user/network/mount namespaces
        "systemd-run", "--scope", "--user",
        `--property=MemoryMax=${spec.max_memory_bytes}`,
        `--property=CPUQuota=100%`,
        `--property=TimeoutStopSec=${Math.ceil(spec.timeout_ms / 1000)}`,
        "--quiet",
        "--",
        `${this.config.venv_path}/bin/python`, "-E", "-I", "-c", "<inline-fullCode>",
      ],
      path: `${this.config.venv_path}/bin`,
      env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
    };
  }

  private buildMacosCmd(scratch: string, spec: ScriptSpec): SpawnCmd {
    return {
      argv: [
        "sandbox-exec", "-f", this.macosSandboxProfile(scratch),
        `${this.config.venv_path}/bin/python`, "-E", "-I", "-c", "<inline-fullCode>",
      ],
      path: `${this.config.venv_path}/bin`,
      env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
    };
  }

  private macosSandboxProfile(scratch: string): string {
    // Generates a .sb file allowing read on stdlib paths + write on scratch only; deny network + spawn
    // ...
  }
}
```

## 6. Deno JS runtime

```typescript
// libs/server/src/lib/scripting/runtime/deno-js.ts
export class DenoJsRuntime implements Runtime {
  name = "deno-js" as const;
  languages = ["javascript"] as const;

  async execute(spec: ScriptSpec, signal: AbortSignal): Promise<ScriptResult> {
    const scratch = await mkdtemp(`/tmp/dcft-script-`);
    const child = spawn("deno", [
      "run",
      `--allow-read=${scratch}`,
      `--allow-write=${scratch}`,
      "--no-net",
      "--no-prompt",
      `--v8-flags=--max-old-space-size=${spec.max_memory_bytes / 1024 / 1024}`,
      path.join(__dirname, "../runner-stubs/runner.mjs"),
    ], { stdio: ["pipe", "pipe", "pipe"], cwd: scratch });
    // ... same stdin/stdout/timeout logic as native-python
  }
}
```

## 7. Pyodide WASM fallback

```typescript
// libs/server/src/lib/scripting/runtime/pyodide-wasm.ts
import { loadPyodide } from "pyodide";

export class PyodideRuntime implements Runtime {
  name = "pyodide-wasm" as const;
  languages = ["python"] as const;
  private pyodide?: any;

  async ensureAvailable(): Promise<void> {
    if (!this.pyodide) {
      this.pyodide = await loadPyodide({ indexURL: this.config.pyodide_path });
      await this.pyodide.loadPackage(["numpy", "pillow"]);
    }
  }

  async execute(spec: ScriptSpec, signal: AbortSignal): Promise<ScriptResult> {
    // Pyodide runs in this Node process — naturally sandboxed (no FS, no network from JS-WASM bridge)
    // BUT we don't get cgroup-level memory limit; rely on V8's heap limit + Pyodide's internal.
    // Whitelist further reduced (no cv2; numpy + Pillow only).
    // ...
  }
}
```

Pyodide is ~10 MB initial download, ~30 MB resident. Slower than native (no SIMD by default, no native libs). Used only as fallback.

## 8. Runtime selection

```typescript
// libs/server/src/lib/scripting/runtime/select.ts
export async function selectRuntime(language: "python" | "javascript", config: ScriptConfig): Promise<Runtime> {
  const pref = config.runtime_preference ?? "auto";
  if (pref === "auto") {
    if (language === "python") {
      try { const r = new NativePythonRuntime(config); await r.ensureAvailable(); return r; } catch {}
      if (config.allow_pyodide_fallback) {
        const p = new PyodideRuntime(config); await p.ensureAvailable(); return p;
      }
      throw new ServerError({ code: "SCRIPT_EXECUTION_NOT_AVAILABLE", message: "No Python runtime available." });
    } else {
      const d = new DenoJsRuntime(config); await d.ensureAvailable(); return d;
    }
  }
  // explicit selection
  // ...
}
```

## 9. AST validation

### 9.1 Python validator

Use libCST or Python's `ast` via a subprocess call (not the user's subprocess; a cached "validator" subprocess running trusted code). Walk the AST tree:
- Reject `Import` / `ImportFrom` whose module isn't in whitelist.
- Reject `Call` to: `eval`, `exec`, `compile`, `__import__`, `open` (without arg-checking), `getattr` (with non-literal name, to prevent dynamic attribute escape), `globals`, `locals`, `vars`, `dir`, `breakpoint`, `input`.
- Reject any `__class__`, `__bases__`, `__subclasses__`, `__mro__` attribute access (defends against the Python sandbox-escape via class hierarchy walking).

### 9.2 JS validator

Use `@babel/parser` to AST-walk:
- Reject `import` of non-whitelisted modules.
- Reject `require()` calls with non-string args or non-whitelisted strings.
- Reject `eval`, `Function`, `import()` (dynamic).
- Reject access to `globalThis`, `Function`, `process`.

### 9.3 Whitelist config

```typescript
export interface ScriptWhitelist {
  python: ReadonlyArray<string>;     // ["numpy", "PIL", "cv2", "scipy.ndimage", "scipy.signal", "skimage", "math", "json", ...]
  javascript: ReadonlyArray<string>; // ["sharp", "jimp"]
}
```

Operator extends via `script_execution.allowed_python_imports` / `.allowed_js_imports` in `ServerConfig`. Default minimal.

## 10. Runner stubs

```python
# libs/server/src/lib/scripting/runner-stubs/runner.py
import sys, json, struct, io
from PIL import Image

# Read stdin protocol
header_len = struct.unpack(">I", sys.stdin.buffer.read(4))[0]
header = json.loads(sys.stdin.buffer.read(header_len))
image = None
if "image" in header:
    img_bytes = sys.stdin.buffer.read(header["image"]["size"])
    image = Image.open(io.BytesIO(img_bytes))

params = header.get("params", {})

# --- USER CODE INJECTED HERE BY HANDLER ---
# (The handler appends user code; user must define `main(image, params) -> Image`)
# main = ...

# Call main
result = main(image, params)

# Write stdout protocol
out_buf = io.BytesIO()
result.save(out_buf, format="PNG")
out_bytes = out_buf.getvalue()
out_header = json.dumps({"image": {"format": "png", "width": result.width, "height": result.height, "size": len(out_bytes)}}).encode("utf-8")
sys.stdout.buffer.write(struct.pack(">I", len(out_header)))
sys.stdout.buffer.write(out_header)
sys.stdout.buffer.write(out_bytes)
sys.stdout.buffer.flush()
```

JS runner is analogous using `Buffer` and `Sharp.toBuffer()`.

## 11. Reversibility integration

```typescript
// inside ScriptRunner after success:
async function onScriptSuccess(ctx, spec, result) {
  if (spec.output_target === "new_layer") {
    // Same path as ComfyUI output: persist as blob, create history_item, emit job.completed.
    // The user/agent then calls apply_history_item to commit as a layer with reversibility.
    const blob_id = await ctx.assets.writeBlob(result.output_image);
    const history_item_id = ulid();
    ctx.db.exec("INSERT INTO history_items ...", { id: history_item_id, ..., parameters_json: { kind: "script", language: spec.language, code_hash: sha256(spec.code) } });
    ctx.bus.publish({ name: "job.completed", payload: { job_id, outcome: "success", history_item_id, ... } });
  } else if (spec.output_target === "replace_target") {
    // Direct replace via reversible Command:
    const layer = await ctx.layers.get(spec.document_id, spec.target_layer_id);
    const previous_blob_id = layer.content_blob_id;
    const new_blob_id = await ctx.assets.writeBlob(result.output_image);
    const command = buildCommand({
      tool_name: "apply_script",
      document_id: spec.document_id,
      args_summary: `Script (${spec.language}): ${spec.code.slice(0, 60)}...`,
      weight: "medium",
      apply: async () => { await ctx.layers.update(spec.document_id, spec.target_layer_id, { content_blob_id: new_blob_id }); },
      revert: async () => { await ctx.layers.update(spec.document_id, spec.target_layer_id, { content_blob_id: previous_blob_id }); },
    });
    await ctx.undoRedo.execute(spec.token_name, spec.token_id, spec.document_id, command);
    ctx.bus.publish({ name: "job.completed", payload: { job_id, outcome: "success", layer_id: spec.target_layer_id, ... } });
  }
}
```

## 12. Tablet UX

```typescript
// libs/ui/src/script/ScriptPanel.tsx
export const ScriptPanel: React.FC = () => {
  const [language, setLanguage] = useState<"python" | "javascript">("python");
  const [code, setCode] = useState<string>(EXAMPLES.grayscale.python);
  const [params, setParams] = useState<object>({});
  const [target, setTarget] = useState<LayerId | null>(useEditorStore.getState().active_layer_id);
  const [outputTarget, setOutputTarget] = useState<"new_layer" | "replace_target">("new_layer");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string>("");

  const onRun = async () => {
    setRunning(true); setLogs("");
    try {
      const job = await client.tools.applyScript({ language, code, target_layer_id: target, params, output_target: outputTarget });
      // wait for job.completed via job event subscription
      await waitForJob(job.job_id, (event) => {
        if (event.outcome === "success") {
          showToast("Script applied; preview in history strip");
          setLogs(event.stderr_log ?? "");
        } else {
          showToast("Script failed", { kind: "error" });
          setLogs(event.error?.message + "\n\n" + (event.stderr_log ?? ""));
        }
      });
    } finally { setRunning(false); }
  };

  return (
    <Panel title="Custom Script">
      <Tabs value={language} onChange={setLanguage}>
        <Tab value="python" label="Python" />
        <Tab value="javascript" label="JavaScript" />
      </Tabs>
      <ExamplesPicker language={language} onPick={setCode} />
      <CodeEditor language={language} value={code} onChange={setCode} />
      <ParamsEditor value={params} onChange={setParams} />
      <Row>
        <LayerPicker label="Target" value={target} onChange={setTarget} />
        <SegmentedPicker value={outputTarget} onChange={setOutputTarget}>
          <Segment value="new_layer" label="New layer" />
          <Segment value="replace_target" label="Replace" />
        </SegmentedPicker>
      </Row>
      <Button onPress={onRun} disabled={running}>{running ? "Running..." : "Run"}</Button>
      <LogsViewer text={logs} />
    </Panel>
  );
};
```

The panel is reachable from layer context menu ("Custom script…") OR from a "Tools → Script" menu — intentionally not on the main toolbar.

## 13. Acceptance criteria for `design.md`

1. Sandbox guarantees pass adversarial tests (red-team scripts: open socket, spawn subprocess, escape via `__class__`, write outside scratch — all blocked).
2. AST whitelist correctly accepts/rejects representative scripts.
3. Runtime selection picks the correct runtime per host and language.
4. `output_target` semantics produce correct undo/redo behavior.
5. Tablet panel runs the canonical examples successfully.
