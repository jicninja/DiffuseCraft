# @diffusecraft/diffusion-client

Client SDK every DiffuseCraft consumer uses to talk to a server: the tablet (`apps/mobile`), MeshCraft (in-process), external agents (Claude Code, Codex, Gemini CLI, custom).

The SDK abstracts three transports (HTTP, stdio, in-memory) behind a single typed surface. Tool methods, resource readers, event subscribers, and the pairing flow are all generated from `@diffusecraft/mcp-tools`, so consumers never write MCP boilerplate.

See `.kiro/specs/client-sdk/requirements.md` and `.kiro/specs/client-sdk/design.md` for the full contract. This README walks the three canonical integration shapes.

## Install

```bash
pnpm add @diffusecraft/diffusion-client @diffusecraft/mcp-tools @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency; the SDK itself only declares it as such so consumers control the version.

## Example 1 — Tablet app (`apps/mobile`)

The tablet discovers paired servers via mDNS, scans a QR to pair, persists the token to `expo-secure-store`, and reconnects on app resume. Adapters for mDNS, secure store, and the QR scanner are platform-specific — `apps/mobile` ships them.

```ts
import { createDiffuseCraftClient } from "@diffusecraft/diffusion-client";
import { ZeroconfMdnsAdapter } from "./adapters/mdns-rn-zeroconf";
import { ExpoSecureStoreAdapter } from "./adapters/secure-store-expo";
import { ExpoCameraQrAdapter } from "./adapters/qr-expo-camera";

const tokenStore = new ExpoSecureStoreAdapter();
const mdns = new ZeroconfMdnsAdapter();
const qrScanner = new ExpoCameraQrAdapter();

// Pairing flow (one-time): user picks a server from `discover()`,
// scans the QR the server displays, SDK parses it into url+token.
const qrPayload = await qrScanner.scanOnce();
const { url, token, server_name } = clientPlaceholder.pairing.parseQr(qrPayload);
await tokenStore.set("diffusecraft.token", token);
await tokenStore.set("diffusecraft.url", url);

// Steady-state client. The token provider re-reads the keychain per
// session; the SDK caches the resolved value for ~5 minutes.
const client = createDiffuseCraftClient({
  transport: {
    kind: "http",
    url,
    token: async () => (await tokenStore.get("diffusecraft.token")) ?? "",
  },
  adapters: { mdns, secureStore: tokenStore, qrScanner },
  capabilities: {
    accepts_lossy_images: true,
    max_inline_image_kb: 256,
    streaming_supported: true,
    prefers_resources_over_tools: false,
    active_workspace: "Generate",
  },
  reconnect: { enabled: true, max_attempts: 5, backoff_ms: [500, 1000, 2000, 4000, 8000] },
});

await client.connect();
client.events.onConnectionStatus((status) => connectionStore.setStatus(status));
const out = await client.tools.generateImage({ prompt: "a city at dusk", width: 1024, height: 1024 });
```

`clientPlaceholder.pairing.parseQr(...)` is whichever client instance you keep around for the pairing screen (the SDK supports calling `pairing.*` before `connect()`). On app resume the existing client's reconnect loop fires automatically.

## Example 2 — MeshCraft in-process

MeshCraft embeds `@diffusecraft/server` and drives it from the same process via the in-memory transport. No pairing, no mDNS, no secure store — the client holds a direct reference to the server and dispatches across a function boundary.

```ts
import { createDiffuseCraftClient } from "@diffusecraft/diffusion-client";
import { createServer } from "@diffusecraft/server";

const server = await createServer({
  database: { kind: "sqlite", url: "file:./diffusecraft.db" },
  comfy: { kind: "managed" },
});
await server.start();

const client = createDiffuseCraftClient({
  transport: { kind: "in-memory", server },
  capabilities: {
    accepts_lossy_images: false,
    max_inline_image_kb: 2048,
    streaming_supported: true,
    prefers_resources_over_tools: true,
  },
});

await client.connect();

// Drive the 6-phase pipeline.
const job = await client.tools.generateImage({
  prompt: "studio portrait, soft light",
  width: 1024,
  height: 1024,
});
for await (const item of client.resources.history.iterate("doc-01")) {
  if (item.job_id === job.job_id) {
    await client.tools.applyHistoryItem({ history_id: item.id });
    break;
  }
}

// Tear down: dispose the client first, then stop the server (MeshCraft owns the lifecycle).
await client.dispose();
await server.stop();
```

The in-memory transport calls `server.mcp.invokeTool(...)` directly — zero serialisation overhead. Events are synchronous: handlers attached via `client.events.on(...)` fire on the same tick the server publishes.

## Example 3 — External agent (Claude Code, Codex, Gemini CLI, custom)

External agents use stdio (when spawning the server as a subprocess) or HTTP (when targeting a remote server) with a paired token. The agent registers a sampling handler so the server can ask it to call out to its own LLM whenever a tool needs prompt enhancement, vision grounding, or chat orchestration.

```ts
import { createDiffuseCraftClient } from "@diffusecraft/diffusion-client";
import { Anthropic } from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const client = createDiffuseCraftClient({
  transport: {
    kind: "http",
    url: "https://server.lan:7333/mcp",
    token: process.env.DIFFUSECRAFT_TOKEN!,
  },
  // Or, for local debugging:
  // transport: { kind: "stdio", command: "npx", args: ["@diffusecraft/server", "--stdio"] },
  capabilities: {
    accepts_lossy_images: true,
    max_inline_image_kb: 1024,
    streaming_supported: true,
    prefers_resources_over_tools: false,
  },
});

// Register BEFORE `connect()` so the SDK advertises `sampling: {}` on
// the MCP `initialize` payload (J.1, design.md §10.3).
client.sampling.onSample(async (request) => {
  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: request.max_tokens ?? 1024,
    system: request.system_prompt,
    messages: request.messages,
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("\n");
  return { text, model: response.model };
});

await client.connect();

const enhanced = await client.tools.enhancePrompt({
  prompt: "neon-lit alley",
  style_hints: ["cinematic", "wide angle"],
});
console.log(enhanced.prompt);
```

Stdio is the right transport when spawning the server as a child process; HTTP is the right transport for paired remote servers. Both honour the same `client.tools.*` / `client.resources.*` surface, so the agent code is transport-agnostic.

## Negotiated capabilities

After `connect()` resolves, `client.capabilities.server` carries the server's catalog version range, ComfyUI status, supported workspaces, sampling support, and audit-log state — read from `diffusecraft://server/info` (J.2). Consumers tune behaviour off this:

```ts
if (client.capabilities.server?.comfyui_status === "ready") {
  await client.tools.generateImage({ /* ... */ });
} else {
  await client.tools.queueGenerate({ /* ... */ }); // fallback path
}
```

`client.capabilities.client` is the catalog-shaped record the consumer declared on `ClientConfig.capabilities`; the SDK forwards it on the wire so the server can adapt response serialisation (inline vs ref, PNG vs WEBP).

## What's NOT covered yet

- **Event subscriptions over stdio / HTTP.** `client.events.on(...)` against the in-memory transport works synchronously today. The HTTP and stdio transports throw `ConnectionError` from `subscribe(...)` because the DiffuseCraft server publishes events to its in-process `EventBus` only — it does not yet emit MCP `notifications/<eventName>` on the wire. Tracked by the `server-architecture` spec.
- **Token rotation events.** `TokenRotationHook` (re-exported from `@diffusecraft/diffusion-client`) is wired and ready, but the catalog has no `token.rotated` MCP event yet, so the SDK's listener fan-out only fires when the consumer manually invokes the hook (e.g., post-`requestPair` re-pair). Wire-level rotation events arrive when the catalog adds them.
- **Server-info resource handler.** The catalog declares `diffusecraft://server/info`; the server does not yet register a resolver for it (`libs/server/src/lib/server.ts` registers only history / undo / redo). `connect()` reads the resource best-effort and falls back to the handshake placeholder when the server returns `RESOURCE_NOT_FOUND`. The placeholder still populates a usable `client.capabilities.server` object — only the negotiated values degrade. Tracked by `server-architecture`.

## Public API

```ts
import {
  createDiffuseCraftClient,
  type DiffuseCraftClient,
  type ClientConfig,
  type ClientCapabilities,
  // Transports — usually consumers just use `transport.kind` strings,
  // but the classes are exported for advanced wiring (test doubles).
  HttpTransport,
  StdioTransport,
  InMemoryTransport,
  type Transport,
  type HandshakeResult,
  // Adapters — interfaces the consumer implements.
  type MdnsAdapter,
  type SecureStoreAdapter,
  type QrScannerAdapter,
  InMemorySecureStoreAdapter,
  // Pairing client (also reachable via `client.pairing`).
  PairingClient,
  // Sampling forwarder + handler signature.
  SamplingForwarder,
  type SamplingHandler,
  // Capability mapping helper (catalog → MCP wire shape).
  mapToMcpCapabilities,
  // Catalog re-exports.
  type ToolName,
  type ToolInput,
  type ToolOutput,
  type ResourceUri,
  type EventName,
  type EventPayload,
  type ImageEnvelope,
} from "@diffusecraft/diffusion-client";
```

## Source-of-truth

- Spec: `.kiro/specs/client-sdk/requirements.md`, `.kiro/specs/client-sdk/design.md`.
- Catalog: `libs/mcp-tools/`.
- Server (in-process): `libs/server/`.
