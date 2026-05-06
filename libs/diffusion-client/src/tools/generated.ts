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
import type { ToolCategory } from "@diffusecraft/mcp-tools";
import type { z } from "zod";

import { ClientValidationError } from "../errors.js";
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
// Client-side Zod validation (C.3 — FR-13)
// ---------------------------------------------------------------------------

/**
 * Snake_case tool name → catalog `inputSchema` lookup table.
 *
 * Built once at module load by walking `catalog.tools`. Per-call validation
 * (which runs on every tool invocation, FR-13 / NFR-4) needs O(1) access to
 * the schema; iterating the catalog tuple every call would defeat the
 * latency budget (NFR-4 — ≤5 ms client-side per typical input).
 *
 * The map is keyed by the snake_case canonical name (the `transport.send`
 * wire identifier) so callers — both the generated default path below and
 * any wrapper that opts in via {@link validateToolInput} — can address
 * tools by their catalog identity rather than by camelCase.
 */
const inputSchemaByToolName: ReadonlyMap<string, z.ZodTypeAny> = (() => {
  const m = new Map<string, z.ZodTypeAny>();
  for (const tool of catalog.tools) {
    m.set(tool.name, tool.inputSchema);
  }
  return m;
})();

/**
 * Validate `args` against the catalog `inputSchema` for `toolName` (FR-13,
 * design.md §5).
 *
 * Behaviour:
 *
 *   - Returns the **parsed** value on success (with optional / defaulted
 *     fields filled in by Zod). Callers SHOULD pass this value to
 *     `transport.send` rather than the original `args` so default values
 *     declared in the catalog reach the wire.
 *   - Throws {@link ClientValidationError} on failure, populating
 *     `field_path` from the first issue's dotted path
 *     (`issue.path.map(String).join(".")` — `"prompt"`,
 *     `"control_layers.0.weight"`, etc.) and forwarding the full
 *     `z.ZodError` as `cause` for downstream debugging.
 *
 * The default tool method path always invokes this helper before calling
 * `transport.send`. Hand-written wrappers (C.2) opt in by calling it
 * explicitly — wrappers that legitimately need to skip validation (e.g.,
 * when they recompose `args` from synthetic inputs) simply do not call it.
 *
 * Exported so wrappers under `tools/` and integration code under
 * `image/` (C.2's `upload_blob` wrapper) share the canonical path.
 *
 * @example
 * ```ts
 * const parsed = validateToolInput("generate_image", { prompt: "A cat" });
 * // parsed has Zod defaults applied; pass it to transport.send.
 * ```
 */
export function validateToolInput<N extends ToolName>(
  toolName: N,
  args: ToolInput<N>,
): ToolInput<N> {
  // Lookup is keyed by snake_case; `ToolName` is the catalog's literal union
  // so the key is guaranteed present at runtime. Keep the lookup defensive —
  // a missing entry indicates a build-time mismatch between the catalog and
  // this module (e.g., manual editing of `catalog.tools`) and we surface it
  // as a `ClientValidationError` rather than letting a `.safeParse` on
  // `undefined` throw a `TypeError`.
  const schema = inputSchemaByToolName.get(toolName);
  if (!schema) {
    throw new ClientValidationError(
      `Unknown tool "${toolName}" — not present in @diffusecraft/mcp-tools catalog.`,
      { field_path: undefined },
    );
  }

  const result = schema.safeParse(args);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldPath = issue ? issue.path.map(String).join(".") : "";
    const message = issue
      ? `Invalid input for tool "${toolName}" at ${fieldPath || "<root>"}: ${issue.message}`
      : `Invalid input for tool "${toolName}".`;
    throw new ClientValidationError(message, {
      field_path: fieldPath || undefined,
      cause: result.error,
    });
  }

  // `safeParse` returns `z.output<I>`, which is structurally a superset of
  // `z.input<I>` (Zod fills in defaults / applies coercions). The catalog's
  // `ToolInput<N>` alias is `z.input<I>`; we widen the parsed value back to
  // that public type so the call site (and `transport.send`) keeps the same
  // signature regardless of whether validation ran.
  return result.data as ToolInput<N>;
}

// ---------------------------------------------------------------------------
// AbortSignal orchestration (C.5 — FR-15 / Q4, design.md §1 + §5)
// ---------------------------------------------------------------------------

/**
 * Snake_case tool name → catalog `category` lookup table.
 *
 * Built once at module load by walking `catalog.tools`. The abort-cascade
 * orchestration in {@link callToolWithAbort} (and any wrapper that opts in)
 * needs O(1) access to a tool's category to decide whether a post-send
 * abort should fan out to `cancel_job(job_id)` (FR-15 / Q4 — only
 * `category: "job"` tools queue server-side work that survives the
 * caller's promise rejection).
 *
 * Keyed by the snake_case canonical name so callers address tools by their
 * catalog identity, mirroring {@link inputSchemaByToolName}.
 */
const categoryByToolName: ReadonlyMap<string, ToolCategory> = (() => {
  const m = new Map<string, ToolCategory>();
  for (const tool of catalog.tools) {
    m.set(tool.name, tool.category);
  }
  return m;
})();

/**
 * Construct the canonical abort error.
 *
 * Per design.md §1 (Q4 — `AbortSignal supported`) the SDK rejects with the
 * Web-standard `DOMException('Aborted', 'AbortError')` when a consumer
 * cancels a tool call. ES2022 / Node 18+ surfaces a `signal.reason`
 * property — when present we honour it (the consumer may have set a
 * domain-specific abort cause); otherwise we fall back to the canonical
 * `DOMException`.
 *
 * Exported for transport-level callers that previously threw the
 * placeholder `Error("aborted")`; routing through this helper keeps every
 * abort-induced rejection on a single error shape (see the boundary note
 * at the top of this module).
 */
export function abortError(signal?: AbortSignal): unknown {
  if (signal && "reason" in signal && signal.reason !== undefined) {
    return signal.reason;
  }
  return new DOMException("Aborted", "AbortError");
}

/**
 * Per-call orchestration that wires `AbortSignal` into a tool invocation
 * (FR-15 / Q4, design.md §1 + §5).
 *
 * Behaviour:
 *
 *   1. **Pre-send abort** — if `opts.signal` is already aborted at call
 *      time, the function throws {@link abortError} synchronously and
 *      `transport.send` is **not** invoked. This satisfies the design.md
 *      §1 ruling "Pre-send abort → no request".
 *   2. **Non-job tools** (`category: "read" | "write"`) — the signal is
 *      forwarded to `transport.send` verbatim. The transport's own
 *      pre-flight short-circuit handles in-flight cancellation; there is
 *      no server-side handle to retract because the call resolves
 *      synchronously from the client's perspective.
 *   3. **Job tools** (`category: "job"`) — the immediate response from
 *      `transport.send` carries a `job_id` (per `mcp-tool-catalog`'s
 *      job-shaped output convention; see e.g. `generate_image`'s
 *      `Output = z.object({ job_id, ... })`). When the signal aborts
 *      after the queue acknowledgement we fire
 *      `transport.send("cancel_job", { job_id })` fire-and-forget — the
 *      caller has already moved on (their promise rejected), so a failed
 *      cancel cannot be propagated up to them; the SDK's optional logger
 *      receives the failure if configured.
 *
 *      Two abort windows exist for job-shaped tools:
 *
 *      - **Between send and queue ack** — if the signal fires while we
 *        await the queue acknowledgement, we honour the abort *after* we
 *        have a `job_id`: the abort post-await branch fires `cancel_job`
 *        and rejects with {@link abortError}. We deliberately do NOT
 *        cancel pre-emptively at the SDK level here — the job is already
 *        queued server-side, so the only honest cancellation is one that
 *        carries the `job_id`.
 *      - **After queue ack** — we attach a one-shot `abort` listener that
 *        fires `cancel_job` when the consumer aborts the long-running job
 *        (the realistic cancellation case for `generate_image`,
 *        `upscale_image`, etc.).
 *
 * Symmetry note: wrappers that opt into validation via
 * {@link validateToolInput} should likewise route their `transport.send`
 * call through this helper to inherit the abort-cascade contract.
 */
export async function callToolWithAbort<N extends ToolName>(
  transport: Transport,
  toolName: N,
  args: ToolInput<N>,
  opts: ToolCallOptions | undefined,
  toolCategory: ToolCategory,
): Promise<ToolOutput<N>> {
  const signal = opts?.signal;

  // (1) Pre-send abort — the design.md §1 ruling: "Pre-send abort →
  // no request". We synchronously throw the canonical abort error
  // before invoking `transport.send`, so the transport never observes
  // a pre-aborted signal originating from this orchestration layer.
  if (signal?.aborted) {
    throw abortError(signal);
  }

  const sendOpts: TransportSendOptions | undefined = opts
    ? { signal: opts.signal, timeout_ms: opts.timeout_ms }
    : undefined;

  // (2) Non-job tools — pass the signal through verbatim. Read tools
  // resolve quickly; write tools have already committed their effect by
  // the time the response returns. Either way there is no server-side
  // job handle to retract, so the abort cascade collapses to "let the
  // transport reject the in-flight call if it can; otherwise just throw
  // the abort error to the caller".
  if (toolCategory !== "job") {
    return transport.send(toolName, args, sendOpts);
  }

  // (3) Job tools — fire the request and orchestrate post-send
  // cancellation around the immediate response.
  const sendPromise = transport.send(toolName, args, sendOpts);

  // The transport may reject the `sendPromise` itself (network failure,
  // server error, etc.). We propagate that rejection unchanged — the
  // caller sees the underlying error rather than a synthetic abort.
  const result = await sendPromise;

  // Job-shaped outputs always carry a `job_id` per the catalog
  // convention; the runtime read here is defensive (the catalog could
  // grow a job-category tool that wraps the id elsewhere — at which
  // point this helper would need updating to extract the right field).
  const jobId = (result as { job_id?: string }).job_id;
  if (jobId === undefined) {
    return result;
  }

  // Window A — signal aborted between send and queue ack. The job is
  // already running on the server, so we DO fire `cancel_job` (we now
  // have the id) and reject with the canonical abort error. This is
  // distinct from the pre-send case in (1): there, no request reached
  // the server; here, the server has accepted the job and we owe it a
  // cancellation.
  if (signal?.aborted) {
    fireAndForgetCancelJob(transport, jobId);
    throw abortError(signal);
  }

  // Window B — signal aborts after we hand the result back to the
  // caller. We attach a one-shot listener so the long-running job is
  // retracted when the consumer aborts mid-flight (the realistic
  // generate_image / upscale_image cancellation case). The caller's
  // promise has already resolved with `result`; their abort no longer
  // affects this promise — it only triggers the side-effecting
  // cancel_job emission. The `{ once: true }` flag detaches the listener
  // automatically after the first fire (the signal cannot abort twice).
  if (signal !== undefined) {
    signal.addEventListener(
      "abort",
      () => {
        fireAndForgetCancelJob(transport, jobId);
      },
      { once: true },
    );
  }

  return result;
}

/**
 * Fire-and-forget `cancel_job(job_id)` over the transport. Used by
 * {@link callToolWithAbort} to retract job-shaped work after a post-send
 * abort.
 *
 * The cancel emission cannot fail the caller's promise — the caller has
 * already moved on (their original promise rejected with the abort, or
 * resolved before they aborted). We swallow rejections silently here;
 * a future logger plumbing (see SDK `Logger` interface, FR-4) could
 * surface the failure to consumers, but in v1 a failed cancel is purely
 * advisory: the server will eventually time out the job on its own.
 *
 * The `as unknown as ToolInput<"cancel_job">` cast bridges the loose
 * runtime call site to the typed transport overload — the catalog
 * declares `cancel_job` with `Input = z.object({ job_id: JobId })`, so
 * passing `{ job_id }` matches the wire shape.
 */
function fireAndForgetCancelJob(transport: Transport, jobId: string): void {
  // `void` discards the returned promise without awaiting; the
  // `.catch(() => {})` is required because an unhandled promise
  // rejection on Node would otherwise warn (or, with `--unhandled-rejections=strict`,
  // crash).
  void transport
    .send(
      "cancel_job",
      { job_id: jobId } as unknown as ToolInput<"cancel_job">,
    )
    .catch(() => {
      // Intentionally swallowed — see function-level note. A future
      // logger hook can surface this; for now an unsuccessful cancel is
      // purely advisory (the server times the job out on its own).
    });
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
 * (FR-12); runtime validation runs in {@link validateToolInput} (C.3 —
 * Zod parse before send, see FR-13 / design.md §5).
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

    // Resolve the catalog category once per tool registration so the
    // default branch's abort orchestration (C.5 — FR-15 / Q4) does not
    // re-walk the lookup table on every invocation. The catalog is the
    // single source of truth; if a tool's category were missing here,
    // it would mean the manifest changed under us — fall back to
    // `"write"` (no `cancel_job` cascade) to avoid spuriously
    // cancelling a non-existent job.
    const category = categoryByToolName.get(snakeName) ?? "write";

    methods[camelName] = (
      args: ToolInput<ToolName>,
      opts?: ToolCallOptions,
    ): Promise<ToolOutput<ToolName>> => {
      // C.3 — FR-13: validate client-side BEFORE the transport call. The
      // parsed value (with Zod defaults applied) is what the wire sees, so
      // catalog-declared defaults reach the server even when the consumer
      // omitted them. `validateToolInput` throws `ClientValidationError`
      // with a populated `field_path` on failure — the throw escapes
      // synchronously, before `transport.send` is invoked, satisfying the
      // FR-13 wording "before any network call".
      const parsed = validateToolInput(snakeName, args);
      // C.5 — FR-15 / Q4: route through `callToolWithAbort` so pre-send
      // aborts skip dispatch entirely (DOMException('Aborted','AbortError'))
      // and post-send aborts on job-shaped tools cascade to
      // `cancel_job(job_id)`. The orchestrator forwards `opts` to the
      // transport as `TransportSendOptions` internally — the default
      // branch never builds `sendOpts` itself.
      return callToolWithAbort(transport, snakeName, parsed, opts, category);
    };
  }

  return methods as TypedToolMethods;
}
