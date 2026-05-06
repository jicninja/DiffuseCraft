/**
 * LAN-IP enforcement (FR-31, FR-32, design.md §3.10).
 *
 * v1 refuses pair requests from addresses outside private/loopback ranges.
 * Ranges covered:
 *   IPv4: 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8.
 *   IPv6: ::1, fc00::/7 (ULA), fe80::/10 (link-local), and IPv4-mapped IPv6
 *         addresses (::ffff:x.y.z.w) when the embedded IPv4 falls in any of
 *         the IPv4 ranges above.
 *
 * The function is intentionally side-effect free + dep-free so it is trivial
 * to unit test from a tsx runner.
 */

/** True if `ip` is in a private LAN / loopback / link-local range. */
export function isLanIp(ip: string): boolean {
  if (!ip) return false;
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.length === 0) return false;

  // IPv4-mapped IPv6: ::ffff:1.2.3.4
  const mapped = /^::ffff:([0-9.]+)$/.exec(trimmed);
  if (mapped && mapped[1]) {
    return isLanIpv4(mapped[1]);
  }

  if (trimmed.includes(':')) return isLanIpv6(trimmed);
  return isLanIpv4(trimmed);
}

function isLanIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLanIpv6(ip: string): boolean {
  // Loopback ::1
  if (ip === '::1') return true;
  // fe80::/10 link-local
  if (ip.startsWith('fe80:') || ip.startsWith('fe80::')) return true;
  // fc00::/7 unique local addresses (fc.. or fd..)
  if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true;
  return false;
}
