/**
 * Boot-time conformance: walk a `CatalogManifest` and verify every tool has a
 * registered handler. Build / start fails when a catalogued tool has no
 * handler (FR-19, D.12).
 *
 * The default catalog comes from `@diffusecraft/mcp-tools`; hosts may pass an
 * alternate manifest via `createDiffuseCraftServer({}, { catalog })` for
 * tests or partial deployments.
 */

import { catalog as mcpCatalog } from '@diffusecraft/mcp-tools';
import type { CatalogManifest, ToolDefinition } from './types.js';

/** Default catalog: the canonical manifest from `@diffusecraft/mcp-tools`. */
export const DEFAULT_CATALOG: CatalogManifest = mcpCatalog as CatalogManifest;

/**
 * Sentinel empty manifest. Useful for test harnesses that want to register
 * exactly the tools under test and nothing else.
 */
export const EMPTY_CATALOG: CatalogManifest = {
  version: mcpCatalog.version,
  tools: [],
  resources: [],
  events: [],
  prompts: [],
};

export interface HandlerRegistry {
  has(toolName: string): boolean;
  list(): readonly string[];
}

export class CatalogConformanceError extends Error {
  public readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`catalog conformance failed; missing handlers: ${missing.join(', ')}`);
    this.name = 'CatalogConformanceError';
    this.missing = missing;
  }
}

export interface ConformanceOptions {
  /**
   * When `true`, every catalogued tool MUST have a registered handler or
   * boot fails with `CatalogConformanceError` (the FR-19 / D.12 contract).
   *
   * When `false` (skeleton default during server-architecture v1), missing
   * handlers are surfaced via the `onMissing` callback and boot continues.
   * Per-feature specs register handlers incrementally; once every spec
   * lands, hosts can flip this flag.
   */
  strict?: boolean;
  /** Invoked once with the missing-handler list when not strict. */
  onMissing?: (missing: readonly string[]) => void;
}

/**
 * Walk `manifest.tools`; in strict mode, throw if any tool has no registered
 * handler. In lenient mode (default during the skeleton phase), report the
 * missing list via `onMissing` and let boot continue.
 */
export function assertCatalogConformance(
  manifest: CatalogManifest,
  registry: HandlerRegistry,
  opts: ConformanceOptions = {},
): void {
  const missing = manifest.tools.filter((t: ToolDefinition) => !registry.has(t.name)).map((t) => t.name);
  if (missing.length === 0) return;
  if (opts.strict) throw new CatalogConformanceError(missing);
  opts.onMissing?.(missing);
}
