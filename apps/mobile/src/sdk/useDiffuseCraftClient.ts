// SDK wiring hook — closes the loop between the connection store (which
// owns the persisted paired-backend list + the secure token) and the
// `<StoresProvider client={...} />` slot consumed by the editor's
// `BottomPromptBar` Generate path.
//
// Watches the connection store for the active backend id, looks up the
// matching paired-backend entry, instantiates a `DiffuseCraftClient`
// over the HTTP transport, completes the MCP handshake, and surfaces
// the resulting core-compatible adapter so `<StoresProvider>` can
// fan-out events into the editor / jobs / models / history stores.
//
// Lifecycle:
//   - No active backend → returns `null`. Provider mounts `client={null}`
//     and stores stay in their cold-start shape.
//   - Active backend changes (or its `url` rotates) → previous SDK
//     client is `dispose()`'d in the cleanup branch and a fresh one is
//     constructed on the next effect run.
//   - Connection store status reflects the in-flight handshake
//     (`connecting` → `connected` on success, `error` on failure) so
//     the rest of the chrome (e.g. Settings.About debug card, the
//     router) sees the live state.

import { useEffect, useState } from 'react';

import { useConnectionStore, type DiffuseCraftClientLike } from '@diffusecraft/core';
import {
  createDiffuseCraftClient,
  toCoreClient,
  type DiffuseCraftClient,
} from '@diffusecraft/diffusion-client';

/**
 * React hook that turns the connection store's active-backend handle
 * into a live, post-handshake SDK client wrapped in the
 * `DiffuseCraftClientLike` shape the core's `<StoresProvider>` expects.
 *
 * Returns `null` when:
 *   - no backend is currently selected (`currentBackendId === null`),
 *   - the selected backend lacks a `url` (defensive — the store's v2
 *     migration drops malformed entries, so this branch is only hit
 *     mid-pairing or when the persisted state is hand-edited),
 *   - the client is still mid-handshake (the effect hasn't resolved yet),
 *   - or the handshake failed (the store's `lastError` carries the
 *     reason; the hook returns `null` so the editor falls back to its
 *     "Connect to a server to generate." toast in `BottomPromptBar`).
 *
 * The hook does NOT swallow handshake errors silently — it threads them
 * onto the connection store via `setConnectionStatus('error', err)` so
 * the existing chrome surfaces them. Consumers do not need to handle
 * the error path locally.
 */
export function useDiffuseCraftClient(): DiffuseCraftClientLike | null {
  // Read each slot with its own selector so zustand's shallow equality
  // doesn't trigger spurious effect re-runs when an unrelated slice of
  // state changes (e.g. discoveredBackends ticking during an mDNS scan).
  const currentBackendId = useConnectionStore((s) => s.currentBackendId);
  const pairedBackends = useConnectionStore((s) => s.pairedBackends);
  const getToken = useConnectionStore((s) => s.getToken);
  const setStatus = useConnectionStore((s) => s.setConnectionStatus);

  const [coreClient, setCoreClient] = useState<DiffuseCraftClientLike | null>(null);

  // Derive the URL up front so the effect's dep array is a primitive
  // string (or null). Without this, swapping a backend that happens to
  // have an identical paired-list reference but a different URL would
  // not retrigger the effect.
  const currentBackend = currentBackendId
    ? pairedBackends.find((b) => b.id === currentBackendId) ?? null
    : null;
  const url = currentBackend?.url ?? null;

  useEffect(() => {
    if (!currentBackendId || !url) {
      setCoreClient(null);
      return;
    }

    let cancelled = false;
    let sdkClient: DiffuseCraftClient | null = null;

    void (async () => {
      setStatus('connecting');
      try {
        // The HTTP transport accepts `token` as either a string or a
        // resolver function. We pass a resolver so the secure-token
        // adapter is consulted on every reconnect (per the SDK's
        // ~5 minute resolver cache; FR-27). The connection store's
        // in-memory adapter forgets tokens on app restart, but the
        // Manual paste flow re-creates them, so this is fine for v0.1.
        // The exported `ClientConfig` type is the post-Zod-default
        // shape, so several fields with documented defaults
        // (capabilities / reconnect / request_timeout_ms /
        // event_buffer_size) are still required at the call site.
        // We pass the same defaults `parseClientConfig` would fill
        // in so the typecheck passes without a cast.
        sdkClient = createDiffuseCraftClient({
          transport: {
            kind: 'http',
            url,
            token: () =>
              getToken(currentBackendId).then((t) => t ?? ''),
          },
          // Minimum required ClientCapabilities (mcp-tool-catalog
          // FR-37; mirrors the safe defaults declared in
          // libs/mcp-tools/src/shared/capabilities.ts).
          capabilities: {
            accepts_lossy_images: false,
            max_inline_image_kb: 256,
            streaming_supported: true,
            prefers_resources_over_tools: false,
          },
          // Reconnection policy defaults from
          // `ReconnectConfigSchema.default(...)` in
          // libs/diffusion-client/src/config.ts (FR-29 / FR-30 / FR-31).
          reconnect: {
            enabled: true,
            max_attempts: 5,
            backoff_ms: [500, 1000, 2000, 4000, 8000],
          },
          request_timeout_ms: 30_000,
          event_buffer_size: 100,
        });
        await sdkClient.connect();

        if (cancelled) {
          // The effect cleanup ran before connect() resolved — dispose
          // the half-built client and exit before publishing it.
          await sdkClient.dispose().catch(() => {
            /* swallow during teardown */
          });
          return;
        }

        setStatus('connected');
        // `toCoreClient` returns the SDK package's local
        // `CoreClientLike` shape, which is structurally identical to
        // core's exported `DiffuseCraftClientLike` (the SDK's
        // `core-adapter.ts` deliberately mirrors the contract inline
        // to avoid a runtime dep on @diffusecraft/core). The cast at
        // the boundary is the documented one-step migration path —
        // when the contracts converge, `toCoreClient` will return the
        // imported type directly and this cast becomes redundant.
        setCoreClient(toCoreClient(sdkClient) as unknown as DiffuseCraftClientLike);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus('error', {
          code: 'connect-failed',
          message: err instanceof Error ? err.message : String(err),
          observedAt: new Date().toISOString(),
        });
        setCoreClient(null);
      }
    })();

    return () => {
      cancelled = true;
      if (sdkClient) {
        // Best-effort dispose; ignore errors during teardown so a
        // failed disconnect cannot stall React's cleanup phase.
        sdkClient.dispose().catch(() => {
          /* swallow during teardown */
        });
      }
    };
  }, [currentBackendId, url, getToken, setStatus]);

  return coreClient;
}
