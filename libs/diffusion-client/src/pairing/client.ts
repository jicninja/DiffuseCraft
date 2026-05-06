/**
 * `PairingClient` (F.1–F.5, design.md §9, FR-22…FR-25).
 *
 * The pairing flow has four entry points:
 *
 *   1. {@link PairingClient.discover} — async iterable over `mDNS`
 *      results from the consumer-supplied {@link MdnsAdapter}. Used by
 *      the tablet's "scan for servers" screen. (FR-22, F.2)
 *
 *   2. {@link PairingClient.requestPair} — POST `/pair` against a
 *      discovered backend, await the server's host-approval hook, and
 *      return the issued bearer token. Used after the user picks a
 *      backend from the discovery list. (FR-23, F.3)
 *
 *   3. {@link PairingClient.parseQr} — decode and Zod-validate the
 *      base64url-encoded JSON the server stamps into a QR code. Used
 *      by the consumer's QR-scanner adapter. (FR-24, F.4)
 *
 *   4. {@link PairingClient.parseManual} — parse the
 *      `http://<ip>:<port>/?t=<token>` line a user pastes from the
 *      server's boot log. (FR-25, F.5)
 *
 * The class is intentionally side-effect-free aside from the
 * `requestPair` `fetch`: no token persistence (Phase K), no transport
 * construction (the consumer composes those after pairing), no
 * timer-based reconnection. It is safe to construct one per pairing
 * attempt and discard.
 *
 * ## Wire-format alignment
 *
 * Source of truth for the formats below is the server side:
 *   - QR payload: `libs/server/src/lib/pairing/payloads.ts` —
 *     `buildQrPayload` + `QrPayload`.
 *   - Manual URL: same file — `buildManualUrl` (renders
 *     `http://<ip>:<port>/?t=<encodedToken>`).
 *   - `/pair` body / response: `libs/server/src/lib/pairing/manager.ts` —
 *     `PairRequest` + `PairResponse`. The Fastify route (see
 *     `libs/server/src/lib/transports/http.ts`) wraps the response as
 *     `{ ok: true, result: PairResponse }` and errors as
 *     `{ ok: false, error: { code, message, hint? } }`.
 *
 * Any format change there requires a coordinated update here.
 */

import { z } from "zod";

import {
  ClientValidationError,
  PairingRejectedError,
  ServerError,
  type PairingRejectionReason,
} from "../errors.js";
import {
  DEFAULT_MDNS_SERVICE_NAME,
  type DiscoveredBackend,
  type MdnsAdapter,
} from "../adapters/mdns.js";
import type { Logger } from "../config.js";
import type {
  DiscoverOptions,
  ManualPayload,
  PairResult,
  QrPayload,
  RequestPairOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Constructor dependencies for {@link PairingClient}. Both fields are
 * optional so the consumer can:
 *
 *   - Construct without an adapter to use only `parseQr` / `parseManual`
 *     (the most common case — the tablet's QR-scan flow does not need
 *     mDNS).
 *   - Construct without a logger; the client falls back to a no-op
 *     internally so it never throws on a missing sink.
 */
export interface PairingClientOptions {
  /** Pluggable mDNS browser. Required for {@link PairingClient.discover}. */
  mdnsAdapter?: MdnsAdapter;
  /** Optional logger for diagnostics. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Zod schemas — wire validation
// ---------------------------------------------------------------------------

/**
 * Schema for the decoded QR payload. Mirrors the server's `QrPayload`
 * interface exactly; the `v` field is pinned to `1` so old clients
 * fail loudly when the server bumps the format.
 *
 * Constraints worth highlighting:
 *   - `port`: `int().min(1).max(65535)` — same range the OS accepts.
 *   - `token`: `min(1)` — defensive, empty tokens cannot authenticate.
 *   - `url`: `z.string().url()` — catches malformed payloads early so
 *     consumers don't end up with a `new URL(...)` throw deep in the
 *     transport layer.
 */
const QrPayloadSchema = z
  .object({
    v: z.literal(1),
    url: z.string().url(),
    ip: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    token: z.string().min(1),
    token_id: z.string().min(1),
    server_name: z.string(),
    issued_at: z.string(),
    expires_at: z.string(),
  })
  .strict();

/**
 * Schema for the wrapped pair-success response (`{ ok: true, result:
 * PairResponse }`). We accept extra fields on `result` (the server
 * may add them in a minor version) but require the slots the SDK
 * surfaces as {@link PairResult}.
 */
const PairResponseSchema = z.object({
  ok: z.literal(true),
  result: z
    .object({
      token: z.string().min(1),
      server_name: z.string(),
    })
    .passthrough(),
});

/**
 * Schema for the wrapped pair-failure response. The server emits
 * `{ ok: false, error: { code, message, hint? } }` for every documented
 * pairing failure (`libs/server/src/lib/pairing/errors.ts`); we
 * pattern-match on `code` to map onto {@link PairingRejectionReason}.
 */
const PairErrorSchema = z.object({
  ok: z.literal(false),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    })
    .passthrough(),
});

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

/**
 * The pairing client. See module-level doc for the four-entry-point
 * surface; see method doc-comments for behaviour and error model.
 */
export class PairingClient {
  private readonly mdnsAdapter?: MdnsAdapter;
  private readonly logger: Logger;

  constructor(opts: PairingClientOptions = {}) {
    if (opts.mdnsAdapter) this.mdnsAdapter = opts.mdnsAdapter;
    this.logger = opts.logger ?? NOOP_LOGGER;
  }

  // -------------------------------------------------------------------------
  // F.2 — discover
  // -------------------------------------------------------------------------

  /**
   * Async iterable over backends discovered on the LAN via mDNS
   * (FR-22, design §9).
   *
   *   - Throws synchronously when no {@link MdnsAdapter} was supplied
   *     at construction; consumers using only `parseQr` / `parseManual`
   *     see no extra friction (they never call `discover`).
   *   - Forwards `service_name` (defaulted to
   *     {@link DEFAULT_MDNS_SERVICE_NAME}) and `timeout_ms` to the
   *     adapter, then enforces an outer deadline so adapters that
   *     ignore the hint don't strand the consumer in an infinite
   *     `for-await`.
   *
   * Cancellation paths:
   *   - The consumer `break`s out of the loop → `AsyncIterator.return()`
   *     fires → the SDK calls `mdnsAdapter.stop()`.
   *   - The outer `timeout_ms` elapses → the SDK closes the iterator
   *     and calls `mdnsAdapter.stop()`.
   *   - The adapter's iterator finishes naturally → the SDK does NOT
   *     call `stop()` (it already self-terminated).
   */
  async *discover(opts: DiscoverOptions = {}): AsyncIterable<DiscoveredBackend> {
    if (!this.mdnsAdapter) {
      throw new ClientValidationError(
        "PairingClient.discover requires an MdnsAdapter; pass `adapters.mdns` to the client config or `mdnsAdapter` to PairingClient.",
        { field_path: "adapters.mdns" },
      );
    }

    const adapter = this.mdnsAdapter;
    const iterable = adapter.scan({
      service_name: DEFAULT_MDNS_SERVICE_NAME,
      ...(opts.timeout_ms !== undefined ? { timeout_ms: opts.timeout_ms } : {}),
    });
    const iterator =
      typeof (iterable as AsyncIterableIterator<DiscoveredBackend>).next === "function"
        ? (iterable as AsyncIterableIterator<DiscoveredBackend>)
        : iterable[Symbol.asyncIterator]();

    const deadline =
      opts.timeout_ms !== undefined && opts.timeout_ms >= 0
        ? Date.now() + opts.timeout_ms
        : Number.POSITIVE_INFINITY;

    try {
      while (true) {
        // Race the adapter's `next()` against the outer deadline. A
        // simple `Promise.race` is enough — no AbortController needed
        // because the adapter exposes its own `stop()` for cleanup.
        const remaining =
          deadline === Number.POSITIVE_INFINITY ? -1 : Math.max(0, deadline - Date.now());

        const next = remaining < 0
          ? await iterator.next()
          : await Promise.race([
              iterator.next(),
              new Promise<IteratorResult<DiscoveredBackend>>((resolve) => {
                const timer = setTimeout(() => resolve({ value: undefined, done: true }), remaining);
                if (typeof (timer as { unref?: () => void }).unref === "function") {
                  (timer as { unref: () => void }).unref();
                }
              }),
            ]);

        if (next.done) return;
        yield next.value;
      }
    } finally {
      // Always release the adapter's resources, whether the consumer
      // broke early, the deadline elapsed, or the iterator ended
      // naturally. `stop()` is contractually idempotent.
      try {
        adapter.stop();
      } catch (err) {
        this.logger.warn({ err }, "MdnsAdapter.stop() threw");
      }
    }
  }

  // -------------------------------------------------------------------------
  // F.3 — requestPair
  // -------------------------------------------------------------------------

  /**
   * POST `/pair` against a discovered backend and await the server's
   * host-approval hook (FR-23, design §9).
   *
   * Request body (server-side `PairRequest`):
   *   - `v: 1` — payload version.
   *   - `method` — how the candidate found this server (default
   *     `"mdns"`). Must match the open window's `mode`.
   *   - `candidate_name` — human-readable device label.
   *
   * Response handling:
   *   - 200 + `{ ok: true, result: { token, server_name, ... } }` →
   *     return `{ token, server_name }`.
   *   - 401 / 403 with `{ ok: false, error: { code: "PAIRING_REJECTED" } }` →
   *     throw {@link PairingRejectedError} with `reason: "denied"`.
   *   - 403 with `code: "PAIRING_WINDOW_CLOSED"` /
   *     `"PAIRING_TOKEN_ALREADY_CLAIMED"` /
   *     `"PAIRING_CODE_MISMATCH"` /
   *     `"INTERNET_PAIRING_NOT_SUPPORTED"` → throw
   *     {@link PairingRejectedError} with `reason: "expired"` (window
   *     closed / token claimed) or `"denied"` (the rest).
   *   - 410 (legacy "Gone") → `reason: "expired"`.
   *   - Any other non-2xx → throw {@link ServerError} with
   *     `status_code` set.
   *   - Malformed JSON / shape mismatch → throw
   *     {@link ClientValidationError}.
   *
   * The waiting semantics required by FR-23 ("waits for the server to
   * approve with timeout matching the server's pairing window") are
   * enforced server-side: the server's host hook holds the request
   * open until the host approves or the window expires, then returns
   * a single response. The SDK's only timeout knob is the consumer's
   * `signal` — if they want to cap their wait, they pass an
   * `AbortSignal` derived from `AbortSignal.timeout(...)`.
   */
  async requestPair(
    backend: { url: string },
    opts: RequestPairOptions = {},
  ): Promise<PairResult> {
    if (!backend || typeof backend.url !== "string" || backend.url.length === 0) {
      throw new ClientValidationError("requestPair requires backend.url", {
        field_path: "backend.url",
      });
    }

    const candidateName = opts.candidate_name ?? "Unknown device";
    const method = opts.method ?? "mdns";

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, method, candidate_name: candidateName }),
    };
    if (opts.signal) requestInit.signal = opts.signal;

    const url = stripTrailingSlash(backend.url) + "/pair";

    let response: Response;
    try {
      // `globalThis.fetch` is present in Node 18+, RN, and modern
      // browsers (the SDK's runtime baseline per requirements NFR-2).
      response = await globalThis.fetch(url, requestInit);
    } catch (err) {
      // Network errors, DNS failures, and `AbortError` land here.
      // Re-throw verbatim so consumers can pattern-match on
      // `err.name === 'AbortError'` (the requestor's own cancellation
      // path) without having to dig through a wrapper.
      throw err;
    }

    // Try to parse the body as JSON regardless of status code — the
    // server emits structured errors on every 4xx / 5xx documented
    // path, so the body is the most informative source.
    let body: unknown;
    const text = await response.text();
    if (text.length === 0) {
      body = null;
    } else {
      try {
        body = JSON.parse(text);
      } catch (err) {
        throw new ClientValidationError(
          `pair response was not valid JSON: ${(err as Error).message}`,
          { field_path: "<body>", cause: err },
        );
      }
    }

    if (!response.ok) {
      throw this.mapPairFailure(response.status, body, response.statusText);
    }

    const parsed = PairResponseSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ClientValidationError(
        `pair response did not match expected shape: ${issue?.message ?? parsed.error.message}`,
        {
          field_path: issue?.path.length ? issue.path.map(String).join(".") : "<root>",
          cause: parsed.error,
        },
      );
    }

    return {
      token: parsed.data.result.token,
      server_name: parsed.data.result.server_name,
    };
  }

  // -------------------------------------------------------------------------
  // F.4 — parseQr
  // -------------------------------------------------------------------------

  /**
   * Decode the QR payload string (URL-safe base64 of canonical JSON)
   * and validate it against {@link QrPayloadSchema} (FR-24, design §9).
   *
   * Throws {@link ClientValidationError} on:
   *   - Non-base64url input (decoder rejects).
   *   - Decoded payload that is not valid UTF-8 / JSON.
   *   - JSON that does not match the {@link QrPayload} schema (e.g.,
   *     wrong `v`, missing `token`, port out of range).
   */
  parseQr(payload: string): QrPayload {
    if (typeof payload !== "string" || payload.length === 0) {
      throw new ClientValidationError("QR payload must be a non-empty string", {
        field_path: "payload",
      });
    }

    let jsonText: string;
    try {
      jsonText = decodeBase64UrlToUtf8(payload);
    } catch (err) {
      throw new ClientValidationError(
        `QR payload is not valid base64url: ${(err as Error).message}`,
        { field_path: "payload", cause: err },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(jsonText);
    } catch (err) {
      throw new ClientValidationError(
        `QR payload JSON is malformed: ${(err as Error).message}`,
        { field_path: "payload", cause: err },
      );
    }

    const parsed = QrPayloadSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ClientValidationError(
        `QR payload did not match expected shape: ${issue?.message ?? parsed.error.message}`,
        {
          field_path: issue?.path.length ? issue.path.map(String).join(".") : "<root>",
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  // -------------------------------------------------------------------------
  // F.5 — parseManual
  // -------------------------------------------------------------------------

  /**
   * Parse the manual-paste line `http://<ip>:<port>/?t=<token>`
   * (FR-25, design §9). Returns the cleaned base URL (without the
   * `?t=` query) plus the decoded token.
   *
   * Why the `?t=` shape: the server prints this exact line on boot
   * (`buildManualUrl` in `payloads.ts`); the spec's FR-25 references
   * the same `?t=<token>` form. Some implementations of the prompt
   * mention `?token=`; the canonical form is `?t=`. This parser
   * accepts both as a defensive measure (the QR / manual flows that
   * came from older server builds may still be in circulation), with
   * `?t=` taking precedence when both are present.
   *
   * Throws {@link ClientValidationError} on:
   *   - Input that is not a valid URL.
   *   - Missing token query parameter.
   *   - Empty token after URL-decoding.
   */
  parseManual(input: string): ManualPayload {
    if (typeof input !== "string" || input.length === 0) {
      throw new ClientValidationError("manual input must be a non-empty string", {
        field_path: "input",
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(input.trim());
    } catch (err) {
      throw new ClientValidationError(
        `manual input is not a valid URL: ${(err as Error).message}`,
        { field_path: "input", cause: err },
      );
    }

    const token = parsed.searchParams.get("t") ?? parsed.searchParams.get("token");
    if (!token || token.length === 0) {
      throw new ClientValidationError(
        "manual input is missing the token query parameter (expected `?t=<token>`)",
        { field_path: "token" },
      );
    }

    // Strip every query param + path so the consumer gets a clean
    // `http://host:port` that the HTTP transport can use as its
    // base URL. (`/pair` is appended at request time by
    // `requestPair`; the connection store appends the MCP route.)
    const baseUrl = `${parsed.protocol}//${parsed.host}`;
    return { url: baseUrl, token };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Map a non-2xx `/pair` response onto either
   * {@link PairingRejectedError} (documented pairing failure) or
   * {@link ServerError} (anything else — 500s, gateway errors,
   * unexpected statuses).
   */
  private mapPairFailure(status: number, body: unknown, statusText: string): Error {
    const errorParse = PairErrorSchema.safeParse(body);
    const code = errorParse.success ? errorParse.data.error.code : undefined;
    const message = errorParse.success ? errorParse.data.error.message : statusText || "pair failed";

    // Map well-known server `code`s onto {@link PairingRejectionReason}.
    const reason = mapPairingRejectionReason(code, status);

    if (reason !== null) {
      return new PairingRejectedError(message, { reason });
    }

    return new ServerError(`pair request failed: HTTP ${status} ${message}`, {
      status_code: status,
      details: body,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a server-emitted pairing error code (or fallback HTTP status)
 * onto a {@link PairingRejectionReason}, or `null` when the failure
 * is not a pairing rejection (a 500, a gateway timeout, etc.).
 *
 * Source of truth for the `code` strings: the throws inside
 * `PairingManager.handlePairRequest`
 * (`libs/server/src/lib/pairing/manager.ts`) and the `PairingError`
 * helper (`libs/server/src/lib/pairing/errors.ts`).
 */
function mapPairingRejectionReason(
  code: string | undefined,
  status: number,
): PairingRejectionReason | null {
  switch (code) {
    case "PAIRING_REJECTED":
      return "denied";
    case "PAIRING_WINDOW_CLOSED":
    case "PAIRING_TOKEN_ALREADY_CLAIMED":
      return "expired";
    case "PAIRING_CODE_MISMATCH":
    case "INTERNET_PAIRING_NOT_SUPPORTED":
      return "denied";
    case "INVALID_INPUT":
      // 400 with INVALID_INPUT is a client-side bug, not a pairing
      // rejection; let the caller see ServerError so they can fix
      // the request shape.
      return null;
    default:
      break;
  }

  // No structured `code` — fall back to HTTP status. 410 ("Gone")
  // is the conventional "window expired" response.
  if (status === 410) return "expired";
  if (status === 401 || status === 403) return "denied";
  return null;
}

/** Trim a single trailing slash so `${url}/pair` does not produce `//pair`. */
function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Decode a URL-safe base64 string to a UTF-8 JS string.
 *
 * Why a hand-rolled decoder: the SDK runs on Node 18+ AND React
 * Native; `Buffer` is Node-only and `atob` (the browser/RN form)
 * does not handle the URL-safe alphabet (`-` / `_`) or the missing
 * `=` padding. We:
 *
 *   1. Translate `-` → `+` and `_` → `/` to recover standard base64.
 *   2. Re-pad with `=` to a multiple of 4.
 *   3. Decode with `Buffer` when available (faster, native UTF-8
 *      handling); otherwise use `atob` + a manual UTF-8 decoder.
 *
 * The RN path is exercised when the consumer scans a QR with the
 * tablet's camera; the Node path is exercised by tests + MeshCraft.
 */
function decodeBase64UrlToUtf8(input: string): string {
  const standard = input
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded =
    standard.length % 4 === 0
      ? standard
      : standard + "=".repeat(4 - (standard.length % 4));

  // Validate alphabet — `Buffer.from('...', 'base64')` silently drops
  // bad characters, so we check eagerly and surface a clear error.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    throw new Error("input contains characters outside the base64url alphabet");
  }

  const maybeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    return maybeBuffer.from(padded, "base64").toString("utf-8");
  }

  // Browser / RN fallback. `atob` returns a binary string (each char
  // code in [0, 255]); we then UTF-8 decode it via TextDecoder when
  // available, falling back to a simple `decodeURIComponent` trick.
  const atob = (globalThis as { atob?: (s: string) => string }).atob;
  if (typeof atob !== "function") {
    throw new Error("no base64 decoder available (neither Buffer nor atob)");
  }
  const binary = atob(padded);

  const TextDecoderCtor = (globalThis as { TextDecoder?: new (label?: string) => { decode(input: Uint8Array): string } }).TextDecoder;
  if (typeof TextDecoderCtor === "function") {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoderCtor("utf-8").decode(bytes);
  }

  // Last-resort manual UTF-8 decode using the `decodeURIComponent` /
  // `escape` trick. `escape` is deprecated but universally supported
  // and well-defined for this purpose.
  let percent = "";
  for (let i = 0; i < binary.length; i += 1) {
    const c = binary.charCodeAt(i);
    percent += "%" + c.toString(16).padStart(2, "0");
  }
  return decodeURIComponent(percent);
}

/** No-op logger used when the consumer doesn't supply one. */
const NOOP_LOGGER: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
