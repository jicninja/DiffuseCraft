/**
 * Adapter that wraps an MCP SDK `Server` instance into our internal
 * {@link SamplingClient} contract (prompt-enhancement/types.ts).
 *
 * Each connected MCP session whose client declared `sampling: {}` in its
 * `initialize` capabilities gets one of these. The handler calls
 * `client.request(req)` which marshals the catalog-shaped
 * {@link SamplingRequest} into the SDK's `createMessage` parameters,
 * awaits the round-trip, and returns the agent's text response.
 *
 * Keeping the SDK type out of `prompt-enhancement` is deliberate — the
 * handler is unit-tested with a stub `SamplingClient`, and only this
 * adapter takes the runtime dependency on `@modelcontextprotocol/sdk`.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import type {
  SamplingClient,
  SamplingRequest,
  SamplingResponse,
} from '../prompt-enhancement/types.js';

export interface SdkSamplingClientArgs {
  /** The MCP `Server` bound to a single agent session. */
  server: Server;
  /** Audit-display name (the paired token's name, or `_stdio` for stdio). */
  agentName: string;
  /** Whether the connected client declared `sampling: {}` capabilities. */
  supportsSampling: boolean;
}

/**
 * Create a `SamplingClient` that forwards to the SDK server's
 * `createMessage` API. The MCP wire response is a single-content-block
 * `CreateMessageResult`; we extract the text and surface model/usage
 * fields when the agent reports them.
 */
export function createSdkSamplingClient(args: SdkSamplingClientArgs): SamplingClient {
  return {
    agentName: args.agentName,
    supportsSampling: args.supportsSampling,
    async request(req: SamplingRequest, opts): Promise<SamplingResponse> {
      const params = {
        messages: req.messages.map((m) => ({
          role: m.role,
          content: { type: 'text' as const, text: m.content.text },
        })),
        systemPrompt: req.systemPrompt,
        maxTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.modelPreferences ? { modelPreferences: req.modelPreferences } : {}),
      };
      const requestOptions: { signal?: AbortSignal; timeout?: number } = {};
      if (opts?.signal) requestOptions.signal = opts.signal;
      if (opts?.timeoutMs && opts.timeoutMs > 0) requestOptions.timeout = opts.timeoutMs;
      const result = await args.server.createMessage(params, requestOptions);
      const text = extractText(result);
      const out: SamplingResponse = { text };
      const r = result as { model?: string; usage?: { totalTokens?: number } };
      if (typeof r.model === 'string') out.model = r.model;
      if (typeof r.usage?.totalTokens === 'number') out.tokens_used = r.usage.totalTokens;
      return out;
    },
  };
}

/**
 * Extract the plain-text portion of a `CreateMessageResult`. The MCP
 * spec allows a single content block (text/image) or — under the
 * tool-bearing variant — an array. We accept both shapes and stitch
 * text content together; non-text blocks are dropped (the enhancer is a
 * text-only flow).
 */
function extractText(result: unknown): string {
  const r = result as { content?: unknown };
  const content = r.content;
  if (!content) return '';
  const blocks = Array.isArray(content) ? content : [content];
  let out = '';
  for (const block of blocks) {
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') {
      out += (out ? '\n' : '') + b.text;
    }
  }
  return out;
}
