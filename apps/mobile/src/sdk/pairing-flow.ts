// Shared helpers for the four pairing entry points (QR / mDNS / code /
// manual). Each screen calls into these to:
//
//   - derive a stable backend id + display name from a server-issued payload,
//   - persist the paired backend + token through `useConnectionStore`,
//   - flip the active backend, surface a success toast, and route home.
//
// The screens own the UX (camera, keypad, list, paste field); these helpers
// own the bit between "we have a token" and "the editor can dial the server".

import { router } from 'expo-router';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';

import type { ConnectionState } from '@diffusecraft/core';
import { toast } from '@diffusecraft/ui';

const DEVICE_NAME_KEY = 'diffusecraft.device.name';
const DEVICE_FINGERPRINT_KEY = 'diffusecraft.device.fingerprint';

/**
 * Persisted user-chosen device name shown to servers in the pairing-request
 * hook. Falls back to `expo-application`'s `applicationName` (e.g. "DiffuseCraft")
 * when the user has not set one yet.
 */
export async function getDeviceName(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_NAME_KEY);
    if (stored && stored.length > 0) return stored;
  } catch {
    /* fall through */
  }
  return Application.applicationName ?? 'DiffuseCraft tablet';
}

export async function setDeviceName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  await SecureStore.setItemAsync(DEVICE_NAME_KEY, trimmed);
}

/**
 * Stable device fingerprint shown in Settings.Connection. We do not rely on
 * any platform identifier (most are now privacy-restricted). Instead we
 * generate a 32-byte random value once, persist it in SecureStore, and
 * format it as a `SHA256:` group of hex pairs so the UI can render the
 * existing `SHA256: 7ZqL ...` placeholder shape without changes.
 */
export async function getDeviceFingerprint(): Promise<string> {
  let raw = await SecureStore.getItemAsync(DEVICE_FINGERPRINT_KEY);
  if (!raw || raw.length === 0) {
    const Crypto = await import('expo-crypto');
    const bytes = await Crypto.getRandomBytesAsync(16);
    raw = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DEVICE_FINGERPRINT_KEY, raw);
  }
  // Display as 8 groups of 4 hex chars, prefixed with `SHA256:` to match the
  // pre-existing placeholder. The value is opaque; the prefix is cosmetic.
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
  return `SHA256:${groups.join(' ')}`;
}

/**
 * Derive a stable backend id from a server-issued payload. The id needs to
 * be:
 *   - storage-key-safe (it is part of the secure-store key path),
 *   - stable across re-pairing the same server (so the user does not end
 *     up with two entries pointing at the same machine),
 *   - distinct between two servers on the same LAN.
 *
 * `token_id` (when the server provides it, as it does in QR payloads) is
 * the strongest signal — it points at the per-token row in the server's
 * DB. Falling back to a slugged URL covers the manual / mDNS flows where
 * we don't have a token id yet.
 */
export function backendIdFor(args: {
  origin: 'qr' | 'mdns' | 'manual' | 'code';
  url: string;
  tokenId?: string;
}): string {
  if (args.tokenId && args.tokenId.length > 0) {
    return `${args.origin}-${args.tokenId.replace(/[^a-z0-9]/gi, '_').slice(0, 64)}`;
  }
  const slug = args.url.replace(/[^a-z0-9]/gi, '_').slice(0, 64);
  return `${args.origin}-${slug}`;
}

export interface PairResultLike {
  url: string;
  token: string;
  /** Optional friendly name (QR + mDNS payloads carry it; manual does not). */
  serverName?: string;
  /** Optional server-issued token id; only the QR payload carries this. */
  tokenId?: string;
}

/**
 * Persist a paired-backend record + raw token, set it as the active
 * backend, surface a success toast, and route the user back to the
 * editor. The four screens differ only in how they obtain `result`.
 */
export async function completePairing(
  pair: Pick<ConnectionState, 'pairBackend' | 'setCurrentBackend'>,
  origin: 'qr' | 'mdns' | 'manual' | 'code',
  result: PairResultLike,
): Promise<void> {
  let displayName: string;
  if (result.serverName && result.serverName.length > 0) {
    displayName = result.serverName;
  } else {
    try {
      displayName = new URL(result.url).host;
    } catch {
      displayName = result.url;
    }
  }
  const id = backendIdFor({ origin, url: result.url, tokenId: result.tokenId });

  await pair.pairBackend(
    { id, name: displayName, origin, url: result.url },
    result.token,
  );
  pair.setCurrentBackend(id);

  toast.info(`Paired with ${displayName}`);
  router.replace('/');
}
