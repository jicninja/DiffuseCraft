/**
 * Resource catalog manifest (FR-8, design.md §4).
 *
 * Resources are queryable state. Lists are exposed only as resources
 * (not as parallel `list_*` tools, per design.md §1 Q5) so the catalog
 * footprint stays small. Critical reads remain as tools (`get_*`) for
 * tools-only agents.
 */
import { z } from "zod";
import { defineResource } from "../shared/define-tool";
import { paginated } from "../shared/pagination";
import {
  AuditEntry,
  CommandSummary,
  ControlLayerSummary,
  DocumentState,
  DocumentSummary,
  HistoryItemFull,
  HistoryItemSummary,
  JobSummary,
  LayerSummary,
  ModelSummary,
  PairedDevice,
  PresetSummary,
  RegionSummary,
  ServerInfo,
} from "../shared/common";
import { ImageEnvelope } from "../shared/envelope";

const BlobContent = z.object({
  uri: z.string(),
  expires_at: z.string().datetime(),
  envelope: ImageEnvelope,
});

export const resourceCatalog = [
  defineResource({
    uri: "diffusecraft://server/info",
    title: "Server info",
    description:
      "Server identity, version, supported catalog version range, ComfyUI status, mounted transports, and recommended starting workflow.",
    contentSchema: ServerInfo,
    since: "1.0.0",
    supports_since: false,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://server/paired-devices",
    title: "Paired devices",
    description: "Currently-paired devices with token names and last-seen timestamps.",
    contentSchema: paginated(PairedDevice),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://server/audit-log",
    title: "Audit log",
    description: "Recent audit entries for tool invocations and admin actions.",
    contentSchema: paginated(AuditEntry),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://documents/list",
    title: "Documents",
    description: "All loaded documents on the server with summaries.",
    contentSchema: paginated(DocumentSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://document/{id}/state",
    title: "Document state",
    description:
      "Full state of a single document: layers + selection + workspace + control layers + regions.",
    contentSchema: DocumentState,
    since: "1.0.0",
    supports_since: false,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://layers/list",
    title: "Layers",
    description: "Layer summaries for the active document.",
    contentSchema: paginated(LayerSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://control-layers/list",
    title: "Control layers",
    description: "Active control layers across all documents.",
    contentSchema: paginated(ControlLayerSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://regions/list",
    title: "Regions",
    description: "Active regions across all documents.",
    contentSchema: paginated(RegionSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://history/list",
    title: "Generation history",
    description:
      "Generation history previews paginated. Includes prompts, parameters, and thumbnail refs.",
    contentSchema: paginated(HistoryItemSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://history/{id}",
    title: "History item",
    description: "Full history item including image ref.",
    contentSchema: HistoryItemFull,
    since: "1.0.0",
    supports_since: false,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://jobs/list",
    title: "Jobs",
    description: "Active and recently-completed jobs.",
    contentSchema: paginated(JobSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://models/list",
    title: "Models",
    description: "Available checkpoints, LoRAs, ControlNets, IP-Adapters, VAEs, upscalers.",
    contentSchema: paginated(ModelSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://presets/list",
    title: "Presets",
    description: "Saved generation presets (model + sampler + LoRAs + steps + cfg).",
    contentSchema: paginated(PresetSummary),
    since: "1.0.0",
    supports_since: true,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://undo-stack/{document-id}",
    title: "Undo stack",
    description: "Per-client undo stack for a document (list of command summaries).",
    contentSchema: paginated(CommandSummary),
    since: "1.0.0",
    supports_since: false,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://redo-stack/{document-id}",
    title: "Redo stack",
    description: "Per-client redo stack for a document.",
    contentSchema: paginated(CommandSummary),
    since: "1.0.0",
    supports_since: false,
    supports_fields: true,
  }),
  defineResource({
    uri: "diffusecraft://blob/{id}",
    title: "Blob",
    description:
      "Short-lived signed blob (≤5 min) for large image bytes. Token-scoped. Supports HTTP Range requests.",
    contentSchema: BlobContent,
    since: "1.0.0",
    supports_since: false,
    supports_fields: false,
  }),
] as const;
