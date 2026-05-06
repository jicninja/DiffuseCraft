import { generateAndIterate } from "./generate-and-iterate";
import { inpaintRegion } from "./inpaint-region";
import { refineWithControl } from "./refine-with-control";
import { batchVariations } from "./batch-variations";

export const promptCatalog = [
  generateAndIterate,
  inpaintRegion,
  refineWithControl,
  batchVariations,
] as const;
