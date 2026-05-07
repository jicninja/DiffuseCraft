# Gap Analysis: image-io

## 1. Current State Investigation

### 1.1 Layer model and document state
- `libs/canvas-core/src/layers/types.ts:74-98` — `Layer` carries `content_blob_id` (ULID), not raw bytes. Per FR-25, image bytes never live inside the document state; they live in a blob store keyed by ULID and surfaced over the `diffusecraft://blob/<ULID>` URI scheme (`shared/envelope.ts:34`).
- Image bytes flow through an `ImageEnvelope` (`shared/envelope.ts:22-27`): inline base64 for payloads ≤ 256 KB, or a blob URI ref for anything larger.
- The `addLayer` MCP tool already accepts `content: ImageEnvelope` (`libs/mcp-tools/src/tools/layers/add-layer.ts:45-63`) — picker-driven import slots into this contract directly.
- The `create_document` MCP tool exists (`libs/mcp-tools/src/tools/documents/create-document.ts:29-47`) and creates an empty doc with one transparent paint layer — needs an extension or sibling tool to seed the layer with imported pixels.
- Active document store: `libs/core/src/stores/editor/canvas-slice.ts:18` exposes `setDocument(document)` for full replacement; `ActiveDocument` (`editor/types.ts:15-24`) holds metadata only (`id`, `width`, `height`, `last_applied_result_uri`).

### 1.2 Skia rendering and bytes export
- `libs/canvas-skia/src/CanvasView.tsx:1-100` — one `<Canvas>` with a per-layer `<Image>` chain backed by `LayerSurfaceRegistry`.
- Per-layer encode path: `rasterizeLayer(layer, dims)` in `libs/canvas-skia/src/adapter.ts:138-144` calls `encodeToBytes()` on the layer's SkImage (`Skia.Image.MakeImageFromEncoded(bytes)`, `adapter.ts:102`).
- `makeImageSnapshot()` available on surfaces (`libs/canvas-skia/src/skia.d.ts:21`); used in `commit-worklet.ts:118` and `LayerSurfaceRegistry.ts:328`.
- **Multi-layer document-level composite is MISSING** — `adapter.ts:29-32` comment delegates flattening to client-sdk; no implementation exists.

### 1.3 Server, transports, and persistence
- HTTP transport: `libs/server/src/lib/transports/http.ts:1-145` — Fastify mounts only `POST/GET/DELETE /mcp` and `POST /pair`. Bearer token `dcft_*` (line 6, 87); session header `mcp-session-id` (line 89).
- All document operations flow through MCP tools (`libs/mcp-tools/src/tools/documents/*`); no REST `/documents/...` routes.
- DB schema: `libs/server/src/lib/db/migrations/001-initial-schema.ts` — `documents` (lines 16-25), `layers` (27-39), `blobs` (89-100, with `sha256`, `mime`, `rel_path`, `expires_at`).
- No multipart handler is wired today; no HTTP blob upload/download endpoint surfaced — the subagent found none.
- `export_image` MCP tool exists (`libs/mcp-tools/src/tools/export/export-image.ts:32-43`): composites server-side (PNG / JPEG / WebP), returns `ImageEnvelope` or writes to a server path. Server-side composite means it requires server reachability.

### 1.4 Mobile chrome and existing import paths
- **Drag-drop and clipboard-paste image import are NOT implemented** (despite `canvas-fundamentals` FR-16). The subagent found:
  - `Pairing/Manual.tsx:62` — paste path is for the server URL, not images.
  - `Settings/Connection.tsx:72` — TODO for `expo-clipboard` + toast.
  - No `DocumentPicker`, `ImagePicker`, `Sharing`, or canvas-side drop handler anywhere.
- `apps/mobile/src/screens/Documents.tsx:65, 71` — `onSort()` and `onNew()` are TODO stubs.
- `apps/mobile/src/screens/Editor/TopBar.tsx:18, 56-102` — Share icon mounted but no handler; rename has a TODO at line 94. No "Open / Save / Export" buttons.
- `libs/ui/src/components/DropdownMenu.tsx` and `ContextMenu.tsx` exist but are not consumed by the editor.

### 1.5 Platform splitting and web target
- `apps/mobile/index.ts` is the native entry; `apps/mobile/index.web.ts:6-20` loads canvaskit-wasm `0.41.0` from jsdelivr **before** mounting `expo-router`. Metro picks `.web.ts` automatically when bundling for web.
- `react-native-web@0.21.2` is installed.
- A `.native.ts`/`.web.ts` precedent already exists for transports (`libs/diffusion-client/src/transports/stdio.native.ts`).

### 1.6 Expo dependency inventory
| Module | Installed |
|---|---|
| `expo-document-picker` | NO |
| `expo-image-picker` | NO |
| `expo-sharing` | NO |
| `expo-file-system` | NO |
| `expo-media-library` | NO |
| `expo-clipboard` | NO (TODO referenced in `Settings/Connection.tsx:72`) |
| `react-native-web` | YES (0.21.2) |
| `canvaskit-wasm` | runtime CDN load (0.41.0) |

## 2. Requirement-to-Asset Map

| Req | Reusable assets | Gap | Tag |
|---|---|---|---|
| **R1** Open image picker | `addLayer` MCP tool with `ImageEnvelope`; `create_document` MCP tool; layer model. | Native pickers (`expo-document-picker` / `expo-image-picker`); web `<input type="file">`; modal "new document vs new layer"; "New from image" path that combines `create_document` + `addLayer`. | Missing |
| **R2** Open `.dcft` | `documents`/`layers`/`blobs` schema; pairing-token auth; existing blob store with SHA-256 + expiry. | `.dcft` v1 file format; ingestion path; HTTP blob upload endpoint OR streaming MCP envelope; client picker scoped to `.dcft`; document replacement UX. | Missing |
| **R3** Save `.dcft` | Same DB schema; blob store; pairing-token auth. | Serialization to `.dcft v1`; HTTP blob download endpoint OR `ImageEnvelope`-of-archive; share-sheet (`expo-sharing`) and browser `<a download>`; default-filename logic. | Missing |
| **R4** Flat raster export | `encodeToBytes()` per-layer; `LayerSurfaceRegistry`; `export_image` MCP tool *(server-side path; useful as fallback only)*. | Client-side multi-layer composite (`composeDocumentToBytes`) so R4.10 ("works without server") is satisfiable; format dialog UX; share-sheet/download delivery; PNG-alpha vs JPEG-onto-white logic. | Missing |
| **R5** Cross-platform parity | `.native.ts`/`.web.ts` pattern in `libs/diffusion-client`; `index.web.ts`; canvaskit-wasm preloaded on web; `react-native-web`. | New `ImageIoAdapter` interface with native/web impls; web drag-drop overlay; web download trigger; per-target error mapping. | Missing |
| **R6** Coexist with FR-16 | None — FR-16 drag-drop and clipboard-paste are **specced but not implemented**. | Either implement drag-drop + paste here too (scope creep), or coordinate with a separate FR-16 work item in `canvas-fundamentals` follow-up. **Decision needed.** | Constraint |
| **R7** Uncommitted-state protection | `setDocument()` exists; documents have `modified_at`. | Dirty-bit tracking ("modified since last server save"); confirmation modal with save/discard/cancel; save-then-open chain glue. | Missing |
| **R8** Size + magic-byte limits | Server stores `mime` per blob (light validation); blob store has SHA-256. | 100 Mpx decode-side cap; 2 GB `.dcft` cap (client + server); magic-byte sniff before decode. | Missing |
| **R9** Performance + cancellation | Skia worklet pattern (commit-worklet at `commit-worklet.ts:118`) for off-main-thread work; some sync paths to avoid. | Cancellation tokens for picker → decode → upload chain and for compose → encode → save chain; progress reporting that updates ≥1 Hz; off-main-JS-thread encode on web (`canvaskit-wasm` thread story). | Missing |

## 3. Implementation Approach Options

### Option A — Extend MCP-tool-only path
Push everything through new and extended MCP tools: extend `export_image` for client-driven composite, add `import_dcft` and `export_dcft` MCP tools, ship picker/share UI in mobile.

- **Pros**: stays inside the established "everything is MCP" pattern (`structure.md`); no new transport surface; consistent auth/audit story.
- **Cons**: 256 KB inline-envelope cap (`shared/envelope.ts:22-27`) forces a two-step blob-ref dance for every `.dcft` (POST a blob, then call the tool with the URI) — but **no HTTP blob endpoint exists today**, so a tool-only path doesn't actually work without inventing one anyway. R4.10 (raster export must work without server reachability) is **violated** as long as raster composite stays in `export_image` server-side.

### Option B — Pure REST endpoints
New Fastify routes: `POST /documents/import.dcft` (multipart), `GET /documents/:id/export.dcft`, raster export client-side. Skip MCP for file I/O entirely.

- **Pros**: standard HTTP file streaming, multipart well-supported via `@fastify/multipart`; cleanest perf for large `.dcft`; fits R8.5 size enforcement naturally.
- **Cons**: deviates from the all-MCP convention; duplicates auth/audit plumbing; agents lose access (acceptable since this spec already excludes agent-driven file I/O, but it's a regression in symmetry).

### Option C — Hybrid (recommended)
- **Raster export (R4)**: pure client-side. Add `composeDocumentToBytes(format, quality)` in `libs/canvas-skia` (or a thin sibling lib) that walks `LayerSurfaceRegistry`, composites into a `Surface`, calls `encodeToBytes()`. Native and web both produce a `Uint8Array`; share-sheet (native) or `<a download>` (web). R4.10 satisfied; no server roundtrip.
- **`.dcft` open/save (R2, R3)**: server-mediated, transport-aware. Two new HTTP endpoints under the existing pairing-token auth boundary: `POST /documents/import` (multipart, 2 GB cap) and `GET /documents/:id/export` (streamed download with one-shot signed URL or pairing token). The MCP tool catalog gains `materialize_dcft(blob_uri)` / `serialize_dcft(document_id) → blob_uri` only if/when agent symmetry is wanted later — not in v1 since Requirements out-of-scope excludes MCP-driven file I/O.
- **Picker / share-sheet adapter (R5)**: new `ImageIoAdapter` interface with `.native.ts` (Expo modules) and `.web.ts` (browser File API + Blob + download / `showSaveFilePicker`) impls. Lives where the platform-split pattern already lives (e.g. `libs/canvas-skia` or a new `libs/image-io`).
- **Dirty-state tracking (R7)**: a `dirty: boolean` slice on the document store, set by every layer mutation that the existing undo/redo path touches and cleared on confirmed-save events.

- **Pros**: each direction uses the right transport. Reuses blob storage, paired-auth, and the layer/document schema. R4.10 satisfied. New REST surface is small and bounded (two endpoints) and inherits existing auth.
- **Cons**: introduces a small non-MCP transport (acceptable trade-off given file I/O excludes agents already). Multipart handling is new code in `libs/server`.

**Recommendation: Option C.**

## 4. Effort and Risk

- **Effort: L (1–2 weeks).** Spans three layers — `libs/canvas-skia` (composite-to-bytes), `libs/server` (`.dcft` HTTP endpoints + serializer), `apps/mobile` (file menu, modal, dirty-state, native+web adapter). Six new Expo deps. New file-format definition. No architectural change; pattern reuse is high.
- **Risk: Medium.** Each piece sits on an established pattern (Skia ops, MCP/Fastify, blob store, platform split). Main risk surfaces:
  1. **canvaskit-wasm parity**: confirm `encodeToBytes(SkEncodedImageFormat.JPEG, quality)` and surface `makeImageSnapshot()` work the same as native RN-Skia, and that 25 Mpx composites stay within browser-tab memory ceilings.
  2. **`.dcft` v1 format choices**: lock once; future versions can layer on, but v1 has to be self-describing enough to grow.
  3. **FR-16 coordination (Requirement 6)**: Requirement 6 promises drag-drop and clipboard-paste continue to work, but the codebase audit shows neither is actually implemented yet — this is a paper guarantee. Either pull FR-16 implementation into this spec's scope or open a coordination ticket against `canvas-fundamentals`.
  4. **Web download UX**: `<a download>` works universally but `showSaveFilePicker` (where supported) gives a better UX. Decide whether progressive enhancement is in scope.
  5. **Cancellation discipline**: every user-cancellable operation needs a cancellation token threaded through pick → decode → encode/upload. Easy to forget on the cancel-cleanup path; missing it leaks SkImages.

## 5. Research Needed (for design phase)

1. **`.dcft v1` file structure.** Pin: container (ZIP vs tar.gz), manifest schema (version, document_id, sha256, layer count, dimensions, created_at), `document.json` schema (reuse `canvas-core` document type via Zod or independent versioned subset), layer blob naming (`layers/<id>.png`), checksum algorithm, total-archive checksum vs per-blob checksum.
2. **Client-side multi-layer composite path.** Whether to add to `libs/canvas-skia` (couples render lib) or to a new client-side lib that consumes `canvas-skia`. Confirm `LayerSurfaceRegistry` exposes (or can expose) a "composite all visible layers to a single Surface" call. Memory ceiling for 25 Mpx × 10 layers on browser tab.
3. **Server `.dcft` endpoints.** Auth path (reuse `dcft_*` bearer or one-shot URL signing), multipart vs streaming raw bytes, max concurrent serializations, expiry of staged uploads (reuse `blobs.expires_at`).
4. **Dirty-state semantics.** What counts as "modified since last server save" — strict undo-stack diff vs `modified_at > last_saved_at`. Where the store flag lives (canvas-slice vs document-slice).
5. **FR-16 coordination decision.** Either expand R6 into "implement drag-drop + paste here too" or open a `canvas-fundamentals`-follow-up work item; either way Requirement 6 needs to be re-read in light of the current implementation gap.
6. **canvaskit-wasm encode parity.** JPEG quality, alpha handling, performance budget on the project's reference web environment.
7. **Progressive-enhancement target on web.** Decide v1 web download story: `<a download>` only, or `showSaveFilePicker` where available with `<a download>` fallback.

## 6. Recommendations for design phase

- **Adopt Option C.** Client-side raster composite + thin REST surface for `.dcft` + `ImageIoAdapter` for platform split.
- **Resolve FR-16 status before tasks are written.** Requirement 6 cannot be tested green if the paths it claims to "preserve" don't yet exist in code. Bring this back to the user during design.
- **Pin the `.dcft v1` format in `design.md` Boundary Commitments.** Version it from day 1 (`manifest.version = 1`), keep the format minimal, document what's deferred (per-layer effects, animation, control layers' guidance bytes vs per-pixel bytes — choose carefully).
- **Reuse the blob store and paired-auth boundary** rather than inventing new auth/storage primitives.
- **Defer agent (MCP) file-I/O symmetry to post-v1.** Out-of-scope here, but design the server-side `.dcft` serializer/materializer in a way that an MCP tool could later wrap.

---

## 7. Design Synthesis (carried into `design.md`)

### 7.1 Generalizations
- All four user flows reduce to two underlying primitives: **pick → bytes** (in-flow) and **bytes → deliver** (out-flow). The `ImageIoAdapter` interface is the single seam; commands compose those primitives into the four user-visible verbs (open image, open project, save project, export raster).
- Image picker, `.dcft` picker, and (future) drag-drop all converge on the same `addLayer` MCP tool with an `ImageEnvelope`. R6 is satisfied as a forward-compat constraint with zero new code in this spec.

### 7.2 Build vs. Adopt
| Concern | Decision | Rationale |
|---|---|---|
| Native picker / share-sheet / file-system | **Adopt** Expo modules | First-party, well-maintained, already in the platform stack. |
| Browser file pick / download | **Adopt** browser File API + `<a download>` (with `showSaveFilePicker` progressive enhancement) | Universal, no dependency. |
| ZIP container | **Adopt** `fflate` | ~20 KB, pure JS, runs identically on Node and browser; zlib internals are not worth re-implementing. |
| Multi-layer composite | **Build** on top of `LayerSurfaceRegistry` | No off-the-shelf "RN-Skia document compositor" exists; the surface registry is project-internal. |
| Multipart upload | **Adopt** `@fastify/multipart` | Standard plugin, handles size limits and streaming out of the box. |
| Magic-byte detection | **Adopt** `file-type` | Small, well-tested; reinventing it is low-value. |
| `.dcft` format | **Build** | No standard tablet-illustration project format exists; we get to define it once. ZIP container is adopted; the schema inside is built. |
| Dirty-state slice | **Build** (small) | Trivial Zustand slice; an off-the-shelf solution would weigh more than the slice itself. |

### 7.3 Simplifications applied
- No new `libs/image-io` package. Platform adapter and composer live in `libs/canvas-skia`; client commands live in `apps/mobile`. Less indirection, fewer Nx project boundaries to argue about.
- No new MCP tools in v1 (out-of-boundary). The serializer / materializer stay transport-agnostic so a 30-line wrapper can surface them via MCP later if agent symmetry is wanted.
- No project-level dirty-state persistence to disk. The slice is in-memory only; the server's DB remains source of truth between sessions.
- No `showSaveFilePicker` requirement for v1; `<a download>` is the baseline. Progressive enhancement only.

### 7.4 Risks carried into implementation
- **canvaskit-wasm parity** for `encodeToBytes(JPEG, quality)` and surface alpha-flatten on web; verify on a real Chrome / Safari before locking the export flow.
- **Memory ceilings** on web tabs for 25 Mpx × 10 layers; mitigation is ≤ 2 simultaneous layer surfaces and per-layer release after composite.
- **Streaming vs. buffering** of `.dcft` archives on the server response; need to confirm `@fastify/multipart` and the response stream cooperate without buffering the whole archive into RAM.
- **JPEG encoder thread blocking** on canvaskit-wasm; mitigation is `requestIdleCallback` yields between layer draws — confirm during implementation.
