import { definePrompt } from "../shared/define-tool";

export const inpaintRegion = definePrompt({
  name: "inpaint-region",
  description:
    "Replace pixels inside a selected region using a prompt (krita 'Fill' mode).",
  arguments: [
    { name: "prompt", required: true, description: "English prompt for the new content." },
    {
      name: "rect",
      required: true,
      description: "JSON `{ x, y, w, h }` of the region to inpaint.",
    },
  ],
  template: `Inpaint a region using DiffuseCraft:

1. Call \`set_selection({ shape: { kind: "rect", rect: {rect} } })\`.
2. Call \`generate_image({ prompt: "{prompt}", strength: 100, selection: { kind: "rect", rect: {rect} }, selection_mode: "Fill" })\`.
3. Wait for \`job.completed\`; inspect the resulting \`history_item_id\`.
4. Call \`apply_history_item({ history_item_id })\` to commit the change.`,
  since: "1.0.0",
});
