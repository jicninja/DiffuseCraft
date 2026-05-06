/**
 * Client/server capability declarations exchanged at the MCP handshake
 * (FR-37, FR-38). Server stores client capabilities per-session and uses
 * them to adapt response serialization (inline vs ref, PNG vs WEBP).
 */
import { z } from "zod";

/**
 * Workspaces recognised by the v1 catalog.
 */
export const WorkspaceTag = z.enum([
  "Generate",
  "Inpaint",
  "Upscale",
  "Live",
  "CustomGraph",
  "Animation",
]);
export type WorkspaceTag = z.infer<typeof WorkspaceTag>;

/**
 * What the client wants from the server.
 *
 * - `accepts_lossy_images`: server may return WEBP for non-alpha-critical sources.
 * - `max_inline_image_kb`: hard cap on inline base64 payload size; over this → ref.
 * - `streaming_supported`: client can consume server-emitted job/document events.
 * - `prefers_resources_over_tools`: hint for capability-tuning of recommended flows.
 * - `active_workspace`: drives FR-38 catalog filtering at `tools/list` time.
 */
export const ClientCapabilities = z.object({
  accepts_lossy_images: z.boolean().default(false),
  max_inline_image_kb: z.number().int().min(16).max(2048).default(256),
  streaming_supported: z.boolean().default(true),
  prefers_resources_over_tools: z.boolean().default(false),
  active_workspace: WorkspaceTag.optional(),
});
export type ClientCapabilities = z.infer<typeof ClientCapabilities>;

/**
 * What the server exposes to the client.
 *
 * `catalog_version_range` tuple is inclusive `[min, max]`; client picks the
 * highest version it understands (FR-7).
 */
export const ServerCapabilities = z.object({
  catalog_version_range: z.tuple([z.string(), z.string()]),
  comfyui_status: z.enum(["ready", "starting", "disconnected", "unknown"]),
  supported_workspaces: z.array(WorkspaceTag),
  sampling_supported: z.boolean(),
  audit_log_enabled: z.boolean(),
});
export type ServerCapabilities = z.infer<typeof ServerCapabilities>;
