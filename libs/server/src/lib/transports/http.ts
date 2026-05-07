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
 *
 * Image-io task 5 also mounts two `.dcft v1` routes behind the same
 * pairing-token middleware:
 *   - `POST /documents/import` (multipart upload → `DcftMaterializer`)
 *   - `GET  /documents/:id/export` (`DcftSerializer` → archive download)
 * Both are constructed lazily during {@link HttpTransport.start} so the
 * factories' prepared statements are bound to the live SQLite handle.
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

import { DCFT_MAX_BYTES } from '@diffusecraft/canvas-core';

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
import type { AssetStore } from '../assets/store.js';
import {
  createDcftSerializer,
  type DcftSerializer,
} from '../dcft/serializer.js';
import {
  createDcftMaterializer,
  type DcftMaterializer,
} from '../dcft/materializer.js';

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
  /**
   * Asset store — required for the `.dcft` import/export routes (image-io
   * task 5). When omitted, the routes respond `503` so transports mounted
   * by tests without a full bootstrap remain functional for `/mcp` only.
   */
  assets?: AssetStore;
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
  /**
   * Lazily constructed in {@link start} when an `assets` store is wired.
   * Both factories prepare statements against `db`, so they must outlive
   * a single request — caching them once per `start()` mirrors the
   * pattern used by `serializer.ts` and `materializer.ts` in their
   * dedicated test harnesses.
   */
  private serializer: DcftSerializer | null = null;
  private materializer: DcftMaterializer | null = null;

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

    // Multipart parser for `/documents/import` (image-io task 5). Registered
    // before the auth preHandler so the cap is enforced uniformly across
    // every multipart route the server may add later — the upload field
    // limit deliberately matches `DCFT_MAX_BYTES`.
    if (this.options.assets) {
      // `@fastify/multipart` ships its types via module augmentation on
      // `FastifyRequest`; we only need the plugin callback at runtime, so
      // we narrow defensively rather than pulling its ambient `.d.ts` into
      // every consumer of this transport file. Fastify v4's `.register()`
      // accepts unknown plugin shapes, hence the local cast on `app`.
      const multipart = (await import('@fastify/multipart')) as unknown as {
        default: unknown;
      };
      await (
        app as unknown as { register: (plugin: unknown, opts: unknown) => Promise<unknown> }
      ).register(multipart.default, {
        limits: { fileSize: DCFT_MAX_BYTES },
      });
      this.serializer = createDcftSerializer({
        db: this.db,
        blobStore: this.options.assets,
      });
      this.materializer = createDcftMaterializer({
        db: this.db,
        blobStore: this.options.assets,
      });
    }

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

    // .dcft import / export (image-io task 5). Both routes sit behind the
    // existing authenticate() preHandler — they are NOT in
    // ANONYMOUS_ROUTES, so unpaired or expired-token requests are
    // rejected before the route handler runs.
    app.post('/documents/import', async (req, reply) => this.handleImport(req, reply));
    app.get('/documents/:id/export', async (req, reply) => this.handleExport(req, reply));

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

  /**
   * `POST /documents/import` — multipart upload of a `.dcft v1` archive.
   * Maps each `MaterializeError` discriminant to the HTTP status code
   * specified in design.md § "Document import / export routes".
   */
  private async handleImport(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.materializer) {
      reply.code(503).send({
        ok: false,
        error: { code: 'NOT_CONFIGURED', message: 'asset store not wired on this transport' },
      });
      return;
    }
    const tokenId = (req.headers['x-token-id'] as string | undefined) ?? '';
    const tokenName = (req.headers['x-token-name'] as string | undefined) ?? '<unknown>';

    // `@fastify/multipart` augments `FastifyRequest.file()` to return the
    // first field. We narrow at the call site rather than pulling in the
    // module's ambient type augmentation, which would force every consumer
    // of this transport file to depend on multipart's d.ts even when the
    // routes are dormant (no `assets` wired).
    const fr = req as unknown as {
      file: () => Promise<
        | {
            fieldname: string;
            filename: string;
            mimetype: string;
            toBuffer: () => Promise<Buffer>;
          }
        | undefined
      >;
    };

    let part: Awaited<ReturnType<typeof fr.file>> | undefined;
    try {
      part = await fr.file();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
        reply.code(413).send({
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: '.dcft archive exceeds size cap' },
        });
        return;
      }
      reply.code(400).send({
        ok: false,
        error: { code: 'BAD_REQUEST', message: (err as Error).message },
      });
      return;
    }

    if (!part || part.fieldname !== 'archive') {
      reply.code(400).send({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'multipart field "archive" required' },
      });
      return;
    }

    let bytes: Uint8Array;
    try {
      const buf = await part.toBuffer();
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
        reply.code(413).send({
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: '.dcft archive exceeds size cap' },
        });
        return;
      }
      reply.code(400).send({
        ok: false,
        error: { code: 'BAD_REQUEST', message: (err as Error).message },
      });
      return;
    }

    const startedAt = Date.now();
    let result: Awaited<ReturnType<DcftMaterializer['materialize']>>;
    try {
      result = await this.materializer.materialize(bytes);
    } catch (err) {
      this.logger.error({ err, token_id: tokenId }, 'documents.import unexpected failure');
      reply.code(500).send({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
      return;
    }

    if (result.ok) {
      const documentId = result.value.documentId;
      void this.audit.append({
        token_id: tokenId.length > 0 ? tokenId : null,
        token_name: tokenName,
        operation: 'documents.import',
        args_summary: JSON.stringify({ bytes: bytes.byteLength, document_id: documentId }),
        outcome: 'ok',
        latency_ms: Date.now() - startedAt,
      });
      this.logger.info(
        { token_id: tokenId, document_id: documentId, bytes: bytes.byteLength },
        'documents.import ok',
      );
      reply.code(201).send({ ok: true, documentId });
      return;
    }

    const e = result.error;
    void this.audit.append({
      token_id: tokenId.length > 0 ? tokenId : null,
      token_name: tokenName,
      operation: 'documents.import',
      args_summary: JSON.stringify({ bytes: bytes.byteLength, error_kind: e.kind }),
      outcome: 'error',
      latency_ms: Date.now() - startedAt,
    });
    switch (e.kind) {
      case 'too_large':
        reply.code(413).send({
          ok: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            kind: e.kind,
            bytesSize: e.bytesSize,
            capBytes: e.capBytes,
          },
        });
        return;
      case 'not_an_archive':
        reply.code(415).send({
          ok: false,
          error: { code: 'UNSUPPORTED_MEDIA_TYPE', kind: e.kind },
        });
        return;
      case 'manifest_invalid':
      case 'manifest_version_unknown':
      case 'document_invalid':
      case 'document_sha_mismatch':
      case 'layer_missing':
      case 'layer_invalid':
        reply.code(422).send({
          ok: false,
          error: { code: 'UNPROCESSABLE_ENTITY', ...e },
        });
        return;
      default: {
        // Exhaustiveness gate: surface compile-time failures if a new
        // discriminant lands without a route mapping.
        const _exhaustive: never = e;
        void _exhaustive;
        reply.code(500).send({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'unhandled MaterializeError' },
        });
        return;
      }
    }
  }

  /**
   * `GET /documents/:id/export` — stream a `.dcft v1` archive for the
   * named document. 409 is reserved for documents with zero layers (see
   * R3.6) — the design says save-project is also disabled client-side,
   * but the server enforces the same rule defensively.
   */
  private async handleExport(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.serializer) {
      reply.code(503).send({
        ok: false,
        error: { code: 'NOT_CONFIGURED', message: 'asset store not wired on this transport' },
      });
      return;
    }

    const params = (req as unknown as { params: { id?: string } }).params;
    const documentId = params?.id ?? '';
    if (!documentId) {
      reply.code(400).send({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'document id required' },
      });
      return;
    }

    const tokenId = (req.headers['x-token-id'] as string | undefined) ?? '';
    const tokenName = (req.headers['x-token-name'] as string | undefined) ?? '<unknown>';

    // 409 zero-layer pre-check. The serializer accepts 0-layer documents
    // (it produces an archive with `layer_count: 0`); design.md §
    // "Document import / export routes" requires the server to reject
    // these with 409 so the client's "Save Project…" disablement is
    // backed by a server-side guard. Look up the row first so we can
    // also surface 404 deterministically before we hit the serializer's
    // `document_not_found`.
    const docRow = this.db
      .prepare<string, { id: string; name: string }>(
        'SELECT id, name FROM documents WHERE id = ?',
      )
      .get(documentId);
    if (!docRow) {
      reply.code(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', kind: 'document_not_found', documentId },
      });
      return;
    }
    const layerCountRow = this.db
      .prepare<string, { n: number }>(
        'SELECT COUNT(*) AS n FROM layers WHERE document_id = ?',
      )
      .get(documentId);
    const layerCount = layerCountRow?.n ?? 0;
    if (layerCount === 0) {
      reply.code(409).send({
        ok: false,
        error: {
          code: 'CONFLICT',
          kind: 'document_has_zero_layers',
          documentId,
          message: 'document has zero layers; cannot export an empty archive',
        },
      });
      return;
    }

    const startedAt = Date.now();
    let result: Awaited<ReturnType<DcftSerializer['serialize']>>;
    try {
      result = await this.serializer.serialize(documentId);
    } catch (err) {
      this.logger.error(
        { err, token_id: tokenId, document_id: documentId },
        'documents.export unexpected failure',
      );
      reply.code(500).send({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
      return;
    }

    if (!result.ok) {
      const e = result.error;
      void this.audit.append({
        token_id: tokenId.length > 0 ? tokenId : null,
        token_name: tokenName,
        operation: 'documents.export',
        args_summary: JSON.stringify({ document_id: documentId, error_kind: e.kind }),
        outcome: 'error',
        latency_ms: Date.now() - startedAt,
      });
      switch (e.kind) {
        case 'document_not_found':
          // Race: the row vanished between the pre-check and the serializer
          // call. Surface as 404 for consistency.
          reply.code(404).send({
            ok: false,
            error: { code: 'NOT_FOUND', kind: e.kind, documentId: e.documentId },
          });
          return;
        case 'blob_missing':
          reply.code(500).send({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              kind: e.kind,
              blobId: e.blobId,
              message: 'document references a missing blob',
            },
          });
          return;
        case 'archive_too_large':
          reply.code(500).send({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              kind: e.kind,
              bytesSize: e.bytesSize,
              message: 'serialized archive exceeds the size cap',
            },
          });
          return;
        default: {
          const _exhaustive: never = e;
          void _exhaustive;
          reply.code(500).send({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'unhandled SerializeError' },
          });
          return;
        }
      }
    }

    const archiveBytes = result.value;
    const title = (docRow.name ?? '').trim() || 'Untitled';
    const safeFilename = `${sanitizeFilenameForHeader(title)}.dcft`;

    void this.audit.append({
      token_id: tokenId.length > 0 ? tokenId : null,
      token_name: tokenName,
      operation: 'documents.export',
      args_summary: JSON.stringify({ document_id: documentId, bytes: archiveBytes.byteLength }),
      outcome: 'ok',
      latency_ms: Date.now() - startedAt,
    });
    this.logger.info(
      {
        token_id: tokenId,
        document_id: documentId,
        bytes: archiveBytes.byteLength,
      },
      'documents.export ok',
    );

    reply.header('Content-Type', 'application/x-dcft');
    reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    reply.header('Content-Length', String(archiveBytes.byteLength));
    // Fastify writes Buffer / Uint8Array bodies through directly without
    // re-serializing as JSON; we hand it a Buffer view so the underlying
    // response stream pipes the bytes verbatim.
    reply.send(
      Buffer.from(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength),
    );
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

/**
 * Sanitize a document title for inclusion in `Content-Disposition`'s
 * `filename="..."` parameter. The export route quotes the value with
 * double-quotes, so we strip CR/LF (header injection), backslash, and
 * the closing double-quote. RFC 6266 also recommends a length cap;
 * 200 chars is comfortably below typical proxy header limits.
 */
function sanitizeFilenameForHeader(name: string): string {
  return name.replace(/[\r\n\\"]/g, '_').slice(0, 200);
}
