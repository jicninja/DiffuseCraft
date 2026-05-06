/**
 * `SamplingForwarder` (Phase I.1, design.md §10.1).
 *
 * Bridges the SDK's transport-level sampling channel
 * ({@link Transport.sampling.register}) to a single consumer-supplied
 * handler registered via `client.sampling.onSample(handler)`. The
 * forwarder is the canonical mechanism by which the server delegates
 * LLM/VLM-class reasoning back to the calling client (the SDK) so
 * sampling-driven features (`enhance_prompt`, `select_by_prompt`,
 * `send_chat_message`) can run against a paired agent.
 *
 * Lifecycle (per design.md §10.2):
 *
 *   1. **Construction:** the {@link DiffuseCraftClient} instantiates one
 *      `SamplingForwarder` per session and immediately registers a
 *      transport-level handler that delegates to the consumer slot.
 *      The transport invokes that handler whenever the server initiates
 *      a `sampling/createMessage` request over the channel.
 *   2. **Consumer registration:** the consumer (an agent like Claude
 *      Code, or `apps/mobile` if it routes to a paired LLM) calls
 *      `client.sampling.onSample(handler)` which sets the slot. Calling
 *      again replaces the slot; calling the returned unsubscribe
 *      function clears it.
 *   3. **Server-initiated sampling:** the transport calls into the
 *      forwarder, which forwards to the consumer handler. If no handler
 *      is registered the forwarder throws {@link SamplingNotSupportedError}
 *      — design.md §10.4 fallback for "no handler registered".
 *   4. **Disposal:** {@link SamplingForwarder.dispose} unregisters the
 *      transport-level handler and clears the consumer slot. The
 *      {@link DiffuseCraftClient} calls this from its own `dispose()` so
 *      no stale references survive teardown.
 *
 * Single-handler semantics match design.md §10.2 ("the SDK creates one
 * `SamplingForwarder` per `DiffuseCraftClient` instance"): only one
 * consumer can be registered at a time. Re-registering replaces;
 * unregistering only clears the slot when the supplied handler still
 * matches (so a stale unsubscribe from a previous registration cannot
 * accidentally clear a freshly attached handler).
 */

import { SamplingNotSupportedError } from "../errors";
import type {
  Transport,
  TransportSamplingRequest,
  TransportSamplingResponse,
} from "../transports/transport";

/**
 * Consumer-facing sampling handler signature surfaced via
 * `client.sampling.onSample(handler)`. The `request` parameter is the
 * raw MCP `sampling/createMessage` params payload (typed `unknown` at
 * the transport boundary per design.md §10.1 — the canonical
 * {@link import("@diffusecraft/mcp-tools").ImageEnvelope}-bearing
 * `SamplingRequest` shape is documented in the design but the SDK keeps
 * the boundary opaque so future MCP-spec changes do not require a
 * forwarder-level type bump).
 *
 * The handler returns the MCP `CreateMessageResult` shape (the
 * `SamplingResponse` in design.md §10.1). The MCP SDK's transport layer
 * validates the returned shape before serialising it back to the
 * server.
 */
export type SamplingHandler = (
  request: TransportSamplingRequest,
) => Promise<TransportSamplingResponse>;

/**
 * Forwarder bridging the transport's sampling channel to a single
 * consumer-registered handler. Constructed once per
 * {@link DiffuseCraftClient} session and disposed when the client is
 * torn down.
 */
export class SamplingForwarder {
  /**
   * Currently-registered consumer handler. `null` when no consumer has
   * called {@link onSample} yet (design.md §10.2 step 1: "Initially no
   * handler registered"). The transport-level forwarding stub installed
   * in the constructor reads this slot on every server-initiated
   * sampling request.
   */
  private handler: SamplingHandler | null = null;

  /**
   * Teardown for the transport-level registration installed in the
   * constructor. Called from {@link dispose} so the transport does not
   * hold a reference to this forwarder after the SDK session ends.
   * Cleared once disposed so a double-dispose is a no-op.
   */
  private unregister: (() => void) | null = null;

  constructor(private readonly transport: Transport) {
    // Install a single transport-level handler at construction time so
    // server-initiated sampling requests reach the forwarder even when
    // the consumer has not registered yet — the forwarder throws
    // SamplingNotSupportedError in that branch (design.md §10.4 — the
    // "no handler" fallback).
    this.unregister = this.transport.sampling.register(async (request) => {
      const handler = this.handler;
      if (!handler) {
        throw new SamplingNotSupportedError(
          "Client did not register a sampling handler. " +
            "Sampling-driven features (enhance_prompt, select_by_prompt, " +
            "send_chat_message) require client.sampling.onSample(handler).",
        );
      }
      return handler(request);
    });
  }

  /**
   * Register the consumer-facing sampling handler. Returns an
   * unsubscribe callback that clears the slot if (and only if) the
   * still-registered handler is the one supplied here — a stale
   * unsubscribe from a previously-registered handler is a no-op.
   *
   * Re-registering replaces the slot wholesale (single-handler
   * semantics, design.md §10.2).
   */
  onSample(handler: SamplingHandler): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = null;
      }
    };
  }

  /**
   * Capability flag used by the SDK's handshake (design.md §10.3 —
   * `supports_sampling: forwarder.supportsSampling`). `true` while a
   * consumer handler is registered, `false` otherwise. The
   * {@link DiffuseCraftClient} reads this each time it builds the
   * client capabilities payload. A future Phase J task may also surface
   * a fine-grained `sampling_kinds_supported` array; v1 stops at the
   * boolean.
   */
  get supportsSampling(): boolean {
    return this.handler !== null;
  }

  /**
   * Tear down the transport-level handler and clear the consumer slot.
   * Idempotent — a second call is a no-op so the outer client's
   * `dispose()` can chain teardown without guarding.
   */
  dispose(): void {
    if (this.unregister) {
      try {
        this.unregister();
      } catch {
        // Transport unregister callbacks are documented as idempotent;
        // a throw here is unexpected but should not cascade into the
        // outer dispose chain. Swallowing is consistent with EventBus
        // dispose's "best-effort tear-down" stance.
      }
      this.unregister = null;
    }
    this.handler = null;
  }
}
