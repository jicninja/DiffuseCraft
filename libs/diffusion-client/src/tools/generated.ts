/**
 * Generated tool methods (C.1 — `client-sdk` requirements §3.4 FR-11/FR-12,
 * design.md §2 + §5).
 *
 * Approach
 * --------
 * The catalog manifest in `@diffusecraft/mcp-tools` is the single source of
 * truth for every tool's name, input schema, and output schema. Rather than
 * hard-coding one method per tool, this module derives `TypedToolMethods`
 * structurally from the catalog at the type level and constructs the
 * corresponding object at runtime by iterating `catalog.tools`. The
 * resulting surface is identical to a hand-written class with one method
 * per tool — the compiler infers `args: ToolInput<N>` and
 * `Promise<ToolOutput<N>>` for every entry — but stays in lockstep with
 * the catalog without a build step.
 *
 * The design.md §5 wording ("a build script reads the manifest and emits
 * this file") is satisfied at the developer-experience layer: TS sees
 * exactly the methods the catalog declares, and adding a tool to the
 * catalog adds the method to `client.tools` automatically with full type
 * inference. A static-codegen variant (writing the methods out as
 * verbatim TypeScript) can replace this implementation later without
 * changing the public surface, if bundle-size or doc-visibility ever
 * demand it. The hand-written escape pattern from design.md §5
 * (e.g., `upload_blob` integrating with the image helper) lands in C.2
 * via the `wrappers` parameter accepted by {@link createToolMethods}.
 *
 * Naming
 * ------
 * FR-11 mandates camelCase derivations of the catalog's snake_case tool
 * names: `generate_image` becomes `generateImage`, `apply_history_item`
 * becomes `applyHistoryItem`, etc. The mapping is performed at compile
 * time via {@link CamelCase} and at runtime via {@link toCamelCase}; both
 * implementations stay in sync (round-tripping every catalog name through
 * both routes yields identical results). Methods are keyed only by the
 * camelCased name — the snake_case form is reserved for the wire
 * (`transport.send(toolName, args)`).
 */

import { catalog } from "@diffusecraft/mcp-tools";
import type {
  ToolInput,
  ToolName,
  ToolOutput,
} from "@diffusecraft/mcp-tools";

import type {
  Transport,
  TransportSendOptions,
} from "../transports/transport.js";

// ---------------------------------------------------------------------------
// snake_case → camelCase mapping (compile-time + runtime)
// ---------------------------------------------------------------------------

/**
 * Compile-time mapping from a snake_case literal to its camelCase form.
 * `"generate_image"` → `"generateImage"`. Recursively walks underscores;
 * empty / single-segment strings pass through unchanged.
 *
 * Implementation mirrors the runtime {@link toCamelCase} helper: split on
 * `_`, lowercase each segment after the first, capitalize the first
 * letter of each subsequent segment.
 */
export type CamelCase<S extends string> =
  S extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<CamelCase<Tail>>}`
    : S;

/**
 * Runtime equivalent of {@link CamelCase}. Used to build the per-method
 * keys of the `TypedToolMethods` object so the runtime shape matches the
 * type-level shape exactly.
 *
 * The conversion is purely structural — it walks underscores and uppercases
 * the first character of every subsequent segment. Catalog names are
 * already lowercase snake_case (per `mcp-tool-catalog` FR-2); we don't
 * lowercase the head segment because catalog names never start with a
 * capital.
 */
export function toCamelCase<S extends string>(input: S): CamelCase<S> {
  const segments = input.split("_");
  if (segments.length <= 1) return input as CamelCase<S>;
  const [head, ...rest] = segments;
  const camel =
    (head ?? "") +
    rest
      .map((segment) =>
        segment.length === 0
          ? ""
          : segment.charAt(0).toUpperCase() + segment.slice(1),
      )
      .join("");
  return camel as CamelCase<S>;
}

// ---------------------------------------------------------------------------
// TypedToolMethods — generated namespace shape
// ---------------------------------------------------------------------------

/**
 * Per-call options exposed to consumers when invoking a tool method
 * (FR-15 / Q4 — `AbortSignal` cancellation, design.md §1).
 *
 * Equivalent to the transport-level {@link TransportSendOptions} but
 * re-declared here so the public SDK surface does not require consumers
 * to import from `transports/`. The runtime forwards these verbatim.
 */
export interface ToolCallOptions {
  /**
   * Cancels the in-flight request. Pre-send abort skips dispatch
   * entirely; mid-flight abort cascades to a `cancel_job` for job-shaped
   * tools (full plumbing lands in C.5).
   */
  signal?: AbortSignal;
  /**
   * Per-call override of the SDK-wide `request_timeout_ms`. On expiry
   * the transport rejects with `RequestTimeoutError` (FR-15).
   */
  timeout_ms?: number;
}

/**
 * Public mapped type covering one method per catalog tool — the
 * `TypedToolMethods` surface declared in design.md §3.
 *
 * The `as CamelCase<N>` clause re-keys the mapped type from snake_case
 * (`ToolName`) to camelCase (FR-11). For each catalog tool with name
 * `N`, the resulting method accepts `ToolInput<N>` and resolves to
 * `ToolOutput<N>` — the same single-source-of-truth typing the
 * `Transport.send` overloads provide.
 *
 * Compile-time errors when consumers pass a wrong-shape argument
 * (FR-12); runtime validation lands in C.3 (Zod parse before send).
 */
export type TypedToolMethods = {
  [N in ToolName as CamelCase<N>]: (
    args: ToolInput<N>,
    opts?: ToolCallOptions,
  ) => Promise<ToolOutput<N>>;
};

// ---------------------------------------------------------------------------
// createToolMethods — runtime constructor
// ---------------------------------------------------------------------------

/**
 * Optional override map: hand-written wrappers replace the default
 * transport pass-through for the listed tools. Keys are the catalog's
 * snake_case names so wrappers can be authored against the tool's
 * canonical identity (the camelCase rename happens internally).
 *
 * C.2 populates this with the special-case tools (e.g., `upload_blob`
 * integrates the image helper). The wrapper receives the same `args`
 * the consumer passed and the same options forwarded by `createToolMethods`,
 * plus the {@link Transport} so it can route extra calls through the
 * canonical channel.
 */
export type ToolMethodWrappers = Partial<{
  [N in ToolName]: (
    transport: Transport,
    args: ToolInput<N>,
    opts?: ToolCallOptions,
  ) => Promise<ToolOutput<N>>;
}>;

/**
 * Build the `TypedToolMethods` object backed by `transport.send`. One
 * method per entry in `catalog.tools`, keyed by the camelCased tool name.
 *
 * Behaviour:
 *
 *   1. Iterate `catalog.tools` exactly once. For each entry, register a
 *      method that forwards `(args, opts)` to `transport.send(name, args, opts)`.
 *   2. If `wrappers[snakeName]` exists, use it instead of the default
 *      forwarding. The wrapper is responsible for invoking the transport
 *      itself (or for routing through SDK helpers — e.g., `image.upload`).
 *   3. The function returns the constructed object cast to
 *      {@link TypedToolMethods}. The cast is safe because the
 *      iteration covers every member of `ToolName` (the catalog is the
 *      single source of truth) and the per-method type signature
 *      matches `Transport.send`'s typed overload exactly.
 *
 * The constructor is invoked once per `DiffuseCraftClient` instance and
 * the returned object is held on `client.tools` (B.6 — the client class
 * landing in a follow-up task).
 *
 * @example
 * ```ts
 * const methods = createToolMethods(transport);
 * const result = await methods.generateImage({ prompt: "A cat" });
 * ```
 */
export function createToolMethods(
  transport: Transport,
  wrappers: ToolMethodWrappers = {},
): TypedToolMethods {
  // The runtime container. Built as `Record<string, unknown>` and
  // re-cast on return — TS cannot type-check the iteration because
  // `catalog.tools` is a heterogeneous tuple at the type level. The
  // safety claim is that `iterTools` covers every member of `ToolName`,
  // so every key required by `TypedToolMethods` is populated.
  const methods: Record<string, unknown> = {};

  for (const tool of catalog.tools) {
    const snakeName = tool.name as ToolName;
    const camelName = toCamelCase(snakeName);
    const wrapper = wrappers[snakeName];

    if (wrapper) {
      // The wrapper signature mirrors the per-tool method signature; cast
      // through `unknown` because TS cannot narrow `wrappers[snakeName]`
      // against the heterogeneous `ToolMethodWrappers` mapped type at
      // this iteration site.
      methods[camelName] = (
        args: ToolInput<ToolName>,
        opts?: ToolCallOptions,
      ): Promise<ToolOutput<ToolName>> => {
        // The wrapper is keyed by the catalog tool's snake_case name and
        // typed against that exact tool's `ToolInput<N>` / `ToolOutput<N>`,
        // so the runtime forwarding is a value pass-through. We cast
        // through `unknown` to suppress the heterogeneous-mapped-type
        // narrowing TS cannot perform here.
        const dispatch = wrapper as unknown as (
          transport: Transport,
          args: ToolInput<ToolName>,
          opts?: ToolCallOptions,
        ) => Promise<ToolOutput<ToolName>>;
        return dispatch(transport, args, opts);
      };
      continue;
    }

    methods[camelName] = (
      args: ToolInput<ToolName>,
      opts?: ToolCallOptions,
    ): Promise<ToolOutput<ToolName>> => {
      const sendOpts: TransportSendOptions | undefined = opts
        ? { signal: opts.signal, timeout_ms: opts.timeout_ms }
        : undefined;
      return transport.send(snakeName, args, sendOpts);
    };
  }

  return methods as TypedToolMethods;
}
