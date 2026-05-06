/**
 * `ClientConfig` Zod schema, defaults, and inferred TypeScript type.
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.2 (FR-4, FR-5)
 *   - `client-sdk` design.md §3 (Public API — `ClientConfig` shape)
 *
 * Per FR-5, every field has a documented default so that constructing with an
 * empty config + a valid transport SHALL succeed.
 *
 * Adapter and logger interfaces are declared as plain TypeScript interfaces
 * (they hold function references and are therefore opaque to Zod runtime
 * validation). The schema treats those slots as `z.unknown()`; callers that
 * use the related features perform shape checks at the call sites that
 * actually invoke adapter methods.
 *
 * `transport.kind === "in-memory"` carries an opaque `server` reference. To
 * avoid a runtime dependency on `@diffusecraft/server`, the schema types it as
 * `z.unknown()`; the in-memory transport implementation (Phase B) narrows it
 * structurally when it actually invokes server methods.
 */

import { z } from "zod";
import { ClientCapabilities as ClientCapabilitiesSchema } from "@diffusecraft/mcp-tools";
import { ClientValidationError } from "./errors";
import type { MdnsAdapter as RuntimeMdnsAdapter } from "./adapters/mdns";
import type { SecureStoreAdapter as RuntimeSecureStoreAdapter } from "./adapters/secure-store";
import type { QrScannerAdapter as RuntimeQrScannerAdapter } from "./adapters/qr-scanner";

// ---------------------------------------------------------------------------
// Re-exported / declared interfaces
// ---------------------------------------------------------------------------

/**
 * Re-export of the canonical `ClientCapabilities` Zod schema and inferred type
 * from `@diffusecraft/mcp-tools`. The SDK declares these in the MCP handshake
 * (`mcp-tool-catalog` FR-37). Phase J will extend this surface; the schema is
 * authoritative even before then.
 */
export { ClientCapabilitiesSchema };
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;

/**
 * Pluggable token retrieval. When `transport.token` is a `TokenProvider`
 * function, the SDK invokes it once per session and caches the result for
 * approximately five minutes (FR-27). Implementations typically front a
 * platform-specific secure store (e.g. `expo-secure-store`, Electron
 * `safeStorage`).
 */
export interface TokenProvider {
  (): Promise<string> | string;
}

/**
 * mDNS discovery adapter (design §12, FR-22, F.1). The authoritative
 * runtime contract lives in `./adapters/mdns.ts`; this re-export keeps
 * `import { MdnsAdapter } from "@diffusecraft/diffusion-client"` (the
 * shape consumers configure via `ClientConfig.adapters.mdns`) and the
 * `PairingClient`-side import path pointed at the same interface.
 *
 * Concrete implementations live in consumer packages
 * (`react-native-zeroconf` for `apps/mobile`, `bonjour-service` for
 * MeshCraft); the SDK accepts any compatible implementation.
 */
export type MdnsAdapter = RuntimeMdnsAdapter;

/**
 * Secure-token storage adapter (design §12, FR-26 / FR-28).
 *
 * The authoritative runtime contract lives in
 * `./adapters/secure-store.ts` (G.1). This re-export keeps
 * `import { SecureStoreAdapter } from "@diffusecraft/diffusion-client"`
 * — the shape consumers configure via
 * `ClientConfig.adapters.secureStore` — and the connection-layer import
 * pointed at the same interface. The bundled
 * {@link InMemorySecureStoreAdapter} default is exported from the same
 * file (FR-28).
 */
export type SecureStoreAdapter = RuntimeSecureStoreAdapter;

/**
 * QR-scanner adapter (design §12, FR-22).
 *
 * The authoritative runtime contract lives in
 * `./adapters/qr-scanner.ts` (G.2). Returns the raw QR payload string;
 * the SDK parses it via `pairing.parseQr`.
 */
export type QrScannerAdapter = RuntimeQrScannerAdapter;

/**
 * Minimal logger interface compatible with `pino`-style sinks. Default is a
 * no-op implementation provided by the client constructor (Phase B).
 */
export interface Logger {
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  fatal(obj: unknown, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Schema fragments
// ---------------------------------------------------------------------------

/**
 * `TokenProvider` is a function reference; Zod cannot validate its callable
 * shape. We accept either a non-empty string or an arbitrary function and let
 * the HTTP transport perform a runtime `typeof` check at call time.
 */
const TokenSchema = z.union([
  z.string().min(1),
  z.function().args().returns(z.union([z.string(), z.promise(z.string())])),
]);

const HttpTransportSchema = z
  .object({
    kind: z.literal("http"),
    url: z.string().url(),
    token: TokenSchema,
  })
  .strict();

const StdioTransportSchema = z
  .object({
    kind: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .strict();

const InMemoryTransportSchema = z
  .object({
    kind: z.literal("in-memory"),
    /**
     * Opaque `DiffuseCraftServer` reference. Typed as `unknown` here to keep
     * `@diffusecraft/diffusion-client` free of a runtime dependency on
     * `@diffusecraft/server`. The in-memory transport implementation
     * (Phase B) narrows it structurally before use.
     */
    server: z.unknown(),
  })
  .strict();

export const TransportConfigSchema = z.discriminatedUnion("kind", [
  HttpTransportSchema,
  StdioTransportSchema,
  InMemoryTransportSchema,
]);

export type TransportConfig = z.infer<typeof TransportConfigSchema>;

/**
 * Reconnection policy (FR-29 / FR-30 / FR-31). Defaults: enabled, five
 * attempts, exponential backoff `[500, 1000, 2000, 4000, 8000]` ms.
 */
export const ReconnectConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().min(0).default(5),
    backoff_ms: z
      .array(z.number().int().min(0))
      .min(1)
      .default([500, 1000, 2000, 4000, 8000]),
  })
  .strict()
  .default({
    enabled: true,
    max_attempts: 5,
    backoff_ms: [500, 1000, 2000, 4000, 8000],
  });

export type ReconnectConfig = z.infer<typeof ReconnectConfigSchema>;

/**
 * Adapter slot. Each adapter holds function references, so the schema records
 * its presence as `z.unknown()` and defers structural checks to the call
 * sites that actually invoke adapter methods.
 */
const AdaptersSchema = z
  .object({
    mdns: z.unknown().optional(),
    secureStore: z.unknown().optional(),
    qrScanner: z.unknown().optional(),
  })
  .strict()
  .optional();

// ---------------------------------------------------------------------------
// Top-level schema
// ---------------------------------------------------------------------------

/**
 * Default client capabilities used when the consumer omits the field. Mirrors
 * the safe-defaults declared on `ClientCapabilities` in `mcp-tool-catalog`.
 */
const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  accepts_lossy_images: false,
  max_inline_image_kb: 256,
  streaming_supported: true,
  prefers_resources_over_tools: false,
};

export const ClientConfigSchema = z
  .object({
    transport: TransportConfigSchema,
    capabilities: ClientCapabilitiesSchema.default(DEFAULT_CLIENT_CAPABILITIES),
    adapters: AdaptersSchema,
    logger: z.unknown().optional(),
    reconnect: ReconnectConfigSchema,
    request_timeout_ms: z.number().int().min(1).default(30_000),
    event_buffer_size: z.number().int().min(1).default(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.transport.kind === "in-memory" &&
      (value.transport.server === undefined || value.transport.server === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transport", "server"],
        message: "in-memory transport requires a non-null `server` reference",
      });
    }
  });

/**
 * Inferred SDK consumer-facing type. Adapter and logger slots are widened to
 * their typed interfaces here so consumers get IntelliSense even though the
 * schema treats them as opaque.
 */
export type ClientConfig = Omit<z.infer<typeof ClientConfigSchema>, "adapters" | "logger" | "transport"> & {
  transport:
    | { kind: "http"; url: string; token: string | TokenProvider }
    | { kind: "stdio"; command: string; args?: string[] }
    | { kind: "in-memory"; server: unknown };
  adapters?: {
    mdns?: MdnsAdapter;
    secureStore?: SecureStoreAdapter;
    qrScanner?: QrScannerAdapter;
  };
  logger?: Logger;
};

/**
 * Parse and apply documented defaults. Throws `ClientValidationError`
 * carrying the dotted `field_path` of the first offending Zod issue plus a
 * human-readable message when validation fails (FR-13).
 */
export function parseClientConfig(input: unknown): ClientConfig {
  const result = ClientConfigSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldPath = issue?.path.length ? issue.path.map(String).join(".") : "<root>";
    const reason = issue?.message ?? result.error.message;
    throw new ClientValidationError(`ClientConfig invalid at ${fieldPath}: ${reason}`, {
      field_path: fieldPath,
      cause: result.error,
    });
  }
  // The schema-inferred shape stores adapters/logger as `unknown`; re-cast to
  // the consumer-facing type so callers see the typed adapter interfaces.
  return result.data as unknown as ClientConfig;
}
