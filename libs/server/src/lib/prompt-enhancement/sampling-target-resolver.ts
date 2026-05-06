/**
 * Sampling target resolver (design.md §6, FR-10).
 *
 * Priority order:
 *   1. Calling client itself, if it advertised the `sampling` capability.
 *   2. Configured default agent, looked up by token name.
 *   3. First active sampling-capable session in the registry.
 *   4. None — handler returns `SAMPLING_NOT_SUPPORTED`.
 *
 * The resolver depends on a `SamplingClientRegistry` populated at
 * handshake time by each transport (FR-B.2). The registry interface is
 * deliberately small so tests can pass a stub map without standing up
 * the full transport set.
 */

import type { HandlerContext } from '../../types/handler-context.js';
import type { SamplingClient, SamplingTarget } from './types.js';

export interface SamplingClientRegistry {
  /** Lookup by token name (audit display name). */
  findByTokenName(name: string): SamplingClient | null;
  /** Iterate all currently-active sampling-capable clients. */
  active(): Iterable<SamplingClient>;
}

export interface ResolveOptions {
  /** Configured default agent token name (FR-B.3). */
  default_agent_token_name?: string | undefined;
  /** Active-session registry. Optional — when absent, only the calling client is consulted. */
  registry?: SamplingClientRegistry | undefined;
}

/**
 * Pick a sampling target for the current handler invocation. Returns
 * `null` when no candidate is available (handler maps to
 * `SAMPLING_NOT_SUPPORTED`).
 */
export function resolveSamplingTarget(
  ctx: HandlerContext,
  opts: ResolveOptions = {},
): SamplingTarget | null {
  // 1. Calling client.
  const calling = ctx.samplingClient as SamplingClient | undefined;
  if (calling && calling.supportsSampling) {
    return { agentName: calling.agentName, client: calling, priority: 1 };
  }

  // 2. Configured default.
  if (opts.default_agent_token_name && opts.registry) {
    const found = opts.registry.findByTokenName(opts.default_agent_token_name);
    if (found && found.supportsSampling) {
      return { agentName: found.agentName, client: found, priority: 2 };
    }
  }

  // 3. First available.
  if (opts.registry) {
    for (const client of opts.registry.active()) {
      if (client.supportsSampling) {
        return { agentName: client.agentName, client, priority: 3 };
      }
    }
  }

  return null;
}
