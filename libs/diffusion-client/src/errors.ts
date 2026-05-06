/**
 * Client SDK error taxonomy.
 *
 * Sourced from:
 *   - `client-sdk` requirements §3.4 (FR-13 `ClientValidationError`,
 *     FR-14 `ServerError`, FR-15 `RequestTimeoutError`),
 *     §3.7 (`PairingRejectedError` per design §9),
 *     §3.9 (`ConnectionError` per design §8),
 *     §3 Q3 / design §10 (`SamplingNotSupportedError`).
 *   - `client-sdk` design.md §2 (module layout — `errors.ts`),
 *     §3 (Public API), §10.1/§10.4 (sampling fallback).
 *
 * Hosts use `instanceof` checks at boundaries (per the precedent set by
 * `libs/server/src/types/errors.ts`). Each class extends `Error`, sets a
 * meaningful `name`, optionally carries structured fields, and forwards
 * `cause` via the Node 16.9+ `super(message, { cause })` form (Node 20+ is
 * the engine baseline per requirements NFR-2).
 */

// ---------------------------------------------------------------------------
// ClientValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown when `ClientConfig` or any client-side argument fails Zod validation
 * before a network call is made (FR-13). `field_path` carries the dotted path
 * of the first offending Zod issue when available.
 */
export class ClientValidationError extends Error {
  public readonly code = "CLIENT_VALIDATION_ERROR" as const;
  public readonly field_path?: string;

  constructor(
    message: string,
    options?: { field_path?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ClientValidationError";
    if (options?.field_path !== undefined) this.field_path = options.field_path;
  }
}

// ---------------------------------------------------------------------------
// ServerError
// ---------------------------------------------------------------------------

/**
 * Thrown when the server returns a non-2xx HTTP response or an MCP-level
 * error (FR-14). `status_code` is the HTTP status when applicable;
 * `mcp_error_code` is the JSON-RPC / MCP error code; `details` carries the
 * raw error payload (e.g. `{ code, message, hint?, retry_after_ms? }`).
 */
export class ServerError extends Error {
  public readonly code = "SERVER_ERROR" as const;
  public readonly status_code?: number;
  public readonly mcp_error_code?: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      status_code?: number;
      mcp_error_code?: number;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ServerError";
    if (options?.status_code !== undefined) this.status_code = options.status_code;
    if (options?.mcp_error_code !== undefined) this.mcp_error_code = options.mcp_error_code;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// ---------------------------------------------------------------------------
// RequestTimeoutError
// ---------------------------------------------------------------------------

/**
 * Thrown when a tool invocation or resource read exceeds
 * `request_timeout_ms` (FR-15). The server-side operation may still
 * complete; the SDK has merely abandoned the wait.
 */
export class RequestTimeoutError extends Error {
  public readonly code = "REQUEST_TIMEOUT" as const;
  public readonly timeout_ms: number;
  public readonly tool_name?: string;

  constructor(
    message: string,
    options: { timeout_ms: number; tool_name?: string; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RequestTimeoutError";
    this.timeout_ms = options.timeout_ms;
    if (options.tool_name !== undefined) this.tool_name = options.tool_name;
  }
}

// ---------------------------------------------------------------------------
// ConnectionError
// ---------------------------------------------------------------------------

/**
 * Transport kinds covered by `ConnectionError.transport_kind`. Mirrors the
 * `transport.kind` discriminant from `ClientConfig` (FR-4).
 */
export type ConnectionTransportKind = "http" | "stdio" | "in-memory";

/**
 * Thrown when the transport cannot connect, disconnects unexpectedly, or
 * fails its handshake (FR-29 / FR-31, design §8 reconnect-failed).
 */
export class ConnectionError extends Error {
  public readonly code = "CONNECTION_ERROR" as const;
  public readonly transport_kind?: ConnectionTransportKind;

  constructor(
    message: string,
    options?: { transport_kind?: ConnectionTransportKind; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ConnectionError";
    if (options?.transport_kind !== undefined) this.transport_kind = options.transport_kind;
  }
}

// ---------------------------------------------------------------------------
// PairingRejectedError
// ---------------------------------------------------------------------------

/**
 * Reason categories for a rejected pairing attempt. `denied` is an explicit
 * rejection by the server (host declined the claim); `expired` means the
 * pairing window closed before approval; `unknown` covers any other
 * server-reported failure that does not fit the first two.
 */
export type PairingRejectionReason = "denied" | "expired" | "unknown";

/**
 * Thrown by `requestPair()` when the server rejects the claim or the
 * pairing window expires before approval (FR-23, design §9).
 */
export class PairingRejectedError extends Error {
  public readonly code = "PAIRING_REJECTED" as const;
  public readonly reason?: PairingRejectionReason;

  constructor(
    message: string,
    options?: { reason?: PairingRejectionReason; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PairingRejectedError";
    if (options?.reason !== undefined) this.reason = options.reason;
  }
}

// ---------------------------------------------------------------------------
// SamplingNotSupportedError
// ---------------------------------------------------------------------------

/**
 * Thrown when the server requests a sampling completion but no consumer
 * sampling handler is registered (design §10.1 / §10.4 — Q3 fallback).
 * Sampling-driven features (`enhance_prompt`, `select_by_prompt`,
 * `send_chat_message`) require the consumer to register a handler via
 * `client.sampling.onSample(...)` first.
 */
export class SamplingNotSupportedError extends Error {
  public readonly code = "SAMPLING_NOT_SUPPORTED" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SamplingNotSupportedError";
  }
}
