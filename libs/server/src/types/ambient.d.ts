// Ambient module stubs for runtime dependencies declared as peer deps in
// `package.json`. The actual modules ship as transitive installs from the host
// (`apps/server`, MeshCraft, tests). These minimal types let `tsc --noEmit`
// resolve the imports while the parallel `mcp-tool-catalog` lib materializes
// and before deps are installed in this workspace.
//
// TODO(server-architecture): once dependencies are installed, drop this file
// and rely on the real `@types/*` packages (or shipped declaration files for
// fastify, better-sqlite3, pino, bonjour-service, ulid).

declare module 'fastify' {
  // Minimal subset used by the HTTP transport.
  export interface FastifyRequest {
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    ip: string;
  }
  export interface FastifyReply {
    code(statusCode: number): FastifyReply;
    header(name: string, value: string): FastifyReply;
    send(payload?: unknown): FastifyReply;
  }
  export interface FastifyInstance {
    addHook(name: string, fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void> | void): void;
    post(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown): void;
    get(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown): void;
    listen(opts: { host: string; port: number }): Promise<string>;
    close(): Promise<void>;
  }
  export interface FastifyServerOptions {
    logger?: unknown;
    bodyLimit?: number;
  }
  function fastify(opts?: FastifyServerOptions): FastifyInstance;
  export default fastify;
}

declare module 'better-sqlite3' {
  // Minimal subset of the better-sqlite3 surface we depend on.
  // `BindParams` mirrors the real package: callers may pass positional
  // params as either a tuple/array or individual arguments. We type the
  // callable signatures permissively (`...unknown[]`) and document the
  // intent via `Statement<TParams>` for readability.
  export interface Statement<_TParams = unknown, TRow = unknown> {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): TRow | undefined;
    all(...params: unknown[]): TRow[];
    iterate(...params: unknown[]): IterableIterator<TRow>;
  }
  export interface Database {
    prepare<TParams = unknown, TRow = unknown>(sql: string): Statement<TParams, TRow>;
    exec(sql: string): Database;
    pragma(pragma: string, opts?: { simple?: boolean }): unknown;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    close(): void;
    readonly open: boolean;
    readonly inTransaction: boolean;
  }
  interface DatabaseConstructor {
    new (filename: string, opts?: { readonly?: boolean; fileMustExist?: boolean }): Database;
    (filename: string, opts?: { readonly?: boolean; fileMustExist?: boolean }): Database;
  }
  const Database: DatabaseConstructor;
  export default Database;
}

declare module 'pino' {
  export interface Logger {
    trace: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    fatal: (...args: unknown[]) => void;
    child(bindings: Record<string, unknown>): Logger;
  }
  export interface LoggerOptions {
    level?: string;
    transport?: { target: string; options?: Record<string, unknown> };
    redact?: { paths: string[]; censor?: string | ((v: unknown) => unknown) };
    base?: Record<string, unknown> | null;
  }
  function pino(opts?: LoggerOptions, dest?: unknown): Logger;
  export default pino;
}

declare module 'bonjour-service' {
  export interface BonjourService {
    name: string;
    type: string;
    port: number;
    txt?: Record<string, string>;
    /**
     * Update TXT records on a published service without recreating it. Real
     * `bonjour-service` supports this; we declare it so `MdnsAdvertiser` can
     * mutate `pairing_open` etc. without restart (FR-3, NFR-3).
     */
    updateTxt?(txt: Record<string, string>): void;
    stop(cb?: () => void): void;
  }
  export interface BonjourPublishOpts {
    name: string;
    type: string;
    port: number;
    txt?: Record<string, string>;
  }
  export class Bonjour {
    publish(opts: BonjourPublishOpts): BonjourService;
    destroy(): void;
  }
  export default Bonjour;
}

declare module 'ulid' {
  /** Generates a Crockford-base32 ULID string (26 chars, time-sortable). */
  export function ulid(seedTime?: number): string;
}

declare module 'ws' {
  // Minimal subset of the `ws` browser-compatible client surface. The server
  // uses `ws` only as a WebSocket client (not a server) — it connects to
  // ComfyUI's `/ws` endpoint to receive progress events.
  type WsData = string | Buffer | ArrayBuffer | Buffer[];
  type WsListener = (data: WsData, isBinary?: boolean) => void;
  type CloseListener = (code: number, reason: Buffer) => void;
  type OpenListener = () => void;
  type ErrorListener = (err: Error) => void;
  export default class WebSocket {
    static readonly OPEN: 1;
    static readonly CLOSED: 3;
    readonly readyState: 0 | 1 | 2 | 3;
    constructor(url: string, opts?: { headers?: Record<string, string> });
    on(event: 'message', listener: WsListener): this;
    on(event: 'open', listener: OpenListener): this;
    on(event: 'close', listener: CloseListener): this;
    on(event: 'error', listener: ErrorListener): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
    close(code?: number, reason?: string): void;
    terminate(): void;
    send(data: string | Buffer): void;
  }
}
