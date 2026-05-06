# meshcraft-integration — Design

> **Companion to:** `requirements.md`. **Type:** contract spec. **References:** every prior DiffuseCraft spec.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **MeshCraft writes its own CanvasKit adapter.** No DiffuseCraft package for it in v1. Extract post-v1 if widely useful. |
| Q2 | **Pipeline phases are reversible**: custom tool handler aggregates underlying Commands into one composite Command. |
| Q3 | **Document-level lock during pipeline phases**; tablet user gets read-only with progress indicator. Lock via `DOCUMENT_LOCKED` error code from `mcp-tool-catalog`. |
| Q4 | **MeshCraft owns its character model**; no attempt to embed character semantics in DiffuseCraft documents. |
| Q5 | **MeshCraft's choice** (RN-Web for verbatim component reuse OR pure React with re-implementation). Either is contract-compatible. |
| Q6 | **No example app in v1**; reference impl post-v1. |

## 2. Architectural diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                       MeshCraft (Electron)                         │
│                                                                    │
│   ┌──────────────────────┐   ┌────────────────────────────────┐    │
│   │  Renderer (UI)       │   │  Main process                  │    │
│   │                      │   │                                │    │
│   │  - React (or RN-Web) │   │  - createDiffuseCraftServer    │    │
│   │  - canvas-core       │   │    (managed ComfyUI)           │    │
│   │  - canvas-kit adapter│◄──┤  - registers onPairingRequest  │    │
│   │    (MeshCraft-owned) │ I │  - registers addCustomTool     │    │
│   │  - DiffuseCraftClient│ P │    (meshcraft.* pipeline tools)│    │
│   │    (in-memory)       │ C │  - bridges in-memory MCP to    │    │
│   │  - editor stores     │   │    renderer via IPC            │    │
│   │  - MeshCraft UI      │   │                                │    │
│   └──────────────────────┘   └─────┬──────────────────────────┘    │
│                                    │                               │
└────────────────────────────────────┼───────────────────────────────┘
                                     │ Streamable HTTP (port 7860)
                                     │ (for EXTERNAL clients only)
                                     ▼
                ┌────────────────────────────────────┐
                │  External clients (need pairing):   │
                │   - Paired iPad / Android tablet    │
                │     (mDNS or QR)                    │
                │   - Claude Desktop / Code           │
                │     (token paste)                   │
                │   - Codex / Gemini CLI / custom     │
                └────────────────────────────────────┘
```

## 3. Renderer ↔ main IPC bridge

The renderer never speaks HTTP to the local server. Instead, the main process exposes an IPC channel that bridges in-memory MCP invocations:

```typescript
// MeshCraft/main/diffusecraft-bridge.ts
import { ipcMain } from "electron";
import { createDiffuseCraftServer, DiffuseCraftServer } from "@diffusecraft/server";

let server: DiffuseCraftServer;

export async function initServer() {
  server = createDiffuseCraftServer({
    comfyui: { mode: "managed", install_dir: app.getPath("userData") + "/comfyui" },
    transports: { http: { host: "0.0.0.0", port: 7860 }, stdio: false },
    in_memory_token_name: "_in_process_meshcraft",
    host_name: "MeshCraft",
  });

  server.hooks.onPairingRequest(async (req) => showPairingDialog(req));
  server.hooks.addCustomTool(meshcraftPipelinePhaseTool, meshcraftPipelinePhaseHandler);

  ipcMain.handle("dcft:invokeTool", (_e, name, args) => server.mcp.invokeTool(name, args));
  ipcMain.handle("dcft:readResource", (_e, uri) => server.mcp.readResource(uri));
  ipcMain.handle("dcft:subscribeEvent", (e, eventName) => {
    const unsub = server.events.on(eventName, (payload) => e.sender.send(`dcft:event:${eventName}`, payload));
    e.sender.once("destroyed", unsub);
  });

  await server.start();
}
```

```typescript
// MeshCraft/renderer/diffusecraft-client.ts
import { ipcRenderer } from "electron";
import { createDiffuseCraftClient, type DiffuseCraftServer } from "@diffusecraft/diffusion-client";

const ipcBridgedServer: DiffuseCraftServer = {
  mcp: {
    invokeTool: (name, args) => ipcRenderer.invoke("dcft:invokeTool", name, args),
    readResource: (uri) => ipcRenderer.invoke("dcft:readResource", uri),
    tools: /* generated typed accessors */,
  },
  events: {
    on(name, handler) {
      ipcRenderer.invoke("dcft:subscribeEvent", name);
      const wrapped = (_e, payload) => handler(payload);
      ipcRenderer.on(`dcft:event:${name}`, wrapped);
      return () => ipcRenderer.off(`dcft:event:${name}`, wrapped);
    },
  },
  // start/stop are no-ops from renderer perspective; main owns lifecycle
} as any;

export const client = createDiffuseCraftClient({
  transport: { kind: "in-memory", server: ipcBridgedServer },
  capabilities: { /* ... */ },
});
```

This bridge gives the renderer the **same `DiffuseCraftClient` API** as the tablet app, with zero auth, zero HTTP, ≤5 ms IPC overhead per call.

## 4. CanvasKit render adapter (MeshCraft-supplied)

```typescript
// MeshCraft/renderer/diffusecraft-paint/CanvasKitAdapter.ts
import { CanvasKit, CanvasKitInit, Canvas, Image, Paint, Surface } from "canvaskit-wasm";
import { CanvasRenderAdapter, Document, Layer, Viewport, LayerId } from "@diffusecraft/canvas-core";

export class CanvasKitAdapter implements CanvasRenderAdapter {
  private surface!: Surface;
  private layerCache = new Map<string, Image>();

  async init(htmlCanvas: HTMLCanvasElement) {
    this.canvasKit = await CanvasKitInit({});
    this.surface = this.canvasKit.MakeWebGLCanvasSurface(htmlCanvas)!;
  }

  drawDocument(document: Document, viewport: Viewport, opts?: { incremental?: { changedLayerIds?: LayerId[] } }) {
    const canvas = this.surface.getCanvas();
    canvas.save();
    canvas.translate(viewport.pan_x, viewport.pan_y);
    canvas.rotate(viewport.rotation_degrees, 0, 0);
    canvas.scale(viewport.zoom, viewport.zoom);

    for (const entity of topLevelEntities(document)) {
      if (entity.kind === "layer") this.drawLayer(canvas, entity);
      else this.drawGroup(canvas, entity, document);
    }
    canvas.restore();
    this.surface.flush();
  }

  hitTest(x, y, document, viewport): LayerId | null { /* mirror canvas-skia logic */ }
  hitTestStack(x, y, document, viewport): LayerId[] { /* ... */ }
  rasterizeLayer(layer, dims): Promise<Uint8Array> { /* ... */ }
  rasterizeDocument(doc, dims): Promise<Uint8Array> { /* ... */ }

  private drawLayer(canvas: Canvas, layer: Layer) {
    if (!layer.visible) return;
    const img = this.getCachedImage(layer.content_blob_id);
    if (!img) return;
    const paint = new this.canvasKit.Paint();
    paint.setAlphaf(layer.opacity);
    paint.setBlendMode(this.toCkBlendMode(layer.blend_mode));
    canvas.drawImage(img, 0, 0, paint);
    paint.delete();
  }

  // etc — mirroring SkiaRenderAdapter from canvas-skia
}
```

The adapter implements the same interface as `canvas-skia`. Visual regression tests (FR NFR-3) compare adapter outputs on a fixture set to ensure parity.

## 5. UI composition options

MeshCraft can choose:

### Option A — React Native Web

```typescript
// pseudocode
import { LayerPanel } from "@diffusecraft/ui";
// Rendered via react-native-web in the Electron renderer
// Reuses tablet components verbatim
```

Cost: more setup (RN-Web + Skia-Web). Benefit: maximum component reuse.

### Option B — Pure React with re-implemented components

```typescript
// MeshCraft/renderer/components/LayerPanel.tsx
import { useEditorStore } from "@diffusecraft/core";
// MeshCraft writes its own LayerPanel.tsx
// Reuses stores + canvas-core; rewrites UI
```

Cost: more UI code. Benefit: simpler stack, native Electron React.

This spec accepts either; MeshCraft decides per its existing tech stack.

## 6. Custom pipeline tool

```typescript
// MeshCraft/main/pipeline/phase-1-tool.ts
import { z } from "zod";
import { defineTool } from "@diffusecraft/mcp-tools";

export const meshcraftPhase1Tool = defineTool({
  name: "meshcraft.run_pipeline_phase",
  title: "Run a MeshCraft pipeline phase",
  description:
    "Runs a specific phase of MeshCraft's 6-phase character pipeline. Phase 1 = concept art generation; " +
    "phase 2 = refinement; phase 5/6 = texture authoring. Internally orchestrates DiffuseCraft tools " +
    "(set_workspace, generate_image, apply_history_item, upscale_image) per phase.",
  category: "job",
  idempotent: false,
  reversible: true,
  inputSchema: z.object({
    phase: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(6)]),
    character_id: z.string(),
    params: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    job_id: z.string(),
    phase: z.number(),
  }),
  workspace: ["Generate", "Inpaint", "Upscale"],
  since: "1.0.0",
});

export const meshcraftPhase1Handler: Handler<typeof meshcraftPhase1Tool> = async (input, ctx) => {
  const character = await meshcraftCharacterStore.get(input.character_id);
  const document_id = await ctx.client.tools.createDocument({ width: 1024, height: 1536, name: `${character.name}-concept` });

  // Aggregated reversible Command capturing all sub-operations
  const command = buildCommand({
    tool_name: "meshcraft.run_pipeline_phase",
    document_id: document_id,
    args_summary: `MeshCraft phase ${input.phase} for ${character.name}`,
    weight: "large",
    apply: async () => {
      await ctx.client.tools.setWorkspace({ workspace: "Generate" });
      const job = await ctx.client.tools.generateImage({
        prompt: character.description,
        preset: "concept-art",
        batch_size: 8,
      });
      // Wait for completion, gather history items, present to user / pick
      const result = await waitForBatchCompletion(job.job_id, 8);
      // ... handle pick + apply_history_item
      return { job_id: job.job_id, phase: input.phase };
    },
    revert: async () => {
      await ctx.client.tools.closeDocument({ id: document_id });
    },
  });

  return ctx.undoRedo.execute(ctx.tokenName, ctx.tokenId, document_id, command);
};
```

The pipeline-phase tool registers via `addCustomTool` so it appears in the MCP catalog. External agents (Claude Code) paired with MeshCraft can drive the pipeline directly.

## 7. Document-level locking during pipeline phases

```typescript
// MeshCraft pipeline-phase handler
async function withDocumentLock(document_id: string, ctx: HandlerContext, fn: () => Promise<any>) {
  ctx.documents.lock(document_id, ctx.tokenName);
  try {
    return await fn();
  } finally {
    ctx.documents.unlock(document_id);
  }
}
```

Other clients (tablet user) attempting to mutate the locked document receive `DOCUMENT_LOCKED` per `mcp-tool-catalog` error model. Read operations (resources, get_image, etc.) still work — the user can watch progress without contributing edits.

## 8. Job queue: shared, not duplicated

There is **one** job queue: ComfyUI's. The DiffuseCraft job tracker mirrors it. MeshCraft pipeline jobs flow through the same path:

```
MeshCraft pipeline tool
   → DiffuseCraft tools (generate_image, etc.)
       → JobTracker.submit
           → ComfyClient.submitGraph
               → ComfyUI /prompt
                   ← prompt_id
           ← job_id
       ← job_id
   ← MeshCraft pipeline tracking key
```

Tablet user submitting a `generate_image` enters the same queue; both wait their turn. Multi-client coordination per `mcp-tool-catalog` FR-21..23 (last-write-wins, conflict events).

## 9. Cross-spec touches (impact summary)

| Spec | Impact |
|---|---|
| `mcp-tool-catalog` | No catalog changes from this spec. MeshCraft adds custom tools at runtime. |
| `server-architecture` | Hooks `onPairingRequest`, `addCustomTool`, in-memory transport — all already specced; this spec exercises them. |
| `pairing-protocol` | Only invoked for **external clients** to MeshCraft (paired tablet, agents). Renderer-to-server is in-process IPC, no pairing. |
| `comfyui-management` | MeshCraft uses managed mode; install UX wraps the standard install events. |
| `canvas-fundamentals` / `transform-tools` / `mask-system` / `selection-tools` / `brush-system` / `control-layers` / `regions` | All `canvas-core` modules reused verbatim. MeshCraft writes a CanvasKit render adapter conforming to the same interface as `canvas-skia`. |
| `generation-workflow` / `generation-history` / `upscale-and-tiling` / `resolution-handling` / `prompt-enhancement` / `speech-to-text` | All MCP tools reused; MeshCraft pipeline orchestrates them. |
| `undo-redo-system` | Pipeline-phase Commands aggregate underlying tool Commands into one revertable unit. |
| `workspaces` | MeshCraft pipeline sets workspaces appropriately per phase (Generate / Inpaint / Upscale). |

## 10. Acceptance criteria

1. Five user stories from `requirements.md` are achievable via the contracts in §3-9.
2. Renderer ↔ main IPC bridge gives ≤5 ms overhead.
3. Local connection has zero pairing/QR/token UX (FR-16..19).
4. CanvasKit adapter contract is implementable (MeshCraft side); `canvas-core` interface is sufficient.
5. Custom pipeline tool with composite Command pattern works.
6. Document lock prevents concurrent edits during pipelines without blocking reads.
7. One queue path: pipeline tools → DiffuseCraft tools → ComfyUI.
