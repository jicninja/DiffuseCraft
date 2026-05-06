/**
 * Catalog conformance assertions (H.1, H.2, H.3, H.4, H.6).
 *
 * Self-contained runtime checks invoked by `scripts/emit-json-schema.ts`
 * **and** runnable as a standalone `tsx` script. When Vitest is added to
 * the workspace, these assertions can be wrapped in `test()` blocks
 * unchanged.
 */
import { catalog } from "../manifest";

export interface ConformanceFailure {
  rule: string;
  detail: string;
}

const NON_OBVIOUS_DESCRIPTION_WORD_CAP = 200;
const OBVIOUS_DESCRIPTION_WORD_CAP = 60;
const TOOL_CAP = 65;
const FOOTPRINT_CAP_BYTES = 100_000;

const wordCount = (text: string): number =>
  text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean).length;

export const isObviousReadTool = (name: string): boolean =>
  name.startsWith("get_") || name.startsWith("list_");

export const runConformance = (
  emittedJson: string,
): { ok: boolean; failures: ConformanceFailure[] } => {
  const failures: ConformanceFailure[] = [];

  // H.3 — tool count ≤ 65 (FR-36, current cap)
  if (catalog.tools.length > TOOL_CAP) {
    failures.push({
      rule: "tool-count",
      detail: `${catalog.tools.length} > ${TOOL_CAP} (FR-36)`,
    });
  }

  // H.2 — footprint ≤ 100 KB (FR-33)
  const bytes = Buffer.byteLength(emittedJson, "utf8");
  if (bytes > FOOTPRINT_CAP_BYTES) {
    failures.push({
      rule: "footprint",
      detail: `${bytes} > ${FOOTPRINT_CAP_BYTES} (FR-33)`,
    });
  }

  // H.4 — description word budget (FR-34)
  for (const tool of catalog.tools) {
    const cap = isObviousReadTool(tool.name)
      ? OBVIOUS_DESCRIPTION_WORD_CAP
      : NON_OBVIOUS_DESCRIPTION_WORD_CAP;
    const words = wordCount(tool.description);
    if (words > cap) {
      failures.push({
        rule: "description-budget",
        detail: `${tool.name}: ${words} words > ${cap} (FR-34)`,
      });
    }
  }

  // H.1 — example input/output validate against schemas (acceptance §5.4)
  for (const tool of catalog.tools) {
    if (!tool.example) continue;
    const inputResult = tool.inputSchema.safeParse(tool.example.input);
    if (!inputResult.success) {
      failures.push({
        rule: "example-input",
        detail: `${tool.name}: ${JSON.stringify(inputResult.error.format())}`,
      });
    }
    const outputResult = tool.outputSchema.safeParse(tool.example.output);
    if (!outputResult.success) {
      failures.push({
        rule: "example-output",
        detail: `${tool.name}: ${JSON.stringify(outputResult.error.format())}`,
      });
    }
  }

  // H.6 — manifest coverage: assert every requirements §3.3 baseline tool
  // is present by name. The list mirrors the 38-tool baseline table in
  // `requirements.md` §3.3.19.
  const requiredTools = [
    // Server / session
    "get_server_info",
    "revoke_token",
    "get_audit_log",
    // Documents
    "create_document",
    "set_active_document",
    "get_document_state",
    // Layers
    "add_layer",
    "remove_layer",
    "update_layer",
    // Selection
    "set_selection",
    "get_selection",
    // Generation
    "generate_image",
    "cancel_job",
    "get_job_status",
    // History
    "get_history_item",
    "apply_history_item",
    "discard_history_item",
    // Control layers
    "add_control_layer",
    "remove_control_layer",
    // Regions
    "define_region",
    "remove_region",
    // Workspaces
    "set_workspace",
    "get_workspace",
    // Upscale
    "upscale_image",
    // Models / presets
    "download_model",
    "delete_model",
    "set_preset",
    "delete_preset",
    // Speech / enhance
    "transcribe_audio",
    "enhance_prompt",
    // Undo / redo
    "undo",
    "redo",
    // Image read
    "get_image",
    "get_pixel",
    // Image edit
    "paint_strokes",
    "paint_area",
    "upload_blob",
    // Export
    "export_image",
  ];
  const presentNames = new Set<string>(catalog.tools.map((t) => t.name));
  for (const required of requiredTools) {
    if (!presentNames.has(required)) {
      failures.push({
        rule: "missing-baseline-tool",
        detail: `${required} (requirements §3.3.19)`,
      });
    }
  }

  // H.6 cont. — required resources, events, prompts
  const requiredResources = [
    "diffusecraft://server/info",
    "diffusecraft://server/paired-devices",
    "diffusecraft://server/audit-log",
    "diffusecraft://documents/list",
    "diffusecraft://document/{id}/state",
    "diffusecraft://layers/list",
    "diffusecraft://control-layers/list",
    "diffusecraft://regions/list",
    "diffusecraft://history/list",
    "diffusecraft://history/{id}",
    "diffusecraft://jobs/list",
    "diffusecraft://models/list",
    "diffusecraft://presets/list",
    "diffusecraft://undo-stack/{document-id}",
    "diffusecraft://redo-stack/{document-id}",
    "diffusecraft://blob/{id}",
  ];
  const resourceUris = new Set<string>(catalog.resources.map((r) => r.uri));
  for (const uri of requiredResources) {
    if (!resourceUris.has(uri)) {
      failures.push({
        rule: "missing-resource",
        detail: `${uri} (design.md §4)`,
      });
    }
  }

  const requiredEvents = [
    "job.progress",
    "job.completed",
    "document.changed",
    "model.download.progress",
    "audit.entry",
  ];
  const eventNames = new Set<string>(catalog.events.map((e) => e.name));
  for (const name of requiredEvents) {
    if (!eventNames.has(name)) {
      failures.push({
        rule: "missing-event",
        detail: `${name} (design.md §5)`,
      });
    }
  }

  const requiredPrompts = [
    "generate-and-iterate",
    "inpaint-region",
    "refine-with-control",
    "batch-variations",
  ];
  const promptNames = new Set(catalog.prompts.map((p) => p.name));
  for (const name of requiredPrompts) {
    if (!promptNames.has(name)) {
      failures.push({
        rule: "missing-prompt",
        detail: `${name} (FR-43)`,
      });
    }
  }

  return { ok: failures.length === 0, failures };
};
