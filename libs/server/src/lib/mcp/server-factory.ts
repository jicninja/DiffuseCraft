/**
 * MCP `Server` factory shared by stdio and Streamable HTTP transports.
 *
 * Builds a `@modelcontextprotocol/sdk` `Server` instance with all the
 * request handlers an external MCP agent (Claude Code, Claude Desktop,
 * OpenAI Codex, Gemini CLI, …) needs:
 *
 *   - `tools/list`  → the dispatcher's registered tools, projected onto
 *                     the SDK shape with JSON-Schema input schemas.
 *   - `tools/call`  → routes through the dispatcher (same middleware
 *                     chain that the in-memory transport runs).
 *   - `resources/list` / `resources/read` → projected from the catalog
 *                     manifest; reads delegate to {@link InMemoryTransport.readResource}
 *                     so all transports share one resolver implementation.
 *   - `prompts/list` → catalog prompts (typically empty in v1).
 *
 * Per-session sampling: when the connected client declared the
 * `sampling: {}` capability in its `initialize` request, the caller
 * (transport mount) registers an SDK-backed {@link SamplingClient} in
 * the {@link InMemorySamplingRegistry}. The `enhance_prompt` handler
 * then routes to it via {@link resolveSamplingTarget}.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { Logger } from 'pino';

import type { CatalogManifest } from '../catalog/types.js';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { ResourceContext } from '../transports/in-memory.js';
import type { InMemoryTransport } from '../transports/in-memory.js';
import type { HandlerContext, TransportKind, UndoRedoManagerLike } from '../../types/handler-context.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import { newRequestId } from '../id.js';
import type { SamplingClient } from '../prompt-enhancement/types.js';

export interface McpSessionIdentity {
  /** `null` for stdio (trust-by-process); the paired token id on HTTP. */
  readonly token_id: string | null;
  /** Audit-display name (`_stdio` for stdio; the token name on HTTP). */
  readonly token_name: string;
  /** Source transport — used to stamp `HandlerContext.transport`. */
  readonly transport: TransportKind;
}

export interface CreateMcpServerInstanceArgs {
  catalog: CatalogManifest;
  dispatcher: HandlerDispatcher;
  /** The in-memory transport's resource registry; read-only here. */
  resources: Pick<InMemoryTransport, 'readResource'>;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  /** Server identity surfaced to clients in `initialize` response. */
  serverInfo: { name: string; version: string };
  /** UndoRedo facade stamped onto `HandlerContext.undoRedo`. */
  undoRedo: UndoRedoManagerLike;
  /**
   * Per-session identity the SDK Server is bound to. Stored on every
   * dispatched `HandlerContext` so audit / authz are scoped correctly.
   */
  identity: McpSessionIdentity;
  /** Hook called once `initialize` completes; receives client capabilities. */
  onInitialized?: (info: { clientCapabilities: Record<string, unknown> | undefined }) => void;
}

export interface McpServerInstance {
  /** SDK server. Caller binds it to a transport via `server.connect(...)`. */
  readonly server: Server;
  /**
   * Build a {@link SamplingClient} adapter once `initialize` reveals the
   * client supports sampling. Returns `null` when `clientCapabilities`
   * lack the `sampling` slot — the caller then skips registration.
   */
  buildSamplingClient(clientCapabilities: Record<string, unknown> | undefined): SamplingClient | null;
}

const PROTOCOL_VERSION = '1';

export function createMcpServerInstance(args: CreateMcpServerInstanceArgs): McpServerInstance {
  const server = new Server(
    {
      name: args.serverInfo.name,
      version: args.serverInfo.version,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
        logging: {},
      },
    },
  );

  // ---- tools/list ---------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = args.dispatcher.list().map((name) => {
      const reg = args.dispatcher.getRegistration(name);
      const def = reg?.tool;
      const inputSchemaJson = def
        ? (zodToJsonSchema(def.inputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>)
        : ({ type: 'object' } as Record<string, unknown>);
      return {
        name,
        title: def?.title ?? name,
        description: def?.description ?? '',
        inputSchema: inputSchemaJson,
      };
    });
    return { tools };
  });

  // ---- tools/call ---------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const toolArgs = (req.params.arguments ?? {}) as unknown;
    const ctx = makeHandlerContext(args, args.identity);
    try {
      const result = await args.dispatcher.dispatch(name, toolArgs, ctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown> | undefined,
      };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR';
      return {
        content: [{ type: 'text', text: `${code}: ${message}` }],
        isError: true,
      };
    }
  });

  // ---- resources/list -----------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = args.catalog.resources.map((r) => ({
      uri: r.uri,
      name: r.title,
      description: r.description,
    }));
    return { resources };
  });

  // ---- resources/read -----------------------------------------------------
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const ctx: ResourceContext = {
      token_id: args.identity.token_id,
      token_name: args.identity.token_name,
      transport: args.identity.transport,
    };
    try {
      const out = await args.resources.readResource(uri, ctx);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(out),
          },
        ],
      };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      throw new Error(`resources/read failed for ${uri}: ${message}`);
    }
  });

  // ---- prompts/list -------------------------------------------------------
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: args.catalog.prompts.map((p) => ({ name: p.name, description: p.description })) };
  });

  // ---- initialize hook ----------------------------------------------------
  server.oninitialized = () => {
    const declared = (server as unknown as { getClientCapabilities?: () => unknown }).getClientCapabilities?.();
    args.onInitialized?.({
      clientCapabilities: (declared as Record<string, unknown> | undefined) ?? undefined,
    });
  };

  return {
    server,
    buildSamplingClient: (clientCapabilities) => {
      if (!clientCapabilities || typeof clientCapabilities !== 'object') return null;
      if (!('sampling' in clientCapabilities)) return null;
      // Lazy-import to avoid a hard dep cycle.
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { createSdkSamplingClient } = require('../sampling/sdk-client.js') as typeof import('../sampling/sdk-client.js');
      return createSdkSamplingClient({
        server,
        agentName: args.identity.token_name,
        supportsSampling: true,
      });
    },
  };

  void PROTOCOL_VERSION;
}

function makeHandlerContext(
  args: CreateMcpServerInstanceArgs,
  identity: McpSessionIdentity,
): HandlerContext {
  return {
    request_id: newRequestId(),
    transport: identity.transport,
    token_id: identity.token_id,
    token_name: identity.token_name,
    received_at: Date.now(),
    publish: (event) => args.bus.publish(event),
    audit: ({ operation, outcome, latency_ms, args_summary }) =>
      void args.audit.append({
        token_id: identity.token_id,
        token_name: identity.token_name,
        operation,
        outcome,
        latency_ms,
        args_summary,
      }),
    logger: {
      info: (...rest) => args.logger.info(...rest),
      error: (...rest) => args.logger.error(...rest),
    },
    undoRedo: args.undoRedo,
  };
}
