/**
 * Generated resource readers (D.1 + D.2 + D.3 — `client-sdk` requirements
 * §3.5 FR-16 / FR-17 / FR-18, design.md §2 + §3 + §6).
 *
 * Approach
 * --------
 * The catalog manifest in `@diffusecraft/mcp-tools` (`catalog.resources`) is
 * the single source of truth for every resource URI, its content schema,
 * and the `supports_since` / `supports_fields` flags. Rather than maintaining
 * a hand-written wrapper per URI, this module derives `TypedResourceReaders`
 * structurally from the catalog at the type level and constructs the
 * corresponding object at runtime by iterating `catalog.resources`.
 *
 * The design.md §6 sketch ("a build script reads the manifest and emits this
 * file") is satisfied at the developer-experience layer: TS sees exactly the
 * namespaces the catalog declares, and adding a resource to the catalog adds
 * the namespace to `client.resources` automatically. A static-codegen variant
 * (writing the methods out as verbatim TypeScript) can replace this
 * implementation later without changing the public surface.
 *
 * Namespace derivation algorithm (per design §3 — "one namespace per
 * resource URI, grouped by path prefix"):
 *
 *   1. Strip the `diffusecraft://` scheme.
 *   2. Split on `/`. Walk segments left to right.
 *   3. Drop every `{...}` placeholder segment (these are positional params
 *      consumed by the reader's call signature).
 *   4. Drop a *trailing* literal `list` segment — `documents/list` becomes
 *      `documents`, `history/list` becomes `history`, etc. The list-vs-item
 *      distinction is encoded on the action key (`list` / `iterate` /
 *      `read`) below, not on the namespace key.
 *   5. CamelCase-concatenate the remaining segments. Each segment is
 *      lowercased; `-` and `_` separators inside a segment are dropped and
 *      the next character is uppercased. The first segment stays
 *      lowercase-headed; subsequent segments capitalize their leading
 *      character.
 *
 * Examples (every entry in the v1 catalog):
 *
 *   - `diffusecraft://server/info`               → `serverInfo`
 *   - `diffusecraft://server/paired-devices`     → `serverPairedDevices`
 *   - `diffusecraft://server/audit-log`          → `serverAuditLog`
 *   - `diffusecraft://documents/list`            → `documents`
 *   - `diffusecraft://document/{id}/state`       → `documentState`
 *   - `diffusecraft://layers/list`               → `layers`
 *   - `diffusecraft://control-layers/list`       → `controlLayers`
 *   - `diffusecraft://regions/list`              → `regions`
 *   - `diffusecraft://history/list`              → `history`  (list endpoint)
 *   - `diffusecraft://history/{id}`              → `history`  (read endpoint)
 *   - `diffusecraft://jobs/list`                 → `jobs`
 *   - `diffusecraft://models/list`               → `models`
 *   - `diffusecraft://presets/list`              → `presets`
 *   - `diffusecraft://undo-stack/{document-id}`  → `undoStack`
 *   - `diffusecraft://redo-stack/{document-id}`  → `redoStack`
 *   - `diffusecraft://blob/{id}`                 → `blob`
 *
 * Method shape per URI (resolves namespace collisions like
 * `history/list` + `history/{id}`):
 *
 *   - **Has params + paginated** (e.g. `undo-stack/{document-id}`)
 *     → `read(...params, opts?)` returns the first page; `iterate(...params, opts?)`
 *       async-yields items across all pages.
 *   - **Has params + not paginated** (e.g. `document/{id}/state`,
 *     `history/{id}`, `blob/{id}`) → `read(...params, opts?)`.
 *   - **No params + paginated** (e.g. `documents/list`,
 *     `server/paired-devices`) → `list(opts?)` + `iterate(opts?)`.
 *   - **No params + not paginated** (e.g. `server/info`) → `read(opts?)`.
 *
 * Pagination detection introspects the resource's Zod content schema: a
 * resource is paginated when its top-level schema is a `ZodObject` with
 * both `items` (an array) and `next_cursor` keys in its shape — the exact
 * shape produced by `paginated(...)` in `@diffusecraft/mcp-tools`'s
 * `shared/pagination.ts`. The introspection is robust because the
 * catalog always wraps paginated payloads with that helper; if a future
 * resource hand-rolls a paginated envelope it must preserve the same
 * shape (or be patched in here).
 *
 * Validation (FR-17):
 *
 *   - `since` is checked against a basic ISO-8601 regex (the same shape
 *     the server's catalog enforces via `z.string().datetime()`); invalid
 *     strings raise {@link ClientValidationError} with `field_path: 'since'`
 *     before any network call.
 *   - `fields` must be a non-empty `string[]`; non-array values, non-string
 *     entries, or empty strings raise {@link ClientValidationError} with
 *     `field_path: 'fields'`.
 *
 * The runtime constructor returns a freshly-shaped object per call. The
 * resulting surface is held on `client.resources` (Phase B.6 — the client
 * class lands later).
 */

import { catalog } from "@diffusecraft/mcp-tools";
import type { ResourceUri } from "@diffusecraft/mcp-tools";
import { z } from "zod";

import { ClientValidationError } from "../errors";
import type {
  ResourceReadQuery,
  Transport,
  TransportReadResourceOptions,
} from "../transports/transport";

// ---------------------------------------------------------------------------
// Public option / shape types
// ---------------------------------------------------------------------------

/**
 * Per-call options exposed to consumers when reading a resource (FR-17).
 *
 * `since` and `fields` map directly to `?since=` / `?fields=` in the resource
 * URI (the same wire shape the server's resource handlers in
 * `libs/server/src/lib/resources/*` parse via `query['since']` /
 * `query['fields']`).
 *
 * `signal` honours `AbortSignal` cancellation — the transport short-circuits
 * pre-flight if the signal is already aborted; otherwise it forwards the
 * signal to the underlying MCP read.
 */
export interface ResourceReadOptions {
  /**
   * RFC-3339 / ISO 8601 timestamp; resource returns deltas after this
   * moment. Validated client-side before the network call so malformed
   * timestamps fail fast with `field_path: 'since'` (FR-17 / FR-13).
   */
  since?: string;
  /**
   * Sparse-fieldset selector. Each entry is a top-level field name on the
   * resource's content schema; the server projects only those fields. Empty
   * arrays and non-string entries are rejected client-side.
   */
  fields?: string[];
  /**
   * Cancels the in-flight request. Honoured pre-send by the transport; the
   * read returns a rejected promise carrying the canonical
   * `DOMException('Aborted', 'AbortError')` (or `signal.reason` when set).
   */
  signal?: AbortSignal;
}

/**
 * Pagination iteration options. Adds `page_size` to {@link ResourceReadOptions}
 * so consumers can ask the server for shorter pages when memory pressure
 * matters; the server-side cap stays at 50 per page (`shared/pagination.ts`'s
 * `paginated(...)` helper).
 *
 * Currently unused — the catalog's paginated resources do not honour a
 * `?limit=` query yet on the server side. Reserved for future expansion.
 */
export interface ResourceIterateOptions extends ResourceReadOptions {
  // Reserved.
}

/**
 * Paginated response envelope returned by `list(...)` / `read(...)` for
 * paginated resources. Mirrors `Paginated<T>` in
 * `@diffusecraft/mcp-tools/shared/pagination.ts` but is re-declared here so
 * consumers do not import from the catalog package directly.
 */
export interface PaginatedPage<T> {
  items: T[];
  next_cursor?: string;
  total_known?: number;
}

// ---------------------------------------------------------------------------
// camelCase helper (mirrors `tools/generated.ts`'s `toCamelCase`)
// ---------------------------------------------------------------------------

/**
 * Concatenate path segments into a camelCase identifier.
 *
 * The first segment is lowercased verbatim; subsequent segments uppercase
 * their leading character. Within a segment, `-` and `_` separators are
 * removed and the following character is uppercased (so `paired-devices`
 * becomes `pairedDevices`).
 *
 * Pure helper, exported for unit-test ergonomics.
 */
export function camelCaseSegments(segments: readonly string[]): string {
  if (segments.length === 0) return "";
  const normalize = (segment: string, capitalizeFirst: boolean): string => {
    if (segment.length === 0) return "";
    const lower = segment.toLowerCase();
    let out = "";
    let upperNext = capitalizeFirst;
    for (const ch of lower) {
      if (ch === "-" || ch === "_") {
        upperNext = true;
        continue;
      }
      if (upperNext) {
        out += ch.toUpperCase();
        upperNext = false;
      } else {
        out += ch;
      }
    }
    return out;
  };
  const [head, ...tail] = segments;
  return (
    normalize(head ?? "", false) +
    tail.map((s) => normalize(s, true)).join("")
  );
}

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

/**
 * Parsed resource URI: namespace property name, ordered parameter names, and
 * an indicator of whether the URI is a list endpoint (the trailing `/list`
 * sentinel).
 */
export interface ParsedResourceUri {
  /** camelCased namespace key on `client.resources`. */
  namespace: string;
  /**
   * Ordered parameter names extracted from `{...}` placeholders. Names are
   * preserved verbatim from the URI (so `{document-id}` keeps the `-`).
   * Callers index arguments positionally; the names are surfaced for
   * diagnostics.
   */
  paramNames: string[];
  /**
   * `true` when the URI ends in a literal `list` segment. List endpoints
   * register `list(...)` + `iterate(...)` actions on the namespace; per-id
   * endpoints register `read(...)`.
   */
  isListEndpoint: boolean;
  /** Original URI verbatim, kept for diagnostics. */
  original: string;
}

/**
 * Parse a `diffusecraft://...` URI per the algorithm documented at the top
 * of this file.
 */
export function parseResourceUri(uri: string): ParsedResourceUri {
  const SCHEME = "diffusecraft://";
  const path = uri.startsWith(SCHEME) ? uri.slice(SCHEME.length) : uri;
  const segments = path.split("/").filter((s) => s.length > 0);

  const paramNames: string[] = [];
  const literalSegments: string[] = [];
  for (const segment of segments) {
    const m = /^\{([^}]+)\}$/.exec(segment);
    if (m) {
      paramNames.push(m[1] ?? "");
    } else {
      literalSegments.push(segment);
    }
  }

  // Drop trailing literal `list` (sentinel — encoded on the action key).
  let isListEndpoint = false;
  if (
    literalSegments.length > 0 &&
    literalSegments[literalSegments.length - 1] === "list"
  ) {
    isListEndpoint = true;
    literalSegments.pop();
  }

  const namespace = camelCaseSegments(literalSegments);
  if (namespace === "") {
    throw new Error(
      `Cannot derive namespace key for resource URI "${uri}" — every segment was either a parameter or a list sentinel.`,
    );
  }

  return { namespace, paramNames, isListEndpoint, original: uri };
}

// ---------------------------------------------------------------------------
// URI template substitution
// ---------------------------------------------------------------------------

/**
 * Substitute positional `params` into the `{...}` placeholders of `uri`,
 * preserving placeholder order. Each parameter is encoded with
 * `encodeURIComponent` so values containing reserved characters (`/`, `?`,
 * `#`, `&`) cannot inject extra path segments or query params.
 *
 * Throws when the number of `params` does not match the number of
 * placeholders — the runtime call site treats this as a programming bug
 * (the typed signature should already prevent it).
 */
export function fillResourceUri(
  uri: string,
  params: readonly (string | number)[],
): string {
  const re = /\{([^}]+)\}/g;
  let i = 0;
  const out = uri.replace(re, () => {
    if (i >= params.length) {
      throw new Error(
        `URI template "${uri}" expects more parameters than were supplied.`,
      );
    }
    const value = params[i++];
    if (value === undefined || value === null) {
      throw new Error(
        `URI template "${uri}" parameter #${i - 1} is undefined.`,
      );
    }
    return encodeURIComponent(String(value));
  });
  if (i !== params.length) {
    throw new Error(
      `URI template "${uri}" received ${params.length} parameter(s) but only ${i} placeholder(s).`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pagination detection
// ---------------------------------------------------------------------------

/**
 * Inspect a resource's Zod content schema to detect whether it is a
 * paginated envelope. Returns `true` when the schema is a `ZodObject` whose
 * shape carries both `items` (any value — typically a `ZodArray`) and
 * `next_cursor` keys — the canonical shape produced by `paginated(...)` in
 * `@diffusecraft/mcp-tools/shared/pagination.ts`.
 *
 * This introspection is robust because:
 *   1. The catalog never hand-rolls paginated envelopes; every paginated
 *      resource flows through the `paginated()` factory.
 *   2. Every paginated entry in the v1 catalog (`server/paired-devices`,
 *      `server/audit-log`, `documents/list`, `layers/list`,
 *      `control-layers/list`, `regions/list`, `history/list`, `jobs/list`,
 *      `models/list`, `presets/list`, `undo-stack/{...}`, `redo-stack/{...}`)
 *      uses `paginated(item)`, so the shape match holds for all.
 *
 * Exported for tests / introspection-driven docs.
 */
export function isPaginatedSchema(schema: z.ZodTypeAny): boolean {
  // Zod's `ZodObject` exposes `.shape` lazily; reading it materializes the
  // inner record. Guard with `instanceof` so non-objects (e.g. `ServerInfo`'s
  // top-level `ZodObject` is also matched, but its shape lacks `items` /
  // `next_cursor`) early-return as non-paginated.
  if (!(schema instanceof z.ZodObject)) return false;
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  return "items" in shape && "next_cursor" in shape;
}

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

/**
 * Loose ISO 8601 timestamp regex. Accepts the canonical RFC-3339 forms the
 * catalog produces: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, optional fractional
 * seconds, optional `Z` / `±HH:MM` offset.
 *
 * The regex is intentionally permissive — server-side validation (Zod's
 * `.datetime()` in `@diffusecraft/mcp-tools/shared/common.ts`) is the
 * authoritative gate; the client-side check exists so blatantly malformed
 * inputs fail fast with `field_path: 'since'` before a round trip.
 */
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validate `opts` and project to the wire-shaped {@link ResourceReadQuery}.
 * Throws {@link ClientValidationError} with a `field_path` on failure
 * (FR-13 / FR-17). Returns `undefined` when no query knobs are set, so the
 * transport receives a falsy `query` and skips URI rewriting.
 */
function buildQuery(
  opts: ResourceReadOptions | undefined,
  cursor: string | undefined,
): ResourceReadQuery | undefined {
  if (!opts && cursor === undefined) return undefined;

  if (opts?.since !== undefined) {
    if (typeof opts.since !== "string" || !ISO_8601_REGEX.test(opts.since)) {
      throw new ClientValidationError(
        `Invalid \`since\`: expected an ISO 8601 timestamp string, received ${JSON.stringify(opts.since)}.`,
        { field_path: "since" },
      );
    }
  }

  if (opts?.fields !== undefined) {
    if (!Array.isArray(opts.fields)) {
      throw new ClientValidationError(
        `Invalid \`fields\`: expected string[], received ${typeof opts.fields}.`,
        { field_path: "fields" },
      );
    }
    if (opts.fields.length === 0) {
      throw new ClientValidationError(
        "Invalid `fields`: array must be non-empty.",
        { field_path: "fields" },
      );
    }
    for (let i = 0; i < opts.fields.length; i++) {
      const f = opts.fields[i];
      if (typeof f !== "string" || f.length === 0) {
        throw new ClientValidationError(
          `Invalid \`fields[${i}]\`: each entry must be a non-empty string.`,
          { field_path: `fields.${i}` },
        );
      }
    }
  }

  const query: ResourceReadQuery = {};
  if (opts?.since !== undefined) query.since = opts.since;
  if (opts?.fields !== undefined) query.fields = opts.fields;
  if (cursor !== undefined) query.cursor = cursor;
  return Object.keys(query).length === 0 ? undefined : query;
}

// ---------------------------------------------------------------------------
// Reader function shapes
// ---------------------------------------------------------------------------

/**
 * Zero-parameter reader. Returns the resource payload as `unknown` — the
 * mapped {@link TypedResourceReaders} type tightens this to the catalog's
 * inferred content shape at the namespace boundary.
 */
export type ZeroArgReader = (opts?: ResourceReadOptions) => Promise<unknown>;

/**
 * One-or-more-positional-parameter reader. Each parameter substitutes into
 * a `{...}` placeholder of the URI in declaration order.
 *
 * The args tuple is `[...params, opts?]` at the call site (TS does not
 * permit an optional element to follow a rest, so the parameter list is
 * typed loosely as `(string | number | ResourceReadOptions | undefined)[]`
 * and the runtime splits on the trailing object). Per-namespace static
 * overloads can tighten this if a higher-level codegen pass replaces this
 * runtime construction.
 */
export type ParamReader = (
  ...args: ReadonlyArray<string | number | ResourceReadOptions | undefined>
) => Promise<unknown>;

/**
 * Pagination iterator factory. Returns an `AsyncIterableIterator` that
 * yields `unknown` items across pages until the server stops sending
 * `next_cursor`.
 */
export type ZeroArgIterator = (
  opts?: ResourceIterateOptions,
) => AsyncIterableIterator<unknown>;

/**
 * Parameterized iterator factory. Same call-site shape as
 * {@link ParamReader} (`[...params, opts?]`) — see that type for the
 * variadic-typing caveat.
 */
export type ParamIterator = (
  ...args: ReadonlyArray<string | number | ResourceIterateOptions | undefined>
) => AsyncIterableIterator<unknown>;

/**
 * Public reader namespace shape. Each catalog URI contributes one or more
 * action keys (`read` / `list` / `iterate`) on a single namespace.
 *
 * The runtime always populates an instance of this shape; the
 * {@link TypedResourceReaders} mapped type below is the strictly-typed
 * surface consumers see.
 */
export interface ResourceNamespace {
  read?: ZeroArgReader | ParamReader;
  list?: ZeroArgReader;
  iterate?: ZeroArgIterator | ParamIterator;
}

/**
 * Public surface — one namespace per derived key in `client.resources`.
 *
 * The mapped type is intentionally loose at the catalog-introspection layer
 * (`Record<string, ResourceNamespace>`); call sites can layer per-namespace
 * narrowing on top via the catalog's `ResourceUri` literal union when they
 * need the exact return shape. Tightening the mapped type to derive the
 * action keys from URI structure at compile time is a follow-up
 * refinement — the runtime guarantees the structure documented at the top
 * of this file.
 */
export type TypedResourceReaders = Record<string, ResourceNamespace>;

// ---------------------------------------------------------------------------
// Argument-tail extraction (positional params + optional opts)
// ---------------------------------------------------------------------------

/**
 * Split a variadic `args` tuple of the form
 * `[...params, opts?]` into (params, opts).
 *
 * The last entry is treated as `opts` when it is a non-array, non-null
 * object (string / number params never hit that branch). Missing trailing
 * `opts` returns `undefined`.
 */
function splitArgs(
  args: readonly unknown[],
): { params: readonly unknown[]; opts: ResourceReadOptions | undefined } {
  if (args.length === 0) return { params: [], opts: undefined };
  const last = args[args.length - 1];
  if (
    last !== null &&
    typeof last === "object" &&
    !Array.isArray(last)
  ) {
    return {
      params: args.slice(0, args.length - 1),
      opts: last as ResourceReadOptions,
    };
  }
  return { params: args, opts: undefined };
}

/**
 * Coerce arbitrary param values to the `string | number` accepted by
 * {@link fillResourceUri}. Anything else fails fast — typed call sites
 * should never produce an invalid value.
 */
function coerceParams(
  params: readonly unknown[],
): readonly (string | number)[] {
  return params.map((p, i) => {
    if (typeof p === "string" || typeof p === "number") return p;
    throw new ClientValidationError(
      `Invalid resource URI parameter at position ${i}: expected string or number, received ${typeof p}.`,
      { field_path: `params.${i}` },
    );
  });
}

// ---------------------------------------------------------------------------
// createResourceReaders — runtime constructor
// ---------------------------------------------------------------------------

/**
 * Build the typed `client.resources` namespace tree from `catalog.resources`.
 * One namespace per derived key; per-URI actions (`read` / `list` /
 * `iterate`) merged into the same namespace when multiple URIs collapse to
 * the same key (e.g. `history/list` + `history/{id}` → both register on
 * `history`).
 *
 * @example
 * ```ts
 * const resources = createResourceReaders(transport);
 * const info = await resources.serverInfo.read();
 * const page = await resources.documents.list();
 * for await (const item of resources.history.iterate()) {
 *   // item is HistoryItemSummary (unknown at this layer, narrowed at consumer)
 * }
 * const stack = await resources.undoStack.read("doc-1");
 * ```
 */
export function createResourceReaders(
  transport: Transport,
): TypedResourceReaders {
  const namespaces: Record<string, ResourceNamespace> = {};

  for (const resource of catalog.resources) {
    const parsed = parseResourceUri(resource.uri);
    const paginated = isPaginatedSchema(resource.contentSchema);

    // Materialize the namespace lazily — multiple URIs can share one.
    const ns = (namespaces[parsed.namespace] ??= {});

    if (parsed.paramNames.length === 0) {
      // ---------- No-param URI ----------
      if (parsed.isListEndpoint || paginated) {
        // Paginated listing: `.list(opts)` + `.iterate(opts)`.
        const list: ZeroArgReader = (opts) => {
          const query = buildQuery(opts, undefined);
          return transport.readResource(resource.uri as ResourceUri, query, {
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
          });
        };
        const iterate: ZeroArgIterator = (opts) =>
          paginatedIterator(transport, resource.uri, [], opts);
        ns.list = list;
        // Surface `iterate` only when the response is paginated. List-shaped
        // endpoints whose content schema is non-paginated (none in v1, but
        // defensively handled) get only `list`.
        if (paginated) ns.iterate = iterate;
      } else {
        // Singleton: `.read(opts)`.
        const read: ZeroArgReader = (opts) => {
          const query = buildQuery(opts, undefined);
          return transport.readResource(resource.uri as ResourceUri, query, {
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
          });
        };
        // Don't overwrite a `read` already registered by a sibling URI
        // (e.g. `history/{id}` registering before `history/list` would
        // be the sibling case for *parameterized* read; this branch only
        // applies to no-param singletons, which never collide today).
        ns.read = read;
      }
      continue;
    }

    // ---------- Parameterized URI ----------
    const expectedArity = parsed.paramNames.length;
    const read: ParamReader = (...args) => {
      const { params, opts } = splitArgs(args);
      if (params.length !== expectedArity) {
        throw new ClientValidationError(
          `Resource "${resource.uri}" expects ${expectedArity} positional parameter(s), received ${params.length}.`,
          { field_path: "params" },
        );
      }
      const concrete = fillResourceUri(resource.uri, coerceParams(params));
      const query = buildQuery(opts, undefined);
      return transport.readResource(concrete as ResourceUri, query, {
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      });
    };
    ns.read = read;

    if (paginated) {
      const iterate: ParamIterator = (...args) => {
        const { params, opts } = splitArgs(args);
        if (params.length !== expectedArity) {
          throw new ClientValidationError(
            `Resource "${resource.uri}" expects ${expectedArity} positional parameter(s) before opts, received ${params.length}.`,
            { field_path: "params" },
          );
        }
        return paginatedIterator(transport, resource.uri, params, opts);
      };
      ns.iterate = iterate;
    }
  }

  return namespaces;
}

// ---------------------------------------------------------------------------
// Pagination iterator
// ---------------------------------------------------------------------------

/**
 * Drive a paginated resource via successive `readResource` calls, yielding
 * each item across all pages. The loop terminates when the server returns
 * a page without a `next_cursor` (per `paginated(...)`'s convention in
 * `shared/pagination.ts` — `next_cursor` is `string | undefined`; absence
 * means "no further pages").
 *
 * The first call carries the consumer's `since` / `fields` query without a
 * cursor; subsequent calls forward `next_cursor` as `?cursor=<...>` via
 * the shared {@link ResourceReadQuery} slot (see `_query.ts`'s
 * `appendResourceQuery`).
 *
 * Defensive bounds:
 *
 *   - The page response is duck-typed: any `unknown` payload that exposes
 *     `items: unknown[]` is iterated. Servers that return `null` items are
 *     treated as empty pages. Non-array `items` raises `ClientValidationError`
 *     so transport-level shape drift surfaces with a clear message instead
 *     of an opaque iteration crash.
 *   - The loop guards against malformed `next_cursor` values: only string
 *     cursors trigger a follow-up read; everything else (including the
 *     literal `null` documented in `Paginated<T>`) terminates the iterator.
 *   - A pathological server that returns the *same* `next_cursor` page
 *     after page would loop forever; an internal `MAX_PAGES` bound (1024)
 *     short-circuits with a clear `ClientValidationError`. The bound
 *     accommodates 50-item pages × 1024 = 51,200 items — well above any
 *     realistic v1 catalog browse session — without becoming a footgun.
 */
async function* paginatedIterator(
  transport: Transport,
  uriTemplate: string,
  rawParams: readonly unknown[],
  opts: ResourceIterateOptions | undefined,
): AsyncIterableIterator<unknown> {
  const concreteUri =
    rawParams.length === 0
      ? uriTemplate
      : fillResourceUri(uriTemplate, coerceParams(rawParams));

  const MAX_PAGES = 1024;
  let cursor: string | undefined;
  let pageCount = 0;

  while (true) {
    if (pageCount >= MAX_PAGES) {
      throw new ClientValidationError(
        `Pagination iterator for "${uriTemplate}" exceeded ${MAX_PAGES} pages — refusing to continue.`,
      );
    }
    pageCount++;

    const query = buildQuery(opts, cursor);
    const readOpts: TransportReadResourceOptions | undefined =
      opts?.signal !== undefined ? { signal: opts.signal } : undefined;
    const page = (await transport.readResource(
      concreteUri as ResourceUri,
      query,
      readOpts,
    )) as { items?: unknown; next_cursor?: unknown } | null;

    if (page === null || typeof page !== "object") {
      throw new ClientValidationError(
        `Paginated resource "${uriTemplate}" returned a non-object response.`,
      );
    }

    const rawItems = page.items;
    if (rawItems !== undefined && !Array.isArray(rawItems)) {
      throw new ClientValidationError(
        `Paginated resource "${uriTemplate}" returned a non-array \`items\` field.`,
      );
    }
    if (Array.isArray(rawItems)) {
      for (const item of rawItems) yield item;
    }

    const next = page.next_cursor;
    if (typeof next !== "string" || next.length === 0) {
      return;
    }
    if (next === cursor) {
      throw new ClientValidationError(
        `Paginated resource "${uriTemplate}" returned a repeated next_cursor — refusing to loop.`,
      );
    }
    cursor = next;
  }
}
