/**
 * Streamable HTTP transport (E.3, FR-15, FR-17).
 *
 * Fastify mounts `POST /mcp` for invocations and a long-lived event channel
 * for catalog events (job.progress, etc.). Bearer-token middleware
 * authenticates against the `tokens` table; missing/invalid token → 401
 * with `WWW-Authenticate: Bearer realm="DiffuseCraft"`.
 *
 * Skeletal completeness: this file mounts the Fastify server, attaches the
 * auth hook, and exposes `dispatchInvocation`. The MCP-over-HTTP framing
 * (Streamable HTTP per the spec) integrates via
 * `@modelcontextprotocol/sdk/server/streamableHttp` — that wiring lands
 * alongside the SDK upgrade.
 *
 * TODO(server-architecture): connect SDK Streamable HTTP transport into
 * the Fastify route; wire SSE event channel.
 */

import fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import type { Database as DB } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { HandlerDispatcher } from '../dispatcher.js';
import type { EventBus } from '../events/bus.js';
import type { AuditLog } from '../audit/log.js';
import type { PairingManager } from '../pairing/manager.js';
import { PairingError } from '../pairing/errors.js';
import { verifyToken } from '../pairing/verify.js';
import type { HandlerContext, UndoRedoManagerLike } from '../../types/handler-context.js';
import { newRequestId } from '../id.js';
import type { ConnectionTracker } from './connection-tracker.js';

export interface HttpTransportOptions {
  host: string;
  port: number;
  /** Max inbound body size in bytes; mirror `comfyui_proxy.rate_limits.max_payload_bytes`. */
  body_limit_bytes: number;
  /** Pairing manager exposed via the anonymous `POST /pair` route. */
  pairing?: PairingManager;
  /**
   * Per-token connection tracker (undo-redo-system A.5). When supplied,
   * each authenticated `POST /mcp` invocation brackets the dispatch with
   * `tracker.acquire(token_id)` / `tracker.release(token_id)` so the
   * {@link UndoRedoManager}'s disconnect-grace timer arms (or re-arms)
   * around bursts of activity from a token. Anonymous routes
   * (`/health`, `/pair`) carry no token id and bypass the tracker.
   */
  connectionTracker?: ConnectionTracker;
  /**
   * Undo/redo manager facade — stamped onto every handler ctx so
   * reversible handlers can call `ctx.undoRedo.execute(...)`
   * (undo-redo-system FR-34). Optional only because some test
   * harnesses construct the HTTP transport without the full server
   * bootstrap.
   */
  undoRedo?: UndoRedoManagerLike;
}

/** Routes that the bearer-token preHandler must not reject. */
const ANONYMOUS_ROUTES = new Set(['/health', '/pair']);

export class HttpTransport {
  private app?: FastifyInstance;
  private boundUrl?: string;

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

    app.post('/mcp', async (req, reply) => {
      const body = (req.body as { name?: string; args?: unknown }) ?? {};
      if (typeof body.name !== 'string') {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'missing tool name' });
      }
      const tokenId = (req.headers['x-token-id'] as string | undefined) ?? null;
      const tokenName = (req.headers['x-token-name'] as string | undefined) ?? '<unknown>';
      const ctx: HandlerContext = {
        request_id: newRequestId(),
        transport: 'http',
        token_id: tokenId,
        token_name: tokenName,
        received_at: Date.now(),
        publish: (event) => this.bus.publish(event),
        audit: ({ operation, outcome, latency_ms, args_summary }) =>
          void this.audit.append({
            token_id: tokenId,
            token_name: tokenName,
            operation,
            outcome,
            latency_ms,
            args_summary,
          }),
        logger: {
          info: (...rest) => this.logger.info(...rest),
          error: (...rest) => this.logger.error(...rest),
        },
        undoRedo: this.options.undoRedo ?? STUB_UNDO_REDO,
      };
      // undo-redo-system A.5: bracket the dispatch with acquire/release so
      // the per-token grace timer cancels (acquire) and re-arms (release)
      // around each authenticated request. The tracker is `null`-safe so
      // callers without a `tokenId` (defensive: should not happen on
      // `/mcp` after the bearer preHandler) are silently skipped.
      this.options.connectionTracker?.acquire(tokenId);
      try {
        const out = await this.dispatcher.dispatch(body.name, body.args, ctx);
        return reply.send({ ok: true, result: out });
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR';
        const status = code === 'UNAUTHORIZED' ? 401 : code === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
        return reply.code(status).send({ ok: false, error: { code, message: (err as Error).message } });
      } finally {
        this.options.connectionTracker?.release(tokenId);
      }
    });

    app.get('/health', async (_req, reply) => reply.send({ ok: true }));

    // Anonymous pairing endpoint (FR-8…FR-11, design.md §2.2). Returns 4xx
    // with a typed `code` body for every documented failure mode.
    app.post('/pair', async (req, reply) => this.handlePair(req, reply));

    const url = await app.listen({ host: this.options.host, port: this.options.port });
    this.app = app;
    this.boundUrl = url;
    this.logger.info({ url }, 'HTTP transport listening');
    return { url };
  }

  async stop(): Promise<void> {
    if (!this.app) return;
    await this.app.close();
    this.app = undefined;
    this.boundUrl = undefined;
  }

  getBoundUrl(): string | undefined {
    return this.boundUrl;
  }

  // ---------------------------------------------------------------------------

  /** Bearer-token auth (FR-17). Stamps headers `x-token-id`/`x-token-name` for the route. */
  private async authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Anonymous routes (health, pairing) bypass bearer auth.
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

  /**
   * Handle `POST /pair` (anonymous, design.md §2.2). Decoupled from the
   * dispatcher; success returns 200 with the candidate's token, failure
   * returns the documented HTTP status + error code body.
   */
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

/**
 * Defensive stub used when the HTTP transport is constructed without a
 * real {@link UndoRedoManagerLike}. Calling `execute` throws synchronously
 * so misconfiguration surfaces immediately; non-reversible handlers
 * keep working in stripped-down test harnesses since they never reach
 * for `ctx.undoRedo`.
 */
const STUB_UNDO_REDO: UndoRedoManagerLike = {
  execute() {
    throw new Error(
      'ctx.undoRedo is not configured on this transport; handler must not call execute()',
    );
  },
};
