/**
 * stdio transport (E.2, FR-16).
 *
 * Mounted only when `config.transports.stdio === true`. Auth is
 * trust-by-process — Claude Desktop / agent CLI spawning the server
 * inherits the caller's identity at the OS level. We log every call
 * under a synthetic `_stdio` token name.
 *
 * Wires the `@modelcontextprotocol/sdk` server's `StdioServerTransport`
 * into our shared {@link createMcpServerInstance} factory so an external
 * MCP client (Claude Code, Codex, Gemini CLI in stdio mode, …) can:
 *
 *   - Negotiate `initialize` and discover server capabilities.
 *   - List + call every tool the dispatcher has registered.
 *   - List + read catalog resources via the in-memory transport's
 *     resolver registry.
 *   - Receive server → client `sampling/createMessage` requests when the
 *     `enhance_prompt` handler routes to this session.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from 'pino';

import type { CatalogManifest } from '../catalog/types.js';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import type { InMemoryTransport } from './in-memory.js';
import type { UndoRedoManagerLike } from '../../types/handler-context.js';
import { createMcpServerInstance } from '../mcp/server-factory.js';
import type { InMemorySamplingRegistry } from '../sampling/registry.js';

const STDIO_TOKEN_NAME = '_stdio';

export interface StdioTransportDeps {
  catalog: CatalogManifest;
  dispatcher: HandlerDispatcher;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  resources: Pick<InMemoryTransport, 'readResource'>;
  undoRedo?: UndoRedoManagerLike;
  /** Optional sampling registry; when present, sampling-capable peers register here. */
  samplingRegistry?: InMemorySamplingRegistry;
  serverInfo: { name: string; version: string };
}

export class StdioTransport {
  private mounted = false;
  private sdkTransport: StdioServerTransport | null = null;
  private unregisterSampling: (() => void) | null = null;

  constructor(private readonly deps: StdioTransportDeps) {}

  async start(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;

    const undoRedo = this.deps.undoRedo ?? STUB_UNDO_REDO;
    const instance = createMcpServerInstance({
      catalog: this.deps.catalog,
      dispatcher: this.deps.dispatcher,
      resources: this.deps.resources,
      bus: this.deps.bus,
      audit: this.deps.audit,
      logger: this.deps.logger,
      serverInfo: this.deps.serverInfo,
      undoRedo,
      identity: {
        token_id: null,
        token_name: STDIO_TOKEN_NAME,
        transport: 'stdio',
      },
      onInitialized: ({ clientCapabilities }) => {
        const samplingClient = instance.buildSamplingClient(clientCapabilities);
        if (samplingClient && this.deps.samplingRegistry) {
          this.unregisterSampling = this.deps.samplingRegistry.add(samplingClient);
          this.deps.logger.info(
            { agent: STDIO_TOKEN_NAME },
            'stdio MCP client registered as sampling target',
          );
        }
      },
    });

    const sdk = new StdioServerTransport();
    this.sdkTransport = sdk;
    await instance.server.connect(sdk);
    this.deps.logger.info('stdio transport mounted (MCP SDK wired)');
  }

  async stop(): Promise<void> {
    if (!this.mounted) return;
    this.mounted = false;
    this.unregisterSampling?.();
    this.unregisterSampling = null;
    if (this.sdkTransport) {
      await this.sdkTransport.close();
      this.sdkTransport = null;
    }
    this.deps.logger.info('stdio transport unmounted');
  }
}

const STUB_UNDO_REDO: UndoRedoManagerLike = {
  execute() {
    throw new Error(
      'ctx.undoRedo is not configured on this transport; handler must not call execute()',
    );
  },
};
