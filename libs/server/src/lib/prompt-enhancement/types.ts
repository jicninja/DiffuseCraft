/**
 * Shared types for the prompt-enhancement module.
 *
 * These types are intentionally narrow extensions of the
 * `enhance_prompt` schema in `@diffusecraft/mcp-tools`; we keep them
 * server-internal so the catalog stays the single source of truth for
 * the wire shape.
 */

import type { z } from 'zod';
import type { enhancePrompt } from '@diffusecraft/mcp-tools';

/** The full validated input as inferred from the catalog schema. */
export type EnhanceInput = z.infer<typeof enhancePrompt.inputSchema>;

/** The full validated output as inferred from the catalog schema. */
export type EnhanceOutput = z.infer<typeof enhancePrompt.outputSchema>;

/** Convenience: the optional `context` sub-block from `EnhanceInput`. */
export type EnhancementContext = NonNullable<EnhanceInput['context']>;

/** Mode discriminator used across the module. */
export type EnhancementMode = EnhanceInput['mode'];

/** Length hint used across the module. */
export type EnhancementTargetLength = EnhanceInput['target_length'];

/**
 * One MCP-sampling message turn. We mirror the (subset of the) MCP spec
 * that we actually rely on; the SDK ships its own richer type which we
 * accept structurally.
 */
export interface SamplingMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

/**
 * Sampling-request payload built per `design.md` §3 step 5. Hosts that
 * provide a `samplingClient` accept this shape; the dispatcher does no
 * vendor-specific massaging.
 */
export interface SamplingRequest {
  messages: SamplingMessage[];
  systemPrompt: string;
  /** Hard cap on agent output tokens (FR-28). */
  maxTokens: number;
  /** Default 0.4 — produces deterministic-ish prompts. Override per call. */
  temperature?: number;
  /**
   * Per `model_preferences` in the MCP spec. Optional: agents pick a
   * model when omitted. We pass through hints when the operator
   * configures them.
   */
  modelPreferences?: {
    hints?: Array<{ name: string }>;
    intelligencePriority?: number;
    speedPriority?: number;
    costPriority?: number;
  };
}

/** Result from a sampling round-trip. */
export interface SamplingResponse {
  /** The agent's plain-text response. */
  text: string;
  /** Optional model id the agent reported using (audit display only). */
  model?: string;
  /** Optional token count reported by the agent. */
  tokens_used?: number;
}

/**
 * A handle that performs sampling against a single agent session. Each
 * mounted transport that supports MCP-sampling provides one instance via
 * the `samplingClient` slot on `HandlerContext`.
 *
 * Tests inject a stub implementation; the production stdio/http
 * transports adapt the `@modelcontextprotocol/sdk`'s
 * `server.createMessage()` API to this contract.
 */
export interface SamplingClient {
  /**
   * Stable, human-readable name of the agent (e.g. token name). Used
   * for the `agent_name` field in the response and as a cache-key
   * dimension (FR-17, Q6).
   */
  readonly agentName: string;
  /** Whether the connected client advertised the `sampling` capability. */
  readonly supportsSampling: boolean;
  /**
   * Perform an MCP sampling round-trip.
   *
   * @throws on timeout, network error, or refusal (the handler maps
   * these to typed `ENHANCEMENT_*` codes).
   */
  request(req: SamplingRequest, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<SamplingResponse>;
}

/** Resolved sampling target chosen by `resolveSamplingTarget`. */
export interface SamplingTarget {
  readonly agentName: string;
  readonly client: SamplingClient;
  /**
   * Where in the priority order the target was found
   * (1 = calling client itself, 2 = configured default, 3 = first
   * available). Used by tests / audit.
   */
  readonly priority: 1 | 2 | 3;
}

/** Cache entry stored by `EnhancementCache`. */
export interface CachedEnhancement {
  enhanced: string;
  language_detected: string;
  agent_name: string;
}
