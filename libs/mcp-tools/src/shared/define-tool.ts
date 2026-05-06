/**
 * `defineTool`, `defineResource`, `defineEvent`, `definePrompt`,
 * `defineCatalog` — uniform factories that wrap each catalog entry with
 * a typed shape (design.md §2.2).
 *
 * The factories preserve schema generics so handler signatures in
 * `@diffusecraft/server` and call sites in `@diffusecraft/diffusion-client`
 * can infer input/output types directly from the catalog manifest.
 */
import type { z } from "zod";
import type { WorkspaceTag } from "./capabilities";

/** Side-effect class declared on every tool (FR-3). */
export type ToolCategory = "read" | "write" | "job";

export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
  N extends string = string,
> {
  /** snake_case verb_noun. Stable contract surface. */
  name: N;
  /** Short human-readable label. */
  title: string;
  /**
   * Multi-paragraph rich description for agents.
   * ≤200 words for non-obvious tools, ≤60 words for obvious read tools (FR-34).
   * Includes summary, preconditions, side effects, one example invocation.
   */
  description: string;
  /** read | write | job (FR-3). */
  category: ToolCategory;
  /** FR-4: tools must declare idempotency. Read tools must be idempotent. */
  idempotent: boolean;
  /** FR-16: if true, the handler registers a Command in the undo/redo system. */
  reversible: boolean;
  inputSchema: I;
  outputSchema: O;
  /**
   * Validates against `inputSchema`/`outputSchema` at build time.
   *
   * The input uses `z.input<I>` so optional + defaulted fields can be
   * omitted by callers (they will be filled in by Zod parsing); the
   * output uses `z.output<O>` so server responses match what clients
   * see post-parse.
   */
  example?: { input: z.input<I>; output: z.output<O> };
  /** Catalog version that introduced this tool (semver). */
  since: string;
  /** Workspaces in which the tool is offered (FR-38). Omit = all workspaces. */
  workspace?: WorkspaceTag[];
}

/**
 * Identity-typed factory: keeps the I/O generics on the inferred type so
 * downstream code can `typeof generateImage` and pull the schemas back out.
 *
 * The `N` generic captures the literal `name` so `catalog.tools` retains
 * a discriminated union over `name` (consumed by `ToolName` / `ToolInput` /
 * `ToolOutput` aliases re-exported via `types.ts`).
 */
export const defineTool = <
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  N extends string,
>(
  def: ToolDefinition<I, O, N>,
): ToolDefinition<I, O, N> => def;

/**
 * Resource definition. URIs may include `{id}` segments treated as path
 * params at resolution time.
 *
 * The `U` generic captures the literal URI so `catalog.resources` retains
 * a discriminated union over `uri` (consumed by `ResourceUri` re-export).
 */
export interface ResourceDefinition<
  C extends z.ZodTypeAny = z.ZodTypeAny,
  U extends string = string,
> {
  uri: U;
  title: string;
  description: string;
  contentSchema: C;
  since: string;
  /** When true, the resource may be polled with `?since=ISO8601` (FR-46). */
  supports_since: boolean;
  /** When true, the resource accepts `?fields=a,b` selection (FR-39). */
  supports_fields: boolean;
}

export const defineResource = <C extends z.ZodTypeAny, U extends string>(
  def: ResourceDefinition<C, U>,
): ResourceDefinition<C, U> => def;

/**
 * Event definition.
 *
 * The `N` generic captures the literal `name` so `catalog.events` retains
 * a discriminated union over `name` (consumed by `EventName` /
 * `EventPayload<E>` aliases).
 */
export interface EventDefinition<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  N extends string = string,
> {
  /** Event name in `noun.past-tense` form (e.g., `job.completed`). */
  name: N;
  description: string;
  payloadSchema: P;
  since: string;
}

export const defineEvent = <P extends z.ZodTypeAny, N extends string>(
  def: EventDefinition<P, N>,
): EventDefinition<P, N> => def;

/** MCP prompt (templated agent guidance, FR-43). */
export interface PromptArgument {
  name: string;
  description?: string;
  required: boolean;
  default?: string;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: PromptArgument[];
  /**
   * Template string with `{argName}` placeholders. Server interpolates
   * before serving the prompt body to the calling agent.
   */
  template: string;
  since: string;
}

export const definePrompt = (def: PromptDefinition): PromptDefinition => def;

/** Top-level catalog manifest. */
export interface CatalogDefinition {
  version: string;
  tools: ReadonlyArray<ToolDefinition>;
  resources: ReadonlyArray<ResourceDefinition>;
  events: ReadonlyArray<EventDefinition>;
  prompts: ReadonlyArray<PromptDefinition>;
}

/**
 * Generic shape for the manifest literal. Generic parameters preserve the
 * narrowed `ToolDefinition` / `ResourceDefinition` / `EventDefinition`
 * subtypes (with literal `name` / `uri`) so consumers can derive
 * discriminated unions (`ToolName`, `ResourceUri`, `EventName`, etc.)
 * from `typeof catalog`.
 */
export interface NarrowedCatalogDefinition<
  Tools extends ReadonlyArray<ToolDefinition>,
  Resources extends ReadonlyArray<ResourceDefinition>,
  Events extends ReadonlyArray<EventDefinition>,
  Prompts extends ReadonlyArray<PromptDefinition>,
> {
  version: string;
  tools: Tools;
  resources: Resources;
  events: Events;
  prompts: Prompts;
}

/**
 * Identity-typed factory that preserves the precise tuple types of the
 * input arrays, so the resulting `catalog` object keeps literal `name` /
 * `uri` discriminants on each entry. The runtime body is unchanged.
 */
export const defineCatalog = <
  const Tools extends ReadonlyArray<ToolDefinition>,
  const Resources extends ReadonlyArray<ResourceDefinition>,
  const Events extends ReadonlyArray<EventDefinition>,
  const Prompts extends ReadonlyArray<PromptDefinition>,
>(
  def: NarrowedCatalogDefinition<Tools, Resources, Events, Prompts>,
): NarrowedCatalogDefinition<Tools, Resources, Events, Prompts> => def;
