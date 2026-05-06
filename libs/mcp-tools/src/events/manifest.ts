/**
 * Event catalog (FR-11..FR-15, design.md §5).
 *
 * Events are typed channels emitted by the server for long-running ops,
 * document mutations, model downloads, and audit entries. Clients
 * subscribe via the MCP transport's notification stream.
 */
import { z } from "zod";
import { defineEvent } from "../shared/define-tool";
import {
  AuditEntry,
  JobOutcome,
  JobStage,
} from "../shared/common";
import { ImageEnvelope } from "../shared/envelope";
import {
  DocumentId,
  HistoryItemId,
  JobId,
  LayerId,
} from "../shared/ids";
import { ErrorResponse } from "../shared/errors";

const Bbox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const eventCatalog = [
  defineEvent({
    name: "job.progress",
    description: "Periodic progress for a running job.",
    payloadSchema: z.object({
      job_id: JobId,
      percent: z.number().min(0).max(100),
      eta_seconds: z.number().int().nonnegative().optional(),
      stage: JobStage,
    }),
    since: "1.0.0",
  }),
  defineEvent({
    name: "job.completed",
    description:
      "Terminal event for a job. Includes `history_item_id` and a `thumbnail_ref` so agents can decide whether to fetch the full image (FR-45).",
    payloadSchema: z.object({
      job_id: JobId,
      outcome: JobOutcome,
      history_item_id: HistoryItemId.optional(),
      thumbnail_ref: ImageEnvelope.optional(),
      error: ErrorResponse.optional(),
    }),
    since: "1.0.0",
  }),
  defineEvent({
    name: "document.changed",
    description:
      "Broadcast to all paired clients when any client mutates the document. Carries the originating token name (FR-21) and a conflict flag for last-write-wins overlaps (FR-23).",
    payloadSchema: z.object({
      document_id: DocumentId,
      change_summary: z.string(),
      affected_layer_ids: z.array(LayerId),
      bbox: Bbox.optional(),
      originating_token_name: z.string(),
      conflict: z.boolean().default(false),
    }),
    since: "1.0.0",
  }),
  defineEvent({
    name: "model.download.progress",
    description: "Progress events for `download_model` jobs.",
    payloadSchema: z.object({
      model_id: z.string(),
      percent: z.number().min(0).max(100),
      bytes_done: z.number().int().nonnegative(),
      bytes_total: z.number().int().nonnegative(),
    }),
    since: "1.0.0",
  }),
  defineEvent({
    name: "audit.entry",
    description: "Optional stream of new audit log entries (FR-15).",
    payloadSchema: AuditEntry,
    since: "1.0.0",
  }),
] as const;
