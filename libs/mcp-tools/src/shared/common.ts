/**
 * Common record schemas shared by tools and resources.
 *
 * These describe state shapes (Layer summaries, Jobs, History items,
 * etc.) reused across both read tools and resource manifests.
 */
import { z } from "zod";
import {
  ControlLayerId,
  DocumentId,
  HistoryItemId,
  JobId,
  LayerId,
  PresetId,
  RegionId,
  TokenId,
} from "./ids";
import { ImageEnvelope, Selection, Rect } from "./envelope";
import { WorkspaceTag } from "./capabilities";
import { ErrorResponse } from "./errors";

// ---------- Layer ----------

export const LayerKind = z.enum(["paint", "mask", "control", "region"]);
export type LayerKind = z.infer<typeof LayerKind>;

/** Mask layer subkind (mask-system FR-1). */
export const MaskSubKind = z.enum(["painted", "from_layer"]);
export type MaskSubKind = z.infer<typeof MaskSubKind>;

/** Source-channel selector for `from_layer` masks (mask-system FR-15). */
export const FromLayerChannel = z.enum(["alpha", "luminance"]);
export type FromLayerChannel = z.infer<typeof FromLayerChannel>;

export const BlendMode = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
]);
export type BlendMode = z.infer<typeof BlendMode>;

export const LayerSummary = z.object({
  id: LayerId,
  kind: LayerKind,
  name: z.string(),
  position: z.number().int().nonnegative(),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  blend_mode: BlendMode,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type LayerSummary = z.infer<typeof LayerSummary>;

// ---------- Control layer ----------

export const ControlLayerType = z.enum([
  // Reference / IP-Adapter family
  "reference",
  "style",
  "composition",
  "face",
  // Structural / ControlNet family
  "scribble",
  "line_art",
  "soft_edge",
  "canny",
  "depth",
  "normal",
  "pose",
  "segmentation",
  "unblur",
  "stencil",
]);
export type ControlLayerType = z.infer<typeof ControlLayerType>;

export const ControlLayerSummary = z.object({
  id: ControlLayerId,
  type: ControlLayerType,
  weight: z.number().min(0).max(2),
  layer_id: LayerId.optional(),
  scope: z.enum(["global", "region"]).default("global"),
});
export type ControlLayerSummary = z.infer<typeof ControlLayerSummary>;

// ---------- Region ----------

export const RegionSummary = z.object({
  id: RegionId,
  layer_id: LayerId,
  prompt: z.string(),
  negative_prompt: z.string().optional(),
  control_layer_ids: z.array(ControlLayerId).default([]),
});
export type RegionSummary = z.infer<typeof RegionSummary>;

// ---------- Document ----------

export const DocumentSummary = z.object({
  id: DocumentId,
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  layer_count: z.number().int().nonnegative(),
  active_workspace: WorkspaceTag,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const SelectionSummary = z.object({
  active: z.boolean(),
  bbox: Rect.optional(),
  has_mask: z.boolean(),
});
export type SelectionSummary = z.infer<typeof SelectionSummary>;

export const DocumentState = z.object({
  document: DocumentSummary,
  layers: z.array(LayerSummary),
  selection: SelectionSummary,
  control_layers: z.array(ControlLayerSummary),
  regions: z.array(RegionSummary),
  active_tool: z
    .string()
    .optional()
    .describe("UI-side active tool id; informational for agents."),
});
export type DocumentState = z.infer<typeof DocumentState>;

// ---------- History ----------

export const HistoryItemSummary = z.object({
  id: HistoryItemId,
  prompt: z.string(),
  resolved_verb: z.enum(["generate", "refine", "fill", "constrained_variation"]),
  seed: z.number().int(),
  created_at: z.string().datetime(),
  applied_to_layer_id: LayerId.optional(),
  thumbnail_ref: ImageEnvelope.optional(),
});
export type HistoryItemSummary = z.infer<typeof HistoryItemSummary>;

export const HistoryItemFull = HistoryItemSummary.extend({
  negative_prompt: z.string().optional(),
  strength: z.number().min(0).max(100),
  preset: z.string().optional(),
  model: z.string().optional(),
  control_layer_ids: z.array(ControlLayerId).default([]),
  region_ids: z.array(RegionId).default([]),
  selection_used: Selection.optional(),
  image_ref: ImageEnvelope.optional(),
});
export type HistoryItemFull = z.infer<typeof HistoryItemFull>;

// ---------- Jobs ----------

export const JobOutcome = z.enum(["success", "failure", "cancelled"]);
export type JobOutcome = z.infer<typeof JobOutcome>;

export const JobStage = z.enum([
  "queued",
  "preparing",
  "inferring",
  "post_processing",
  "uploading",
  "complete",
  "error",
]);
export type JobStage = z.infer<typeof JobStage>;

export const JobSummary = z.object({
  id: JobId,
  document_id: DocumentId.optional(),
  tool_name: z.string(),
  stage: JobStage,
  percent: z.number().min(0).max(100),
  eta_seconds: z.number().int().nonnegative().optional(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  outcome: JobOutcome.optional(),
  error: ErrorResponse.optional(),
  history_item_id: HistoryItemId.optional(),
});
export type JobSummary = z.infer<typeof JobSummary>;

// ---------- Models / presets ----------

export const ModelKind = z.enum([
  "checkpoint",
  "lora",
  "controlnet",
  "ip_adapter",
  "vae",
  "upscaler",
]);
export type ModelKind = z.infer<typeof ModelKind>;

/** `<registry>:<id>` per Q7 in design.md §1. */
export const ModelId = z
  .string()
  .regex(
    /^(hf|civitai|file):[\w./@:\-]+$/,
    "Must be `<registry>:<id>` with registry in {hf, civitai, file}",
  );
export type ModelId = z.infer<typeof ModelId>;

export const ModelSummary = z.object({
  id: ModelId,
  kind: ModelKind,
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  installed: z.boolean(),
  source_url: z.string().optional(),
});
export type ModelSummary = z.infer<typeof ModelSummary>;

export const PresetSummary = z.object({
  id: PresetId,
  name: z.string(),
  model: ModelId,
  loras: z.array(z.object({ model: ModelId, weight: z.number() })).default([]),
  sampler: z.string(),
  steps: z.number().int().min(1).max(150),
  cfg_scale: z.number(),
});
export type PresetSummary = z.infer<typeof PresetSummary>;

// ---------- Server / audit ----------

export const PairedDevice = z.object({
  token_id: TokenId,
  token_name: z.string(),
  paired_at: z.string().datetime(),
  last_seen_at: z.string().datetime().optional(),
  revoked_at: z.string().datetime().optional(),
});
export type PairedDevice = z.infer<typeof PairedDevice>;

export const AuditEntry = z.object({
  id: z.string(),
  token_name: z.string(),
  operation: z.string(),
  args_summary: z.string(),
  outcome: z.enum(["success", "failure", "denied"]),
  error_code: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const ServerInfo = z.object({
  name: z.string(),
  server_version: z.string(),
  catalog_version_range: z.tuple([z.string(), z.string()]),
  comfyui_status: z.enum(["ready", "starting", "disconnected", "unknown"]),
  mounted_transports: z.array(z.enum(["stdio", "http", "in-memory"])),
  audit_log_enabled: z.boolean(),
  recommended_starting_workflow: z
    .object({
      prompts: z.array(z.string()),
      tools: z.array(z.string()),
      summary: z.string(),
    })
    .describe("FR-54: 'you-are-here' map for fresh agents."),
});
export type ServerInfo = z.infer<typeof ServerInfo>;

// ---------- Undo/redo ----------

export const CommandSummary = z.object({
  id: z.string(),
  tool_name: z.string(),
  description: z.string(),
  performed_at: z.string().datetime(),
  reversible: z.boolean(),
});
export type CommandSummary = z.infer<typeof CommandSummary>;
