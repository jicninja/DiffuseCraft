/**
 * Streamable HTTP transport (E.3, FR-15, FR-17).
 *
 * Fastify mounts the MCP Streamable HTTP endpoint at `POST/GET/DELETE
 * /mcp` and an anonymous `POST /pair` route used by paired devices to
 * claim a token. Bearer-token auth (`Authorization: Bearer dcft_...`)
 * gates `/mcp`; missing/invalid tokens → 401 with
 * `WWW-Authenticate: Bearer realm="DiffuseCraft"`.
 *
 * MCP framing is delegated to the SDK's `StreamableHTTPServerTransport`.
 * Each authenticated MCP session (`initialize` is the first request)
 * gets its own `Server` + transport pair so sampling round-trips bind
 * to the right peer. Subsequent requests carry the SDK's
 * `mcp-session-id` header which we route to the existing session.
 */

import fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import type { Database as DB } from 'better-sqlite3';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { CatalogManifest } from '../catalog/types.js';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import type { PairingManager } from '../pairing/manager.js';
import { PairingError } from '../pairing/errors.js';
import { verifyToken } from '../pairing/verify.js';
import type { UndoRedoManagerLike } from '../../types/handler-context.js';
import type { ConnectionTracker } from './connection-tracker.js';
import type { InMemoryTransport } from './in-memory.js';
import { createMcpServerInstance } from '../mcp/server-factory.js';
import type { InMemorySamplingRegistry } from '../sampling/registry.js';

export interface HttpTransportOptions {
  host: string;
  port: number;
  body_limit_bytes: number;
  pairing?: PairingManager;
  connectionTracker?: ConnectionTracker;
  undoRedo?: UndoRedoManagerLike;
  /** Catalog used by the MCP server (tools/resources/prompts manifest). */
  catalog: CatalogManifest;
  /** Resource registry — typically the in-memory transport. */
  resources: Pick<InMemoryTransport, 'readResource'>;
  /** Sampling registry; HTTP sessions register sampling-capable peers here. */
  samplingRegistry?: InMemorySamplingRegistry;
  /** Server identity surfaced in `initialize` responses. */
  serverInfo: { name: string; version: string };
}

const ANONYMOUS_ROUTES = new Set(['/health', '/pair']);

interface McpSession {
  readonly transport: StreamableHTTPServerTransport;
  readonly token_id: string;
  readonly token_name: string;
  unregisterSampling: (() => void) | null;
}

export class HttpTransport {
  private app?: FastifyInstance;
  private boundUrl?: string;
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly db: DB,
    private readonly dispatcher: HandlerDispatcher,
    private readonly bus: EventBus,
    private readonly audit: AuditLog,
    private readonly logger: Logger,
    private readonly options: HttpTransportOptions,
  ) {}

  async start(): Promise<{ url: string }> {
    const app = fastify({ bodyLimit: this.options.body_limit_bytes });
    app.addHook('preHandler', async (req, reply) => this.authenticate(req, reply));

    const handleMcp = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const tokenId = (req.headers['x-token-id'] as string | undefined) ?? '';
      const tokenName = (req.headers['x-token-name'] as string | undefined) ?? '<unknown>';
      const sessionHeader = (req.headers['mcp-session-id'] as string | undefined) ?? null;
      const body = (req as unknown as { body: unknown }).body;

      let session = sessionHeader ? this.sessions.get(sessionHeader) ?? null : null;

      if (!session) {
        // New session must start with `initialize`.
        if (!isInitializeRequest(body)) {
          reply.code(400).send({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'no MCP session; first request must be `initialize`' },
            id: null,
          });
          return;
        }
        session = this.openSession(tokenId, tokenName);
      }

      this.options.connectionTracker?.acquire(tokenId);
      try {
        // Pass the parsed body so the SDK doesn't try to re-parse the stream.
        // Fastify exposes the raw Node request/response on `.raw` and we
        // need `reply.hijack()` to tell Fastify the SDK owns the response
        // pipe from here on; the type defs surface these as untyped slots
        // in some setups so we narrow at the call site.
        const fr = req as unknown as { raw: import('node:http').IncomingMessage };
        const fp = reply as unknown as {
          raw: import('node:http').ServerResponse;
          hijack: () => void;
          sent: boolean;
          code: (n: number) => unknown;
          send: (b: unknown) => unknown;
        };
        await session.transport.handleRequest(fr.raw, fp.raw, body);
        fp.hijack();
      } catch (err) {
        this.logger.error({ err }, 'MCP request handling failed');
        const fp = reply as unknown as { sent: boolean; code: (n: number) => { send: (b: unknown) => unknown } };
        if (!fp.sent) fp.code(500).send({ ok: false, error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
      } finally {
        this.options.connectionTracker?.release(tokenId);
      }
    };

    app.post('/mcp', handleMcp);
    app.get('/mcp', handleMcp);
    (app as unknown as { delete: typeof app.post }).delete('/mcp', handleMcp);

    app.get('/health', async (_req, reply) => reply.send({ ok: true }));
    app.post('/pair', async (req, reply) => this.handlePair(req, reply));

    const url = await app.listen({ host: this.options.host, port: this.options.port });
    this.app = app;
    this.boundUrl = url;
    this.logger.info({ url }, 'HTTP transport listening (MCP Streamable HTTP wired)');
    return { url };
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.unregisterSampling?.();
      await session.transport.close().catch(() => undefined);
    }
    this.sessions.clear();
    if (!this.app) return;
    await this.app.close();
    this.app = undefined;
    this.boundUrl = undefined;
  }

  getBoundUrl(): string | undefined {
    return this.boundUrl;
  }

  // ---------------------------------------------------------------------------

  private openSession(tokenId: string, tokenName: string): McpSession {
    const undoRedo = this.options.undoRedo ?? STUB_UNDO_REDO;
    let session: McpSession | null = null;

    const instance = createMcpServerInstance({
      catalog: this.options.catalog,
      dispatcher: this.dispatcher,
      resources: this.options.resources,
      bus: this.bus,
      audit: this.audit,
      logger: this.logger,
      serverInfo: this.options.serverInfo,
      undoRedo,
      identity: {
        token_id: tokenId,
        token_name: tokenName,
        transport: 'http',
      },
      onInitialized: ({ clientCapabilities }) => {
        const samplingClient = instance.buildSamplingClient(clientCapabilities);
        if (samplingClient && this.options.samplingRegistry && session) {
          session.unregisterSampling = this.options.samplingRegistry.add(samplingClient);
          this.logger.info(
            { agent: tokenName },
            'HTTP MCP client registered as sampling target',
          );
        }
      },
    });

    const sdkTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        if (session) this.sessions.set(sid, session);
      },
    });

    sdkTransport.onclose = () => {
      const sid = sdkTransport.sessionId;
      if (sid) {
        const s = this.sessions.get(sid);
        s?.unregisterSampling?.();
        this.sessions.delete(sid);
      }
    };

    void instance.server.connect(sdkTransport);

    session = { transport: sdkTransport, token_id: tokenId, token_name: tokenName, unregisterSampling: null };
    return session;
  }

  /** Bearer-token auth (FR-17). Stamps `x-token-id`/`x-token-name` headers. */
  private async authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = (req as unknown as { url: string }).url ?? '';
    const path = url.split('?')[0] ?? url;
    if (ANONYMOUS_ROUTES.has(path)) return;
    const auth = (req.headers['authorization'] as string | undefined) ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) return this.unauthorized(reply);
    const tokenStr = match[1] ?? '';
    const ctx = verifyToken(tokenStr, this.db);
    if (!ctx) return this.unauthorized(reply);
    req.headers['x-token-id'] = ctx.token_id;
    req.headers['x-token-name'] = ctx.token_name;
  }

  private unauthorized(reply: FastifyReply): void {
    reply.code(401);
    reply.header('WWW-Authenticate', 'Bearer realm="DiffuseCraft"');
    reply.send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'pairing token required' } });
  }

  private async handlePair(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    if (!this.options.pairing) {
      return reply
        .code(503)
        .send({ ok: false, error: { code: 'PAIRING_UNAVAILABLE', message: 'pairing manager not configured' } });
    }
    const sourceIp = ((req as unknown as { ip: string }).ip ?? '').toString();
    try {
      const body = (req.body as Record<string, unknown> | undefined) ?? {};
      const result = await this.options.pairing.handlePairRequest(
        {
          v: typeof body['v'] === 'number' ? (body['v'] as number) : 1,
          method: body['method'] as never,
          candidate_name: body['candidate_name'] as never,
          ...(typeof body['code'] === 'string' ? { code: body['code'] as string } : {}),
        },
        sourceIp,
      );
      return reply.send({ ok: true, result });
    } catch (err) {
      if (err instanceof PairingError) {
        return reply.code(err.status).send({
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            ...(err.hint ? { hint: err.hint } : {}),
          },
        });
      }
      this.logger.error({ err }, 'unexpected /pair error');
      return reply.code(500).send({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'unexpected pairing error' },
      });
    }
  }
}

const STUB_UNDO_REDO: UndoRedoManagerLike = {
  execute() {
    throw new Error(
      'ctx.undoRedo is not configured on this transport; handler must not call execute()',
    );
  },
};
