# generation-history — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (history tools + resource), `server-architecture` (persistence), `comfyui-management` (output fetcher creates history items), `generation-workflow` (history strip integration).
> **References:** P8 (preview-then-apply, non-negotiable), P5, P27, krita-ai-diffusion `ai_diffusion/model.py` history panel.

## 1. Purpose

Generation results are **previews**, not commits. They land in a history list; the user (or an agent) explicitly applies them. This spec defines:

- The history data model (server-side persistence + tablet-side mirror).
- The four MCP tools (`get_history_item`, `apply_history_item`, `discard_history_item` + the `diffusecraft://history/list` resource).
- Apply positioning rules (per `mcp-tool-catalog` Q4: contextual to the resolved verb).
- The tablet's history strip UX.
- Retention policy and storage budget.

## 2. Stakeholders & user stories

### S1 — Tablet illustrator browsing variations
> **Story 1.** As an illustrator generating four variations of "neo-tokyo skyline", I see four thumbnails appear in the bottom history strip. I tap each to enlarge, swipe to compare, double-tap to apply. Discarded variations stay viewable until I dismiss them or they age out.

### S2 — Tablet illustrator mixing applied results
> **Story 2.** As an illustrator, I apply preview A as the new layer. I generate three more, apply preview C as another layer, then erase parts of C to reveal A underneath. Both stay in history; I can re-apply A as a new layer if needed.

### S3 — Agent reviewing options before applying
> **Story 3.** As Claude Code, I generate `batch_size: 4`. I `get_history_item` on each + fetch thumbnails. I evaluate (or ask the user) and call `apply_history_item` on the chosen one.

### S4 — Long-session retention
> **Story 4.** As an illustrator working all day, I expect older history entries to persist for the session and survive server restart. After ~30 days (configurable), entries that were never applied are garbage-collected to keep blob storage bounded.

## 3. Functional requirements (EARS)

### 3.1 Data model

**FR-1 (Ubiquitous).** A `history_items` row SHALL exist for every successful generation result. Schema:

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (ULID) | PK |
| `document_id` | TEXT | FK to `documents` |
| `job_id` | TEXT | FK to `jobs` |
| `prompt` | TEXT | English prompt used |
| `parameters_json` | TEXT | Full input including verb, sub-mode, strength, control layers, regions, model, seed |
| `image_blob_id` | TEXT | Full-resolution image |
| `thumbnail_blob_id` | TEXT | 256px preview |
| `applied_to_layer_id` | TEXT NULL | If applied, which layer it created |
| `applied_at` | TEXT NULL | Timestamp of application |
| `discarded_at` | TEXT NULL | Timestamp of explicit discard |
| `created_at` | TEXT | When generation completed |

**FR-2 (Ubiquitous).** Thumbnails SHALL be generated server-side at the time of `job.completed`, max 256 px on the longest side, PNG.

### 3.2 History tools

**FR-3 (Ubiquitous).** `get_history_item({ history_item_id })` SHALL return the row plus a `thumbnail_ref` (`ImageEnvelope`). The full image is fetchable separately via `get_image({ scope: "history_item", id })`.

**FR-4 (Ubiquitous).** `apply_history_item({ history_item_id })` SHALL: (1) load the source preview image; (2) determine insertion semantics from the row's `parameters_json` verb (per §3.3); (3) create a new layer; (4) update `applied_to_layer_id` and `applied_at`; (5) emit `document.changed`; (6) register a reversible Command per P27.

**FR-5 (Ubiquitous).** `discard_history_item({ history_item_id })` SHALL set `discarded_at = now()`. Already-applied layers SHALL NOT be removed (they are independent of history). Discarded items remain in storage until garbage-collected (see §3.5).

**FR-6 (Ubiquitous).** A history item MAY be applied multiple times, each producing a new layer with its own `layer_id`. The `applied_to_layer_id` field tracks the **most recent** application.

### 3.3 Apply positioning rules (`mcp-tool-catalog` Q4)

**FR-7 (Ubiquitous).** When applying a preview, the new layer's position SHALL be determined by the resolved verb stored in `parameters_json`:

| Resolved verb | Insertion position |
|---|---|
| `generate` | Top of layer stack (above all others) |
| `refine` | Above the source layer (the layer that was active when generation submitted) |
| `fill` | Above the layer that owned the inpainted area at generation time, with the result clipped/masked to the original selection |
| `constrained_variation` | Above the source layer, with the original selection as the clip mask |

**FR-8 (Ubiquitous).** When the source layer (for refine/fill/variation) is no longer in the document at apply time (deleted between generation and apply), the new layer SHALL be inserted at the top with a notification surfaced to the caller.

**FR-9 (Ubiquitous).** Fill / constrained_variation results SHALL preserve the **selection mask** they were generated against; the new layer's alpha is gated by the recorded mask so other regions of the canvas are untouched.

### 3.4 History resource (paginated list)

**FR-10 (Ubiquitous).** `diffusecraft://history/list` SHALL return paginated history items, sorted by `created_at` DESC, default page size 20, max 50.

**FR-11 (Ubiquitous).** The resource SHALL accept query params:
- `document_id` — filter to a single document.
- `applied` — `true | false | undefined` to filter by application state.
- `since` — ISO8601 timestamp for delta sync (per `mcp-tool-catalog` FR-46).
- `fields` — array of field names for projection.

### 3.5 Retention & garbage collection

**FR-12 (Ubiquitous).** Server config SHALL include `history.retention_days` (default 30) and `history.max_size_bytes` (default 5 GB).

**FR-13 (Event-driven).** A daily garbage-collection job SHALL:
- Delete `discarded_at IS NOT NULL` items older than 7 days.
- Delete unreferenced (`applied_to_layer_id IS NULL`) items older than `retention_days`.
- If total blob storage exceeds `max_size_bytes`, delete oldest unreferenced items until under budget.
- Applied items (`applied_to_layer_id IS NOT NULL`) SHALL never be GC'd while their layer exists in any document; if the layer is removed, GC eligibility resumes after `retention_days`.

**FR-14 (Ubiquitous).** GC SHALL emit `history.gc-completed` with `{ items_deleted, bytes_freed, ts }` for observability.

### 3.6 Tablet UX: history strip

**FR-15 (Ubiquitous).** The history strip SHALL be a horizontally-scrolling row at the bottom of the canvas, showing thumbnails with most recent on the right (so latest is in view).

**FR-16 (Ubiquitous).** Each thumbnail SHALL display:
- Image preview (lazy-loaded if not yet fetched).
- A small badge: ✓ for applied; — for discarded; ● for fresh (no action yet).
- Pulse animation while in-flight (job not yet completed but slot reserved).

**FR-17 (Ubiquitous).** Tap interactions:
- **Single tap** → enlarges to fill canvas as a temporary overlay (preview before apply).
- **Double tap** → applies (`apply_history_item`).
- **Long press** → context menu: Apply, Discard, Compare, Copy parameters.
- **Swipe up** → applies; **swipe down** → discards (gestural shortcut).

**FR-18 (Ubiquitous).** The strip SHALL be filterable: toggle "show discarded" off by default; toggle "this document only" on by default.

**FR-19 (Ubiquitous).** When `apply_history_item` succeeds, the badge updates to ✓ and the layer appears in the layers panel.

**FR-20 (Ubiquitous).** Comparison view: long-press → Compare opens a side-by-side or before/after viewer for two selected history items.

### 3.7 Multi-batch & batch tagging

**FR-21 (Ubiquitous).** A single `generate_image` with `batch_size: N` SHALL produce N history items, all sharing the same `job_id` and `created_at` (within seconds of each other). The strip groups them visually as a "batch" cluster.

**FR-22 (Ubiquitous).** Bulk operations: long-press a batch cluster → Apply all (creates N layers), Discard all, Pick one and discard rest.

### 3.8 Multi-client coordination

**FR-23 (Ubiquitous).** When another paired client (an agent) creates a history item, the tablet SHALL receive `document.changed` with a `summary` referencing the new item; the tablet refreshes its history mirror.

**FR-24 (Ubiquitous).** When another client applies an item, the tablet's badge updates accordingly; the layer appears in the layers panel.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** Thumbnail generation SHALL complete within 500 ms of `job.completed` for typical SDXL output (1024x1024).

**NFR-2 (Ubiquitous).** History strip rendering SHALL handle 200+ thumbnails without performance degradation (lazy loading + virtualization).

**NFR-3 (Ubiquitous).** `apply_history_item` SHALL complete in < 1 second from invocation to `document.changed` for typical 1-MB images.

**NFR-4 (Ubiquitous).** GC job SHALL not block tool invocations; runs in a background timer.

## 5. Out of scope

- **Cross-document history** (browsing all documents at once) — possible future feature.
- **Cloud sync of history** — not v1; explicitly local.
- **Compositing applied previews into a single flat image** — that's just standard layer rendering, not history.
- **Editing the applied layer** — that's `paint_strokes` / `paint_area` / etc.

## 6. Open questions

### Q1 — Should already-applied items remain shown by default in the history strip?
After applying, do we still show them?

**Recommendation:** **yes, with ✓ badge.** Users often need to re-apply the same preview to a new layer, or compare. Hide via filter toggle. Removing applied items from the visual strip would feel destructive.

### Q2 — Should we keep history per-document or globally?
A user might generate something against document A, then open document B. Should the variations from A's session show in B's history strip?

**Recommendation:** **per-document.** History strip filters to current `document_id`. Cross-document history viewing is a future "All recent generations" panel, not v1.

### Q3 — How should we handle very long sessions (1000+ history items)?
Performance and storage.

**Recommendation:** virtualized list rendering (FR NFR-2). Storage bounded by GC (FR-12/13). 1000 items × ~5 MB blob avg = ~5 GB → at the budget. GC kicks in.

### Q4 — Do we expose batch grouping in the catalog?
The data already has `job_id`. Tablet groups by it. Should agents see batch_id semantics explicitly?

**Recommendation:** **yes, surfaced via `batch_summary`** field on each history item: `{ batch_job_id, batch_size, batch_position }`. Agents get explicit batch info. Cheap to compute. Adds ~30 bytes per item.

### Q5 — Should `apply_history_item` accept a `target_layer` override to apply into an existing layer instead of creating a new one?
Saves a layer for users who want to "merge into the active layer."

**Recommendation:** **no in v1.** Always creates a new layer (per Q4 of catalog: positional inserts). User can `merge_layers` post-apply if they want (post-v1 tool). Keeps the surface clean.

### Q6 — Persistence of history across server restart
Server keeps SQLite + blob store; survives restart. But blobs may be GC'd before restart finishes if shutdown was abrupt.

**Recommendation:** GC pauses during shutdown; blobs pinned by an in-progress apply are safe. On startup, server validates blob references match items; missing-blob items become `discarded_at = startup_time`.

## 7. Acceptance criteria

This spec is APPROVED when:

1. The four user stories (§2) are realized end-to-end.
2. The data model (§3.1) covers all needed fields without redundancy.
3. The four catalog tools + resource interact consistently with the data model.
4. Apply positioning rules (§3.3) match the verb-resolution outcomes from `generation-workflow`.
5. Retention policy (§3.5) matches user expectations ("days, not minutes; bounded by GB, not unlimited").
6. Tablet UX dynamics (§3.6) cover all interactions a user expects from a "history of previews" panel.
7. Open questions have acceptable recommendations.
