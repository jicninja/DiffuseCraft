import { z } from "zod";
import { defineTool } from "../../shared/define-tool";
import { PresetId } from "../../shared/ids";
import { ModelId } from "../../shared/common";

const Input = z.object({
  id: PresetId.optional()
    .describe("Omit to create. Provide to update existing preset."),
  name: z.string().min(1).max(120),
  model: ModelId,
  loras: z
    .array(
      z.object({
        model: ModelId,
        weight: z.number().min(-2).max(2),
      }),
    )
    .max(8)
    .default([]),
  sampler: z.string(),
  steps: z.number().int().min(1).max(150),
  cfg_scale: z.number().min(0).max(30),
});

const Output = z.object({
  preset_id: PresetId,
  created: z.boolean(),
});

export const setPreset = defineTool({
  name: "set_preset",
  title: "Set preset (upsert)",
  description:
    "Upsert a preset bundle (model + sampler + LoRAs + steps + cfg). Creates if `id` absent; updates fields if present (replacing on conflict). Idempotent for identical input.",
  category: "write",
  idempotent: true,
  reversible: false,
  inputSchema: Input,
  outputSchema: Output,
  since: "1.0.0",
});
