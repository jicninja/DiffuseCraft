/**
 * Server error taxonomy.
 *
 * The library uses typed error classes (rather than string codes only) so
 * hosts can `instanceof`-check at boundaries. Each class carries a structured
 * `code` matching `mcp-tool-catalog`'s error model when applicable.
 */

import type { ZodIssue } from 'zod';

/** Thrown when a `ServerConfig` value fails Zod validation. */
export class ConfigValidationError extends Error {
  public readonly field_path: string;
  public readonly issues: ZodIssue[];
  public readonly code = 'CONFIG_VALIDATION_ERROR' as const;

  constructor(args: { field_path: string; message: string; issues: ZodIssue[] }) {
    super(`ServerConfig invalid at ${args.field_path}: ${args.message}`);
    this.name = 'ConfigValidationError';
    this.field_path = args.field_path;
    this.issues = args.issues;
  }
}

/** Thrown by `start()` / `stop()` for impossible state transitions (FR-11). */
export class IllegalLifecycleError extends Error {
  public readonly code = 'ILLEGAL_LIFECYCLE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IllegalLifecycleError';
  }
}

/** Thrown by the dispatcher when an unknown tool name is invoked. */
export class ToolNotFoundError extends Error {
  public readonly code = 'TOOL_NOT_FOUND' as const;
  public readonly tool_name: string;
  constructor(toolName: string) {
    super(`tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
    this.tool_name = toolName;
  }
}

/** Generic operational error (covers `INTERNAL_ERROR` wrapping). */
export class ServerError extends Error {
  public readonly code: string;
  public override readonly cause?: unknown;
  constructor(args: { code: string; message: string; cause?: unknown }) {
    super(args.message);
    this.name = 'ServerError';
    this.code = args.code;
    if (args.cause !== undefined) this.cause = args.cause;
  }
}

/** Thrown by middleware when authentication fails. */
export class UnauthorizedError extends ServerError {
  constructor(message = 'unauthorized') {
    super({ code: 'UNAUTHORIZED', message });
  }
}

/** Thrown by `payloadSizeMw`. */
export class PayloadTooLargeError extends ServerError {
  constructor(actual: number, limit: number) {
    super({ code: 'PAYLOAD_TOO_LARGE', message: `payload ${actual} bytes exceeds limit ${limit}` });
  }
}

/** Thrown by `rateLimitMw`. */
export class RateLimitedError extends ServerError {
  constructor(retryAfterMs: number) {
    super({ code: 'RATE_LIMITED', message: `rate limit exceeded; retry after ${retryAfterMs}ms` });
  }
}

/** Thrown by `versionCompatMw`. */
export class UnsupportedCatalogVersionError extends ServerError {
  constructor(toolSince: string, negotiated: string) {
    super({
      code: 'UNSUPPORTED_CATALOG_VERSION',
      message: `tool requires catalog ${toolSince}, negotiated ${negotiated}`,
    });
  }
}
