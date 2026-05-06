# client-sdk — Design

> **Companion to:** `requirements.md`. **References:** `mcp-tool-catalog`, `server-architecture`, `client-state-architecture`.

## 1. Resolved decisions

| ID | Decision |
|---|---|
| Q1 | **No `generate-and-apply` helper.** Keep SDK minimal; use MCP prompt template. |
| Q2 | **One client = one backend.** Switch backends by disposing + creating new. |
| Q3 | **Consumer-registered sampling handler.** `client.sampling.onSample(handler)`; SDK forwards server sampling requests to the handler. |
| Q4 | **AbortSignal supported.** Methods accept `{ signal }`. Pre-send abort → no request; post-send → emit `cancel_job` for jobs. |
| Q5 | **Consumer-driven `?since`.** SDK exposes; stores decide when to use. |

## 2. Module layout

```
libs/diffusion-client/src/
├── index.ts                    # public exports
├── client.ts                   # DiffuseCraftClient class
├── transports/
│   ├── http.ts                 # Streamable HTTP via @modelcontextprotocol/sdk
│   ├── stdio.ts                # stdio child-process spawn
│   ├── in-memory.ts            # direct DiffuseCraftServer reference
│   ├── transport.ts            # Transport interface
│   └── reconnect.ts            # reconnection orchestration (HTTP only)
├── tools/
│   └── generated.ts            # one method per catalog tool, generated from manifest
├── resources/
│   └── generated.ts            # typed resource readers
├── events/
│   ├── bus.ts                  # buffered event bus
│   └── types.ts
├── pairing/
│   ├── client.ts               # discover, requestPair, parseQr, parseManual
│   └── types.ts
├── adapters/
│   ├── mdns.ts                 # MdnsAdapter interface
│   ├── secure-store.ts         # SecureStoreAdapter interface + InMemoryAdapter default
│   └── qr-scanner.ts           # QrScannerAdapter interface
├── image/
│   ├── fetch.ts                # envelope → Uint8Array
│   └── upload.ts               # bytes → blob ULID
├── sampling/
│   └── handler.ts              # MCP sampling forwarder
├── errors.ts                   # ClientValidationError, ServerError, RequestTimeoutError, ConnectionError
└── shared/
    ├── handshake.ts
    ├── capabilities.ts
    └── ids.ts
```

## 3. Public API

```typescript
// libs/diffusion-client/src/index.ts
import type {
  ToolName,
  ToolInput,
  ToolOutput,
  ResourceUri,
  EventName,
  EventPayload,
  ImageEnvelope,
} from "@diffusecraft/mcp-tools";

export type ClientConfig = {
  transport:
    | { kind: "http"; url: string; token: string | TokenProvider }
    | { kind: "stdio"; command: string; args: string[] }
    | { kind: "in-memory"; server: DiffuseCraftServer };
  capabilities: ClientCapabilities;
  adapters?: {
    mdns?: MdnsAdapter;
    secureStore?: SecureStoreAdapter;
    qrScanner?: QrScannerAdapter;
  };
  logger?: Logger;
  reconnect?: { enabled?: boolean; max_attempts?: number; backoff_ms?: number[] };
  request_timeout_ms?: number;
  event_buffer_size?: number;
};

export interface DiffuseCraftClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

  /** Typed tool methods. Generated from catalog manifest. */
  tools: TypedToolMethods;

  /** Typed resource readers. Generated from manifest. */
  resources: TypedResourceReaders;

  /** Buffered event bus with typed subscribers. */
  events: {
    on<E extends EventName>(name: E, handler: (payload: EventPayload<E>) => void): Unsubscribe;
    onConnectionStatus(handler: (status: ConnectionStatus) => void): Unsubscribe;
  };

  /** Pairing flow. */
  pairing: {
    discover(opts?: { timeout_ms?: number }): AsyncIterable<DiscoveredBackend>;
    requestPair(backend: DiscoveredBackend): Promise<{ token: string; server_name: string }>;
    parseQr(payload: string): { url: string; ip: string; port: number; token: string; server_name: string };
    parseManual(input: string): { url: string; token: string };
  };

  /** Server capabilities (set after handshake). */
  capabilities: { client: ClientCapabilities; server: ServerCapabilities | null };

  /** Image envelope helpers. */
  image: {
    fetch(envelope: ImageEnvelope): Promise<Uint8Array>;
    upload(bytes: Uint8Array, format: "png" | "jpeg" | "webp"): Promise<{ ref: { uri: string } }>;
  };

  /** MCP sampling. Consumer registers a handler that the server can request samples from. */
  sampling: {
    onSample(handler: (request: SamplingRequest) => Promise<SamplingResponse>): Unsubscribe;
  };
}

export function createDiffuseCraftClient(config: ClientConfig): DiffuseCraftClient;
```

## 4. Transport interface

```typescript
// libs/diffusion-client/src/transports/transport.ts
export interface Transport {
  connect(): Promise<HandshakeResult>;
  send<I, O>(toolName: string, args: I, opts?: { signal?: AbortSignal; timeout_ms?: number }): Promise<O>;
  readResource<T>(uri: string, query?: { since?: string; fields?: string[] }): Promise<T>;
  subscribe(name: string, handler: (payload: unknown) => void): Unsubscribe;
  sampling: {
    register(handler: (req: SamplingRequest) => Promise<SamplingResponse>): Unsubscribe;
  };
  disconnect(): Promise<void>;
  isHealthy(): boolean;
}
```

The three transport implementations (`http.ts`, `stdio.ts`, `in-memory.ts`) all conform to this interface; the client class is transport-agnostic.

## 5. Tool method generation

Tool methods are generated from the catalog manifest at build time:

```typescript
// libs/diffusion-client/src/tools/generated.ts (generated)
import { catalog } from "@diffusecraft/mcp-tools";

export class GeneratedTools {
  constructor(private transport: Transport, private logger: Logger) {}

  generateImage(args: ToolInput<"generate_image">, opts?: CallOpts): Promise<ToolOutput<"generate_image">> {
    catalog.tools.generate_image.inputSchema.parse(args);  // client-side validation
    return this.transport.send("generate_image", args, opts);
  }

  applyHistoryItem(args: ToolInput<"apply_history_item">, opts?: CallOpts): Promise<ToolOutput<"apply_history_item">> {
    catalog.tools.apply_history_item.inputSchema.parse(args);
    return this.transport.send("apply_history_item", args, opts);
  }

  // ... one method per tool in catalog
}
```

A build script reads the manifest and emits this file. Hand-written wrappers are optional escapes if a tool needs special handling (e.g., `upload_blob` integrates with the image helper).

## 6. Resource readers

```typescript
// libs/diffusion-client/src/resources/generated.ts (generated)
export class GeneratedResources {
  constructor(private transport: Transport) {}

  serverInfo(): Promise<ServerInfo> {
    return this.transport.readResource("diffusecraft://server/info");
  }

  documentState(documentId: string, opts?: { since?: string; fields?: string[] }): Promise<DocumentState> {
    return this.transport.readResource(`diffusecraft://document/${documentId}/state`, opts);
  }

  // ... one method per resource URI
}
```

## 7. Event bus with buffering

```typescript
// libs/diffusion-client/src/events/bus.ts
export class EventBus {
  private listeners = new Map<string, Set<Handler>>();
  private buffer = new Map<string, unknown[]>();   // events received with no listener
  private bufferSize: number;

  publish(name: string, payload: unknown) {
    const subs = this.listeners.get(name);
    if (subs?.size) {
      subs.forEach((h) => h(payload));
    } else {
      const buf = this.buffer.get(name) ?? [];
      buf.push(payload);
      if (buf.length > this.bufferSize) buf.shift();
      this.buffer.set(name, buf);
    }
  }

  on(name: string, handler: Handler): Unsubscribe {
    let subs = this.listeners.get(name);
    if (!subs) { subs = new Set(); this.listeners.set(name, subs); }
    subs.add(handler);
    // flush buffered events
    const buffered = this.buffer.get(name);
    if (buffered) {
      buffered.forEach(handler);
      this.buffer.delete(name);
    }
    return () => { subs!.delete(handler); };
  }
}
```

## 8. Reconnection (HTTP transport)

```typescript
// libs/diffusion-client/src/transports/reconnect.ts
export class HttpReconnector {
  private attempts = 0;

  async run(transport: HttpTransport, config: ReconnectConfig) {
    while (this.attempts < config.max_attempts) {
      try {
        await transport.reconnect();
        this.attempts = 0;
        // re-issue handshake
        await transport.handshake();
        // resubscribe to events
        transport.resumeSubscriptions();
        return;
      } catch (err) {
        this.attempts++;
        const delay = config.backoff_ms[Math.min(this.attempts - 1, config.backoff_ms.length - 1)];
        await sleep(delay);
      }
    }
    throw new ConnectionError("reconnect-failed");
  }
}
```

In-flight requests during reconnection are queued in the transport's outbox and replayed once reconnected.

## 9. Pairing client

```typescript
// libs/diffusion-client/src/pairing/client.ts
export class PairingClient {
  constructor(private adapters: Adapters, private logger: Logger) {}

  async *discover(opts: { timeout_ms?: number } = {}): AsyncIterable<DiscoveredBackend> {
    if (!this.adapters.mdns) return;
    const channel = this.adapters.mdns.scan({ service: "_diffusecraft._tcp.local" });
    const deadline = opts.timeout_ms ? Date.now() + opts.timeout_ms : Infinity;
    while (Date.now() < deadline) {
      const next = await channel.next();
      if (next.done) return;
      yield next.value;
    }
  }

  async requestPair(backend: DiscoveredBackend): Promise<{ token: string; server_name: string }> {
    // POST /pair with candidate name; server invokes onPairingRequest hook;
    // server responds with token on approval
    const response = await fetch(`${backend.url}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_name: backend.candidate_name }),
    });
    if (!response.ok) throw new PairingRejectedError(await response.text());
    return await response.json();
  }

  parseQr(payload: string): QrPayload {
    return QrPayloadSchema.parse(JSON.parse(payload));
  }

  parseManual(input: string): ManualPayload {
    const url = new URL(input);
    const token = url.searchParams.get("t");
    if (!token) throw new InvalidPayloadError("missing token");
    url.searchParams.delete("t");
    return { url: url.toString(), token };
  }
}
```

## 10. MCP sampling forwarding (canonical pattern)

`SamplingForwarder` is the canonical mechanism by which the server delegates LLM/VLM-class reasoning to a paired agent. It is referenced by `prompt-enhancement` (`enhance_prompt`), `selection-tools` Tier 4 (`select_by_prompt`), and `external-agent-integration` (`send_chat_message`). All three specs share one implementation.

### 10.1 Public interface

```typescript
// libs/diffusion-client/src/sampling/forwarder.ts
export interface SamplingRequest {
  /** MCP sampling-spec compatible payload. */
  messages: Array<{ role: "user" | "assistant"; content: string | StructuredContent }>;
  system_prompt?: string;
  model_preferences?: { hints?: string[]; cost_priority?: number; speed_priority?: number; intelligence_priority?: number };
  max_tokens?: number;
  temperature?: number;
  /** DiffuseCraft-specific extension: caller-declared kind for vendor-prompt tuning. */
  kind?: "text-rewrite" | "vision-grounding" | "chat-orchestration" | "generic";
  /** For vision-grounding: image bytes. */
  image?: ImageEnvelope;
}

export interface SamplingResponse {
  text: string;
  /** Vendor-reported model id, if any. */
  model?: string;
  /** Optional structured content (e.g., parsed bbox JSON). */
  structured?: unknown;
}

export interface SamplingHandler {
  (request: SamplingRequest): Promise<SamplingResponse>;
}

export class SamplingForwarder {
  private handler: SamplingHandler | null = null;

  /** Consumer registers; returns unsubscribe. */
  register(handler: SamplingHandler): () => void {
    this.handler = handler;
    return () => { this.handler = null; };
  }

  /** Server calls this when it wants to ask the consumer (the agent) to sample. */
  async respond(request: SamplingRequest): Promise<SamplingResponse> {
    if (!this.handler) {
      throw new SamplingNotSupportedError(
        "Client did not register a sampling handler. " +
        "Sampling-driven features (enhance_prompt, select_by_prompt, send_chat_message) require it."
      );
    }
    return await this.handler(request);
  }

  /** Capability flag for handshake. */
  get supportsSampling(): boolean { return this.handler !== null; }
}
```

### 10.2 Lifecycle

1. **Construction:** SDK creates one `SamplingForwarder` per `DiffuseCraftClient` instance. Initially no handler registered.
2. **Consumer registration:** the consumer (an agent like Claude Code, or `apps/mobile` if it wants to route to a paired LLM) calls `client.sampling.onSample(handler)` which delegates to `SamplingForwarder.register`.
3. **Handshake declaration:** the SDK includes `supports_sampling: forwarder.supportsSampling` in the client capabilities sent during MCP `initialize`.
4. **Server-initiated sampling:** when the server resolves the calling client as a sampling target (per `prompt-enhancement` FR-10), it sends a sampling request through the transport; the SDK routes it to `SamplingForwarder.respond`; the consumer's handler executes; the response goes back over the transport.
5. **Error propagation:** consumer-thrown errors propagate as `ENHANCEMENT_REFUSED` / `SAMPLING_HANDLER_ERROR` (depending on origin) per the catalog error codes.

### 10.3 Capability negotiation

At handshake, the client declares:
```typescript
{
  supports_sampling: boolean,
  sampling_kinds_supported: ("text-rewrite" | "vision-grounding" | "chat-orchestration" | "generic")[],
}
```

The server filters: tools that require unsupported sampling kinds (e.g., `select_by_prompt` requires `vision-grounding`) are still listed in `tools/list` but invocations from a client lacking that kind get `SAMPLING_NOT_SUPPORTED { hint }` if no other paired agent supports the kind.

### 10.4 Error fallback

| Scenario | Behavior |
|---|---|
| No handler registered + no other agent paired | `SAMPLING_NOT_SUPPORTED` |
| Handler throws / rejects | Wrap as `SAMPLING_HANDLER_ERROR { agent_message }` |
| Handler times out (per request `timeout_ms`) | Try next priority agent (per `prompt-enhancement` FR-10); if none succeed → `ENHANCEMENT_TIMEOUT` |
| Handler returns malformed response (parser fails) | Strict-retry once per `prompt-enhancement` FR-19; if still fails → `ENHANCEMENT_RESPONSE_INVALID` |
| Handler refusal pattern detected | `ENHANCEMENT_REFUSED { agent_message }` |

### 10.5 Consumed by

- **prompt-enhancement spec:** `enhance_prompt` and the internal auto-translate (`enhancePromptInternal`).
- **selection-tools Tier 4:** `select_by_prompt` (sends `kind: "vision-grounding"` with image + prompt).
- **external-agent-integration:** `send_chat_message` (sends `kind: "chat-orchestration"` with chat system prompt + history).
- Future LLM-assisted features.

The tablet's `apps/mobile` typically does NOT register a sampling handler (the tablet is not an LLM). External agents (Claude Code etc.) DO register, becoming the pool the server samples from. MeshCraft-as-MCP-client similarly does not sample; the agents paired to MeshCraft's embedded server provide sampling.

## 11. Image helpers

```typescript
// libs/diffusion-client/src/image/fetch.ts
export async function fetchEnvelope(envelope: ImageEnvelope, transport: Transport): Promise<Uint8Array> {
  if ("inline" in envelope) {
    return Uint8Array.from(atob(envelope.inline.data), (c) => c.charCodeAt(0));
  }
  // ref: read via MCP resource
  const blob = await transport.readResource<Uint8Array>(envelope.ref.uri);
  return blob;
}

// libs/diffusion-client/src/image/upload.ts
export async function uploadBytes(
  bytes: Uint8Array,
  format: "png" | "jpeg" | "webp",
  client: DiffuseCraftClient
): Promise<{ ref: { uri: string } }> {
  // chunk if needed; for simplicity, single-shot ≤16 MB
  const result = await client.tools.uploadBlob({
    format,
    width: 0,  // server will compute from bytes; or consumer can supply
    height: 0,
    inline: { encoding: "base64", data: btoa(String.fromCharCode(...bytes)) },
  });
  return { ref: { uri: `diffusecraft://blob/${result.blob_id}` } };
}
```

## 12. Adapter interfaces

```typescript
// libs/diffusion-client/src/adapters/mdns.ts
export interface MdnsAdapter {
  scan(opts: { service: string }): AsyncIterableIterator<DiscoveredBackend>;
  stop(): void;
}

// libs/diffusion-client/src/adapters/secure-store.ts
export interface SecureStoreAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecureStoreAdapter implements SecureStoreAdapter {
  private map = new Map<string, string>();
  // ... default for tests / Node
}

// libs/diffusion-client/src/adapters/qr-scanner.ts
export interface QrScannerAdapter {
  scanOnce(opts?: { timeout_ms?: number }): Promise<string>;
}
```

`apps/mobile` provides:
- `MdnsAdapter` backed by `react-native-zeroconf`.
- `SecureStoreAdapter` backed by `expo-secure-store`.
- `QrScannerAdapter` backed by Expo Camera + ML Kit.

`MeshCraft` provides:
- `MdnsAdapter` backed by `bonjour-service` (Node).
- `SecureStoreAdapter` backed by Electron's `safeStorage`.
- No QR scanner needed.

## 13. Acceptance criteria for `design.md`

1. Public API in §3 covers all four user stories.
2. Generated tool methods + resource readers cover the entire catalog 1:1.
3. Transport interface in §4 is sufficient for stdio / HTTP / in-memory implementations.
4. Pairing client (§9) covers mDNS / QR / manual.
5. Adapter interfaces (§12) make platform integration straightforward.
