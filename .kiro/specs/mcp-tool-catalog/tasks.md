# mcp-tool-catalog — Tasks

> **Companion to:** `requirements.md` and `design.md` of this spec.
> **DoD (Definition of Done) for every task below:**
> - Code merged to main with passing CI
> - Unit tests written and passing
> - Schema and snapshot tests pass
> - `nx affected --build --test --lint` clean
> - Docs (TSDoc on public exports + relevant README) updated
> - Commit follows Conventional Commits with `mcp-tools` or `server` scope

> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d · XL = >7d

> **Total estimated effort: ~7-9 weeks for one engineer.**

---

## Phase A — Package scaffolding & shared primitives

- [ ] **A.1** Initialize `libs/mcp-tools/` Nx project with TypeScript + Zod + Vitest. Tags: `scope:contract`. Single runtime dependency `zod`. **(S)**
- [ ] **A.2** Implement shared primitives: `Ulid`, branded ids (`DocumentId`, `LayerId`, `HistoryItemId`, `JobId`, `RegionId`, `ControlLayerId`, `PresetId`, `BlobId`, `TokenId`). Tests: round-trip + format validation. **(XS)**
- [ ] **A.3** Implement `ImageEnvelope` and `Selection` schemas in `shared/envelope.ts`. **(XS)**
- [ ] **A.4** Implement `ErrorCode` enum and `ErrorResponse` schema in `shared/errors.ts`. **(XS)**
- [ ] **A.5** Implement `paginated<T>()` helper and `Cursor` schema in `shared/pagination.ts`. **(XS)**
- [ ] **A.6** Implement client/server `Capabilities` schemas in `shared/capabilities.ts`. **(XS)**
- [ ] **A.7** Implement `defineTool`, `defineResource`, `defineEvent`, `definePrompt`, `defineCatalog` factories in `shared/`. These give every catalog entry a uniform shape and provide TS inference for handler signatures. **(S)**
- [ ] **A.8** Set up `version.ts` (catalog semver) and embed in manifest. **(XS)**

## Phase B — Read-only tools first (no side effects, no comfyui)

These are the simplest to implement and give immediate value to agents inspecting state.

- [ ] **B.1** Schema: `get_server_info` (read). **(XS)**
- [ ] **B.2** Schema: `get_audit_log` (read). **(XS)**
- [ ] **B.3** Schema: `get_document_state` (read). Bundled query per FR-44. **(S)**
- [ ] **B.4** Schema: `get_selection` (read). **(XS)**
- [ ] **B.5** Schema: `get_workspace` (read). **(XS)**
- [ ] **B.6** Schema: `get_history_item` (read). **(XS)**
- [ ] **B.7** Schema: `get_job_status` (read). **(XS)**
- [ ] **B.8** Schema: `get_image` (read, polymorphic — scope: document/layer/selection/region/history_item/thumbnail). **(M)**
- [ ] **B.9** Schema: `get_pixel` (read). **(XS)**

## Phase C — State-mutating tools (synchronous writes)

- [ ] **C.1** Schema: `revoke_token` (write). **(XS)**
- [ ] **C.2** Schemas: `create_document`, `set_active_document` (write). **(S)**
- [ ] **C.3** Schemas: `add_layer`, `remove_layer`, `update_layer` (write, reversible). Note: `add_layer` accepts optional initial `content` (replaces import_image). **(M)**
- [ ] **C.4** Schema: `set_selection` (write, reversible, polymorphic — rect/mask/clear/modify). **(S)**
- [ ] **C.5** Schemas: `add_control_layer`, `remove_control_layer` (write, reversible). 14-value `type` enum (Reference + Structural). **(S)**
- [ ] **C.6** Schemas: `define_region`, `remove_region` (write, reversible). **(S)**
- [ ] **C.7** Schema: `set_workspace` (write, reversible). **(XS)**
- [ ] **C.8** Schemas: `apply_history_item`, `discard_history_item` (write, reversible/non-reversible respectively). **(S)**
- [ ] **C.9** Schemas: `set_preset`, `delete_preset` (write). **(XS)**
- [ ] **C.10** Schema: `delete_model` (write). **(XS)**
- [ ] **C.11** Schemas: `paint_strokes`, `paint_area` (write, reversible). **(M)**
- [ ] **C.12** Schema: `upload_blob` (write). Returns blob ULID; metadata only — actual byte channel via resource. **(S)**
- [ ] **C.13** Schemas: `undo`, `redo` (write, idempotent). Per-client per-document semantics. **(S)**
- [ ] **C.14** Schema: `cancel_job` (write, idempotent). **(XS)**
- [ ] **C.15** Schema: `export_image` (write). **(S)**

## Phase D — Long-running job tools

- [ ] **D.1** Schema: `generate_image` (job). Full input + verb resolution. **Most schema-rich tool in catalog.** **(M)**
- [ ] **D.2** Schema: `upscale_image` (job). **(S)**
- [ ] **D.3** Schema: `download_model` (job, idempotent). Prefixed-id format (`hf:`, `civitai:`, `file:`). **(S)**
- [ ] **D.4** Schema: `transcribe_audio` (job). **(S)**
- [ ] **D.5** Schema: `enhance_prompt` (job). MCP sampling architecture documented in input/output. **(S)**

## Phase E — Resources & events

- [ ] **E.1** Resource catalog manifest with all 16 URIs from `design.md` §4. Each has a Zod content schema. **(M)**
- [ ] **E.2** `?since` query param support documented at the protocol level (FR-46). **(S)**
- [ ] **E.3** `?fields` field-selection mechanism (FR-39). **(S)**
- [ ] **E.4** Event catalog manifest with `job.progress`, `job.completed`, `document.changed`, `model.download.progress`, `audit.entry`. **(S)**
- [ ] **E.5** Event subscription model docs (whose events does each client see; multi-client semantics). **(S)**

## Phase F — Prompts (templated agent guidance)

- [ ] **F.1** `generate-and-iterate` prompt. **(XS)**
- [ ] **F.2** `inpaint-region` prompt. **(XS)**
- [ ] **F.3** `refine-with-control` prompt. **(XS)**
- [ ] **F.4** `batch-variations` prompt. **(XS)**

## Phase G — Build pipeline

- [ ] **G.1** `scripts/emit-json-schema.ts`: walks the manifest, runs `zod-to-json-schema` per entry, emits `dist/catalog.json`. **(M)**
- [ ] **G.2** Build asserts: `JSON.stringify(catalog).length ≤ 100_000` (FR-33). **(XS)**
- [ ] **G.3** Build asserts: tool count ≤ 40 (FR-36). **(XS)**
- [ ] **G.4** ESM-only output via tsup or unbuild. **(S)**
- [ ] **G.5** TSDoc generation step (optional for v1). **(S)**

## Phase H — Tests

- [ ] **H.1** Per-tool: example input validates against `inputSchema`; example output validates against `outputSchema` (FR acceptance §5.4). **(M)**
- [ ] **H.2** Catalog footprint test: emitted `catalog.json` ≤ 100 KB. **(XS)**
- [ ] **H.3** Tool count test: ≤ 40 tools. **(XS)**
- [ ] **H.4** Description budget test: each tool description ≤ 200 words for non-obvious, ≤ 60 words for `get_*`/`list_*`. **(S)**
- [ ] **H.5** Snapshot test for the full catalog JSON. Changes to the snapshot trigger reviewer attention. **(S)**
- [ ] **H.6** Manifest coverage test: every tool/resource/event mentioned in `requirements.md` §3.3 §3.3.16-19 has a manifest entry. **(M)**
- [ ] **H.7** Walkthrough simulation test: each of the 4 walkthroughs (`design.md` §10) is executed as a sequence of mock tool calls and asserts the catalog supports each step. **(L)**
- [ ] **H.8** Cross-package test: `@diffusecraft/diffusion-client` consumes the manifest types and a test in client validates type inference. **(S)**

## Phase I — Server-side handler registration scaffolding

(This phase touches `libs/server` but is included here for completeness — the catalog is meaningless without registration.)

- [ ] **I.1** Server boot reads `catalog` manifest, asserts every tool has a registered handler. Build fails if a tool is in the catalog but no handler exists. **(M)**
- [ ] **I.2** Common handler infrastructure: input validation (Zod), error wrapping, audit-log write, undo/redo Command construction for reversible tools. **(L)**
- [ ] **I.3** Capability negotiation: server reads client capabilities at handshake, stores per-session, applies on response serialization (inline vs ref, PNG vs WEBP). **(M)**
- [ ] **I.4** Workspace-based catalog filtering (FR-38): tools/list returns only tools with the active workspace tag. **(S)**
- [ ] **I.5** Catalog version negotiation in handshake (FR-7). **(S)**
- [ ] **I.6** Rate limiting per token (FR Q7-bis): 50 image-mutating calls per minute, 16 MB max payload. **(M)**
- [ ] **I.7** `unsupported_tool_for_negotiated_version` enforcement when tool's `since` > negotiated catalog version. **(S)**

> Phase I is the **handoff to `server-architecture` spec**. The schemas and manifest from Phases A-G are the contract; `server-architecture` will spec how the registration runtime is structured (route mounting, middleware, transports).

## Phase J — Documentation & integration

- [ ] **J.1** README for `@diffusecraft/mcp-tools`: install, import, examples for client and server. **(S)**
- [ ] **J.2** TSDoc on every public export. **(M)**
- [ ] **J.3** `inspirations.md` Krita mapping table cross-checked against this catalog (every concept maps somewhere). **(XS)**
- [ ] **J.4** `_backlog.md` updates: every other spec declares which tools it implements. **(S)**

## Phase K — Stretch (post-v1 catalog)

These are *not* required for v1 but tracked here so they don't get lost.

- [ ] **K.1** Live-mode tools: `start_live_session`, `update_live_input`, `stop_live_session`, `get_live_session`. **(L)**
- [ ] **K.2** Edit-tool extensions: `replace_layer_image`, `composite_image_into_layer`, `apply_filter`, `transform_layer`, `merge_layers`, `duplicate_layer`. **(L)**
- [ ] **K.3** Update tools for control layers and regions if catalog footprint allows. **(S)**
- [ ] **K.4** Animation workspace tools. **(XL)**
- [ ] **K.5** Custom Graph workspace: `submit_custom_graph` (audit-logged, sandboxed). **(L)**

---

## Dependency order

```
A (scaffolding)
   │
   ▼
B (reads) ──── E (resources/events)
   │              │
   ▼              ▼
C (writes) ─── F (prompts)
   │              │
   ▼              ▼
D (jobs) ───── G (build pipeline)
                 │
                 ▼
              H (tests)
                 │
                 ▼
              I (server registration scaffold) → handoff
                 │
                 ▼
              J (docs)
```

Phases A–G can largely be parallelized between two engineers. H, I, J are sequential.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Catalog footprint creeps over 100 KB as descriptions grow | Build asserts in G.2/G.3 fail CI; description budget test (H.4) flags over-budget tools. |
| `generate_image` schema becomes unwieldy with selection-mode + control-layers + regions overloads | Spec covered with single-tool verb-resolution per Q3; refactor to multi-tool only if real friction emerges in Phase D. |
| `zod-to-json-schema` produces non-MCP-compliant output | Validation step in G.1 against MCP JSON-Schema profile (CI). |
| Cross-package type drift between `mcp-tools` and `diffusion-client` | H.8 cross-package test; both packages share the same Zod schemas for inference. |
| Pre-1.0 schema churn forces frequent client updates | Changesets-driven semver; clear major/minor/patch rules in `design.md` §9. |
| Resource URI design constrains future extensibility | `since` and `fields` query params already in place; URI templates extensible. |

---

## Approval

This `tasks.md` is approved when:
1. Every phase's tasks have a path to DoD as defined.
2. The dependency graph is correct.
3. Stretch items (Phase K) are accepted as post-v1 deferrals, not silent omissions.
4. Risks are acceptable with their stated mitigations.

After approval, implementation begins with Phase A.
