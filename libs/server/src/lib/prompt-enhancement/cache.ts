/**
 * In-memory enhancement cache (design.md §8, FR-17, FR-18).
 *
 * Keyed on `(input, mode, target_length, style_hint, context_hash, agent_name)`
 * per Q6/FR-17 — same input from different agents lives in separate
 * entries because the rewrites differ across vendors.
 *
 * TTL is 5 minutes (FR-17). Entries past TTL are dropped lazily on read;
 * a background sweep is unnecessary given the small expected size
 * (≤ ~100 entries per session).
 */

import * as crypto from 'node:crypto';
import type { CachedEnhancement, EnhanceInput, EnhancementContext } from './types.js';

export const ENHANCEMENT_CACHE_TTL_MS = 5 * 60 * 1_000;

interface Entry {
  result: CachedEnhancement;
  expires_at: number;
}

export class EnhancementCache {
  private readonly map = new Map<string, Entry>();
  private readonly ttl_ms: number;

  constructor(ttl_ms: number = ENHANCEMENT_CACHE_TTL_MS) {
    this.ttl_ms = ttl_ms;
  }

  get(key: string): CachedEnhancement | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expires_at) {
      this.map.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(key: string, result: CachedEnhancement): void {
    this.map.set(key, { result, expires_at: Date.now() + this.ttl_ms });
  }

  /** Remove every entry. Used by tests and on token revocation. */
  clear(): void {
    this.map.clear();
  }

  /** Approximate number of cached entries (counts expired-but-not-swept too). */
  size(): number {
    return this.map.size;
  }
}

/**
 * Compute the cache key for a given enhancement request. The key is a
 * SHA-256 of a canonicalized JSON payload — order-stable, length-bounded,
 * cheap to compute (~10 µs on a modern host).
 */
export function computeCacheKey(
  input: EnhanceInput,
  context: EnhancementContext | undefined,
  agent_name: string,
  target_model?: string,
): string {
  const ctx_hash = context ? sha256Hex(stableStringify(context)) : '<none>';
  return sha256Hex(
    stableStringify({
      input: input.input,
      mode: input.mode,
      target_length: input.target_length,
      style_hint: input.style_hint ?? null,
      target_model: target_model ?? input.target_model ?? null,
      context_hash: ctx_hash,
      agent_name,
    }),
  );
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Deterministic JSON serialization with sorted keys, depth-first. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
