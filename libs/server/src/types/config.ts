/**
 * `ServerConfig` Zod schema, defaults, and inferred TypeScript type.
 *
 * Every field has a documented default so that
 * `createDiffuseCraftServer({})` succeeds and produces a server with sensible
 * defaults for a single-user LAN scenario (FR-6).
 *
 * Validation runs at the entrypoint before any subsystem is constructed
 * (FR-7); on failure, a `ConfigValidationError` is thrown.
 */

import { z } from 'zod';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// ComfyUI integration modes (the deeper spec lives in `comfyui-management`).
// ---------------------------------------------------------------------------

export const ComfyConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('managed'),
    install_dir: z.string().min(1),
  }),
  z.object({
    mode: z.literal('external-local'),
    url: z.string().url(),
  }),
  z.object({
    mode: z.literal('external-remote'),
    url: z.string().url(),
  }),
]);

export type ComfyConfig = z.infer<typeof ComfyConfigSchema>;

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export const TransportsConfigSchema = z.object({
  stdio: z.boolean().default(false),
  http: z
    .object({
      host: z.string().default('0.0.0.0'),
      port: z.number().int().min(1).max(65535).default(7860),
    })
    .nullable()
    .default({ host: '0.0.0.0', port: 7860 }),
  /**
   * The in-memory transport is always-on (FR-14). The field exists in the
   * type to make it discoverable; setting it to `false` is rejected at
   * runtime.
   */
  inMemory: z.literal(true).default(true),
});

export type TransportsConfig = z.infer<typeof TransportsConfigSchema>;

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export const PairingConfigSchema = z.object({
  window_seconds: z.number().int().min(1).default(120),
  mdns_service_name: z.string().default('diffusecraft._tcp'),
  mdns_advertise: z.boolean().default(true),
  qr_fallback_enabled: z.boolean().default(true),
});

export type PairingConfig = z.infer<typeof PairingConfigSchema>;

// ---------------------------------------------------------------------------
// ComfyUI proxy / rate limits
// ---------------------------------------------------------------------------

export const ComfyProxyConfigSchema = z.object({
  /**
   * Concurrency lives in ComfyUI's own configuration; we mirror it here for
   * tooling purposes only. Default = 1 (single-GPU consumer rig).
   */
  max_concurrent_jobs: z.number().int().min(1).default(1),
  queue_depth: z.number().int().min(1).default(50),
  rate_limits: z
    .object({
      mutating_per_minute: z.number().int().min(1).default(50),
      max_payload_bytes: z
        .number()
        .int()
        .min(1)
        .default(16 * 1024 * 1024),
    })
    .default({ mutating_per_minute: 50, max_payload_bytes: 16 * 1024 * 1024 }),
});

export type ComfyProxyConfig = z.infer<typeof ComfyProxyConfigSchema>;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  pretty: z.boolean().default(false),
  destination: z.union([z.literal('stdout'), z.object({ file: z.string().min(1) })]).default('stdout'),
});

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

// ---------------------------------------------------------------------------
// Assets / blobs
// ---------------------------------------------------------------------------

function defaultAssetsDir(): string {
  // OS-appropriate data dir. We intentionally avoid the `xdg-basedir` package
  // until dep installation is unblocked; the hostname-keyed default still
  // works on every supported platform.
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'diffusecraft');
  }
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? home, 'diffusecraft');
  }
  return path.join(process.env['XDG_DATA_HOME'] ?? path.join(home, '.local', 'share'), 'diffusecraft');
}

export const AssetsConfigSchema = z.object({
  directory: z.string().min(1).default(defaultAssetsDir()),
  blob_ttl_seconds: z.number().int().min(0).default(300),
  audit_retention_days: z.number().int().min(1).default(30),
  max_directory_bytes: z
    .number()
    .int()
    .min(1)
    .default(5 * 1024 * 1024 * 1024),
});

export type AssetsConfig = z.infer<typeof AssetsConfigSchema>;

// ---------------------------------------------------------------------------
// Sampling target
// ---------------------------------------------------------------------------

/**
 * Sampling-target preferences (prompt-enhancement FR-10/§3.4). When the
 * calling client lacks the `sampling` capability the resolver consults
 * `default_agent_token_name` next, then falls back to the first active
 * sampling-capable session. All fields optional with sensible defaults.
 */
export const SamplingConfigSchema = z.object({
  default_agent_token_name: z.string().min(1).optional(),
});

export type SamplingConfig = z.infer<typeof SamplingConfigSchema>;

// ---------------------------------------------------------------------------
// Prompt enhancement
// ---------------------------------------------------------------------------

/**
 * Prompt-enhancement runtime config (prompt-enhancement requirements
 * §3.6-ter, design.md §4.4). `auto_translate_enabled` is a kill-switch
 * for the auto-translate phase; `system_prompt_path` lets operators ship
 * a custom default template. `templates_dir` overrides the per-family
 * directory used by the loader (FR-16-d).
 */
export const PromptEnhancementConfigSchema = z.object({
  auto_translate_enabled: z.boolean().default(true),
  /**
   * Sampling round-trip timeout (FR-20). The server gives up and emits
   * `ENHANCEMENT_TIMEOUT` after this many ms.
   */
  sampling_timeout_ms: z.number().int().min(1_000).max(120_000).default(30_000),
  /**
   * Maximum agent output tokens. Translates to `max_tokens` in the MCP
   * sampling request. Tuned to ~150 to keep medium-length prompts cheap.
   */
  max_output_tokens: z.number().int().min(32).max(2048).default(256),
  /**
   * Per-family templates directory (FR-16-d). Defaults to the bundled
   * directory inside `@diffusecraft/server`.
   */
  templates_dir: z.string().min(1).optional(),
  /**
   * Optional path to a single override system prompt (Q1). Applies to
   * every family unless `templates_dir` is also configured.
   */
  system_prompt_path: z.string().min(1).optional(),
});

export type PromptEnhancementConfig = z.infer<typeof PromptEnhancementConfigSchema>;

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

/**
 * Undo/redo runtime config (undo-redo-system requirements §3.2 FR-9, §3.3
 * FR-10, §3.4 FR-13, §3.7 FR-25, §3.8 FR-27). All fields have documented
 * defaults so the block is safely omittable from `ServerConfig`.
 *
 *   - `max_depth_per_client`: per-`(token, document)` undo/redo cap
 *     (FR-9). Default 100 ops.
 *   - `snapshot_every_n`: anchor a full snapshot every N pushes (FR-10).
 *     Default 20.
 *   - `retain_after_disconnect_seconds`: grace window before stacks are
 *     discarded after a token's last connection drops (FR-25). Default
 *     600 s (10 min).
 *   - `max_total_memory_bytes`: total memory budget across all stacks
 *     (FR-27). Default 512 MiB. Eviction (Phase B) uses this.
 *   - `floor_ops_per_stack`: minimum number of commands kept per stack
 *     during eviction (FR-27 implicit, design.md §6 line 250). The
 *     `EvictionPolicy` will not drop below this depth from any stack
 *     even when total memory still exceeds budget — recent undo is
 *     always preserved. Default 5.
 *   - `conflict_window_ms`: multi-client conflict-detection window
 *     (FR-13, design.md §7). When `UndoRedoManager.execute` runs, it
 *     looks at `document.changed` events published in the last
 *     `conflict_window_ms`; if a prior event from a different token
 *     touches at least one of the same layers, the new event is flagged
 *     `conflict: true`. Default 1000 ms (1 s).
 */
export const UndoConfigSchema = z
  .object({
    max_depth_per_client: z.number().int().min(1).default(100),
    snapshot_every_n: z.number().int().min(1).default(20),
    retain_after_disconnect_seconds: z.number().int().min(0).default(600),
    max_total_memory_bytes: z
      .number()
      .int()
      .min(1)
      .default(512 * 1024 * 1024),
    floor_ops_per_stack: z.number().int().min(0).default(5),
    conflict_window_ms: z.number().int().min(0).default(1000),
  })
  .default({
    max_depth_per_client: 100,
    snapshot_every_n: 20,
    retain_after_disconnect_seconds: 600,
    max_total_memory_bytes: 512 * 1024 * 1024,
    floor_ops_per_stack: 5,
    conflict_window_ms: 1000,
  });

export type UndoConfig = z.infer<typeof UndoConfigSchema>;

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

const HOST_NAME_DEFAULT = os.hostname?.() ?? 'diffusecraft';

export const ServerConfigSchema = z
  .object({
    comfyui: ComfyConfigSchema.default({
      mode: 'external-local' as const,
      url: 'http://127.0.0.1:8188',
    }),
    persistence: z
      .union([z.literal(':memory:'), z.string().min(1)])
      .default(path.join(defaultAssetsDir(), 'diffusecraft.sqlite')),
    transports: TransportsConfigSchema.default({
      stdio: false,
      http: { host: '0.0.0.0', port: 7860 },
      inMemory: true,
    }),
    pairing: PairingConfigSchema.default({
      window_seconds: 120,
      mdns_service_name: 'diffusecraft._tcp',
      mdns_advertise: true,
      qr_fallback_enabled: true,
    }),
    comfyui_proxy: ComfyProxyConfigSchema.default({
      max_concurrent_jobs: 1,
      queue_depth: 50,
      rate_limits: { mutating_per_minute: 50, max_payload_bytes: 16 * 1024 * 1024 },
    }),
    logging: LoggingConfigSchema.default({ level: 'info', pretty: false, destination: 'stdout' }),
    assets: AssetsConfigSchema.default({
      directory: defaultAssetsDir(),
      blob_ttl_seconds: 300,
      audit_retention_days: 30,
      max_directory_bytes: 5 * 1024 * 1024 * 1024,
    }),
    sampling: SamplingConfigSchema.default({}),
    prompt_enhancement: PromptEnhancementConfigSchema.default({
      auto_translate_enabled: true,
      sampling_timeout_ms: 30_000,
      max_output_tokens: 256,
    }),
    undo: UndoConfigSchema,
    bootstrap_admin: z.enum(['print', 'event', 'silent']).default('print'),
    in_memory_token_name: z.string().min(1).default(`_in_process_${HOST_NAME_DEFAULT}`),
    host_name: z.string().min(1).default(HOST_NAME_DEFAULT),
    /**
     * Hosts may register additional MCP tools at construction time. Each tool
     * name SHALL be host-prefixed (`meshcraft.start_3d_pipeline`) to avoid
     * catalog collisions (FR-12). Validated when the dispatcher boots.
     */
    custom_tools: z.array(z.unknown()).default([]),
  })
  .strict();

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * Parse a partial config and apply documented defaults.
 *
 * @throws {ConfigValidationError} if validation fails. The error carries the
 * Zod `field_path` of the first offending field plus a human message.
 */
export function parseServerConfig(input: Partial<ServerConfig> | undefined): ServerConfig {
  const result = ServerConfigSchema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ConfigValidationError({
      field_path: issue?.path.map(String).join('.') ?? '<root>',
      message: issue?.message ?? 'invalid ServerConfig',
      issues: result.error.issues,
    });
  }
  return result.data;
}
