/**
 * Capability-aware response shaping (D.11).
 *
 * The transport layer stamps the negotiated client capabilities onto
 * `ctx.scratch.client_capabilities`. After the handler executes, this
 * middleware adapts the response (inline vs. ref blob, png vs webp) before
 * the value is returned to the transport.
 *
 * v1 implementation is a pass-through; the deeper logic (image format
 * conversion, blob ref substitution) lands when capability negotiation is
 * wired end-to-end.
 *
 * TODO(server-architecture): implement format adaptation once E.4 ships.
 */

import type { Middleware } from './chain.js';

export const capabilityShapeMw: Middleware = async (_args, ctx, next) => {
  const out = await next();
  const reshaped = ctx.scratch['output'] ?? out;
  // Pass through; future passes will read ctx.scratch.client_capabilities.
  return reshaped;
};
