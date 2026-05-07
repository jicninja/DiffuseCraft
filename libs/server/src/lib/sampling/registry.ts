/**
 * Server-side sampling-client registry (prompt-enhancement FR-10/FR-11,
 * design.md §6).
 *
 * Each MCP transport registers a {@link SamplingClient} here when an
 * external agent (Claude Code, Claude Desktop, OpenAI Codex, Gemini CLI,
 * …) connects with the `sampling: {}` capability declared in its
 * `initialize` payload. The `enhance_prompt` handler reads the registry
 * via {@link resolveSamplingTarget} to pick a target.
 *
 * Lookup is by token name (audit display name) so the configured-default
 * agent path (`config.sampling.default_agent_token_name`) works without
 * the registry knowing about token ids. Iteration order is registration
 * order — first-paired agent wins the "first available" fallback.
 */

import type { SamplingClient } from '../prompt-enhancement/types.js';
import type { SamplingClientRegistry } from '../prompt-enhancement/sampling-target-resolver.js';

export class InMemorySamplingRegistry implements SamplingClientRegistry {
  /** Insertion-ordered map keyed by token name. */
  private readonly byName = new Map<string, SamplingClient>();

  /**
   * Register a sampling-capable client. Replaces any previous entry
   * under the same token name (paired agent reconnecting under the
   * same identity). Returns an unregister callback that the caller
   * (transport) invokes when the connection drops.
   */
  add(client: SamplingClient): () => void {
    this.byName.set(client.agentName, client);
    return () => {
      const current = this.byName.get(client.agentName);
      if (current === client) this.byName.delete(client.agentName);
    };
  }

  findByTokenName(name: string): SamplingClient | null {
    return this.byName.get(name) ?? null;
  }

  active(): Iterable<SamplingClient> {
    return this.byName.values();
  }

  /** Drop every registration. Called on server.stop() so a restart starts clean. */
  clear(): void {
    this.byName.clear();
  }

  /** Live count for diagnostics. */
  size(): number {
    return this.byName.size;
  }
}
