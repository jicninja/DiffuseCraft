/// <reference path="./types/ambient.d.ts" />
/**
 * @diffusecraft/server — backend library.
 *
 * Hosts (the standalone `apps/server`, MeshCraft, integration tests) import
 * `createDiffuseCraftServer` and call `start()` / `stop()`. The library
 * mounts three MCP transports simultaneously (stdio, Streamable HTTP,
 * in-memory), proxies ComfyUI, persists state in SQLite, and registers
 * handlers against the `@diffusecraft/mcp-tools` catalog.
 *
 * See `.kiro/specs/server-architecture/{requirements,design,tasks}.md` for
 * the detailed spec.
 */

export { createDiffuseCraftServer } from './lib/server.js';

export type {
  DiffuseCraftServer,
  McpInterface,
  Unsubscribe,
} from './public-api.js';

export type {
  ServerConfig,
  ComfyConfig,
  TransportsConfig,
  PairingConfig,
  ComfyProxyConfig,
  LoggingConfig,
  AssetsConfig,
  SamplingConfig,
  PromptEnhancementConfig,
} from './types/config.js';

export {
  ServerConfigSchema,
  ComfyConfigSchema,
  TransportsConfigSchema,
  PairingConfigSchema,
  ComfyProxyConfigSchema,
  LoggingConfigSchema,
  AssetsConfigSchema,
  SamplingConfigSchema,
  PromptEnhancementConfigSchema,
  parseServerConfig,
} from './types/config.js';

export type {
  ServerStatus,
  ServerLifecycleEvent,
  ServerLifecycleEventKind,
  MountedTransports,
} from './types/lifecycle.js';

export type {
  RequestContext,
  HandlerContext,
  EmbeddingContext,
  TransportKind,
  ToolHandler,
} from './types/handler-context.js';

export type {
  PairingRequest,
  PairingDecision,
  PairingRequestHandler,
  JobLifecycleEvent,
} from './lib/hooks/registry.js';

export type { AuditEntry } from './lib/audit/log.js';

export {
  ConfigValidationError,
  IllegalLifecycleError,
  ServerError,
  UnauthorizedError,
  PayloadTooLargeError,
  RateLimitedError,
  UnsupportedCatalogVersionError,
  ToolNotFoundError,
} from './types/errors.js';

// Re-export catalog types so hosts can implement custom tools without
// importing `@diffusecraft/mcp-tools` directly. The underlying shapes come
// from mcp-tools; `lib/catalog/types.ts` re-exports them.
export type { ToolDefinition, ToolCategory, CatalogManifest } from './lib/catalog/types.js';
export { SUPPORTED_CATALOG_VERSION } from './lib/catalog/types.js';
