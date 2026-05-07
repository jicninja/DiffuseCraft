/**
 * `diffusecraft://server/info` resource.
 *
 * Returns the catalog-shaped {@link ServerInfo} record so a paired agent
 * can introspect the server it just connected to (FR-54 — "you-are-here"
 * map for fresh agents). All values are read live: the comfyui status
 * comes from {@link HealthMonitor}, the mounted-transport list is the
 * static set the host wired, and the recommended starting workflow is
 * the v1 generate-image flow.
 */

import type { HealthMonitor } from '../comfy/health.js';
import type { MountedTransports } from '../../types/lifecycle.js';

export interface ServerInfoSnapshotArgs {
  /** Audit-display server name (`config.host_name`). */
  serverName: string;
  /** Catalog version range tuple `[min, max]`. */
  catalogVersionRange: readonly [string, string];
  /** Live ComfyUI health probe. */
  health: HealthMonitor;
  /** Mounted transport set descriptor. */
  mountedTransports: MountedTransports;
  /** True when the audit log is wired (always true today). */
  auditLogEnabled: boolean;
}

export function readServerInfo(args: ServerInfoSnapshotArgs): Record<string, unknown> {
  const internal = args.health.getStatus();
  const comfyui_status =
    internal === 'healthy'
      ? 'ready'
      : internal === 'degraded' || internal === 'unreachable'
        ? 'disconnected'
        : 'unknown';

  const mounted: string[] = ['in-memory'];
  if (args.mountedTransports.stdio) mounted.push('stdio');
  if (args.mountedTransports.http) mounted.push('http');

  return {
    name: args.serverName,
    server_version: args.catalogVersionRange[1],
    catalog_version_range: args.catalogVersionRange,
    comfyui_status,
    mounted_transports: mounted,
    audit_log_enabled: args.auditLogEnabled,
    recommended_starting_workflow: {
      summary:
        'Use `generate_image` with a prompt and an optional `preset_name`. ' +
        'Read `diffusecraft://models/list` and `diffusecraft://presets/list` to discover ' +
        'available checkpoints + presets first. Subscribe to `job.progress` and `job.completed` ' +
        'for streaming generation feedback.',
      tools: ['generate_image', 'cancel_job', 'enhance_prompt', 'undo', 'redo'],
      prompts: [],
    },
  };
}
