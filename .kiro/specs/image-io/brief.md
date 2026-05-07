---
language: en
---

# Brief: image-io

## Problem
DiffuseCraft today has **no file-system pathway** for image or document I/O on the client. The user can only get an image into the canvas via drag-drop or clipboard paste (`canvas-fundamentals` FR-16), and there is **no way at all to get a finished image out** of the app — no "Save", no "Export", no share-sheet. Reopening a previously saved document is also impossible: documents live only on the paired server's database, not as portable files.

This blocks two ordinary user motions on a tablet illustration app:
1. *"Bring this reference photo onto my canvas as a layer."*
2. *"Save what I made so I can post it / send it / archive it."*

## Current State
- **`canvas-fundamentals` FR-16** specs only drag-drop and clipboard paste as import paths. Picker-based import is not specced.
- **`canvas-fundamentals` Q1** (line 223) explicitly defers "save-as-file and open-later" as a separate post-v1 feature — this brief brings that work forward into v1.
- **Server-side persistence** (`documents`, `layers` tables in `apps/server`) already exists. The server is the source of truth for in-progress documents; this feature adds **portable file** representations alongside the server DB.
- **No raster export** code path exists anywhere in the client (`apps/mobile`, `libs/canvas-skia`).
- **`apps/mobile` is universal** (RN native + RN-Web via the recent web platform target commit), so a single feature covers both targets through platform-adapted modules.

## Desired Outcome
On both native (iOS/Android) and web, the user can:
1. **Open an image file** (PNG / JPEG / WebP) via OS file picker, choosing whether it becomes a new document (image as bottom layer at native dimensions) or a new layer in the current document.
2. **Open a DiffuseCraft project file** (`.dcft`) via OS file picker, restoring the full multi-layer document.
3. **Export the current document** as a flat composite raster (PNG default, JPEG option) via the OS share-sheet (native) or browser download (web).

Drag-drop and clipboard-paste continue to work unchanged — this feature **adds** a third pathway (picker) and a brand-new export pathway, without altering FR-16's existing two paths.

## Approach
**Client-only for raster I/O; server-mediated for project files.**

- **Image file open / import-as-layer (PNG / JPEG / WebP):** pure client-side. The image bytes are decoded into the existing image-layer representation in `libs/canvas-core`. No network roundtrip.
- **Flat raster export (PNG / JPEG):** pure client-side. The Skia surface in `libs/canvas-skia` already composes the document; we add a `composeToBlob(format, quality)` adapter call.
- **Project file `.dcft` open/save:** server-mediated. The server already owns document state, so it emits and ingests `.dcft` (zip with `document.json` + per-layer raster blobs). The client uploads/downloads the file and asks the server to materialize/serialize.

Platform-specific modules behind a thin `ImageIoAdapter` interface (`pickImage`, `pickProject`, `saveRaster`, `saveProject`) with `.native.ts` (Expo) and `.web.ts` (browser) implementations:
- Native: `expo-document-picker`, `expo-image-picker`, `expo-sharing`, `expo-file-system`, `expo-media-library`.
- Web: `<input type="file">`, drag overlay, `canvas.toBlob()`, `<a download>` (with `showSaveFilePicker` progressive enhancement where supported).

Rejected: server-mediated raster export (needless network detour, breaks on web entirely without a server), and pure-client `.dcft` (would require duplicating server's serialization logic on the client).

## Scope
- **In:**
  - File-picker import of PNG / JPEG / WebP → new document **or** new image layer (user choice via small modal).
  - File-picker open of `.dcft` project → loads multi-layer document via server.
  - Flat composite export of current document → PNG (default) / JPEG (with quality slider).
  - Native delivery via OS share-sheet; web delivery via download.
  - `.dcft` zip layout definition (minimal: `document.json` per `canvas-core` schema + `layers/<id>.png` raster blobs + `manifest.json` with version + checksum).
  - UI affordances on Documents screen ("Open file…" button) and Editor toolbar ("Export…", "Place image…").

- **Out:**
  - Per-layer or per-selection export *(can re-evaluate during requirements; user said Q2=a)*.
  - Multi-document batch export.
  - Cloud storage providers (Dropbox / Drive / iCloud Drive direct integration) — only the OS picker is in scope; the OS already exposes those.
  - PSD / TIFF / SVG / PDF export — only PNG and JPEG.
  - Color-managed export (P3 / ICC profiles) — sRGB only, consistent with `canvas-fundamentals` Q2.

## Boundary Candidates
- `libs/image-io` (or extend `libs/canvas-skia`): platform-adapted I/O adapter (`pickImage`, `pickProject`, `saveRaster`, `saveProject`).
- `libs/canvas-core`: pure decode/encode of image bytes into the existing layer model (no platform deps).
- `apps/server`: new endpoints for `.dcft` emit and ingest (`POST /documents/:id/export`, `POST /documents/import`).
- `apps/mobile` UI: file-menu affordances on Documents screen + Editor toolbar.

## Out of Boundary
- **Project file write/save in v1.** User confirmed Q2(a) = flat raster only. The server's DB remains the in-progress source of truth; `.dcft` is read-only in v1 (you can receive one, you cannot emit one) **unless** the requirements phase resolves the asymmetry below.
- **Format design beyond `.dcft` v1.** Versioned forward-compat is non-goal; `.dcft v1` only.
- **MCP / agent-driven file I/O.** OS file pickers cannot be triggered by remote agents; no new entries in `mcp-tool-catalog`.
- **Re-flowing reference panel** (`control-layers` already owns the *reference image* slot; this feature does not change how reference images attach to a generation).

## Upstream / Downstream
- **Upstream:**
  - `canvas-fundamentals` (image-layer model, FR-16 import semantics, Q1 file-format deferral now resolved here).
  - `client-state-architecture` (document store invalidation when a document is replaced via "Open").
  - `apps/server` (existing `documents`/`layers` tables and pairing protocol — `.dcft` server endpoints add to the same auth boundary).

- **Downstream:**
  - `screens-implementation` (the "Open file…" / "Export…" buttons replace TODOs already left in Documents screen and Editor toolbar mocks).
  - `editor-canvas-integration` (the "Place image…" command shares the same picker entrypoint as drag-drop, just a different trigger).
  - Future post-v1 spec for **per-layer export** and **PSD-style multi-format export** can build on the `composeToBlob` primitive.

## Existing Spec Touchpoints
- **Extends:**
  - `canvas-fundamentals` FR-16 — adds picker as a third import path. Updates Q1 to mark project file format as **resolved (read in v1, see Open question below for write)**.
  - `screens-implementation` — wires the existing chrome buttons in Documents + Editor toolbar to real handlers.
- **Adjacent (do not overlap):**
  - `generation-history` — owns AI-generation save-to-document; this feature does not touch generated-output handling.
  - `control-layers` — owns reference-image attachment for generation; not the same as "import as layer."
  - `transform-tools` — handles post-import resizing/positioning; this feature only delivers the layer at native dimensions per FR-17.

## Constraints
- Must work identically on iOS, Android, and web (RN-Web in `apps/mobile`).
- Must not pull rendering libs into `libs/canvas-core` (P26 / FR-18).
- Must respect the **raster-only canvas** rule: imports always rasterize at decode (no SVG / vector layer types).
- Must respect **server-as-source-of-truth** for in-progress documents — `.dcft` open replaces the current document only after the server has materialized it.
- sRGB only.
- Must use **server-paired** authentication for `.dcft` upload/download endpoints (no anonymous access).

## Open Questions for Requirements Phase
1. **Save-as-`.dcft` asymmetry.** User confirmed Q2(a) = flat raster only — but Q1(b) means the user *can* open a `.dcft` they don't yet have a way to write. Resolutions:
   - (a) Add `.dcft` write as v1 work (server endpoint + "Save Project…" command). Symmetry restored.
   - (b) Keep `.dcft` read-only in v1; user receives `.dcft` from a peer / future export-from-history feature. Asymmetric but smaller scope.
   - (c) Defer `.dcft` open to post-v1 entirely; ship only image-file picker + flat raster export in v1.
   - **Recommendation:** (a). Without write, "open .dcft" has no source.
2. **New-doc vs. add-as-layer disambiguation UX.** Picker → modal? Picker → always add as layer (and "New from image" is a separate command)? Recommend the latter for fewer modals.
3. **Quality / resolution choices on export.** PNG (lossless) is default. JPEG slider 50–100? PNG bit depth 8 only?
