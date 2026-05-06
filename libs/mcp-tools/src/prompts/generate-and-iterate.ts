import { definePrompt } from "../shared/define-tool";

export const generateAndIterate = definePrompt({
  name: "generate-and-iterate",
  description:
    "Recommended sequence for generating multiple variations and applying the best one.",
  arguments: [
    { name: "prompt", required: true, description: "English prompt." },
    {
      name: "variations_count",
      required: false,
      default: "4",
      description: "Number of variations to generate.",
    },
  ],
  template: `You are working with DiffuseCraft. Generate {variations_count} variations of "{prompt}":

1. Call \`generate_image({ prompt: "{prompt}", batch_size: {variations_count} })\`.
2. Subscribe to \`job.progress\` events to monitor.
3. When \`job.completed\` arrives, call \`get_history_item\` for each result (up to {variations_count} items).
4. Inspect thumbnails via \`get_image({ scope: "thumbnail", id, max_dimension: 256 })\`.
5. Pick the best (or ask the user) and call \`apply_history_item({ history_item_id })\`.`,
  since: "1.0.0",
});
