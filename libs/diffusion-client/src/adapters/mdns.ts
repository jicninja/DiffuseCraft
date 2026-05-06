/**
 * `MdnsAdapter` (F.1, design.md §2 / §12).
 *
 * The pluggable seam through which `client.pairing.discover()` finds
 * DiffuseCraft servers on the LAN. Concrete implementations live in
 * consumer packages so the SDK stays platform-neutral:
 *
 *   - `apps/mobile` (RN/Expo) wraps `react-native-zeroconf` and adapts
 *     each resolve event into a `DiscoveredBackend`.
 *   - MeshCraft (Electron) wraps `bonjour-service` (Node-side mDNS).
 *   - Tests pass an in-memory stub that yields a fixed list of backends.
 *
 * The default service name advertised by `apps/server` is
 * `_diffusecraft._tcp.local` (verified at
 * `libs/server/src/lib/pairing/mdns.ts`); the SDK passes that string by
 * default so adapter implementations only have to translate from their
 * native event shape into {@link DiscoveredBackend}.
 *
 * ## Why a separate file from `config.ts`?
 *
 * `config.ts` already declares an `MdnsAdapter` placeholder typed against
 * `AsyncIterableIterator<unknown>` to keep the Zod schema dependency-free
 * (config-validation cannot type-check a function reference). This file
 * is the *runtime* contract used by the pairing client — the
 * {@link DiscoveredBackend} shape is concrete and the iterable returned
 * by `scan()` carries that exact type. Phase F (`PairingClient.discover`)
 * narrows the config-side `unknown` to {@link MdnsAdapter} before
 * iterating.
 */

/**
 * A DiffuseCraft server discovered via mDNS. Mirrors the slot consumers
 * need to display a "select your server" picker and then pass to
 * `pairing.requestPair(...)`.
 *
 *   - `name`: mDNS service instance name (e.g., the host's chosen
 *     `<serverName>._diffusecraft._tcp.local`). Used as the visible label.
 *   - `ip` / `port`: the resolved network address (IPv4 preferred; the
 *     SDK does not care which family the adapter picks).
 *   - `url`: convenience pre-computed `http://<ip>:<port>` so callers
 *     don't have to assemble it. The pairing client posts to
 *     `${url}/pair` (design §9).
 *   - `server_name`: the server's display name from the TXT record when
 *     the adapter exposed it; surfaced in the UI alongside `name` for
 *     disambiguation when several servers share an instance label.
 */
export interface DiscoveredBackend {
  readonly name: string;
  readonly ip: string;
  readonly port: number;
  readonly url: string;
  readonly server_name?: string;
}

/**
 * Options accepted by {@link MdnsAdapter.scan}.
 *
 *   - `service_name`: mDNS service type to browse. Defaults to the
 *     server's advertised `_diffusecraft._tcp.local` when the SDK calls
 *     the adapter; consumers may override (e.g., tests).
 *   - `timeout_ms`: optional upper bound for the scan. The adapter MAY
 *     stop yielding once elapsed; the SDK ALSO enforces an outer
 *     deadline in {@link PairingClient.discover} to be defensive
 *     against adapters that ignore this hint.
 */
export interface MdnsScanOptions {
  service_name?: string;
  timeout_ms?: number;
}

/**
 * The pluggable mDNS browser. Implementations are typically thin
 * wrappers around a platform library; they MUST yield each discovered
 * backend exactly once for the lifetime of the iterable. Re-yielding
 * the same backend (because the underlying library re-emits) is allowed
 * but not required — the SDK does not deduplicate.
 *
 * `scan()` returns an {@link AsyncIterable} (not just an iterator) so
 * the pairing client can drive it with `for await ... of` and the
 * runtime cleanup hook (`AsyncIterator.return()`) signals the adapter
 * to release its underlying socket. {@link stop} is the imperative
 * fallback when the consumer wants to abort outside the iteration loop
 * (e.g., the user navigated away from the pairing screen).
 */
export interface MdnsAdapter {
  /** Start scanning. Yields backends as they're discovered. */
  scan(opts?: MdnsScanOptions): AsyncIterable<DiscoveredBackend>;
  /** Stop the current scan; idempotent. */
  stop(): void;
}

/**
 * Default mDNS service name advertised by `apps/server`. Source of
 * truth: `libs/server/src/lib/pairing/mdns.ts`. Re-exported so consumers
 * (and the pairing client) can reference the canonical string instead
 * of duplicating it.
 */
export const DEFAULT_MDNS_SERVICE_NAME = "_diffusecraft._tcp.local";
