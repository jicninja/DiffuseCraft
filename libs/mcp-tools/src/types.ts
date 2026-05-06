/**
 * Catalog-derived alias types for client-SDK consumption.
 *
 * These narrow the discriminated unions baked into the `catalog` literal
 * (preserved by `defineTool` / `defineEvent` / `defineResource` /
 * `defineCatalog`) into ergonomic helpers:
 *
 * - `ToolName`         — union of every tool's `name`
 * - `ToolInput<N>`     — Zod-inferred input shape for tool `N`
 * - `ToolOutput<N>`    — Zod-inferred output shape for tool `N`
 * - `EventName`        — union of every event's `name`
 * - `EventPayload<E>`  — Zod-inferred payload shape for event `E`
 * - `ResourceUri`      — union of every resource's `uri`
 *
 * Re-exported by `@diffusecraft/diffusion-client` so SDK consumers can
 * type tool calls without importing this package directly
 * (requirements §3.1 FR-3, design.md §3).
 */
import type { z } from "zod";
import type { catalog } from "./manifest";

/**
 * Tuple-typed entries of the canonical catalog (literal `name` / `uri` is
 * preserved on each element thanks to the `const`-generic
 * `defineCatalog` factory).
 */
type ToolDef = (typeof catalog.tools)[number];
type EventDef = (typeof catalog.events)[number];
type ResourceDef = (typeof catalog.resources)[number];

/** Union of every catalog tool's `name` literal. */
export type ToolName = ToolDef["name"];

/**
 * Resolves the Zod-inferred input type for tool `N`. Used by SDK call
 * sites (e.g., `client.tools.generateImage(args: ToolInput<"generate_image">)`).
 */
export type ToolInput<N extends ToolName> = Extract<
  ToolDef,
  { name: N }
> extends { inputSchema: infer I }
  ? I extends z.ZodTypeAny
    ? z.input<I>
    : never
  : never;

/** Resolves the Zod-inferred output type for tool `N`. */
export type ToolOutput<N extends ToolName> = Extract<
  ToolDef,
  { name: N }
> extends { outputSchema: infer O }
  ? O extends z.ZodTypeAny
    ? z.output<O>
    : never
  : never;

/** Union of every event's `name` literal. */
export type EventName = EventDef["name"];

/** Resolves the Zod-inferred payload type for event `E`. */
export type EventPayload<E extends EventName> = Extract<
  EventDef,
  { name: E }
> extends { payloadSchema: infer P }
  ? P extends z.ZodTypeAny
    ? z.output<P>
    : never
  : never;

/** Union of every catalog resource's `uri` literal (incl. path templates). */
export type ResourceUri = ResourceDef["uri"];
