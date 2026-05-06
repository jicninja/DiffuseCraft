# client-sdk — Tasks

> **Companion to:** `requirements.md` and `design.md`.
> **DoD per task:** code merged with passing CI, unit + integration tests, TSDoc on public exports, Conventional Commits with `diffusion-client` scope.
> **t-shirt sizes:** XS = ≤2h · S = ≤1d · M = 1–3d · L = 3–7d.

> **Total estimate: ~5–7 weeks for one engineer.**

---

## Phase A — Scaffolding & types

- [x] **A.1** Initialize `libs/diffusion-client/` Nx project. Tags: `scope:client-sdk`. Deps: `@diffusecraft/core`, `@diffusecraft/mcp-tools`, `@modelcontextprotocol/sdk`, `zod`. **(S)**
- [x] **A.2** `ClientConfig` Zod schema with all fields from `requirements.md` §3.2. **(S)**
- [x] **A.3** Error classes: `ClientValidationError`, `ServerError`, `RequestTimeoutError`, `ConnectionError`, `PairingRejectedError`, `SamplingNotSupportedError`. **(S)**
- [x] **A.4** Type re-exports from `@diffusecraft/mcp-tools` (`ToolName`, `ToolInput<T>`, `ToolOutput<T>`, `EventName`, `EventPayload<E>`, `ResourceUri`). **(S)**
- [x] **A.5** `Transport` interface definition. **(XS)**

## Phase B — Transports

- [ ] **B.1** In-memory transport: accepts `DiffuseCraftServer`, calls `.mcp.invokeTool` / `.readResource` / `.events.subscribe` directly. No reconnect logic. **(S)**
- [ ] **B.2** stdio transport: spawn child process via `child_process.spawn`; pipe stdin/stdout per MCP spec; SIGTERM on dispose. **(M)**
- [ ] **B.3** HTTP transport: integrate `@modelcontextprotocol/sdk/client/streamableHttp`; bearer token in headers; long-lived event channel. **(L)**
- [ ] **B.4** HTTP reconnector with exponential backoff. Replays in-flight requests; resubscribes events; re-issues handshake. **(M)**
- [ ] **B.5** Transport tests: each transport round-trips a `get_server_info` against a mock server. **(M)**

## Phase C — Tool method generation

- [ ] **C.1** Build script: read catalog manifest, emit `tools/generated.ts` with one method per tool. **(M)**
- [ ] **C.2** Hand-written wrappers for tools needing special handling (`upload_blob` integrates image helper). **(S)**
- [ ] **C.3** Client-side Zod validation before send. Throws `ClientValidationError` with field path. **(S)**
- [ ] **C.4** Server error parsing: typed `ServerError` thrown on 4xx/5xx and MCP error responses. **(S)**
- [ ] **C.5** AbortSignal support per call. Pre-send abort no-op; post-send → `cancel_job` for jobs. **(M)**
- [ ] **C.6** Tests: 5 representative tool methods with mock transport. **(M)**

## Phase D — Resource readers

- [ ] **D.1** Build script: emit `resources/generated.ts` with one method per resource URI. **(M)**
- [ ] **D.2** `?since` and `?fields` query param support. **(S)**
- [ ] **D.3** Pagination iterator: `for await (const item of client.resources.history.iterate(docId))`. **(M)**
- [ ] **D.4** Tests: read with no query; with since; with fields; pagination. **(S)**

## Phase E — Event bus

- [ ] **E.1** `EventBus` with buffered events, typed listeners. **(M)**
- [ ] **E.2** `event_buffer_size` config respected; oldest events discarded when full. **(S)**
- [ ] **E.3** Connection-status events: `onConnectionStatus`. **(S)**
- [ ] **E.4** Tests: subscribe before/after publish; buffer overflow; multiple subscribers. **(S)**

## Phase F — Pairing client

- [ ] **F.1** `MdnsAdapter` interface. **(XS)**
- [ ] **F.2** `discover()` async iterable using adapter. **(M)**
- [ ] **F.3** `requestPair(backend)` POST flow + waiting for token response. **(M)**
- [ ] **F.4** `parseQr(payload)` — Zod-validated JSON parse. **(S)**
- [ ] **F.5** `parseManual(input)` — URL parsing with token query param. **(S)**
- [ ] **F.6** Tests: discover with stub mDNS; requestPair against test server; QR parse with various payloads; manual parse edge cases. **(M)**

## Phase G — Adapters

- [ ] **G.1** `SecureStoreAdapter` interface + `InMemorySecureStoreAdapter` default. **(XS)**
- [ ] **G.2** `QrScannerAdapter` interface. **(XS)**
- [ ] **G.3** Document expected adapter implementations for `apps/mobile` (RN: `react-native-zeroconf`, `expo-secure-store`, Expo Camera + ML Kit). **(S)**
- [ ] **G.4** Document adapters for MeshCraft (Node + Electron: `bonjour-service`, `safeStorage`). **(S)**

## Phase H — Image helpers

- [ ] **H.1** `image.fetch(envelope)` — handles inline base64 + ref via resource read. **(S)**
- [ ] **H.2** `image.upload(bytes, format)` — calls `upload_blob`, returns ref. **(S)**
- [ ] **H.3** Tests: round-trip an image up and back. **(S)**

## Phase I — MCP sampling

- [ ] **I.1** `SamplingForwarder` class. **(S)**
- [ ] **I.2** `client.sampling.onSample(handler)` registration. **(XS)**
- [ ] **I.3** Wire transport to forward sampling requests to the registered handler. **(M)**
- [ ] **I.4** `SamplingNotSupportedError` when no handler registered and server requests. **(XS)**
- [ ] **I.5** Tests: server-issued sample → consumer handler invoked → response back. **(M)**

## Phase J — Capability negotiation

- [ ] **J.1** Send client capabilities in MCP initialize handshake. **(S)**
- [ ] **J.2** Receive and store server capabilities; expose via `client.capabilities.server`. **(S)**
- [ ] **J.3** Adapt outbound requests based on negotiated caps (e.g., `accepts_lossy_images`). **(M)**

## Phase K — Token storage integration

- [ ] **K.1** `TokenProvider` function type; SDK calls it once per session, caches for ~5 minutes. **(S)**
- [ ] **K.2** `SecureStoreAdapter` integration: connection store fetches token via SDK on connect. **(S)**
- [ ] **K.3** Token rotation: when server rotates token, SDK receives + writes via `secureStore.set`. **(S)**

## Phase L — Documentation & integration

- [ ] **L.1** README with three canonical examples: tablet, MeshCraft in-process, external agent. **(M)**
- [ ] **L.2** TSDoc on every public export. **(M)**
- [ ] **L.3** Integration test against `@diffusecraft/server` running with `:memory:`. **(M)**

## Phase M — Performance & validation

- [ ] **M.1** Bundle size: ≤80 KB minified+gzip excluding adapters. CI-asserted. **(S)**
- [ ] **M.2** Tool method overhead benchmark: ≤5 ms client-side (validation + serialize) for typical inputs. **(S)**
- [ ] **M.3** Stress test: 1000 sequential tool calls; no memory leak; transport stable. **(M)**

---

## Dependency order

```
A → B → C → D
              \
               → E → F → G
                          \
                           → H → I → J → K
                                          \
                                           → L → M
```

A is foundational. B (transports) gates everything. C/D depend on B. E (events) depends on B. F (pairing) depends on adapters G. H/I/J/K can parallelize once B is stable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| MCP SDK Streamable HTTP API changes during v1 | Pin SDK version; CI tests against pinned version; bump deliberately. |
| stdio transport hangs on unresponsive child | B.2 includes liveness check + force-kill on dispose timeout. |
| Generated tool methods drift from manifest | C.1 build is deterministic; CI runs after manifest changes; failing build is the contract. |
| Event buffer overflow loses important events | E.2 overflow drops oldest with warning log; consumers should subscribe early. |
| MCP sampling latency from external agent (Claude Desktop, Codex) | I.5 includes timeout (default 30s); SDK falls back to error response so the calling tool fails gracefully. |
| Adapter contract too tight for some platforms | Adapters are interfaces, not concrete classes; consumers can provide any compatible impl. |

---

## Approval

Approved when:
1. Every requirement maps to one or more tasks.
2. Dependency order is correct.
3. Risks acceptable with stated mitigations.

After approval, implementation begins with Phase A.
