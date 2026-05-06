/**
 * Bridge between the SDK's typed `DiffuseCraftClient` surface and
 * `@diffusecraft/core`'s structurally-typed `DiffuseCraftClientLike`
 * (consumed by `<StoresProvider client={...} />`).
 *
 * Why this adapter exists
 * -----------------------
 * `@diffusecraft/core` was scaffolded with a minimal client shape so the
 * store layer could land before the SDK shipped. The two surfaces
 * diverge in two specific ways:
 *
 *   1. **Event subscription model.** The SDK speaks per-event-name
 *      channels (`client.events.on('job.progress', handler)`); the
 *      stores expect a single all-events callback that receives an
 *      envelope `{ name, payload }` (`client.events.subscribe(handler)`).
 *      The adapter fans the catalog's static event-name list out to
 *      per-name listeners and forwards each into the consumer's
 *      single-handler shape.
 *
 *   2. **Tool dispatch surface.** The SDK exposes typed methods on
 *      `client.tools.<camelCaseName>(args)`; the stores call
 *      `client.invokeTool(snake_case_name, args)` directly. The SDK
 *      ships `client.invokeTool(...)` as a thin transport passthrough
 *      (see `client.ts`); the adapter forwards verbatim.
 *
 * Forward-looking note: once `@diffusecraft/core` adopts the SDK's
 * native interface, this adapter degenerates into a typed re-export.
 * Keep the surface small (the `DiffuseCraftClientLike` shape is the
 * authoritative contract today) so the migration is a one-step swap.
 */
import { catalog } from "@diffusecraft/mcp-tools";
import type { EventName, EventPayload } from "@diffusecraft/mcp-tools";

import type { DiffuseCraftClient } from "./client";

/**
 * Structural mirror of `@diffusecraft/core/src/stores/shared/types.ts`.
 *
 * We declare it inline rather than `import type { DiffuseCraftClientLike }
 * from "@diffusecraft/core"` to keep the SDK's public surface free of a
 * runtime dep on `@diffusecraft/core` (which itself peer-depends on
 * `react`, `zustand`, etc.). The adapter's return type is structurally
 * identical to the core export — TypeScript accepts the result anywhere
 * the imported type is expected. If the contract ever drifts, the
 * compiler catches it at the call site
 * (`<StoresProvider client={toCoreClient(sdkClient)} />`).
 */
interface CoreClientLikeEventEnvelope {
  name: string;
  payload: unknown;
}
interface CoreClientLike {
  events: {
    subscribe(handler: (event: CoreClientLikeEventEnvelope) => void): () => void;
  };
  invokeTool<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
  ): Promise<TResult>;
}

/**
 * Compile-time list of every catalog event name (extracted from the
 * `EventName` union via the catalog manifest's `events` tuple). Used by
 * {@link toCoreClient}'s `events.subscribe` bridge to attach one
 * per-name listener per call. Sourced from the runtime catalog so a new
 * event added to `libs/mcp-tools/src/events/manifest.ts` is picked up
 * automatically without needing to update this file.
 */
const ALL_EVENT_NAMES: readonly EventName[] = catalog.events.map(
  (e) => e.name,
);

/**
 * Project the SDK's `DiffuseCraftClient` onto the structurally-typed
 * shape `@diffusecraft/core`'s `<StoresProvider>` consumes.
 *
 * The returned object holds the SDK reference by closure — it is safe
 * to pass through React reconciler identity changes only when the
 * caller stabilises the wrapper itself (e.g., `useMemo(() =>
 * toCoreClient(sdk), [sdk])`). The provider re-runs its wiring
 * `useEffect` whenever the wrapper identity changes.
 *
 * @example
 * ```ts
 * const sdk = createDiffuseCraftClient({ transport: { kind: "http", url, token } });
 * await sdk.connect();
 * const coreClient = toCoreClient(sdk);
 * <StoresProvider client={coreClient}>...</StoresProvider>
 * ```
 */
export function toCoreClient(sdkClient: DiffuseCraftClient): CoreClientLike {
  return {
    events: {
      subscribe(handler: (event: CoreClientLikeEventEnvelope) => void): () => void {
        // Attach one per-event-name listener and forward each fire as
        // an envelope. The bus replays buffered events on attach (E.2)
        // so consumers attaching late still observe recent activity.
        const unsubs: Array<() => void> = [];
        for (const name of ALL_EVENT_NAMES) {
          // The catalog's `EventName` is a finite literal union; each
          // per-name listener is typed against `EventPayload<typeof
          // name>`. The envelope-side handler is intentionally
          // `unknown`-typed (the consumer dispatches on `name`), so we
          // widen the payload at the boundary.
          const unsub = sdkClient.events.on(name, (payload: EventPayload<typeof name>) => {
            handler({ name, payload });
          });
          unsubs.push(unsub);
        }
        // Single unsubscribe that detaches all per-event listeners.
        return () => {
          for (const u of unsubs) {
            try {
              u();
            } catch {
              // A throwing unsubscribe must not block the rest of the
              // teardown chain; the bus's per-listener Set tolerates a
              // missed entry.
            }
          }
        };
      },
    },
    invokeTool<TArgs, TResult>(name: string, args: TArgs): Promise<TResult> {
      return sdkClient.invokeTool<TArgs, TResult>(name, args);
    },
  };
}
