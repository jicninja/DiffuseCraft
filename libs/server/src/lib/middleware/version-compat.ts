/**
 * Version compatibility middleware (D.6).
 *
 * Rejects calls when the tool's `since` is greater than the negotiated
 * catalog version. The negotiated version arrives via `ctx.scratch.catalog_version`
 * (set during MCP handshake by the transport).
 */

import type { Middleware } from './chain.js';
import { UnsupportedCatalogVersionError } from '../../types/errors.js';

export interface VersionCompatLookup {
  /** Returns the tool's `since` semver, or null when the tool isn't catalogued. */
  getToolSince(toolName: string): string | null;
}

export function createVersionCompatMw(lookup: VersionCompatLookup, fallbackNegotiated: string): Middleware {
  return async (_args, ctx, next) => {
    const since = lookup.getToolSince(ctx.tool_name);
    if (!since) return next();
    const negotiated = (ctx.scratch['catalog_version'] as string | undefined) ?? fallbackNegotiated;
    if (semverGt(since, negotiated)) throw new UnsupportedCatalogVersionError(since, negotiated);
    return next();
  };
}

function semverGt(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

function parts(v: string): number[] {
  return v.split('.').map((p) => Number.parseInt(p, 10) || 0);
}
