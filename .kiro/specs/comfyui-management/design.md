# comfyui-management — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `inspirations.md` (krita-ai-diffusion `ai_diffusion/server.py`, `ai_diffusion/comfy_*.py`, `ai_diffusion/workflow.py`).

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **Pinned ComfyUI commit hash** in `required-versions.ts`; bumped deliberately; tested matrix maintained in CHANGELOG. |
| Q2 | **OS-appropriate `install_dir` defaults** via `env-paths` package; overrideable. |
| Q3 | **Managed venv** via `python -m venv`; require Python 3.10+ on PATH; clear error otherwise. Bundling Python is post-v1. |
| Q4 | **Required nodes pinned by commit hash**, not version range. |
| Q5 | **No auto-install in external modes.** Clear error + install instructions. |
| Q6 | **No `repair_comfyui` tool in v1.** Manual reinstall via deletion. |
| Q7 | **PNG from ComfyUI**, server transcodes to WEBP/JPEG on `get_image` per capability. |

## 2. Module layout

```
libs/server/src/lib/comfy/
├── client.ts                   # ComfyClient (HTTP + WS) — internal
├── managed/
│   ├── installer.ts            # download ComfyUI + custom nodes
│   ├── supervisor.ts           # child-process management
│   ├── venv.ts                 # python venv creation
│   └── default-models.ts       # default model set
├── required-nodes.ts           # pinned custom-node list
├── required-versions.ts        # ComfyUI commit hash + node hashes
├── validation.ts               # validate ComfyUI install on startup
├── models/
│   ├── registry.ts             # SQLite cache of discovered models
│   ├── downloader.ts           # download + integrity + resume
│   └── parsers/
│       ├── hf.ts               # huggingface
│       ├── civitai.ts
│       └── file.ts             # local file:// scheme
├── graph/
│   ├── builder.ts              # entry point: dispatch by resolved verb
│   ├── generate.ts             # txt2img graph
│   ├── refine.ts               # img2img graph
│   ├── fill.ts                 # inpaint graph
│   ├── upscale.ts              # tile-based upscale graph
│   ├── helpers/
│   │   ├── control-layers.ts   # attach ControlNet/IP-Adapter nodes
│   │   ├── regions.ts          # per-region prompt + mask composition
│   │   ├── selection-masks.ts  # denoising + blend mask construction
│   │   └── resolution.ts       # hires-fix, multiples, batch sizing
│   └── types.ts                # ComfyUI workflow JSON shape
├── output-fetcher.ts           # fetch + thumbnail + history_item creation
└── health.ts                   # periodic health checks
```

## 3. `ComfyClient` (internal)

```typescript
// libs/server/src/lib/comfy/client.ts (NOT exported from index.ts)
export class ComfyClient {
  constructor(
    private url: string,
    private logger: Logger,
    private bus: EventBus
  ) {}

  async submitGraph(graph: ComfyGraph): Promise<{ prompt_id: string; queue_position: number }> {
    const res = await fetch(`${this.url}/prompt`, { method: "POST", body: JSON.stringify({ prompt: graph }) });
    if (!res.ok) throw new ComfyError(await res.text());
    const data = await res.json();
    return { prompt_id: data.prompt_id, queue_position: data.number };
  }

  async interrupt(prompt_id: string): Promise<void> {
    await fetch(`${this.url}/interrupt`, { method: "POST" });
  }

  async dequeue(prompt_id: string): Promise<void> {
    await fetch(`${this.url}/queue`, {
      method: "POST",
      body: JSON.stringify({ delete: [prompt_id] }),
    });
  }

  async getQueue(): Promise<QueueState> {
    const res = await fetch(`${this.url}/queue`);
    return res.json();
  }

  async getObjectInfo(): Promise<NodeCatalog> {
    const res = await fetch(`${this.url}/object_info`);
    return res.json();
  }

  async health(): Promise<HealthStatus> {
    const res = await fetch(`${this.url}/system_stats`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new ComfyError("health-check-failed");
    return res.json();
  }

  /** Typed event emitter wrapping the WebSocket. */
  events: ComfyEventEmitter;
}
```

## 4. Managed install pipeline

```
managed-mode start():
  1. Check install_dir/.installed marker file
     - exists + version matches → skip install
     - missing → install
  2. Install steps:
     a. git clone ComfyUI at pinned commit
     b. create venv: python -m venv venv
     c. activate venv, pip install requirements.txt
     d. clone each required custom-node at pinned hash into custom_nodes/
     e. run pip install for each custom-node's requirements
     f. download default models (FR-15)
     g. write .installed marker with version metadata
  3. Spawn ComfyUI process: <venv>/bin/python main.py --listen 127.0.0.1 --port <chosen>
  4. Capture stdout/stderr to logger
  5. Wait for health check to pass (poll /system_stats)
  6. Emit comfyui.install.completed (if install ran)
```

Supervisor restart logic:
```typescript
class ComfySupervisor {
  private restartAttempts = 0;
  private readonly MAX_RESTARTS = 3;

  async ensureRunning(): Promise<void> {
    while (this.shouldRun) {
      const exit = await this.spawn();
      if (!this.shouldRun) return;
      this.restartAttempts++;
      if (this.restartAttempts > this.MAX_RESTARTS) {
        this.bus.publish({ name: "comfyui.crashed-permanently", payload: { exit_code: exit.code } });
        return;
      }
      await sleep(5000 * this.restartAttempts);   // backoff
    }
  }
}
```

## 5. Custom-node validation

```typescript
// libs/server/src/lib/comfy/validation.ts
export async function validateInstall(client: ComfyClient): Promise<ValidationResult> {
  const objectInfo = await client.getObjectInfo();
  const presentNodes = new Set(Object.keys(objectInfo));

  const missing: RequiredNode[] = [];
  for (const node of REQUIRED_NODES) {
    if (!node.checks.every((classname) => presentNodes.has(classname))) {
      missing.push(node);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Missing required custom nodes: ${missing.map(n => n.name).join(", ")}. ` +
               `Install instructions: ${missing.map(n => n.installUrl).join(", ")}`,
    };
  }
  return { ok: true };
}
```

`REQUIRED_NODES` enumerates the four packages with their characteristic node class names and install URLs.

## 6. Graph construction (krita-ai-diffusion port)

This is a **TypeScript port** of `ai_diffusion/workflow.py`. The Python Acly logic is the reference; we adapt to TypeScript idioms but preserve behavior.

### 6.1 Dispatch

```typescript
// libs/server/src/lib/comfy/graph/builder.ts
export async function buildGraph(
  resolved_verb: ResolvedVerb,
  input: GenerateImageInput,
  ctx: GraphContext
): Promise<ComfyGraph> {
  switch (resolved_verb) {
    case "generate":              return buildGenerateGraph(input, ctx);
    case "refine":                return buildRefineGraph(input, ctx);
    case "fill":                  return buildFillGraph(input, ctx);
    case "constrained_variation": return buildRefineGraph({ ...input, with_selection: true }, ctx);
  }
}
```

### 6.2 `buildGenerateGraph` (txt2img)

```typescript
export function buildGenerateGraph(input: GenerateImageInput, ctx: GraphContext): ComfyGraph {
  const preset = resolvePreset(input.preset, ctx);
  const model = input.model ?? preset.model;
  const dims = computeDimensions(ctx.document, model);   // multiples-of-N + hires-fix decision

  const graph: ComfyGraph = {};
  let n = 1;

  // 1. Load checkpoint
  graph[n++] = node("CheckpointLoaderSimple", { ckpt_name: model });
  // 2. Apply LoRAs from preset
  for (const lora of preset.loras) {
    graph[n++] = node("LoraLoader", { /* ... */ });
  }
  // 3. CLIP encode prompts
  graph[n++] = node("CLIPTextEncode", { text: input.prompt });
  graph[n++] = node("CLIPTextEncode", { text: input.negative_prompt ?? "" });
  // 4. Empty latent of computed dims
  graph[n++] = node("EmptyLatentImage", { width: dims.w, height: dims.h, batch_size: input.batch_size });
  // 5. Attach control layers
  attachControlLayers(graph, input.control_layer_ids ?? [], n, ctx);
  // 6. Attach regions
  attachRegions(graph, input.region_ids ?? [], n, ctx);
  // 7. KSampler
  graph[n++] = node("KSampler", { /* ... */ });
  // 8. VAE decode
  graph[n++] = node("VAEDecode");
  // 9. SaveImage with subfolder=`diffusecraft/<job_id>`
  graph[n++] = node("SaveImage", { filename_prefix: `diffusecraft/${ctx.job_id}` });

  return graph;
}
```

The other builders (`buildRefineGraph`, `buildFillGraph`, `buildUpscaleGraph`) follow the same shape with verb-specific nodes (LoadImage for img2img source, MaskFromImage for fill, UltimateSDUpscale or tile-based for upscale).

### 6.3 Selection masks (krita-ai-diffusion `ai_diffusion/selection.py`)

Per the krita-ai-diffusion design:
- **Denoising mask** — red selection at full strength + orange offset + green/yellow falloff. Controls where the model can change.
- **Blend mask** — blue, larger, controls alpha composition with the original.

`selection-masks.ts` produces both from a single `Selection` input + `selection_mode` + selection feather/blend params (configurable in preset).

### 6.4 Regions

Per krita-ai-diffusion `ai_diffusion/region.py`:
- Each region's coverage = its linked paint layer's opacity.
- Root prompt is concatenated to each region's per-region prompt.
- Higher layers hide lower regions for the area they cover (normal layer stacking).

`regions.ts` walks the active document's regions, builds per-region masks from layer alpha, attaches conditioning nodes (e.g., via `ConditioningSetMask`).

### 6.5 Resolution handling

`resolution.ts`:
- If target dims fall in model's native trained range → single-pass.
- Otherwise → 2-pass (hires-fix): generate at native, then `LatentUpscale` + second KSampler with `denoise: 0.4-0.6`.
- Round dims to multiples of model-required factor (8, 16, or 64 depending on model).
- Apply `resolution_multiplier` from preset / config.
- Cap by `max_pixel_count` from server config.

## 7. Model registry & download

```typescript
// libs/server/src/lib/comfy/models/registry.ts
class ModelRegistry {
  async refresh(comfy: ComfyClient): Promise<void> {
    const objectInfo = await comfy.getObjectInfo();
    // ComfyUI exposes available models via input slots of CheckpointLoader, LoraLoader, etc.
    const checkpoints = objectInfo["CheckpointLoaderSimple"]?.input?.required?.ckpt_name?.[0] ?? [];
    // ... similar for loras, controlnets, ip_adapters, vaes, upscalers
    this.persist({ checkpoints, loras, controlnets, ip_adapters, vaes, upscalers });
  }
}
```

```typescript
// libs/server/src/lib/comfy/models/downloader.ts
class ModelDownloader {
  async download(modelId: string, opts: { signal?: AbortSignal }): Promise<DownloadResult> {
    const { url, target_path, integrity_hash } = parseModelId(modelId);
    // resume support via Range requests
    const existing = fs.existsSync(target_path) ? fs.statSync(target_path).size : 0;
    const res = await fetch(url, { headers: existing ? { Range: `bytes=${existing}-` } : {} });
    // stream to file with progress events
    let bytes = existing;
    const total = Number(res.headers.get("content-length")) + existing;
    for await (const chunk of res.body) {
      fs.appendFileSync(target_path, chunk);
      bytes += chunk.length;
      this.bus.publish({ name: "model.download.progress", payload: { model_id: modelId, percent: bytes/total*100, bytes_done: bytes, bytes_total: total } });
    }
    // verify hash
    const actual = sha256File(target_path);
    if (actual !== integrity_hash) {
      fs.unlinkSync(target_path);
      throw new IntegrityError({ expected: integrity_hash, actual });
    }
    return { path: target_path, size: bytes };
  }
}
```

## 8. Output fetching & history items

```typescript
// libs/server/src/lib/comfy/output-fetcher.ts
class OutputFetcher {
  async onJobCompleted(prompt_id: string, job_id: string, ctx: TrackerContext): Promise<HistoryItemId> {
    // 1. Find output filenames from ComfyUI's history endpoint
    const history = await fetch(`${this.comfy.url}/history/${prompt_id}`);
    const outputs = extractOutputFilenames(history);

    // 2. Fetch image bytes (filesystem if colocated; HTTP /view otherwise)
    const bytes = await this.fetchOutput(outputs[0]);

    // 3. Persist as blob
    const blob_id = await this.assets.writeBlob(bytes);

    // 4. Generate thumbnail
    const thumb_blob_id = await this.assets.writeThumbnail(bytes, 256);

    // 5. Create history_item row
    const history_item_id = ulid();
    this.db.exec("INSERT INTO history_items ...", {
      id: history_item_id,
      document_id: ctx.document_id,
      job_id,
      prompt: ctx.input.prompt,
      parameters_json: JSON.stringify(ctx.input),
      image_blob_id: blob_id,
      thumbnail_blob_id: thumb_blob_id,
      created_at: now(),
    });
    return history_item_id;
  }
}
```

## 9. Krita-ai-diffusion mapping

| krita-ai-diffusion (Python) | DiffuseCraft (TypeScript) |
|---|---|
| `ai_diffusion/server.py` (managed install) | `libs/server/src/lib/comfy/managed/installer.ts` |
| `ai_diffusion/comfy_client.py` | `libs/server/src/lib/comfy/client.ts` |
| `ai_diffusion/comfy_workflow.py` | `libs/server/src/lib/comfy/graph/types.ts` |
| `ai_diffusion/workflow.py` | `libs/server/src/lib/comfy/graph/builder.ts` + `generate.ts` + `refine.ts` + `fill.ts` |
| `ai_diffusion/selection.py` | `libs/server/src/lib/comfy/graph/helpers/selection-masks.ts` |
| `ai_diffusion/region.py` | `libs/server/src/lib/comfy/graph/helpers/regions.ts` |
| `ai_diffusion/control.py` | `libs/server/src/lib/comfy/graph/helpers/control-layers.ts` |
| `ai_diffusion/resolution.py` | `libs/server/src/lib/comfy/graph/helpers/resolution.ts` |
| `ai_diffusion/style.py` (presets) | `libs/server/src/lib/comfy/presets.ts` |

## 10. Acceptance criteria

1. The three connection modes are clearly separated.
2. Managed install pipeline ends with a working ComfyUI in <15 min on a clean machine.
3. Custom-node validation produces actionable error messages on missing nodes in external modes.
4. Graph builders cover all four v1 verbs and pass ComfyUI input validation 100% in test fixtures.
5. WebSocket reconnection preserves job tracking continuity.
6. Krita-ai-diffusion mapping is complete (every reference module mapped).
