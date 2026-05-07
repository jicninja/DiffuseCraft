// Tiny wrapper around `react-native-zeroconf` that translates raw resolve
// events into the `DiscoveredBackend` shape the connection store + the
// pairing screens consume.
//
// The library follows an event-emitter API:
//
//   const z = new Zeroconf();
//   z.scan('diffusecraft', 'tcp', 'local.');
//   z.on('resolved', (svc) => /* { name, host, port, addresses, txt } */);
//   z.on('error', (err) => ...);
//   z.stop();
//
// We expose a small `useMdnsScan()` hook that mounts/unmounts a single
// scanner, deduplicates by service name, and flushes results into the
// connection store's `discoveredBackends` slot. Adding `requestPair` is
// up to the caller.
//
// Note: the lib expects multicast lock acquisition on Android. The
// Zeroconf constructor handles that internally on RN 0.83 + the
// 0.13.x release line.

import { useEffect } from 'react';

import { useConnectionStore, type DiscoveredBackend } from '@diffusecraft/core';

interface RawZeroconfService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

/**
 * Pick the most useful host string out of a Zeroconf resolve event:
 *
 *   1. Any IPv4 address from `addresses` (most reliable — RN's fetch can
 *      always dial these without hitting iOS link-local resolution
 *      quirks).
 *   2. The first IPv6 address.
 *   3. The `host` field as published in the SRV record (typically
 *      `something.local`); HTTP can usually resolve this on macOS but
 *      iOS sometimes fails on `.local` resolution unless the device is
 *      on the same Wi-Fi network as the announcer.
 */
function pickHost(svc: RawZeroconfService): string | null {
  const addrs = svc.addresses ?? [];
  const ipv4 = addrs.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (ipv4) return ipv4;
  if (addrs.length > 0) return addrs[0]!;
  if (svc.host && svc.host.length > 0) return svc.host;
  return null;
}

function rawToDiscovered(svc: RawZeroconfService): DiscoveredBackend | null {
  const host = pickHost(svc);
  if (!host) return null;
  if (!svc.port || svc.port <= 0) return null;
  const id = `${svc.name}.${svc.port}`;
  // The TXT record carries `sn=<server_name>` and `v=<protocol_version>`
  // (libs/server/src/lib/pairing/mdns.ts buildTxt).
  const txt = svc.txt ?? {};
  return {
    id,
    name: txt.sn || svc.name,
    host,
    port: svc.port,
    version: txt.v ?? null,
  };
}

interface ZeroconfApi {
  scan(type: string, protocol: string, domain: string): void;
  stop(): void;
  removeDeviceListeners?: () => void;
  on(event: string, listener: (svc: RawZeroconfService) => void): void;
}

let cached: ZeroconfApi | null | undefined;

/**
 * Lazily require `react-native-zeroconf`. We don't `import` at top-level
 * because the package is a community native module — environments where
 * it's not linked (Metro web bundles, Jest unit runs) crash on import.
 * Returning `null` lets the caller gracefully skip discovery.
 */
function loadZeroconf(): ZeroconfApi | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-zeroconf') as
      | { default: new () => ZeroconfApi }
      | (new () => ZeroconfApi);
    const Ctor = (mod as { default?: new () => ZeroconfApi }).default ??
      (mod as new () => ZeroconfApi);
    cached = new Ctor();
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Start an mDNS scan for `_diffusecraft._tcp.local` and write resolved
 * services into the connection store's `discoveredBackends` slot. The
 * caller's component lifecycle owns scan start/stop via `useEffect`.
 *
 * Returns `{ available }` so the screen can show a "discovery
 * unavailable" hint when the native module is missing (Metro web).
 */
export function useMdnsScan(): { available: boolean } {
  const setDiscoveredBackends = useConnectionStore((s) => s.setDiscoveredBackends);

  useEffect(() => {
    const z = loadZeroconf();
    if (!z) return;

    const seen = new Map<string, DiscoveredBackend>();

    const onResolved = (svc: RawZeroconfService) => {
      const entry = rawToDiscovered(svc);
      if (!entry) return;
      seen.set(entry.id, entry);
      setDiscoveredBackends(Array.from(seen.values()));
    };

    z.on('resolved', onResolved);
    try {
      z.scan('diffusecraft', 'tcp', 'local.');
    } catch {
      /* swallow — scan is a no-op on unsupported platforms */
    }

    return () => {
      try {
        z.stop();
      } catch {
        /* swallow */
      }
      try {
        z.removeDeviceListeners?.();
      } catch {
        /* swallow */
      }
      // Clear the discovered list on unmount so two paired devices in
      // sequence don't render stale entries from an earlier session.
      setDiscoveredBackends([]);
    };
  }, [setDiscoveredBackends]);

  return { available: loadZeroconf() !== null };
}
