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
> {
  /** snake_case verb_noun. Stable contract surface. */
  name: string;
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
 */
export const defineTool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: ToolDefinition<I, O>,
): ToolDefinition<I, O> => def;

/**
 * Resource definition. URIs may include `{id}` segments treated as path
 * params at resolution time.
 */
export interface ResourceDefinition<C extends z.ZodTypeAny = z.ZodTypeAny> {
  uri: string;
  title: string;
  description: string;
  contentSchema: C;
  since: string;
  /** When true, the resource may be polled with `?since=ISO8601` (FR-46). */
  supports_since: boolean;
  /** When true, the resource accepts `?fields=a,b` selection (FR-39). */
  supports_fields: boolean;
}

export const defineResource = <C extends z.ZodTypeAny>(
  def: ResourceDefinition<C>,
): ResourceDefinition<C> => def;

/** Event definition. */
export interface EventDefinition<P extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Event name in `noun.past-tense` form (e.g., `job.completed`). */
  name: string;
  description: string;
  payloadSchema: P;
  since: string;
}

export const defineEvent = <P extends z.ZodTypeAny>(
  def: EventDefinition<P>,
): EventDefinition<P> => def;

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

export const defineCatalog = (def: CatalogDefinition): CatalogDefinition => def;
