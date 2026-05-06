# client-sdk — Requirements

> **Status:** Draft v0.1.
> **Depends on:** `mcp-tool-catalog` (the surface this SDK invokes), `server-architecture` (the server it talks to), `client-state-architecture` (the consumer of its events).
> **References:** P1, P2, P3, P5, P20.

## 1. Purpose

This spec defines `@diffusecraft/diffusion-client` — the client-side SDK that any DiffuseCraft client (the tablet app, MeshCraft when acting as MCP client of its own server, third-party agents, tests) uses to talk to a DiffuseCraft server.

Responsibilities:
- Transport abstraction: stdio, Streamable HTTP, in-memory — same API on top.
- Pairing flow client-side: mDNS scan, QR-encoded URL parsing, manual paste, claim flow with the server.
- Token storage interface: pluggable, default secure-store-based on RN.
- Typed tool invocation: every catalog tool exposed as a typed method.
- Event subscription: typed receivers for `job.progress`, `job.completed`, `document.changed`, etc.
- Resource reads with `?since` and `?fields` support.
- Connection lifecycle: connect, reconnect, disconnect, multi-backend swap.
- Capability negotiation client-side.

The SDK is **render-agnostic and platform-agnostic** at its core. RN/Expo-specific bits (mDNS via `react-native-zeroconf`, secure store) are **adapters** the consumer plugs in.

## 2. Stakeholders & user stories

### S1 — Tablet app (`apps/mobile`)
> **Story 1.** As the tablet app, I instantiate `DiffuseCraftClient` with a backend URL + token + adapters (mDNS, secure store, QR scanner), pass it to `StoresProvider`, and use it through the stores.

### S2 — MeshCraft (in-process MCP client)
> **Story 2.** As MeshCraft, I instantiate `DiffuseCraftClient` with the **in-memory transport** pointing at my embedded server. No pairing, no mDNS, no secure store. I call typed tool methods to drive the 6-phase pipeline.

### S3 — External agent (Claude Code, Codex, Gemini CLI, custom)
> **Story 3.** As a custom agent, I import the SDK, configure it with HTTP transport + my paired token, and call typed tool methods. The SDK gives me schema-validated inputs and typed outputs without me writing my own MCP boilerplate.

### S4 — Test harness
> **Story 4.** As a test, I instantiate the SDK with the in-memory transport against a server running with `:memory:` SQLite, perform a sequence of tool calls, and assert outcomes — all in-process, no ports.

## 3. Functional requirements (EARS)

### 3.1 Public API surface

**FR-1 (Ubiquitous).** The package SHALL export `createDiffuseCraftClient(config: ClientConfig): DiffuseCraftClient`.

**FR-2 (Ubiquitous).** The returned client SHALL expose:
- `connect()`, `disconnect()`, `getStatus()`
- `tools` — typed namespace with one method per catalog tool (e.g., `client.tools.generateImage(args)`)
- `resources` — typed namespace with read methods for each resource URI
- `events` — typed event subscription bus
- `pairing` — pairing flow methods (discover, claim, etc.)
- `capabilities` — declare client capabilities at handshake
- `dispose()` — frees adapters, closes transport

**FR-3 (Ubiquitous).** The package SHALL re-export relevant types from `@diffusecraft/mcp-tools` (input/output types per tool, event payload types, resource content types) so consumers don't have to import from two packages.

### 3.2 Configuration

**FR-4 (Ubiquitous).** `ClientConfig` SHALL be Zod-validated and include:

- `transport`: discriminated union — `{ kind: "http", url: string, token: string | TokenProvider }` | `{ kind: "stdio", command: string, args: string[] }` | `{ kind: "in-memory", server: DiffuseCraftServer }`.
- `capabilities`: `ClientCapabilities` declared in handshake (FR-37 of `mcp-tool-catalog`).
- `adapters`: `{ mdns?: MdnsAdapter, secureStore?: SecureStoreAdapter, qrScanner?: QrScannerAdapter }`. Each is optional; if absent, related features are unavailable.
- `logger?`: optional logger interface, default no-op.
- `reconnect`: `{ enabled: boolean, max_attempts: number, backoff_ms: number[] }`. Default: enabled, 5 attempts, exponential backoff.
- `request_timeout_ms`: per-request timeout, default 30000.
- `event_buffer_size`: max queued events when no listeners attached, default 100.

**FR-5 (Ubiquitous).** Every config field SHALL have a documented default. Constructing with empty config + a valid transport SHALL succeed.

### 3.3 Transport abstraction

**FR-6 (Ubiquitous).** The SDK SHALL provide a uniform `Transport` interface with: `send(toolName, args)`, `readResource(uri)`, `subscribe(eventName, handler)`, `close()`. Each kind (HTTP/stdio/in-memory) implements it.

**FR-7 (Ubiquitous).** HTTP transport SHALL use the MCP TypeScript SDK's Streamable HTTP client. It SHALL include the bearer token on every request and reconnect the event channel on transient failures.

**FR-8 (Ubiquitous).** stdio transport SHALL spawn the configured command (e.g., `npx @diffusecraft/server --stdio`), pipe stdin/stdout per MCP spec, and close on `dispose()`.

**FR-9 (Ubiquitous).** In-memory transport SHALL accept a `DiffuseCraftServer` instance and call its `mcp.invokeTool` / `readResource` / `events.subscribe` directly. No serialization, no network.

**FR-10 (Ubiquitous).** Transport selection SHALL be transparent at the API layer. Calling `client.tools.generateImage(args)` works identically across all three transports.

### 3.4 Typed tool invocation

**FR-11 (Ubiquitous).** The SDK SHALL provide one typed method per catalog tool. Method names are camelCase derivations of tool names (`generate_image` → `generateImage`).

**FR-12 (Ubiquitous).** Method signatures SHALL infer input/output from `@diffusecraft/mcp-tools` Zod schemas. Compile-time errors when consumers pass wrong shapes.

**FR-13 (Ubiquitous).** Inputs SHALL be validated client-side (Zod parse) BEFORE sending to the server. Invalid inputs throw `ClientValidationError` with field path before any network call.

**FR-14 (Event-driven).** WHEN the server returns an error response, THE SDK SHALL throw a typed `ServerError` with `code`, `message`, `hint?`, `retry_after_ms?` — preserving the error model from `mcp-tool-catalog`.

**FR-15 (Ubiquitous).** Tool invocation SHALL respect the `request_timeout_ms` config. On timeout, the SDK throws `RequestTimeoutError`. The server-side tool may still complete.

### 3.5 Resource reads

**FR-16 (Ubiquitous).** The SDK SHALL provide typed resource read methods, one per resource URI in the catalog. Path-template URIs accept arguments: `client.resources.documentState(documentId)`.

**FR-17 (Ubiquitous).** Resource reads SHALL support `?since` and `?fields` query params (FR-39 / FR-46 of `mcp-tool-catalog`).

**FR-18 (Ubiquitous).** Paginated resources SHALL expose iteration helpers: `for await (const item of client.resources.history.iterate(documentId)) { ... }`.

### 3.6 Event subscription

**FR-19 (Ubiquitous).** The SDK SHALL expose a typed `events` namespace. Consumers subscribe per event name, get typed payloads:

```typescript
const unsub = client.events.on("job.progress", (payload) => {
  // payload is JobProgressPayload, typed
});
```

**FR-20 (Ubiquitous).** Events SHALL be buffered when no listener is attached (up to `event_buffer_size`). Late-attaching listeners receive the buffered events on subscribe.

**FR-21 (Ubiquitous).** Disconnection events SHALL be raised on the client itself: `client.events.onConnectionStatus(status => ...)`.

### 3.7 Pairing client

**FR-22 (Ubiquitous).** The SDK SHALL provide `client.pairing.discover()`: returns an async iterable of `DiscoveredBackend` results from mDNS (via the supplied adapter). Stops when iterator returns or `.return()` is called.

**FR-23 (Ubiquitous).** The SDK SHALL provide `client.pairing.requestPair(backend)`: sends a pair request, waits for the server to approve (with timeout matching server's pairing window), returns a `{ token, server_name }` on success or throws on rejection/timeout.

**FR-24 (Ubiquitous).** The SDK SHALL provide `client.pairing.parseQr(payload)`: parses a QR string into a `{ url, ip, port, token, server_name }` and immediately constructs a connection (token is given by the QR; no further claim needed).

**FR-25 (Ubiquitous).** The SDK SHALL provide `client.pairing.parseManual(input)`: parses a `<url>?t=<token>` line copy-pasted by the user.

### 3.8 Token storage

**FR-26 (Ubiquitous).** Tokens SHALL be retrieved via the configured `SecureStoreAdapter` interface, never held in plain memory beyond the duration of a request.

**FR-27 (Ubiquitous).** When `transport.token` is a `TokenProvider` function, the SDK SHALL call it to fetch the token per request batch (cached for ~5 minutes within a session to avoid repeated keychain prompts).

**FR-28 (Ubiquitous).** A default in-memory `SecureStoreAdapter` SHALL be provided for tests and Node-side use. Production tablet usage requires `expo-secure-store` adapter (provided in a separate adapter package or app code).

### 3.9 Reconnection & resilience

**FR-29 (Event-driven).** WHEN the HTTP transport's event channel disconnects unexpectedly, THE SDK SHALL attempt reconnection per `config.reconnect`. During reconnection, in-flight requests are queued; events are buffered.

**FR-30 (Event-driven).** WHEN reconnection succeeds, THE SDK SHALL re-issue the handshake, re-emit any pending events to subscribers, and resume normal operation.

**FR-31 (Event-driven).** WHEN reconnection ultimately fails, THE SDK SHALL transition to status `error` and emit a connection event; consumers handle (typically the connection store updates).

### 3.10 Capability negotiation

**FR-32 (Ubiquitous).** The SDK SHALL send `capabilities` in the MCP handshake (per server-architecture FR §3.5). It SHALL receive the server's capabilities and store them; consumers can read via `client.capabilities.server`.

**FR-33 (Ubiquitous).** The SDK SHALL adapt outbound requests based on negotiated capabilities (e.g., not requesting WEBP when server doesn't support it; using inline encoding when client declared it; etc.).

### 3.11 Image envelope handling

**FR-34 (Ubiquitous).** The SDK SHALL provide helper methods for the image envelope: `client.image.fetch(envelope)` returns Uint8Array regardless of whether the envelope is `inline` or `ref`. Consumers don't manually fetch blob refs.

**FR-35 (Ubiquitous).** The SDK SHALL provide `client.image.upload(bytes, format)` returning a blob ULID by calling `upload_blob` and returning `{ ref: { uri } }`.

## 4. Non-functional requirements

**NFR-1 (Ubiquitous).** All public methods SHALL have TSDoc with at least one example.

**NFR-2 (Ubiquitous).** SDK SHALL run on Node 20+, RN/Expo SDK 50+, and modern browsers (although DiffuseCraft excludes web from product, the SDK should be usable in any environment for tests/CI).

**NFR-3 (Ubiquitous).** SDK bundle size for the client portion SHALL be ≤ 80 KB minified+gzipped (excluding adapters).

**NFR-4 (Ubiquitous).** Tool method call → server SHALL add ≤ 5 ms client-side latency (validation + serialization) for typical inputs on M-class CPU.

## 5. Out of scope

- **mDNS implementation** itself (provided as adapter; common impls: `react-native-zeroconf`, `bonjour-service` for Node).
- **QR scanner UI** (provided as adapter; consumer's responsibility).
- **Secure-store implementation** (adapter; defaults provided for Node tests).
- **The connection store, models store, etc.** — `client-state-architecture` spec.
- **Specific feature tools' UI** — feature specs.

## 6. Open questions

### Q1 — Should the SDK auto-handle `apply_history_item`-after-`generate_image` chaining for convenience?
A common pattern: generate, wait for completion, apply the only result. Worth a helper?

**Recommendation:** **no** in v1. The catalog has the `generate-and-iterate` MCP prompt template for that. Adding a client-side helper duplicates that. Keep the SDK minimal.

### Q2 — Connection management at the SDK level: one server at a time, or multi?
The connection store (per `client-state-architecture`) handles paired backends, but does each `DiffuseCraftClient` instance attach to one or many?

**Recommendation:** **one client = one backend**. To switch backends, dispose the old client and create a new one. Multi-backend within a single client adds complexity for no v1 use case.

### Q3 — How does the SDK surface MCP sampling for `enhance_prompt`?
Server uses MCP sampling to ask the calling agent to do prompt enhancement. The SDK is the agent in this case (when called by the tablet). Does the SDK expose a sampling handler the consumer registers?

**Recommendation:** **yes**. Consumers register `client.sampling.onSample(async (request) => responseString)`; the SDK forwards to the server. For tablet, this consumer-side handler calls the user's paired LLM agent (via the tablet's own external connection). Confirm in `design.md`.

### Q4 — Should tool methods support cancellation via `AbortSignal`?
For long ops (downloads, generations triggered by the SDK), cancellation matters.

**Recommendation:** **yes**. Methods accept optional `{ signal: AbortSignal }`. Aborting before send → no request. Aborting after → calls `cancel_job` if applicable. Confirm.

### Q5 — Does the SDK do delta sync via `?since` automatically, or does the consumer track timestamps?
A long-running session benefits from `since` queries to avoid re-fetching.

**Recommendation:** **consumer-driven**. The SDK exposes `?since` as a parameter; the connection/history stores in `client-state-architecture` decide when to use it. Auto-tracking adds magic.

## 7. Acceptance criteria

This spec is APPROVED when:
1. The four user stories (§2) work with the API in §3.
2. Every catalog tool, resource, and event has a corresponding typed method/subscriber in the SDK.
3. The transport abstraction is uniform across stdio / HTTP / in-memory.
4. Pairing flow client-side covers mDNS / QR / manual fallback paths.
5. Open questions (§6) have acceptable recommendations.
