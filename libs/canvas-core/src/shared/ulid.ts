/**
 * Tiny ULID generator (zero dependencies).
 *
 * ULIDs are 26-character Crockford base32 strings: a 48-bit timestamp
 * (milliseconds since epoch) followed by 80 bits of randomness. They are
 * lexicographically sortable by creation time and URL-safe.
 *
 * The mcp-tools `Ulid` schema validates the output of this generator, so
 * canvas-core can mint ids without taking a runtime dependency on the
 * `ulid` npm package.
 */

/** Crockford base32 alphabet — excludes I, L, O, U for human-readability. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIMESTAMP_LEN = 10;
const RANDOM_LEN = 16;

/** Encode `n` as `len` base32 characters (Crockford). */
const encodeBase32 = (input: number, len: number): string => {
  let n = input;
  let out = '';
  for (let i = 0; i < len; i++) {
    const mod = n % 32;
    out = ENCODING[mod] + out;
    n = Math.floor(n / 32);
  }
  return out;
};

/** Random number in [0, 32). Uses crypto if available, Math.random fallback. */
const randomChar = (): string => {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const arr = new Uint8Array(1);
    globalThis.crypto.getRandomValues(arr);
    // Reduce to 5 bits.
    const value = arr[0]! & 0x1f;
    return ENCODING[value]!;
  }
  return ENCODING[Math.floor(Math.random() * 32)]!;
};

/**
 * Generate a fresh ULID. Optional `now` override is for deterministic tests.
 *
 * @example
 * ```ts
 * const id = ulid();           // "01HZK2X9VTVM7E9WX0H4QF6P5N"
 * const id2 = ulid(0);         // timestamp portion all zeros
 * ```
 */
export const ulid = (now: number = Date.now()): string => {
  const ts = encodeBase32(now, TIMESTAMP_LEN);
  let rand = '';
  for (let i = 0; i < RANDOM_LEN; i++) rand += randomChar();
  return ts + rand;
};
