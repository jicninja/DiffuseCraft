/**
 * Pairing client public types (design.md §2 / §9, FR-22…FR-25).
 *
 * Re-exports the discovery shape from `adapters/mdns.ts` so consumers
 * can `import { DiscoveredBackend } from "@diffusecraft/diffusion-client"`
 * without reaching into the adapter module, and declares the parsed
 * shapes returned by {@link PairingClient.parseQr} / `parseManual`.
 *
 * ## Wire-format alignment
 *
 * The QR payload shape mirrors `libs/server/src/lib/pairing/payloads.ts`
 * (`QrPayload`) verbatim — see {@link QrPayload} below. The pairing
 * client decodes the URL-safe base64 wrapper that `buildQrPayload`
 * applies on the server, then validates the inner JSON with the Zod
 * schema declared in {@link client.ts}. Adding a field to the server's
 * `QrPayload` requires a coordinated bump here (the schema rejects
 * unknown shapes today; we'll widen it via `.passthrough()` once the
 * server's `v` field actually starts versioning the payload).
 *
 * The manual-paste line follows the format `apps/server` prints on
 * boot (also from `payloads.ts`): `http://<ip>:<port>/?t=<token>`.
 * `parseManual` returns the cleaned base URL (without the `?t=` query
 * tail) plus the extracted token.
 */

import type { DiscoveredBackend } from "../adapters/mdns";

export type { DiscoveredBackend };

/**
 * Decoded QR payload (design §9, FR-24).
 *
 * The server emits this object as URL-safe base64-encoded JSON
 * (`Buffer.from(JSON.stringify(payload)).toString('base64url')`). The
 * pairing client reverses both layers and validates the inner JSON
 * with Zod before returning it to the consumer. Field-by-field:
 *
 *   - `v`: payload version. Currently always `1`; the schema rejects
 *     anything else so old clients fail loudly when the server bumps
 *     the format.
 *   - `url`: pre-assembled `http://<ip>:<port>` of the server's HTTP
 *     transport. Convenience — `ip + port` always derive the same
 *     value.
 *   - `ip` / `port`: HTTP transport binding. Surfaced as a separate
 *     field so the consumer can show the IP in the UI without
 *     re-parsing `url`.
 *   - `token` / `token_id`: pre-issued pairing token (cleartext) and
 *     its server-side row id. The server pre-issues these when it
 *     opens a `qr` window (`PairingManager.openWindow`) and the
 *     candidate claims the token by POSTing to `/pair`. FR-24 says
 *     the QR carries the token, so the SDK can connect directly
 *     without the `/pair` round trip — but `requestPair()` is still
 *     needed when the consumer wants the host-approval hook to fire,
 *     so both paths are valid.
 *   - `server_name`: display name of the server (e.g., "Cathedral
 *     Studio"). Used in the UI confirmation step.
 *   - `issued_at` / `expires_at`: ISO-8601 timestamps. The pairing
 *     client surfaces them so the consumer can show "expires in N
 *     seconds" feedback.
 */
export interface QrPayload {
  readonly v: 1;
  readonly url: string;
  readonly ip: string;
  readonly port: number;
  readonly token: string;
  readonly token_id: string;
  readonly server_name: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

/**
 * Decoded manual-paste line (design §9, FR-25).
 *
 * The server prints `http://<ip>:<port>/?t=<encodedToken>` on boot
 * when the operator opens a `manual` pairing window. The pairing
 * client strips the `?t=` query and returns the cleaned base URL plus
 * the decoded token, so the consumer can hand `{ url, token }` to
 * `createDiffuseCraftClient({ transport: { kind: 'http', url, token }})`.
 */
export interface ManualPayload {
  readonly url: string;
  readonly token: string;
}

/**
 * Successful response from `POST /pair` (design §9, FR-23).
 *
 * Server-side source of truth: `PairingManager.handlePairRequest` →
 * `PairResponse` (`libs/server/src/lib/pairing/manager.ts`). The
 * server wraps it as `{ ok: true, result: PairResponse }`; the
 * pairing client unwraps `result` before returning. Fields the SDK
 * surfaces back to the consumer:
 *
 *   - `token`: cleartext bearer token (FR-18 — surfaced once, then
 *     stored via the consumer's `SecureStoreAdapter`).
 *   - `server_name`: human-readable server label, suitable for the
 *     UI's "Paired with <Name>" toast.
 *
 * `token_id`, `token_name`, and `catalog_version` are also returned
 * by the server but the SDK does not surface them today — they're
 * reserved for the connection store (Phase K) which will persist the
 * triple alongside the token.
 */
export interface PairResult {
  readonly token: string;
  readonly server_name: string;
}

/**
 * Options accepted by {@link PairingClient.requestPair}.
 *
 *   - `candidate_name`: human-readable label sent to the server's
 *     pairing-request hook so the host sees who is asking. Defaults
 *     to "Unknown device" when omitted; consumers should pass a
 *     meaningful value (the device's hostname, the user's chosen
 *     nickname).
 *   - `method`: how the candidate found this server. The server's
 *     `findOpenWindowForRequest` matches the open window's `mode`
 *     against this value, so the SDK forwards it verbatim. `mdns` is
 *     the default; QR / code / manual paths are reserved for future
 *     SDK helpers (the manual flow today does not need `requestPair`
 *     because the URL already carries a valid token).
 *   - `signal`: standard `AbortSignal` to cancel the in-flight
 *     `fetch`. The SDK forwards it to `fetch(...)` and re-throws the
 *     resulting `AbortError` verbatim — consumers pattern-match on
 *     `err.name === 'AbortError'`.
 */
export interface RequestPairOptions {
  candidate_name?: string;
  method?: "mdns" | "qr" | "code" | "manual";
  /**
   * 6-digit numeric code shown on the server's pairing screen. Required
   * when `method === "code"` (the server's `/pair` route validates it
   * against open windows). Ignored for other methods.
   */
  code?: string;
  signal?: AbortSignal;
}

/**
 * Options accepted by {@link PairingClient.discover}.
 *
 *   - `timeout_ms`: outer deadline. When elapsed, the SDK calls
 *     `AsyncIterator.return()` on the adapter's iterator (which the
 *     adapter SHOULD interpret as "release sockets") and the
 *     `for-await` loop terminates cleanly.
 */
export interface DiscoverOptions {
  timeout_ms?: number;
}
