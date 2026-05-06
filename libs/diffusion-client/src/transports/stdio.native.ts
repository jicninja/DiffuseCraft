/**
 * stdio.native.ts — React Native shim for the stdio transport.
 *
 * Metro picks `.native.ts` over `.ts` when bundling for iOS/Android, so this
 * file replaces the real `stdio.ts` on RN platforms. It avoids importing
 * `@modelcontextprotocol/sdk/client/stdio.js`, which transitively imports
 * `node:process` / `node:stream` and crashes Metro on RN.
 *
 * stdio is a Node-host concept (spawning a child process). On RN the
 * supported transports are `http` and `in-memory` only. Constructing
 * a `StdioTransport` on RN throws a clear `ConnectionError` so the SDK
 * surface stays present (so `transports/index.ts`'s wildcard re-export
 * still resolves) but never produces a Node-only bundle.
 */

import { ConnectionError } from "../errors";
import type { ClientCapabilities as CatalogClientCapabilities } from "@diffusecraft/mcp-tools";
import type {
  Transport,
  TransportSendOptions,
  ResourceReadQuery,
  TransportReadResourceOptions,
  Unsubscribe,
  HandshakeResult,
  TransportSamplingHandler,
} from "./transport";
import type {
  EventName,
  EventPayload,
  ResourceUri,
  ToolInput,
  ToolName,
  ToolOutput,
} from "@diffusecraft/mcp-tools";

export interface StdioTransportConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  clientInfo?: { name: string; version: string };
  clientCapabilities?: CatalogClientCapabilities;
  getSupportsSampling?: () => boolean;
  disconnect_grace_ms?: number;
}

const RN_UNSUPPORTED_MESSAGE =
  "stdio transport is not available on React Native. Use kind: 'http' or 'in-memory'.";

/**
 * RN stub of {@link StdioTransport}. Every method rejects with
 * {@link ConnectionError}; consumers should never instantiate this on
 * mobile. The class still implements {@link Transport} structurally so
 * `createDiffuseCraftClient`'s exhaustiveness `never` guard is honoured
 * if someone passes `{ kind: 'stdio', ... }` from a shared codebase.
 */
export class StdioTransport implements Transport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: StdioTransportConfig) {
    // Eager throw — fail fast at construction time so consumers see the
    // platform mismatch before any await.
    throw new ConnectionError(RN_UNSUPPORTED_MESSAGE, {
      transport_kind: "stdio",
    });
  }

  connect(): Promise<HandshakeResult> {
    return Promise.reject(
      new ConnectionError(RN_UNSUPPORTED_MESSAGE, { transport_kind: "stdio" }),
    );
  }

  send<N extends ToolName>(
    _toolName: N,
    _args: ToolInput<N>,
    _opts?: TransportSendOptions,
  ): Promise<ToolOutput<N>> {
    return Promise.reject(
      new ConnectionError(RN_UNSUPPORTED_MESSAGE, { transport_kind: "stdio" }),
    );
  }

  readResource<U extends ResourceUri = ResourceUri>(
    _uri: U,
    _query?: ResourceReadQuery,
    _opts?: TransportReadResourceOptions,
  ): Promise<unknown> {
    return Promise.reject(
      new ConnectionError(RN_UNSUPPORTED_MESSAGE, { transport_kind: "stdio" }),
    );
  }

  subscribe<E extends EventName>(
    _eventName: E,
    _handler: (payload: EventPayload<E>) => void,
  ): Unsubscribe {
    throw new ConnectionError(RN_UNSUPPORTED_MESSAGE, {
      transport_kind: "stdio",
    });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  isHealthy(): boolean {
    return false;
  }

  readonly sampling = {
    register: (_handler: TransportSamplingHandler): Unsubscribe => {
      throw new ConnectionError(RN_UNSUPPORTED_MESSAGE, {
        transport_kind: "stdio",
      });
    },
  };
}

export function createStdioTransport(config: StdioTransportConfig): StdioTransport {
  return new StdioTransport(config);
}
