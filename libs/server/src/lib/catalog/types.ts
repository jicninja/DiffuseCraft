/**
 * Catalog types — re-exports from `@diffusecraft/mcp-tools`.
 *
 * The canonical shapes for `ToolDefinition`, `ResourceDefinition`,
 * `EventDefinition`, `PromptDefinition`, and `CatalogDefinition` live in the
 * mcp-tool-catalog spec (`@diffusecraft/mcp-tools/src/shared/define-tool.ts`).
 * This module re-exports them so the rest of `@diffusecraft/server` can
 * import a stable local symbol while delegating the contract to mcp-tools.
 *
 * `SUPPORTED_CATALOG_VERSION` is the version the server advertises during the
 * MCP handshake and uses for `versionCompatMw`. It tracks `CATALOG_VERSION`
 * from mcp-tools.
 */

import type {
  ToolDefinition as McpToolDefinition,
  ResourceDefinition as McpResourceDefinition,
  EventDefinition as McpEventDefinition,
  PromptDefinition as McpPromptDefinition,
  CatalogDefinition,
  ToolCategory as McpToolCategory,
} from '@diffusecraft/mcp-tools';
import { CATALOG_VERSION } from '@diffusecraft/mcp-tools';

export type ToolCategory = McpToolCategory;
export type ToolDefinition<I = unknown, O = unknown> = McpToolDefinition<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  I extends import('zod').ZodTypeAny ? I : any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  O extends import('zod').ZodTypeAny ? O : any
>;

export type ResourceDefinition = McpResourceDefinition;
export type EventDefinition = McpEventDefinition;
export type PromptDefinition = McpPromptDefinition;

/** Boot-time manifest the dispatcher iterates to register handlers. */
export interface CatalogManifest extends Pick<CatalogDefinition, 'version'> {
  readonly version: string;
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly resources: ReadonlyArray<ResourceDefinition>;
  readonly events: ReadonlyArray<EventDefinition>;
  readonly prompts: ReadonlyArray<PromptDefinition>;
}

/** Server's currently-supported catalog version (advertised in handshake). */
export const SUPPORTED_CATALOG_VERSION: string = CATALOG_VERSION;
