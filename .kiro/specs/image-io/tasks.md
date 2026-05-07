# Implementation Plan

> Tasks below cover requirements 1.x through 9.x in `requirements.md` with two intentional deferrals:
>
> - **R6.1 and R6.2** (preserve drag-drop and clipboard-paste) are deferred to a `canvas-fundamentals` follow-up, since the codebase audit (`research.md`) confirmed neither path is implemented today. This spec satisfies R6 as a forward-compat constraint via the shared `addLayer` MCP seam reused by tasks 8.1 and 8.2 (R6.3, R6.4); when the FR-16 paths land, they will inherit that seam without rework.
>
> Test runs and coverage gates are disabled per project policy (`feedback_testing_disabled` memory); the validation phase is manual-smoke-driven and tied directly to acceptance criteria.

- [ ] 1. Foundation: dependencies, format schemas, and shared limits

- [x] 1.1 Install client-side Expo modules in `apps/mobile`
  - Add `expo-document-picker`, `expo-image-picker`, `expo-sharing`, `expo-file-system`, `expo-media-library` at versions matching the current Expo SDK already pinned in `package.json`
  - Re-run `pnpm install` and `expo prebuild` if config plugins require it; commit lockfile changes
  - Observable completion: `apps/mobile/package.json` lists all five modules; `pnpm --filter mobile run typecheck` passes; the modules are importable from a scratch RN file
  - _Requirements: 1.1, 2.1, 3.3, 4.5, 5.3_

- [x] 1.2 Install server-side and shared format dependencies
  - Add `@fastify/multipart` to `libs/server/package.json`
  - Add `fflate` to `libs/server/package.json` (server side); evaluate whether `apps/mobile` also needs it for v1 — per design, only the server reads/writes archives, so the client does not bundle `fflate`
  - Add `file-type` to `libs/server/package.json` for magic-byte sniff on the import path
  - Observable completion: `pnpm install` resolves cleanly; `pnpm --filter server run typecheck` passes; the three packages are importable from `libs/server/src`
  - _Requirements: 2.3, 3.2, 8.3, 8.5_

- [x] 1.3 Define the `.dcft v1` Zod schemas in `libs/canvas-core`
  - Add `zod` as a runtime dependency to `libs/canvas-core/package.json` (canvas-core was previously zod-free)
  - Add `DcftManifestSchema`, `DcftDocumentJsonSchema`, `DcftLayerEntrySchema` exactly as written in `design.md` § "canvas-core / format". The schemas are **self-contained** (mirror, do not extend, the canvas-core TS interfaces) — canvas-core has no Zod schemas to extend from, and decoupling the file format from the in-memory shape is intentional
  - Re-export `DcftManifest`, `DcftDocumentJson`, `DcftLayerEntry` types and the schema constants from the `canvas-core` public index
  - Pin `version: z.literal(1)` so unknown manifest versions fail Zod validation deterministically
  - Observable completion: a freshly-imported `DcftManifestSchema.safeParse({ version: 1, ... })` returns `success: true` for a valid object and `success: false` for `version: 2`
  - _Requirements: 2.3, 2.4, 2.6, 3.2, 3.10_

- [x] 1.4 Define shared size and pixel-count limits
  - Constant `IMAGE_MAX_PIXEL_COUNT = 100_000_000` (100 Mpx) used by client decode preflight
  - Constant `DCFT_MAX_BYTES = 2 * 1024 * 1024 * 1024` (2 GB) used by both `@fastify/multipart` configuration and client preflight
  - Constant `DCFT_FORMAT_VERSION = 1` re-exported alongside the Zod schemas so version checks have a single source
  - Observable completion: both client and server import the same constant values from a single declaration; `tsc` shows no duplication of magic numbers
  - _Requirements: 8.1, 8.2, 8.5_

- [ ] 2. Platform-adapted picker / sharer (`ImageIoAdapter`)

- [x] 2.1 (P) Native (Expo) implementation of the picker/sharer adapter
  - Implement `pickImageFile()` using `expo-image-picker` with explicit MIME filter for PNG / JPEG / WebP
  - Implement `pickProjectFile()` using `expo-document-picker` with `type: ['application/x-dcft', 'application/zip']` and an explicit `.dcft` filename filter
  - Implement `deliverFile()` by writing bytes to a `expo-file-system.cacheDirectory` temp path then opening `expo-sharing.shareAsync(uri)`; clean up the temp file on completion or cancellation
  - Map `cancelled`, `unsupported_mime`, `too_large`, `platform_unavailable`, and `io_failure` discriminants per `design.md`
  - Observable completion: a manual call from a debug screen on iOS Simulator returns a `Uint8Array` for a picked image and shows the share-sheet for a delivered PNG
  - _Boundary: libs/canvas-skia/src/io_
  - _Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 3.3, 4.5, 5.3, 5.5_

- [x] 2.2 (P) Web (browser) implementation of the picker/sharer adapter
  - Implement `pickImageFile()` and `pickProjectFile()` using a hidden `<input type="file">` element with the appropriate `accept` MIME list; resolve a `Uint8Array` from `File.arrayBuffer()`
  - Implement `pickProjectFile()` drag-drop overlay accepting `.dcft` (R5.4) and routing through the same return path as `<input>` selection
  - Implement `deliverFile()` via `URL.createObjectURL` + `<a download>`; feature-detect `showSaveFilePicker` and use it when present
  - Map the same error discriminants; map browser quota / policy errors to `platform_unavailable` with `platform: 'web'`
  - Observable completion: the same debug screen, when run via `pnpm dev:web`, picks a PNG, returns its bytes, and downloads a `.dcft` archive built from a fixed test buffer
  - _Boundary: libs/canvas-skia/src/io_
  - _Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 3.3, 4.5, 5.3, 5.4, 5.5_

- [x] 3. (P) Client-side multi-layer composite (`DocumentComposer`)
  - Walk `LayerSurfaceRegistry` in document layer order, drawing each visible layer onto a freshly-created `Skia.Surface` sized to canvas dimensions, honoring opacity and blend mode
  - Encode the composite via `surface.makeImageSnapshot().encodeToBytes(format, quality)`; PNG branch preserves alpha, JPEG branch flattens onto opaque white before encoding
  - Thread the supplied `AbortSignal` through every step; release intermediate `SkImage` and `Surface` handles immediately after each layer to keep peak memory ≤ 2 simultaneous layer surfaces
  - Emit `onProgress(fraction)` after each layer; on web, yield via `requestIdleCallback` between layers so the UI thread stays responsive
  - Map `empty_document`, `oom`, `encode_failed`, and `cancelled` discriminants
  - Observable completion: encoding a 25-Mpx 10-layer fixture document on the project's reference hardware completes in ≤ 5 s and the resulting PNG opens correctly in Preview / Chrome
  - _Depends: 1.3_
  - _Boundary: libs/canvas-skia/src/io/composer.ts_
  - _Requirements: 4.2, 4.3, 4.4, 4.10, 9.1, 9.4_

- [ ] 4. Server-side `.dcft` format

- [ ] 4.1 (P) `DcftSerializer`: document → archive bytes
  - Read the `documents` row, all `layers` rows in `position` order, and each layer's blob from the existing `blobs` store
  - For each layer, re-encode the blob bytes as PNG if the stored MIME is not already `image/png`
  - Build `manifest.json` and `document.json` per the schemas from task 1.3, computing `document_sha256` from the canonical (sorted-key) JSON serialization of `document.json`
  - Pack the archive with `fflate.zip` using the layout `manifest.json` + `document.json` + `layers/<ULID>.png`; emit a streamable byte buffer
  - Map `document_not_found`, `blob_missing`, `archive_too_large` discriminants
  - Observable completion: serializing a fixture document in a unit-style script produces an archive whose `unzip -l` listing matches the layout exactly
  - _Depends: 1.3_
  - _Boundary: libs/server/src/lib/dcft_
  - _Requirements: 3.2, 3.10_

- [ ] 4.2 (P) `DcftMaterializer`: archive bytes → new document rows
  - Reject archives larger than `DCFT_MAX_BYTES` before opening the archive
  - Unzip with `fflate.unzip`; parse `manifest.json` against `DcftManifestSchema` and reject unknown versions deterministically
  - Parse `document.json` against `DcftDocumentJsonSchema`; recompute SHA-256 of the canonical JSON and reject on mismatch
  - For every `raster_path` referenced by the manifest, verify entry presence and that magic bytes identify it as PNG; reject path patterns that escape `layers/<ULID>.png`
  - In a single SQLite transaction, ingest each raster into the blob store (content-addressed by SHA-256), insert one new `documents` row (fresh ULID — never reuse the source `document_id`), and insert `layers` rows preserving order, opacity, blend, and visibility
  - Map every error discriminant from the design (`too_large`, `not_an_archive`, `manifest_invalid`, `manifest_version_unknown`, `document_invalid`, `document_sha_mismatch`, `layer_missing`, `layer_invalid`)
  - Observable completion: feeding an archive produced by task 4.1 returns a new `documentId` and the resulting database state matches the source one-for-one in canvas dimensions, layer count, layer order, opacity, and blend mode
  - _Depends: 1.3_
  - _Boundary: libs/server/src/lib/dcft_
  - _Requirements: 2.3, 2.4, 2.6, 3.10, 8.5_

- [ ] 5. HTTP transport: `.dcft` import / export endpoints
  - Register `@fastify/multipart` once with `limits.fileSize: DCFT_MAX_BYTES` so Fastify rejects oversize uploads before reaching the materializer
  - Add `POST /documents/import` behind the existing `Authorization: Bearer dcft_*` middleware; parse a single `archive` multipart field, call `DcftMaterializer.materialize`, map `Result<...>` to `201 Created { documentId }` on success and to the appropriate `400 / 401 / 413 / 415 / 422` on the listed error discriminants
  - Add `GET /documents/:id/export` behind the same middleware; call `DcftSerializer.serialize`, stream the response body with `Content-Type: application/x-dcft` and `Content-Disposition: attachment; filename="<title>.dcft"`; map `404` for missing documents and `409` for zero-layer documents
  - Verify the routes reject unpaired or expired-token requests (existing middleware behavior; no new auth code)
  - Observable completion: `curl -X POST -H "Authorization: Bearer dcft_..." -F archive=@fixture.dcft http://localhost:<port>/documents/import` returns `201` with a `documentId`, and `curl -H "Authorization: Bearer dcft_..." http://localhost:<port>/documents/<id>/export -o roundtrip.dcft` produces an archive byte-for-byte equivalent at the manifest level
  - _Depends: 4.1, 4.2_
  - _Boundary: libs/server/src/lib/transports/http.ts_
  - _Requirements: 2.2, 2.7, 2.8, 2.9, 3.1, 3.5, 3.7, 3.8, 3.9, 8.5_

- [ ] 6. Dirty-state tracking on the document store
  - Add a `dirty: boolean` slice with `setDirty()` and `clearDirty()` actions to the editor store factory
  - Wire `setDirty()` into every existing layer mutation funnelled through `canvas-slice.ts` (add layer, remove layer, update layer, set blend, set opacity, set visibility); call `clearDirty()` from the `setDocument` handler and from the future `save-project` success path
  - Reset `dirty` to `false` whenever `setDocument` runs
  - Observable completion: from a manual repro on iOS Simulator, a freshly-loaded document reports `dirty === false`; one stylus stroke on the canvas flips it to `true`; calling `setDocument(...)` flips it back to `false`
  - _Boundary: libs/core/src/stores/editor_
  - _Requirements: 7.1, 7.5_

- [ ] 7. Mobile UI components for the file menu

- [ ] 7.1 (P) `FileMenu` dropdown
  - Build the dropdown using `libs/ui/DropdownMenu`; expose entries `Open image…`, `Open project…`, `Place image…`, `Save Project…`, `Export…`
  - Each entry exposes an `onSelect` handler that the integration phase will bind; predicate logic disables `Save Project…` when the document has zero layers and disables `Export…` when the document has no rendered pixels
  - Observable completion: the dropdown renders identically on iOS Simulator and `pnpm dev:web`; disabled entries appear greyed out for an empty fixture document
  - _Boundary: apps/mobile/src/screens/Editor/FileMenu.tsx_
  - _Requirements: 1.1, 2.1, 3.1, 3.6, 4.1, 4.8, 5.1_

- [ ] 7.2 (P) `NewDocOrLayerModal`
  - Two-button modal presenting "Create new document" and "Add as new layer to current document"
  - Returns a `'new-doc' | 'as-layer'` value via callback; closes on backdrop tap or system back without producing a value
  - Observable completion: opening the modal from a debug screen and tapping "Add as new layer" returns `'as-layer'` to the caller; tapping the backdrop returns `null`
  - _Boundary: apps/mobile/src/screens/Editor/NewDocOrLayerModal.tsx_
  - _Requirements: 1.2_

- [ ] 7.3 (P) `ExportFormatDialog`
  - Format radio: `PNG` (default) and `JPEG`; quality slider 50–100 inclusive (default 90) appears only when JPEG is selected
  - Returns a `ComposeFormat` value matching the design's discriminated union via callback
  - Observable completion: selecting JPEG with quality 75 and confirming returns `{ kind: 'jpeg', quality: 75 }`
  - _Boundary: apps/mobile/src/screens/Editor/ExportFormatDialog.tsx_
  - _Requirements: 4.1_

- [ ] 7.4 (P) `UncommittedStateConfirm`
  - Three-button modal with Save, Discard, Cancel actions; copy explicitly mentions which document is at risk
  - Returns `'save' | 'discard' | 'cancel'` via callback
  - Observable completion: tapping each button resolves the callback with the matching string; the cancel path closes the modal without changing document state
  - _Boundary: apps/mobile/src/screens/Editor/UncommittedStateConfirm.tsx_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 8. Mobile commands wiring picker / composer / server / store

- [ ] 8.1 (P) `open-image` command
  - Call `ImageIoAdapter.pickImageFile()`; on cancellation return silently
  - Run `file-type` magic-byte preflight; reject non-PNG / JPEG / WebP per R1.6 with a localized toast
  - Run pixel-count preflight using `IMAGE_MAX_PIXEL_COUNT` per R8.1; reject with a localized toast on failure
  - Present `NewDocOrLayerModal`; on `'new-doc'` invoke `create_document` MCP then `addLayer` MCP and roll back the document on `addLayer` failure; on `'as-layer'` invoke `addLayer` MCP against the active document
  - Layer name is `Image (<filename>)` per R1.8
  - Register the operation as a single reversible Command via the existing undo stack per R1.9
  - Observable completion: a 4-Mpx PNG picked on iOS Simulator becomes a new document with the image as bottom layer; the layer is named `Image (<filename>)`; one undo removes the layer and creates the empty initial state; any file rejection (unsupported MIME, oversize, magic-byte mismatch) leaves zero partial state in the document store
  - _Depends: 2.1, 2.2_
  - _Boundary: apps/mobile/src/commands/image-io_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.3, 6.4, 8.1, 8.3, 8.4_

- [ ] 8.2 (P) `place-image` command
  - Same pick + preflight chain as `open-image` but skips the modal; always calls `addLayer` MCP against the active document
  - Layer name and undo behavior identical to `open-image` add-layer branch
  - Observable completion: tapping `Place image…` from the editor toolbar and selecting a PNG appends a new image layer above the currently selected layer; rejections leave zero partial state
  - _Depends: 2.1, 2.2_
  - _Boundary: apps/mobile/src/commands/image-io_
  - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.3, 6.4, 8.1, 8.3, 8.4_

- [ ] 8.3 (P) `open-project` command
  - If `dirty === true`, present `UncommittedStateConfirm`; on Save invoke `save-project` first, on Discard continue, on Cancel return silently
  - Call `ImageIoAdapter.pickProjectFile()`; reject files larger than `DCFT_MAX_BYTES` and files whose magic bytes do not match a ZIP container
  - `POST /documents/import` with the picked bytes; thread `AbortSignal` so cancellation aborts the upload
  - On `201 Created`, call the document store's `setDocument` with the materialized document; on transient network failure, expose a retry action and preserve the active document unchanged
  - Surface every `MaterializeError` discriminant as a localized toast
  - Observable completion: round-tripping a multi-layer fixture (saved by `save-project`) reopens with identical layer count, order, opacity, and blend modes; cancellation mid-upload leaves the active document unchanged and releases the file handle
  - _Depends: 2.1, 2.2, 5, 6, 7.4_
  - _Boundary: apps/mobile/src/commands/image-io_
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 7.1, 7.2, 7.3, 7.4, 8.2, 8.3, 8.4, 8.5, 9.2, 9.3_

- [ ] 8.4 (P) `save-project` command
  - Disable when active document has zero layers (predicate already enforced by `FileMenu`)
  - Issue `GET /documents/:id/export` with the active document id; thread `AbortSignal`
  - On streamed response, accumulate to a `Uint8Array` (≤ 2 GB cap from headers) and call `ImageIoAdapter.deliverFile` with default filename `<title>.dcft` or `Untitled.dcft` if no title
  - On adapter cancellation, return silently; on user accepting a destination, call `clearDirty()`
  - Observable completion: invoking from a dirty document on iOS Simulator opens the share-sheet showing `Untitled.dcft`; choosing Files writes a file that `unzip -l` lists with the expected layout
  - _Depends: 2.1, 2.2, 5_
  - _Boundary: apps/mobile/src/commands/image-io_
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.7, 3.8, 9.2, 9.3_

- [ ] 8.5 (P) `export-raster` command
  - Present `ExportFormatDialog`; on confirmation call `DocumentComposer.composeDocumentToBytes`
  - Display a progress indicator if the operation exceeds 1 s of wall time; threaded `AbortSignal` cancels every stage
  - On encode success, deliver via `ImageIoAdapter.deliverFile` with default filename `<title>.<ext>` or `Untitled.<ext>` if no title; PNG / JPEG MIMEs as appropriate
  - Operation must succeed even when the paired server is unreachable (R4.10) — no network calls in this command
  - Observable completion: from a 25-Mpx fixture document with the LAN cable disconnected, exporting to JPEG quality 90 opens the share-sheet within 5 s and the saved file opens in Preview / Chrome at correct dimensions
  - _Depends: 2.1, 2.2, 3, 7.3_
  - _Boundary: apps/mobile/src/commands/image-io_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 9.1, 9.2, 9.3, 9.4_

- [ ] 9. Integration: wire UI surfaces to commands

- [ ] 9.1 Mount `FileMenu` in the Editor `TopBar`
  - Replace the unwired `Share2` icon at `apps/mobile/src/screens/Editor/TopBar.tsx:18` with the `FileMenu` dropdown trigger
  - Bind each `FileMenu` entry's `onSelect` to the matching command from task 8
  - Resolve the existing rename TODO at line 94 only if it directly blocks save-as-`<title>` filename behavior; otherwise leave it for a separate spec
  - Observable completion: tapping each entry on iOS Simulator and `pnpm dev:web` triggers the corresponding command (verified by toast or modal opening)
  - _Depends: 7.1, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: apps/mobile/src/screens/Editor/TopBar.tsx_
  - _Requirements: 5.1, 5.2_

- [ ] 9.2 Wire `Documents` screen entry points
  - Replace the `onNew()` TODO at `apps/mobile/src/screens/Documents.tsx:71` with a handler that runs the `open-image` command and selects the new-document branch automatically when invoked from this surface
  - Add an `Open project…` button alongside that runs the `open-project` command
  - Observable completion: tapping `New` from the Documents screen opens the OS image picker; tapping `Open project…` opens the OS document picker scoped to `.dcft`
  - _Depends: 8.1, 8.3_
  - _Boundary: apps/mobile/src/screens/Documents.tsx_
  - _Requirements: 5.1, 5.2_

- [ ] 10. Validation: manual smoke pass tied to acceptance criteria

- [ ] 10.1 Native smoke matrix on iOS Simulator + Android emulator
  - Walk `Open image…` → modal → `Create new document` and → `Add as new layer` for PNG, JPEG, and WebP fixtures
  - Walk `Place image…` for the same fixtures (no modal)
  - Walk `Open project…` and `Save Project…` round-trip on a multi-layer fixture
  - Walk `Export…` for PNG (alpha preserved) and JPEG quality 90 (alpha → white)
  - Verify each cancel path leaves the document untouched and releases the temp file
  - Verify oversized image (≥ 110 Mpx) and oversized `.dcft` (≥ 2 GB) are rejected with localized toasts
  - Observable completion: every row in the matrix produces the expected outcome on both simulators; no crashes; logs from `pino` show one `/documents/import` and one `/documents/:id/export` call for the round-trip
  - _Depends: 9.1, 9.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 3.1, 3.3, 3.5, 3.6, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3_

- [ ] 10.2 Web smoke matrix on Chrome and Safari
  - Re-run the same matrix as 10.1 via `pnpm dev:web`, including the drag-drop pathway for PNG / JPEG / WebP and `.dcft` per R5.4
  - Verify `<a download>` filename matches the expected default in both browsers; verify `showSaveFilePicker` path on Chrome when supported
  - Observable completion: every row passes on both browsers; no console errors during compose / encode
  - _Depends: 9.1, 9.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 10.3 Round-trip equivalence test for `.dcft v1`
  - Take a fixture document with at least 4 layers, mixed blend modes, opacity values strictly between 0 and 1, and a non-trivial visibility pattern
  - Save via `save-project`, open via `open-project`
  - Diff the source document state against the materialized document state on canvas dimensions, layer count, layer order, layer pixel content (per-pixel byte comparison after PNG re-decode), opacity (within 1e-6), blend mode, and visibility
  - Observable completion: zero-diff result across all listed dimensions; any drift fails the smoke pass
  - _Depends: 10.1_
  - _Requirements: 3.10_

- [ ] 10.4 Offline raster export verification
  - Disconnect the simulator / browser from the paired server (LAN cable unplugged or server stopped)
  - Trigger `Export…` for a 25-Mpx 10-layer fixture in PNG and JPEG
  - Observable completion: both exports complete within 5 s and produce valid files; no failed network requests are visible in the network panel; UI never enters an error state
  - _Depends: 9.1_
  - _Requirements: 4.10, 9.4_

- [ ] 10.5 Cancellation discipline verification
  - Trigger cancellation in the middle of: an image decode, a `.dcft` upload, a `.dcft` download, a raster encode
  - Verify each command resolves to the silent cancellation path, releases temp files, and leaves no partial document state
  - Observable completion: after each cancellation, the editor state is identical to the pre-cancel snapshot; `expo-file-system.cacheDirectory` shows no leftover temp `.dcft` or `.png` files
  - _Depends: 9.1_
  - _Requirements: 9.1, 9.2, 9.3_

## Implementation Notes

- **Task 3 → Task 8.1 precondition**: `DocumentComposer` reads layer bitmaps from `LayerSurfaceRegistry` only. The registry is populated by the brush pipeline at stroke commit; imported images / control / generation-history layers currently live in a separate `LayerImageCache` keyed by `content_blob_id` (see `libs/canvas-skia/src/adapter.ts` `rasterizeLayer`). For exported composites to include picker-imported images (R1.3, R1.4 → R4.2), task 8.1's `open-image` command must either (a) promote imported images into the registry as a real `SkSurface` after `addLayer` succeeds, or (b) extend `createDocumentComposer({...})` to also accept the blob cache and fall back to it when the registry has no surface for a layer id. Pick one approach during 8.1; the composer's interface won't change either way. The composer silently skips layers it can't resolve today, so a missing promotion will produce silently-incomplete exports — verify in 10.1 / 10.4 fixtures.
