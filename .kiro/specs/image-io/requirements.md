# Requirements Document

## Introduction

DiffuseCraft today has no file-system pathway for image or document I/O on the client. The user can only get an image into the canvas via drag-drop or clipboard paste (`canvas-fundamentals` FR-16), and there is no way to get a finished image out of the app — no save, no export, no share-sheet. Reopening a previously saved document is also impossible: documents live only on the paired server's database, not as portable files.

This feature adds, on both native (iOS / Android via Expo) and web (RN-Web + canvaskit-wasm in `apps/mobile`):

1. **Open an image file** (PNG / JPEG / WebP) via OS file picker — a unified "Open image…" command that, on selection, asks the user via modal whether to create a new document with the image as the bottom layer, or to add it as a new image layer to the current document.
2. **Open a DiffuseCraft project file** (`.dcft`) via OS file picker — restore the full multi-layer document. Server-mediated.
3. **Save the current document as a project file** (`.dcft`) — the server emits the file, the client delivers it via share-sheet (native) or browser download (web).
4. **Export the current document** as a flat composite raster (PNG default, JPEG with quality option) via the same delivery mechanisms. Pure client-side.

Drag-drop and clipboard paste continue to work unchanged — this feature *adds* a third import pathway (picker) and a brand-new export pathway, without altering FR-16's existing two paths.

> **Steering drift note.** `tech.md` (lines 11, 89, 210) still states "Web/PWA excluded — actively off-roadmap"; commit `66d57b4` ("feat: web platform target …") added a real web target via RN-Web + canvaskit-wasm-via-CDN, and the user has explicitly scoped this feature for native + web. Steering must be updated to reflect web's promotion from "excluded" to "supported tier." This requirements document treats web as a supported target. Resolution belongs in a separate `/kiro-steering` pass.

## Boundary Context

- **In scope**:
  - File-picker import of PNG, JPEG, WebP → new document or new image layer (user picks via in-app modal).
  - File-picker open of `.dcft` project files → multi-layer document materialized on the paired server.
  - Save current document as `.dcft` → portable file delivered via OS share-sheet (native) or browser download (web).
  - Export current document as flat composite raster (PNG default; JPEG with quality option) → same delivery mechanisms.
  - `.dcft` v1 file format (must contain a manifest, a serialized document description, and one raster blob per layer at native resolution; precise file layout is a design concern).
  - File-menu UI affordances on the Documents screen ("Open image…", "Open project…") and Editor toolbar ("Place image…", "Save Project…", "Export…").
  - Identical user-observable behavior on iOS, Android, and web targets in `apps/mobile`.

- **Out of scope**:
  - Per-layer or per-selection export.
  - Multi-document batch export.
  - PSD / TIFF / SVG / PDF / GIF / video export or import.
  - Color-managed export — sRGB only (consistent with `canvas-fundamentals` Q2).
  - Direct cloud-storage provider integrations beyond what the OS picker exposes.
  - MCP / agent-driven file I/O — OS pickers cannot be triggered by remote agents; no entries in `mcp-tool-catalog`.
  - `.dcft` cross-version compatibility; `.dcft v1` only, future versions are out of scope here.
  - On-device inference of any kind — consistent with the project's "tablet is input + display only" invariant.

- **Adjacent expectations**:
  - **`canvas-fundamentals`** — FR-16 drag-drop and clipboard-paste import paths continue to work unchanged. Q1 ("file format as a separate feature, post-v1") is **resolved by this spec**; steering should be updated accordingly. FR-17 (imported layers preserve native dimensions) applies to picker imports.
  - **`client-state-architecture`** — the document store invalidates and replaces the active document when "Open project" or "New from image" succeeds.
  - **`screens-implementation`** — the existing chrome buttons in the Documents screen and Editor toolbar are wired to real handlers; layouts and design tokens are unchanged.
  - **`server-architecture` / `pairing-protocol`** — `.dcft` server endpoints add to the same paired-token authentication boundary; unpaired requests are rejected.
  - **`generation-history`** — this feature does not change how generated outputs are saved into the document; that stays in `generation-history`.
  - **`control-layers`** — reference-image attachment for generation is unchanged; "import as layer" produces ordinary paint layers, not control layers.
  - **`transform-tools`** — imported layers arrive at native dimensions per FR-17; resizing and positioning are the user's responsibility using `transform-tools`.
  - **`undo-redo-system`** — every successful import and every "Open project" registers reversible Commands per `canvas-fundamentals` FR-15 (P27).

## Requirements

### Requirement 1: Open image file via picker

**Objective:** As a tablet illustrator, I want to pick an image file from my device and bring it into DiffuseCraft, so that I can use existing reference photos and assets without leaving the app.

#### Acceptance Criteria

1. When the user invokes "Open image…" from the file menu, the DiffuseCraft client shall present an OS file picker scoped to image MIME types `image/png`, `image/jpeg`, and `image/webp`.
2. When the user selects a supported image file from the picker, the DiffuseCraft client shall present a modal asking whether to "Create new document" or "Add as new layer to current document".
3. When the user chooses "Create new document", the DiffuseCraft client shall create a document whose canvas dimensions equal the picked image's native pixel dimensions and whose bottom layer holds the picked image at full opacity, normal blend mode.
4. When the user chooses "Add as new layer", the DiffuseCraft client shall append a new image layer above the currently selected layer in the active document, preserving the picked image's native pixel dimensions per `canvas-fundamentals` FR-17.
5. When the user dismisses the picker without selecting a file, the DiffuseCraft client shall return to the prior screen state without modifying any document.
6. If the user picks a file whose detected magic bytes do not match PNG, JPEG, or WebP, the DiffuseCraft client shall display an error message naming the unsupported format and shall not modify any document.
7. If the picked file fails to decode (corrupt, truncated, or oversize for available memory), the DiffuseCraft client shall display an error message and shall not modify any document.
8. The DiffuseCraft client shall name newly-imported layers as `Image (<filename>)` per `canvas-fundamentals` design Q5 recommendation.
9. The DiffuseCraft client shall register every successful import as a single reversible Command per `canvas-fundamentals` FR-15.

### Requirement 2: Open DiffuseCraft project file (`.dcft`)

**Objective:** As a tablet illustrator, I want to open a previously-saved project file, so that I can resume work on a document I started elsewhere or received from someone else.

#### Acceptance Criteria

1. When the user invokes "Open project…" from the file menu, the DiffuseCraft client shall present an OS file picker scoped to the `.dcft` extension and MIME type `application/x-dcft`.
2. When the user selects a `.dcft` file, the DiffuseCraft client shall upload the file contents to the paired DiffuseCraft server using the existing pairing-token authentication.
3. When the server receives a `.dcft` upload, the DiffuseCraft server shall validate the manifest version, layer integrity, and structural well-formedness before materializing any database state.
4. When validation succeeds, the DiffuseCraft server shall materialize a new document and its layers in the same database tables that hold server-native documents, and shall return the document identifier to the client.
5. When the client receives a successful materialization response, the DiffuseCraft client shall replace the active document with the newly-materialized document, prompting first if the current document has uncommitted state per Requirement 7.
6. If the picked file is not a valid `.dcft v1` archive (missing or invalid manifest, mismatched checksum, unknown manifest version, missing layer blobs referenced by the manifest), the DiffuseCraft server shall reject the upload with a structured error and the DiffuseCraft client shall display a human-readable error message.
7. If the upload or materialization fails for transient reasons (network drop, server-side timeout), the DiffuseCraft client shall offer the user a retry action and shall preserve the current document unchanged.
8. While the upload or materialization is in progress, the DiffuseCraft client shall display a progress indicator and shall allow cancellation; if cancelled, the DiffuseCraft server shall discard any partial state.
9. The DiffuseCraft server shall accept `.dcft` upload only from a client presenting a valid pairing token; unpaired or expired-token requests shall be rejected.

### Requirement 3: Save current document as `.dcft`

**Objective:** As a tablet illustrator, I want to save my current project as a portable file, so that I can archive it, send it to someone, or back it up off the paired server.

#### Acceptance Criteria

1. When the user invokes "Save Project…" from the file menu, the DiffuseCraft client shall request a `.dcft` emission for the active document from the paired DiffuseCraft server.
2. When the server receives a `.dcft` emission request, the DiffuseCraft server shall serialize the document and all its layers into a `.dcft v1` archive that contains a manifest with version and integrity checksum, a serialized description of the document, and one raster blob per layer at native resolution.
3. When the server returns the archive bytes, the DiffuseCraft client shall deliver the file via the OS share-sheet on native targets and via a browser download on web.
4. When the user accepts a destination from the share-sheet or download dialog, the DiffuseCraft client shall hand off the bytes without retaining a copy in app memory beyond the operation.
5. If the user cancels the share-sheet or download dialog, the DiffuseCraft client shall return to the prior screen state without altering the document.
6. If the active document has zero layers, the DiffuseCraft client shall disable the "Save Project…" command rather than emitting an empty archive.
7. While the server is serializing, the DiffuseCraft client shall display a progress indicator and shall allow cancellation.
8. The default suggested filename shall be the document title with the `.dcft` extension; if no title is set, the DiffuseCraft client shall use `Untitled.dcft`.
9. The DiffuseCraft server shall accept `.dcft` emission only from a client presenting a valid pairing token; unpaired or expired-token requests shall be rejected.
10. A `.dcft` archive emitted by Requirement 3 shall be accepted as a valid input by Requirement 2 within the same major `.dcft v1` format, producing a document equivalent to the source document in canvas dimensions, layer count, layer order, layer pixel content, layer opacity, and layer blend modes.

### Requirement 4: Export flat raster (PNG / JPEG)

**Objective:** As a tablet illustrator, I want to export the finished image as PNG or JPEG, so that I can post it, send it, or use it in other apps.

#### Acceptance Criteria

1. When the user invokes "Export…" from the Editor toolbar, the DiffuseCraft client shall present a small dialog with format choice (PNG default, JPEG) and, when JPEG is chosen, a quality slider with values 50–100 inclusive defaulting to 90.
2. When the user confirms the export dialog, the DiffuseCraft client shall compose the active document into a single sRGB raster matching the document's canvas dimensions, using the layer ordering, opacity, and blend modes as currently displayed on the canvas.
3. When the format is PNG, the DiffuseCraft client shall encode the composite as 8-bit-per-channel sRGB PNG with alpha preserved.
4. When the format is JPEG, the DiffuseCraft client shall encode the composite as sRGB JPEG with the chosen quality, flattening any alpha onto an opaque white background.
5. When encoding succeeds, the DiffuseCraft client shall deliver the bytes via the OS share-sheet on native targets and via a browser download on web.
6. The default suggested filename shall be the document title with the chosen extension; if no title is set, the DiffuseCraft client shall use `Untitled.png` or `Untitled.jpg`.
7. If the user cancels the share-sheet or download dialog, the DiffuseCraft client shall return to the prior screen state without modifying the document.
8. If the active document is empty (no rendered pixels), the DiffuseCraft client shall disable the "Export…" command.
9. While encoding is in progress, the DiffuseCraft client shall display a progress indicator for any operation that exceeds 1 second of wall time.
10. The DiffuseCraft client shall be able to perform raster export when no network connection to the paired server is available; the export operation shall not depend on server reachability.

### Requirement 5: Cross-platform parity (native + web)

**Objective:** As a developer maintaining `apps/mobile`, I want the same observable file-I/O behavior on iOS, Android, and web, so that user-facing flows are not platform-specific.

#### Acceptance Criteria

1. The DiffuseCraft client shall expose identical file-menu commands (`Open image…`, `Open project…`, `Place image…`, `Save Project…`, `Export…`) on iOS, Android, and web targets.
2. When a file-menu command is invoked on any supported target, the DiffuseCraft client shall produce the same observable outcome — same resulting document state, same delivered file format, same human-readable error messages — given the same inputs.
3. Where the OS provides a native share-sheet (iOS, Android), the DiffuseCraft client shall use it for file delivery; where the host is a web browser, the DiffuseCraft client shall use a download mechanism appropriate to the browser.
4. The DiffuseCraft client shall accept image and `.dcft` files as drag-and-drop targets on web in addition to picker invocation, with identical post-import behavior to the picker path.
5. If a target environment cannot fulfill a command (for example, browser policy blocks the file picker, or share-sheet entitlement is missing), the DiffuseCraft client shall display a target-specific actionable error message rather than failing silently.

### Requirement 6: Coexistence with existing import paths

**Objective:** As a user, I want existing drag-drop and paste image-import paths to keep working unchanged after this feature ships, so that nothing I already do breaks.

#### Acceptance Criteria

1. The DiffuseCraft client shall preserve the FR-16 drag-and-drop image-import path (OS drop onto canvas → new image layer) without modification.
2. The DiffuseCraft client shall preserve the FR-16 clipboard-paste image-import path (two-finger tap → "Paste") without modification.
3. The DiffuseCraft client shall route all three import pathways (drag-drop, clipboard paste, file picker) through the same internal layer-creation operation, so that imported layers are indistinguishable from one another in the resulting document state.
4. The DiffuseCraft client shall not introduce a new layer type — imported images shall use the existing image-layer representation already used by drag-drop and clipboard-paste imports.

### Requirement 7: Uncommitted-state protection on document replacement

**Objective:** As a user, I want a clear warning before an "Open" command discards work I haven't committed, so that I don't lose changes.

#### Acceptance Criteria

1. When the user invokes "Create new document" or "Open project…" while the active document has uncommitted state, the DiffuseCraft client shall present a confirmation prompt offering to save the active document first, discard changes, or cancel.
2. If the user chooses to save, the DiffuseCraft client shall complete a `.dcft` save (Requirement 3) before proceeding with the open.
3. If the user chooses to discard, the DiffuseCraft client shall proceed with the open without saving.
4. If the user cancels the confirmation prompt, the DiffuseCraft client shall not modify the active document.
5. The DiffuseCraft client shall consider the document state "uncommitted" if the document has been modified since its last successful save to the paired server.

### Requirement 8: File-size and validation limits

**Objective:** As a user on tablet hardware, I want oversized or malicious files to be rejected gracefully, so that the app does not crash, hang, or silently corrupt my document.

#### Acceptance Criteria

1. The DiffuseCraft client shall reject image files whose decoded pixel count exceeds 100 megapixels with a human-readable error message explaining the limit.
2. The DiffuseCraft client shall reject `.dcft` archives larger than 2 gigabytes with a human-readable error message explaining the limit.
3. The DiffuseCraft client shall reject any file whose detected magic bytes do not match the declared MIME type or extension, regardless of what the OS picker reported.
4. If a file is rejected for any of the reasons in 8.1, 8.2, or 8.3, the DiffuseCraft client shall not load any partial state from the file.
5. The DiffuseCraft server shall enforce the same `.dcft` size limit at upload time and shall return a structured rejection error if the limit is exceeded.

### Requirement 9: Performance and responsiveness

**Objective:** As a user on tablet hardware, I want file I/O to feel responsive and to not freeze the canvas, so that my creative flow is preserved.

#### Acceptance Criteria

1. The DiffuseCraft client shall keep the canvas interactive (no input freeze longer than 100 milliseconds) during any file I/O operation, including decode, encode, upload, download, and serialization.
2. While a long-running file I/O operation is in progress, the DiffuseCraft client shall display a progress indicator that updates at least once per second.
3. The DiffuseCraft client shall allow the user to cancel any in-progress upload, download, encode, or decode; on cancel, the operation shall release its memory and produce no partial document state.
4. When raster export of a document at the user's chosen format completes successfully, the DiffuseCraft client shall deliver the bytes to the OS share-sheet or browser download within 5 seconds for documents up to 25 megapixels and 10 layers, on the project's reference tablet hardware (per `canvas-fundamentals` NFR-1's hardware baseline).
