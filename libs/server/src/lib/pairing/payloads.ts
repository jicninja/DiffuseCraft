/**
 * Payload builders for QR / numeric-code / manual URL pairing modes (B.5,
 * B.6, design.md §2.3, §2.4, §2.5; FR-13, FR-14, FR-15).
 *
 * The QR payload is base64-encoded JSON to keep alphanumeric QR mode usable
 * (FR-13). The base64 alphabet is URL-safe so a single payload can be
 * embedded as a raw string in either a QR or a deep-link.
 */

export interface QrPayload {
  v: 1;
  url: string;
  ip: string;
  port: number;
  token: string;
  token_id: string;
  server_name: string;
  issued_at: string;
  expires_at: string;
}

/** Build a QR payload string (URL-safe base64 of canonical JSON). */
export function buildQrPayload(args: QrPayload): string {
  const json = JSON.stringify(args);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode a QR payload back to its structured form (used by tests + clients). */
export function decodeQrPayload(encoded: string): QrPayload {
  const json = Buffer.from(encoded, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as QrPayload;
  if (parsed.v !== 1) throw new Error(`unsupported QR payload version: ${String(parsed.v)}`);
  return parsed;
}

/**
 * Build the `http://<ip>:<port>?t=<token>` URL emitted on the server log
 * (FR-15). The token is URL-encoded for safety even though it lives in our
 * controlled alphabet.
 */
export function buildManualUrl(args: { ip: string; port: number; token: string }): string {
  return `http://${args.ip}:${args.port}/?t=${encodeURIComponent(args.token)}`;
}

/** Format a 6-digit numeric code as `123-456` for display (FR-14). */
export function formatNumericCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** Strip non-digits from a user-input numeric code; returns up to 6 digits. */
export function normalizeNumericCode(input: string): string {
  return input.replace(/\D+/g, '').slice(0, 6);
}
