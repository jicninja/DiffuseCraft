import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { JobId } from "../../shared/ids";
import { ModelId, ModelKind } from "../../shared/common";

const Input = z.object({
  id: ModelId.describe(
    "`<registry>:<id>` (Q7). Examples: `hf:Stability-AI/sdxl-base-1.0`, `civitai:dreamshaper`, `file:/abs/path.safetensors`.",
  ),
  kind: ModelKind,
  source_url: z
    .string()
    .url()
    .optional()
    .describe("Optional explicit URL; required for `file:` ids."),
});

const Output = z.object({
  job_id: JobId,
  already_present: z.boolean(),
});

export const downloadModel = defineTool({
  name: "download_model",
  title: "Download model",
  description:
    "Downloads a model from a known registry (`hf`, `civitai`, `file`). Idempotent: if the model is already present locally, returns immediately with `already_present: true` and a synthetic completed job. Subscribe to `model.download.progress` for ongoing downloads.",
  category: "job",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  example: {
    input: { id: "hf:Stability-AI/sdxl-base-1.0", kind: "checkpoint" },
    output: {
      job_id: "01HZK2X9VTVM7E9WX0H4QF6P5N" as never,
      already_present: false,
    },
  },
  since: "1.0.0",
});
