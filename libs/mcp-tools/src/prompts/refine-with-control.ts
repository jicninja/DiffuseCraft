import { definePrompt } from "../shared/define-tool";

export const refineWithControl = definePrompt({
  name: "refine-with-control",
  description:
    "Add a control layer (depth/canny/pose/etc.) and refine the canvas with strength<100.",
  arguments: [
    { name: "prompt", required: true },
    {
      name: "control_type",
      required: true,
      description: "One of canny, depth, pose, line_art, etc.",
    },
    {
      name: "control_layer_id",
      required: true,
      description: "Existing layer to source the control signal from.",
    },
    { name: "strength", required: false, default: "70" },
  ],
  template: `Refine the canvas using a control layer:

1. Call \`add_control_layer({ type: "{control_type}", layer_id: "{control_layer_id}", weight: 1 })\`.
2. Call \`generate_image({ prompt: "{prompt}", strength: {strength}, control_layer_ids: [<id from step 1>] })\`.
3. On \`job.completed\`, inspect the result and \`apply_history_item({ history_item_id })\`.`,
  since: "1.0.0",
});
