import { definePrompt } from "../shared/define-tool";

export const batchVariations = definePrompt({
  name: "batch-variations",
  description:
    "Generate N variations with a fixed prompt and varied seeds, then list the history.",
  arguments: [
    { name: "prompt", required: true },
    { name: "count", required: false, default: "8" },
  ],
  template: `Generate {count} variations of "{prompt}":

1. Call \`generate_image({ prompt: "{prompt}", batch_size: {count}, seed: "random" })\`.
2. Subscribe to \`job.progress\` and \`job.completed\` events.
3. Read \`diffusecraft://history/list\` to enumerate the new items.
4. Use \`get_image({ scope: "thumbnail", id, max_dimension: 256 })\` to inspect each.`,
  since: "1.0.0",
});
