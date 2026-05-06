/**
 * ULID generation wrapper.
 *
 * Returns Crockford-base32 ULIDs (26 chars, time-sortable). The
 * implementation here is a vendored, dep-free generator so the server
 * library compiles + runs unit tests even when the `ulid` peer dependency
 * is not installed in the workspace (CLAUDE.md: "DO NOT install
 * dependencies"). Hosts that ship the library still benefit from the same
 * format; if a future task wires in the real `ulid` package, this file is
 * the single replacement point.
 */

import * as crypto from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: bigint, length: number): string {
  let out = '';
  let v = value;
  for (let i = 0; i < length; i += 1) {
    const idx = Number(v & 0x1fn);
    out = CROCKFORD[idx] + out;
    v >>= 5n;
  }
  return out;
}

/** Crockford-base32 ULID (26 chars). */
export function newId(): string {
  const time = BigInt(Date.now()); // ms since epoch — fits in 48 bits
  const timePart = encodeBase32(time, 10);
  const randBytes = crypto.randomBytes(10);
  let randValue = 0n;
  for (const b of randBytes) randValue = (randValue << 8n) | BigInt(b);
  const randPart = encodeBase32(randValue, 16);
  return timePart + randPart;
}

export function newRequestId(): string {
  return `req_${newId()}`;
}
