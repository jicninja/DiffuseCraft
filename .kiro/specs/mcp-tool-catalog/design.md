# mcp-tool-catalog — Design

> **Companion to:** `requirements.md` of this spec.
> **Reference:** `tech.md` (MCP catalog as primary API, schema validation), `principles.md` (P1, P3, P5, P6, P7, P27).

This document specifies how the requirements are realized in code. It defines: package architecture of `@diffusecraft/mcp-tools`, Zod schemas (representative + patterns), JSON Schema emission pipeline, server-side registration handshake, versioning semantics, the resource catalog, the event catalog, the error model, capability negotiation, MCP prompts (templates), and four end-to-end agent walkthroughs.

---

## 1. Resolved decisions (closing requirements §7 open questions)

| ID | Decision | Rationale |
|---|---|---|
| Q1 | **Explicit `document_id` everywhere; `set_active_document` updates a per-client preference forwarded as a request header.** | Stateless tools are agent-friendly; the GUI gets the convenience of a session document via the header. Consistent with P5 (state queryable). |
| Q2 | **ULID** for all DiffuseCraft-generated ids (jobs, history, layers, regions, control layers, presets, blobs, documents). | Sortable, URL-safe, 26 chars, monotonic per generator. Avoids UUID's 36-char overhead and sequential's info-leak. |
| Q3 | **Single `generate_image` tool with verb resolution.** Output reports `resolved_verb: "generate" \| "refine" \| "fill" \| "constrained_variation"`. | Matches krita-ai-diffusion mental model; 1 tool replaces 4 conceptually-equivalent tools. |
| Q4 | **`apply_history_item` inserts as a new layer at the contextual position:** Fill/Inpaint result above the inpainted layer; Refine result above the source; pure Generate result on top of the layer stack. The verb determines insertion semantics. | Matches user expectation; agents don't need to compute insertion. |
| Q5 | **Resources only for lists (no parallel `list_*` tools).** Critical reads (`get_document_state`, `get_history_item`, `get_image`) remain as tools so tools-only agents work. | Saves 10 tools from the catalog footprint while keeping tools-first agents productive. |
| Q6 | **Catalog version negotiation in handshake.** Server reports `[min, max]` supported range; client picks highest both support; tools added in newer versions return `UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION`. | Smooth upgrades without breakage. |
| Q7 | **Prefixed model id (`hf:`, `civitai:`).** Schema `z.string().regex(/^(hf|civitai|file):/)` validates known prefixes. Adding a registry is a minor catalog bump. | Self-describing; collision-proof; extensible. |
| Q7-bis | **Rate limits per token: 50 image-mutating tool calls per minute, 16 MB max payload per call.** Configurable in server config. Errors: `RATE_LIMITED { retry_after_ms }`, `PAYLOAD_TOO_LARGE { max_bytes }`. | Prevents agent runaways without overengineering quotas. |
| Q7-ter | **PNG default for `get_image`. WEBP returned automatically when `accepts_lossy: true` is in handshake AND source has no alpha-critical content.** Agent can override with explicit `format` param. | Honest default; opt-in efficiency. |

---

## 2. Package architecture: `@diffusecraft/mcp-tools`

### 2.1 File layout

```
libs/mcp-tools/
├── src/
│   ├── index.ts                    # Public exports
│   ├── manifest.ts                 # The catalog manifest (declarative)
│   ├── version.ts                  # Catalog semver constant
│   ├── tools/
│   │   ├── server/                 # Domain folder per §3.3 group
│   │   │   ├── get-server-info.ts
│   │   │   ├── revoke-token.ts
│   │   │   └── get-audit-log.ts
│   │   ├── documents/
│   │   ├── layers/
│   │   ├── selection/
│   │   ├── generation/
│   │   ├── history/
│   │   ├── control-layers/
│   │   ├── regions/
│   │   ├── workspaces/
│   │   ├── upscale/
│   │   ├── models/
│   │   ├── speech-enhance/
│   │   ├── undo-redo/
│   │   ├── image-read/
│   │   ├── image-edit/
│   │   └── export/
│   ├── resources/
│   │   ├── manifest.ts             # Resource URI templates and content schemas
│   │   └── *.ts                    # One file per resource group
│   ├── events/
│   │   ├── manifest.ts             # Event names + payload schemas
│   │   └── *.ts
│   ├── prompts/                    # MCP prompts (templated agent guidance)
│   │   ├── generate-and-iterate.ts
│   │   ├── inpaint-region.ts
│   │   ├── refine-with-control.ts
│   │   └── batch-variations.ts
│   ├── shared/
│   │   ├── envelope.ts             # ImageEnvelope schema
│   │   ├── ids.ts                  # ULID schema
│   │   ├── errors.ts               # Error code enum + ErrorResponse schema
│   │   ├── pagination.ts           # Paginated<T> helper
│   │   └── capabilities.ts         # Client capability declaration schema
│   └── __tests__/
│       ├── manifest-coverage.test.ts
│       ├── footprint.test.ts       # Asserts compiled catalog ≤100 KB
│       └── per-tool/
├── scripts/
│   └── emit-json-schema.ts         # Build-time: Zod → JSON Schema → catalog.json
├── dist/
│   ├── index.{js,d.ts,mjs}
│   └── catalog.json                # Emitted artifact, also published
├── package.json                    # Single dependency: zod
└── README.md
```

### 2.2 The manifest pattern

Every tool is a **declarative record** combining the schemas with metadata. Server reads the manifest to register handlers; the JSON Schema emitter walks the same manifest.

```typescript
// libs/mcp-tools/src/shared/tool.ts
import { z } from "zod";

export type ToolCategory = "read" | "write" | "job";

export interface ToolDefinition<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  name: string;                          // snake_case verb_noun
  title: string;
  description: string;                   // Multi-paragraph, ≤200 words
  category: ToolCategory;
  idempotent: boolean;
  reversible: boolean;                   // Wires into undo/redo system per P27
  inputSchema: I;
  outputSchema: O;
  example?: { input: z.infer<I>; output: z.infer<O> };
  since: string;                         // Catalog version that introduced it
  workspace?: WorkspaceTag[];            // Filter for capability negotiation (FR-38)
}
```

```typescript
// libs/mcp-tools/src/manifest.ts
import { defineCatalog } from "./shared/define-catalog";
import * as serverTools from "./tools/server";
import * as documentTools from "./tools/documents";
// ...etc

export const catalog = defineCatalog({
  version: "1.0.0",
  tools: [
    serverTools.getServerInfo,
    serverTools.revokeToken,
    serverTools.getAuditLog,
    documentTools.createDocument,
    // ... 38 total
  ],
  resources: [/* ... */],
  events: [/* ... */],
  prompts: [/* ... */],
});
```

### 2.3 Build pipeline

```
┌──────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ Zod schemas  │ ──► │ zod-to-json-schema   │ ──► │ catalog.json        │
│ in src/      │     │ + manifest walker    │     │ (≤100 KB target)    │
└──────────────┘     └──────────────────────┘     └─────────────────────┘
                                                           │
                                                           ▼
                                                    Imported by:
                                                    - @diffusecraft/server
                                                      (tools/list response)
                                                    - @diffusecraft/diffusion-client
                                                      (handshake validation)
                                                    - test harness
                                                      (catalog conformance)
```

The build script:
1. Imports `manifest.ts`.
2. For each tool/event/resource, calls `zodToJsonSchema(schema, { target: "openApi3" })`.
3. Strips redundant `$schema` declarations to save bytes.
4. Asserts `JSON.stringify(catalog).length ≤ 100_000` (FR-33).
5. Asserts ≤40 tools (FR-36).
6. Writes `dist/catalog.json`.

### 2.4 Single dependency

`package.json` runtime dependencies:
```json
{ "dependencies": { "zod": "^3.23.0" } }
```

Dev dependencies include `zod-to-json-schema` (build-only). Per FR-NFR-4.

---

## 3. Representative schemas (Zod, with notes)

Full schemas for 38 tools live in source. This section presents the **canonical patterns** + the most architecturally significant schemas.

### 3.1 Shared primitives

```typescript
// libs/mcp-tools/src/shared/ids.ts
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Must be a valid ULID");
export const DocumentId = Ulid.brand<"DocumentId">();
export const LayerId = Ulid.brand<"LayerId">();
export const HistoryItemId = Ulid.brand<"HistoryItemId">();
export const JobId = Ulid.brand<"JobId">();
export const RegionId = Ulid.brand<"RegionId">();
export const ControlLayerId = Ulid.brand<"ControlLayerId">();
export const PresetId = Ulid.brand<"PresetId">();
export const BlobId = Ulid.brand<"BlobId">();
export const TokenId = Ulid.brand<"TokenId">();

// libs/mcp-tools/src/shared/envelope.ts
export const ImageFormat = z.enum(["png", "jpeg", "webp"]);

export const ImageEnvelope = z.object({
  format: ImageFormat,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).and(
  z.union([
    z.object({ inline: z.object({ encoding: z.literal("base64"), data: z.string() }) }),
    z.object({ ref: z.object({
      uri: z.string().regex(/^diffusecraft:\/\/blob\/[0-9A-HJKMNP-TV-Z]{26}$/),
      expires_at: z.string().datetime(),
    }) }),
  ])
);

export const Selection = z.union([
  z.object({ kind: z.literal("rect"), rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) }),
  z.object({ kind: z.literal("mask"), mask: ImageEnvelope }),
  z.object({ kind: z.literal("none") }),
]);

// libs/mcp-tools/src/shared/errors.ts
export const ErrorCode = z.enum([
  "NOT_FOUND",
  "INVALID_INPUT",
  "QUEUE_FULL",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_CATALOG_VERSION",
  "UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION",
  "COMFYUI_DISCONNECTED",
  "MODEL_NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "VERSION_MISMATCH",
  "DOCUMENT_LOCKED",
  "RESOURCE_GONE",
]);

export const ErrorResponse = z.object({
  code: ErrorCode,
  message: z.string(),
  hint: z.string().optional(),
  retry_after_ms: z.number().int().nonnegative().optional(),
  field_path: z.string().optional(),
});
```

### 3.2 The core: `generate_image`

```typescript
// libs/mcp-tools/src/tools/generation/generate-image.ts
import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { DocumentId, JobId, LayerId, ControlLayerId, RegionId } from "../../shared/ids";
import { Selection } from "../../shared/envelope";

const SelectionMode = z.enum([
  "Fill",
  "Expand",
  "AddContent",
  "RemoveContent",
  "ReplaceBackground",
]);

const ResolvedVerb = z.enum([
  "generate",
  "refine",
  "fill",
  "constrained_variation",
]);

const Input = z.object({
  document_id: DocumentId.optional()
    .describe("Defaults to active document from session header."),
  prompt: z.string().min(1).max(2000)
    .describe("English prompt. P23: must be English even when UI is multilingual."),
  negative_prompt: z.string().max(2000).optional(),
  strength: z.number().min(0).max(100).default(100)
    .describe("100 = ignore canvas; <100 = use canvas as starting point. With selection, resolves to Fill or constrained_variation."),
  selection: Selection.optional(),
  selection_mode: SelectionMode.optional()
    .describe("Required when selection is present. Determines fill semantics."),
  seed: z.union([z.number().int(), z.literal("random")]).default("random"),
  preset: z.string().optional()
    .describe("Preset name. If omitted, uses server default preset."),
  model: z.string().optional()
    .describe("Overrides preset model. Format: <registry>:<id>."),
  control_layer_ids: z.array(ControlLayerId).optional(),
  region_ids: z.array(RegionId).optional()
    .describe("If set, only these regions are honored. Else all regions in document."),
  batch_size: z.number().int().min(1).max(8).default(1),
});

const Output = z.object({
  job_id: JobId,
  resolved_verb: ResolvedVerb,
  batch_size: z.number().int().min(1).max(8),
});

export const generateImage = defineTool({
  name: "generate_image",
  title: "Generate / Refine / Fill image",
  description:
    "Submits an image-generation job. Resolves to one of four verbs based on inputs:\n" +
    "- strength=100, no selection → 'generate' (new image from prompt + control inputs)\n" +
    "- strength<100, no selection → 'refine' (img2img using current canvas)\n" +
    "- strength=100, with selection → 'fill' (inpaint, with selection_mode discriminator)\n" +
    "- strength<100, with selection → 'constrained_variation'\n" +
    "Returns a job handle immediately. Subscribe to job.progress events for progress and " +
    "job.completed for the resulting history_item_id. Apply via apply_history_item.\n\n" +
    "Minimum invocation: { prompt: \"a red barn at dusk\" }. All other params take server defaults.",
  category: "job",
  idempotent: false,
  reversible: false,                     // Job submission itself isn't reversible; the resulting apply is.
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { prompt: "a red barn at dusk", strength: 100, batch_size: 4 },
    output: {
      job_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as any,
      resolved_verb: "generate",
      batch_size: 4,
    },
  },
  since: "1.0.0",
  workspace: ["Generate", "Inpaint", "Live"],
});
```

### 3.3 Polymorphic read: `get_image`

```typescript
// libs/mcp-tools/src/tools/image-read/get-image.ts
const Scope = z.enum(["document", "layer", "selection", "region", "history_item", "thumbnail"]);

const Input = z.object({
  scope: Scope,
  id: Ulid.optional()
    .describe("Required for layer/region/history_item. Optional for thumbnail (defaults to document)."),
  alpha_only: z.boolean().default(false)
    .describe("Returns mask-only (alpha channel) when true. Useful for selection mask, layer mask, etc."),
  region: z.union([
    z.object({ rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) }),
    z.object({ mask_id: Ulid }),
  ]).optional(),
  format: ImageFormat.default("png"),
  max_dimension: z.number().int().min(64).max(8192).optional()
    .describe("Downscaled to fit. For thumbnails use max_dimension ≤ 512 (always returned inline per FR-50)."),
});

export const getImage = defineTool({
  name: "get_image",
  title: "Read image data",
  description:
    "Returns image bytes for any addressable scope: composited document, individual layer, " +
    "active selection content, region content, or history-item preview. Set alpha_only=true to " +
    "fetch the mask channel (selection mask, layer alpha). max_dimension downscales for previews. " +
    "Response is the standard ImageEnvelope (inline for ≤256KB, ref otherwise).",
  category: "read",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: ImageEnvelope,
  example: {
    input: { scope: "thumbnail", id: "01HZK..." as any, max_dimension: 256 },
    output: { format: "png", width: 256, height: 256, inline: { encoding: "base64", data: "..." } },
  },
  since: "1.0.0",
});
```

### 3.4 CRUD pattern: `add_layer`, `remove_layer`, `update_layer`

```typescript
// add_layer
const LayerKind = z.enum(["paint", "mask", "control", "region"]);
const BlendMode = z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten"]);

const AddLayerInput = z.object({
  document_id: DocumentId.optional(),
  kind: LayerKind,
  name: z.string().max(120).optional(),
  position: z.number().int().min(0).optional()
    .describe("0 = bottom of stack. Defaults to top of stack."),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  blend_mode: BlendMode.default("normal"),
  content: ImageEnvelope.optional()
    .describe("Initial image content for paint or mask layers. Replaces import_image."),
});

const AddLayerOutput = z.object({
  layer_id: LayerId,
  position: z.number().int().min(0),
});

// update_layer accepts every field of add_layer except kind/content as optional.
// Each provided field updates; omitted fields remain. Position changes reorder.

// remove_layer is `{ document_id?, layer_id: LayerId }` → `{ removed: true }`.
```

### 3.5 Reversible operation pattern (P27)

Every reversible tool has a server-side handler that constructs and registers a `Command`:

```typescript
// libs/server/src/lib/handlers/add-layer.ts (sketch)
export const addLayerHandler: Handler<typeof addLayer> = async (input, ctx) => {
  const command: Command = {
    id: ulid(),
    apply: async () => {
      const layer = await ctx.documents.addLayer(input.document_id, input);
      return { layer_id: layer.id };
    },
    revert: async () => {
      await ctx.documents.removeLayer(input.document_id, command.last_result.layer_id);
    },
  };
  const result = await ctx.undoRedo.execute(ctx.tokenName, input.document_id, command);
  return { layer_id: result.layer_id, position: input.position ?? /* computed */ };
};
```

The undo/redo system records `command` in the calling client's per-document stack. `undo` calls `command.revert()`. `redo` re-applies `command.apply()`.

### 3.6 Pagination pattern

```typescript
// shared/pagination.ts
export const Cursor = z.string().max(256).optional();

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item).max(50),
    next_cursor: Cursor,
    total_known: z.number().int().nonnegative().optional()
      .describe("Total count if cheaply known; else absent. Don't rely on for completion."),
  });
```

### 3.7 Field-selection pattern (FR-39)

```typescript
const ListInput = z.object({
  cursor: Cursor,
  limit: z.number().int().min(1).max(50).default(20),
  fields: z.array(z.string()).optional()
    .describe("Restrict response to listed fields per item. Saves bytes when full record isn't needed."),
});
```

---

## 4. Resource catalog

```typescript
// libs/mcp-tools/src/resources/manifest.ts
export const resourceCatalog = [
  { uri: "diffusecraft://server/info",                   contentSchema: ServerInfo },
  { uri: "diffusecraft://server/paired-devices",         contentSchema: paginated(PairedDevice) },
  { uri: "diffusecraft://server/audit-log",              contentSchema: paginated(AuditEntry) },
  { uri: "diffusecraft://documents/list",                contentSchema: paginated(DocumentSummary) },
  { uri: "diffusecraft://document/{id}/state",           contentSchema: DocumentState },
  { uri: "diffusecraft://layers/list",                   contentSchema: paginated(LayerSummary) },
  { uri: "diffusecraft://control-layers/list",           contentSchema: paginated(ControlLayerSummary) },
  { uri: "diffusecraft://regions/list",                  contentSchema: paginated(RegionSummary) },
  { uri: "diffusecraft://history/list",                  contentSchema: paginated(HistoryItemSummary) },
  { uri: "diffusecraft://history/{id}",                  contentSchema: HistoryItemFull },
  { uri: "diffusecraft://jobs/list",                     contentSchema: paginated(JobSummary) },
  { uri: "diffusecraft://models/list",                   contentSchema: paginated(ModelSummary) },
  { uri: "diffusecraft://presets/list",                  contentSchema: paginated(PresetSummary) },
  { uri: "diffusecraft://undo-stack/{document-id}",      contentSchema: paginated(CommandSummary) },
  { uri: "diffusecraft://redo-stack/{document-id}",      contentSchema: paginated(CommandSummary) },
  { uri: "diffusecraft://blob/{id}",                     contentSchema: ImageEnvelope.shape.format /* short-lived */ },
];
```

Resources support `?since=ISO8601` and `?fields=a,b` for delta-sync and field-selection (FR-46, FR-39).

---

## 5. Event catalog

```typescript
// libs/mcp-tools/src/events/manifest.ts
export const eventCatalog = [
  {
    name: "job.progress",
    payloadSchema: z.object({
      job_id: JobId,
      percent: z.number().min(0).max(100),
      eta_seconds: z.number().int().nonnegative().optional(),
      stage: z.string(),
    }),
  },
  {
    name: "job.completed",
    payloadSchema: z.object({
      job_id: JobId,
      outcome: z.enum(["success", "failure", "cancelled"]),
      history_item_id: HistoryItemId.optional(),
      thumbnail_ref: ImageEnvelope.optional(),  // FR-45
      error: ErrorResponse.optional(),
    }),
  },
  {
    name: "document.changed",
    payloadSchema: z.object({
      document_id: DocumentId,
      change_summary: z.string(),
      affected_layer_ids: z.array(LayerId),
      bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
      originating_token_name: z.string(),
      conflict: z.boolean().default(false),
    }),
  },
  {
    name: "model.download.progress",
    payloadSchema: z.object({
      model_id: z.string(),
      percent: z.number().min(0).max(100),
      bytes_done: z.number().int().nonnegative(),
      bytes_total: z.number().int().nonnegative(),
    }),
  },
  {
    name: "audit.entry",
    payloadSchema: AuditEntry,
  },
];
```

---

## 6. Handshake & capability negotiation (FR-37, FR-38)

```
Client                                       Server
  │                                            │
  │ ── MCP initialize                        ──►│
  │    + DiffuseCraftCapabilities:             │
  │      { accepts_lossy_images: true,         │
  │        max_inline_image_kb: 256,           │
  │        streaming_supported: true,          │
  │        prefers_resources_over_tools: true, │
  │        active_workspace: "Generate" }      │
  │                                            │
  │◄─ initialize result                        │
  │   + DiffuseCraftServerCapabilities:        │
  │     { catalog_version_range: ["1.0.0",     │
  │                                "1.0.0"],   │
  │       comfyui_status: "ready",             │
  │       supported_workspaces: [...],         │
  │       sampling_supported: true }           │
  │                                            │
  │ ── tools/list (filtered by workspace)    ──►│
  │                                            │
  │◄─ Filtered tool list                       │
  │   (e.g., 28 tools for "Generate" workspace)│
```

The server stores the negotiated capabilities per-client in a `ClientSession` map and uses them when serializing responses (e.g., choosing inline vs ref, choosing PNG vs WEBP).

---

## 7. Error model (FR-52, FR-53)

| Code | When | Retryable? |
|---|---|---|
| `NOT_FOUND` | Document, layer, region, history item, model, etc. doesn't exist | No |
| `INVALID_INPUT` | Schema validation fails | No |
| `QUEUE_FULL` | Job queue at capacity | Yes (`retry_after_ms`) |
| `RATE_LIMITED` | Per-token rate limit exceeded | Yes (`retry_after_ms`) |
| `PAYLOAD_TOO_LARGE` | Image payload > 16 MB | No (chunk) |
| `UNSUPPORTED_CATALOG_VERSION` | Client/server catalog versions don't overlap | No |
| `UNSUPPORTED_TOOL_FOR_NEGOTIATED_VERSION` | Tool exists in catalog but not in negotiated version | No |
| `COMFYUI_DISCONNECTED` | Backend not reachable | Yes (`retry_after_ms`) |
| `MODEL_NOT_FOUND` | Referenced model not present locally | No (download first) |
| `UNAUTHORIZED` | Missing or invalid token | No |
| `FORBIDDEN` | Reserved (no scopes in v1; placeholder) | No |
| `DOCUMENT_LOCKED` | Document in use by long-running job that prevents mutation | Yes |
| `RESOURCE_GONE` | Blob ref expired | No (re-fetch) |
| `INTERNAL_ERROR` | Unhandled server error | Yes |

Every error response includes a `hint` when an obvious recovery path exists. Example:
```json
{ "code": "MODEL_NOT_FOUND", "message": "Model 'civitai:dreamshaper-9' not present locally.",
  "hint": "Call download_model with id 'civitai:dreamshaper-9' first. Available presets that don't need this model: photographic, anime-base." }
```

---

## 8. MCP prompts (FR-43)

```typescript
// libs/mcp-tools/src/prompts/generate-and-iterate.ts
export const generateAndIterate = definePrompt({
  name: "generate-and-iterate",
  description: "Recommended sequence for generating multiple variations and applying the best one.",
  arguments: [
    { name: "prompt", required: true },
    { name: "variations_count", required: false, default: "4" },
  ],
  template: `
You are working with DiffuseCraft. Generate ${variations_count} variations of "${prompt}":

1. Call \`generate_image({ prompt: "${prompt}", batch_size: ${variations_count} })\`.
2. Subscribe to job.progress events to monitor.
3. When job.completed arrives, call \`get_history_item\` for each result (up to ${variations_count} items).
4. Inspect thumbnails via \`get_image({ scope: "thumbnail", id, max_dimension: 256 })\`.
5. Pick the best (or ask the user) and call \`apply_history_item({ history_item_id })\`.
`,
});
```

Similar templates exist for `inpaint-region`, `refine-with-control`, `batch-variations`. Agents that load prompts get curated multi-step guidance, reducing ad-hoc orchestration.

---

## 9. Versioning semantics (FR-6)

| Change type | Bump |
|---|---|
| Add a new tool | minor (`1.x.y` → `1.x+1.0`) |
| Add a new optional input field with a default | minor |
| Add a new field to output schema | minor |
| Add a new event | minor |
| Add a new resource URI | minor |
| Remove a tool | major |
| Rename a tool | major (with migration table in CHANGELOG) |
| Make an optional field required | major |
| Change an enum's existing values | major |
| Remove an output field | major |
| Catalog footprint exceeds 100 KB | blocked at build (CI fails) |

The catalog version is exported by `@diffusecraft/mcp-tools/version` and embedded in the manifest.

---

## 10. Agent walkthroughs (acceptance criterion §5)

### 10.1 Walkthrough A — Claude Code orchestrating a generation session (Story 4)

```
1. Client connects (HTTP, paired token)
2. → MCP initialize (capabilities); ◄─ server caps + workspace
3. → resources/read: diffusecraft://presets/list (filtered to "photographic" theme)
4. → tool: generate_image({ prompt: "neo-tokyo skyline at dawn", preset: "photographic", batch_size: 4 })
   ◄─ { job_id: "01HZK...", resolved_verb: "generate", batch_size: 4 }
5. (subscribe) job.progress events stream...
6. ◄─ job.completed { job_id: "01HZK...", outcome: "success",
                     history_item_id: "01HZK...", thumbnail_ref: { inline: ... } }
   (×4 — one per item in batch)
7. → tool: get_image({ scope: "thumbnail", id: <each>, max_dimension: 256 })   [×4 in parallel]
   ◄─ inline base64 PNGs
8. (Claude reasons over thumbnails, picks 2nd as best)
9. → tool: apply_history_item({ history_item_id: <2nd> })
   ◄─ { layer_id: "01HZK...", position: 1 }
10. ◄─ document.changed event broadcast
11. (optionally) → tool: export_image({ document_id, format: "png" })
   ◄─ ImageEnvelope { ref: "diffusecraft://blob/01HZK..." }
```

### 10.2 Walkthrough B — MeshCraft pipeline phase 1-2 in-process (Story 6)

```
(MeshCraft host has embedded server; uses in-memory transport)

1. mcp.invokeTool("create_document", { width: 1024, height: 1024, name: "char-A-concept" })
   → { document_id: "01HZK..." }
2. mcp.invokeTool("set_workspace", { workspace: "Generate" })
3. mcp.invokeTool("generate_image", {
     prompt: "<character description from MeshCraft phase 1 brief>",
     preset: "concept-art",
     batch_size: 8
   })
   → { job_id, batch_size: 8 }
4. (await all job.completed events; collect history_item_ids)
5. mcp.invokeTool("get_image", { scope: "history_item", id: <each>, max_dimension: 512 })
   (×8 — for visual evaluation)
6. (MeshCraft phase 2 chooses 1; could use Claude via separate MCP session if desired)
7. mcp.invokeTool("apply_history_item", { history_item_id: <chosen> })
8. mcp.invokeTool("export_image", { document_id, format: "png" })
   → ref:// blob; MeshCraft passes that to its phase 3.
```

### 10.3 Walkthrough C — Tablet illustrator inpainting a character's face (Story 1)

```
(Tablet app authenticated via paired token; HTTP transport)

1. User taps face area → app calls set_selection({ kind: "rect", rect: ... })
2. User dictates: "make this face younger and softer"
3. App calls transcribe_audio → text "make this face younger and softer"
4. App calls enhance_prompt(text, { canvas_context: ... }) → "young woman portrait, soft features, gentle lighting, 8k photo"
5. App calls generate_image({
     prompt: <enhanced>, strength: 100, selection: <current>, selection_mode: "Fill", batch_size: 3
   })
   → job_id, resolved_verb: "fill"
6. job.progress stream → progress bar in UI
7. job.completed (×3) → app subscribes; thumbnails pop in history strip
8. User taps the second preview → apply_history_item
9. document.changed event → all panels refresh
10. (optionally) Two-finger tap on canvas → undo
```

### 10.4 Walkthrough D — Custom batch agent (Story 8)

```
(External CLI script; HTTP, paired token; processes 100 prompts from a file)

1. for each prompt in file:
2.   mcp.invokeTool("generate_image", { prompt, preset: "default", batch_size: 1 })
     → { job_id }
3.   Track job_id in local map.
4. Subscribe to job.completed for entire session.
5. For each completion event:
6.   mcp.invokeTool("apply_history_item", { history_item_id })
7.   mcp.invokeTool("export_image", { format: "png", to_path: `/output/${prompt-slug}.png` })
8. Done.
```

---

## 11. Krita-ai-diffusion mapping (acceptance criterion §3 in requirements)

| krita-ai-diffusion concept (file) | DiffuseCraft realization |
|---|---|
| `Generate` button (model.py) | `generate_image` tool with `strength=100, no selection` → `resolved_verb: "generate"` |
| `Refine` mode (model.py) | `generate_image` tool with `strength<100` → `resolved_verb: "refine"` |
| `Fill` mode (selection + 100%) | `generate_image` tool with `selection + strength=100` → `resolved_verb: "fill"` |
| Selection sub-modes (selection.py) | `generate_image` tool, `selection_mode` enum |
| Generation history panel (model.py) | `get_history_item`, `apply_history_item`, `discard_history_item` + resource `diffusecraft://history/list` |
| Apply step (model.py) | `apply_history_item` with positional rules from Q4 |
| ControlNet types (control.py) | `add_control_layer({ type: "canny" \| ... })` |
| IP-Adapter types (control.py) | `add_control_layer({ type: "reference" \| "style" \| "composition" \| "face" })` |
| Regions (region.py) | `define_region` + resource `regions/list` |
| Live mode (jobs.py + ui/) | Deferred to v0.2: `start_live_session`, `update_live_input`, `stop_live_session` |
| Workspaces (ui/) | `set_workspace`, `get_workspace` |
| Preset model bundles (style.py) | `set_preset` upsert + resource `presets/list` |
| ComfyUI model registry (server.py) | `download_model`, `delete_model` + resource `models/list` |
| Job queue (jobs.py) | `cancel_job`, `get_job_status`, events `job.progress`, `job.completed` |
| Tile-based upscale | `upscale_image` |

---

## 12. Acceptance criteria for `design.md`

This document is approved when:
1. The 38 v1 tools each have a path to a Zod schema in this design (representative shown; pattern stable for the rest).
2. The handshake sequence is unambiguous.
3. The error model is enumerable.
4. The 4 walkthroughs run end-to-end against the described tools, with no missing capabilities.
5. The krita-ai-diffusion mapping table covers every concept in `inspirations.md`.
6. The catalog footprint test (`footprint.test.ts`) is specified.
7. Versioning semantics are explicit per change type.

If approved, `tasks.md` will break this into implementable units (schemas first, then handlers, then conformance tests) with checkboxes, t-shirt sizes, and DoD.
